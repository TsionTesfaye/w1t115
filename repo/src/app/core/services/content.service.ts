import { Injectable } from '@angular/core';
import { ContentPostRepository } from '../repositories';
import { AuditService } from './audit.service';
import { ContentPost } from '../models';
import { ContentPostStatus, AuditAction, UserRole } from '../enums';
import { CONTENT_POST_TRANSITIONS, assertTransition } from '../state-machines';
import { CONTENT_CONSTANTS } from '../constants';
import { generateId, now } from '../utils/id';
import { sanitizeHtml } from '../utils/sanitizer';
import { AuthorizationError, NotFoundError, ValidationError, OptimisticLockError } from '../errors';

@Injectable({ providedIn: 'root' })
export class ContentService {
  private static readonly MGMT_ROLES: UserRole[] = [UserRole.Employer, UserRole.HRCoordinator, UserRole.Administrator];
  constructor(private readonly repo: ContentPostRepository, private readonly audit: AuditService) {}

  private assertMgmt(roles: UserRole[]): void {
    if (!roles.some(r => ContentService.MGMT_ROLES.includes(r))) {
      throw new AuthorizationError('Not authorized to manage content');
    }
  }

  private isMgmt(roles: UserRole[]): boolean {
    return roles.some(r => ContentService.MGMT_ROLES.includes(r));
  }

  async createPost(
    title: string, body: string, tags: string[], topics: string[],
    actorId: string, actorRoles: UserRole[], actorOrgId: string,
  ): Promise<ContentPost> {
    this.assertMgmt(actorRoles);
    if (!title.trim()) throw new ValidationError('Title is required');
    const post: ContentPost = {
      id: generateId(), organizationId: actorOrgId, authorId: actorId,
      title: sanitizeHtml(title.trim()), body: sanitizeHtml(body),
      tags, topics, status: ContentPostStatus.Draft,
      scheduledPublishAt: null, pinnedUntil: null,
      version: 1, createdAt: now(), updatedAt: now(),
    };
    await this.repo.add(post);
    return post;
  }

  /**
   * Transition a content post's status.
   * State machine: CONTENT_POST_TRANSITIONS (Draft→Scheduled/Published, Scheduled→Published, Published→Archived).
   * TOCTOU-safe: assertTransition + version check + write all run inside a single updateWithLock transaction.
   * Guard: transitioning to Scheduled requires a future scheduledPublishAt.
   */
  async transitionStatus(
    postId: string, newStatus: ContentPostStatus,
    actorId: string, actorRoles: UserRole[], actorOrgId: string,
    expectedVersion: number, scheduledPublishAt?: string,
  ): Promise<ContentPost> {
    this.assertMgmt(actorRoles);

    // Validate scheduledPublishAt before acquiring the lock
    if (newStatus === ContentPostStatus.Scheduled) {
      if (!scheduledPublishAt) {
        throw new ValidationError('scheduledPublishAt is required when transitioning to Scheduled');
      }
      const scheduledTime = new Date(scheduledPublishAt).getTime();
      if (isNaN(scheduledTime)) throw new ValidationError('scheduledPublishAt is not a valid date');
      if (scheduledTime <= Date.now()) throw new ValidationError('scheduledPublishAt must be in the future');
    }

    // Pre-flight org check (fast fail before acquiring write lock)
    const pre = await this.repo.getById(postId);
    if (!pre) throw new NotFoundError('ContentPost', postId);
    if (pre.organizationId !== actorOrgId) throw new AuthorizationError('Organization mismatch');

    // Atomic: version check + assertTransition + write in one IDB readwrite transaction
    const updated = await this.repo.updateWithLock(postId, (current) => {
      if (current.version !== expectedVersion) throw new OptimisticLockError('ContentPost', postId);
      if (current.organizationId !== actorOrgId) throw new AuthorizationError('Organization mismatch');
      assertTransition(CONTENT_POST_TRANSITIONS, current.status as ContentPostStatus, newStatus, 'ContentPost');
      return {
        ...current,
        status: newStatus,
        scheduledPublishAt: newStatus === ContentPostStatus.Scheduled
          ? scheduledPublishAt!
          : (newStatus === ContentPostStatus.Published || newStatus === ContentPostStatus.Archived)
            ? null
            : current.scheduledPublishAt,
        version: current.version + 1,
        updatedAt: now(),
      };
    });

    if (newStatus === ContentPostStatus.Published) {
      await this.audit.log(actorId, AuditAction.ContentPublished, 'contentPost', postId, actorOrgId);
    }
    return updated;
  }

  /**
   * Pin a published post.
   * Not a status transition — sets pinnedUntil metadata.
   * TOCTOU-safe: version check + write inside a single updateWithLock transaction.
   */
  async pinPost(
    postId: string, actorId: string, actorRoles: UserRole[], actorOrgId: string, expectedVersion: number,
  ): Promise<ContentPost> {
    this.assertMgmt(actorRoles);
    // Pre-flight org check
    const pre = await this.repo.getById(postId);
    if (!pre) throw new NotFoundError('ContentPost', postId);
    if (pre.organizationId !== actorOrgId) throw new AuthorizationError('Organization mismatch');

    // Atomic: version check + status guard + write in one IDB readwrite transaction
    return this.repo.updateWithLock(postId, (current) => {
      if (current.version !== expectedVersion) throw new OptimisticLockError('ContentPost', postId);
      if (current.organizationId !== actorOrgId) throw new AuthorizationError('Organization mismatch');
      if (current.status !== ContentPostStatus.Published) {
        throw new ValidationError('Can only pin a Published post');
      }
      return {
        ...current,
        pinnedUntil: new Date(Date.now() + CONTENT_CONSTANTS.PIN_DURATION_DAYS * 86400000).toISOString(),
        version: current.version + 1,
        updatedAt: now(),
      };
    });
  }

  /**
   * Expire pins on published posts whose pinnedUntil has passed.
   * Called by scheduler — mutates metadata only, not status.
   */
  async expirePins(): Promise<number> {
    const published = await this.repo.getByStatus(ContentPostStatus.Published);
    let count = 0; const t = now();
    for (const p of published) {
      if (p.pinnedUntil && p.pinnedUntil < t) {
        p.pinnedUntil = null; p.version += 1; p.updatedAt = t;
        await this.repo.put(p); count++;
      }
    }
    return count;
  }

  /**
   * Publish posts whose scheduledPublishAt has arrived.
   * Called by scheduler.
   * assertTransition guard: validates Scheduled → Published is a legal transition
   * before mutating — ensures no corrupted state escapes even from the scheduler path.
   */
  async publishScheduledPosts(): Promise<ContentPost[]> {
    const scheduled = await this.repo.getByStatus(ContentPostStatus.Scheduled);
    const t = now(); const result: ContentPost[] = [];
    for (const p of scheduled) {
      if (p.scheduledPublishAt && p.scheduledPublishAt <= t) {
        // Guard: enforce state machine even in the scheduler path
        assertTransition(CONTENT_POST_TRANSITIONS, p.status as ContentPostStatus, ContentPostStatus.Published, 'ContentPost');
        p.status = ContentPostStatus.Published;
        p.scheduledPublishAt = null;
        p.version += 1; p.updatedAt = t;
        await this.repo.put(p);
        result.push(p);
      }
    }
    return result;
  }

  /**
   * List posts in the caller's organization.
   * ABAC: org is always resolved from actorOrgId (session), never from caller input.
   * RBAC: Non-management may only see Published posts.
   *       Management can see all statuses (or filter by a specific status).
   */
  async listPosts(actorRoles: UserRole[], actorOrgId: string, status?: ContentPostStatus): Promise<ContentPost[]> {
    const mgmt = this.isMgmt(actorRoles);
    if (status) {
      if (!mgmt && status !== ContentPostStatus.Published) return [];
      return (await this.repo.getByStatus(status)).filter(p => p.organizationId === actorOrgId);
    }
    const all = await this.repo.getByOrganization(actorOrgId);
    return mgmt ? all : all.filter(p => p.status === ContentPostStatus.Published);
  }
}
