import { Injectable } from '@angular/core';
import { CommentRepository, ModerationCaseRepository, SensitiveWordRepository, UserRepository } from '../repositories';
import { AuditService } from './audit.service';
import { Comment, ModerationCase, SensitiveWord } from '../models';
import { CommentStatus, ModerationDecision, AuditAction, UserRole } from '../enums';
import { COMMENT_TRANSITIONS, assertTransition } from '../state-machines';
import { MODERATION_CONSTANTS } from '../constants';
import { generateId, now } from '../utils/id';
import { sanitizePlainText, countLinks, containsBlocklistedWords } from '../utils/sanitizer';
import { AuthorizationError, NotFoundError, ValidationError, RateLimitError } from '../errors';

@Injectable({ providedIn: 'root' })
export class ModerationService {
  constructor(
    private readonly commentRepo: CommentRepository,
    private readonly modRepo: ModerationCaseRepository,
    private readonly wordRepo: SensitiveWordRepository,
    private readonly userRepo: UserRepository,
    private readonly audit: AuditService,
  ) {}

  private isMgmt(roles: UserRole[]): boolean {
    return roles.some(r => r === UserRole.HRCoordinator || r === UserRole.Administrator);
  }

  async submitComment(postId: string, content: string, actorId: string, actorOrgId: string): Promise<Comment> {
    const user = await this.userRepo.getById(actorId); if (!user) throw new NotFoundError('User', actorId);
    if (user.lastCommentAt) {
      const elapsed = (Date.now() - new Date(user.lastCommentAt).getTime()) / 1000;
      if (elapsed < MODERATION_CONSTANTS.COOLDOWN_SECONDS) {
        throw new RateLimitError(`Cooldown: wait ${Math.ceil(MODERATION_CONSTANTS.COOLDOWN_SECONDS - elapsed)}s`);
      }
    }
    const sanitized = sanitizePlainText(content); if (!sanitized.trim()) throw new ValidationError('Content cannot be empty');
    if (countLinks(content) > MODERATION_CONSTANTS.MAX_LINKS_PER_COMMENT) {
      throw new ValidationError(`Max ${MODERATION_CONSTANTS.MAX_LINKS_PER_COMMENT} links allowed`);
    }
    const words = await this.wordRepo.getAll();
    const violations = containsBlocklistedWords(content, words.map(w => w.word));
    const issues = violations.map(w => `blocklisted:${w}`);
    const comment: Comment = { id: generateId(), organizationId: actorOrgId, postId, authorId: actorId, content: sanitized, status: issues.length > 0 ? CommentStatus.Pending : CommentStatus.Approved, moderationReason: null, version: 1, createdAt: now(), updatedAt: now() };
    await this.commentRepo.add(comment);
    user.lastCommentAt = now(); user.updatedAt = now(); user.version += 1;
    await this.userRepo.put(user);
    if (issues.length > 0) {
      const mc: ModerationCase = { id: generateId(), organizationId: actorOrgId, commentId: comment.id, detectedIssues: issues, decision: null, decisionReason: null, decidedBy: null, decidedAt: null, version: 1, createdAt: now(), updatedAt: now() };
      await this.modRepo.add(mc);
    }
    return comment;
  }

  async decide(commentId: string, decision: ModerationDecision, reason: string, actorId: string, actorRoles: UserRole[], actorOrgId: string): Promise<Comment> {
    if (!this.isMgmt(actorRoles)) throw new AuthorizationError('Not authorized');
    // Pre-flight: existence and org checks before taking the write lock.
    const preCheck = await this.commentRepo.getById(commentId);
    if (!preCheck) throw new NotFoundError('Comment', commentId);
    if (preCheck.organizationId !== actorOrgId) throw new AuthorizationError('Organization mismatch');
    const targetStatus = decision === ModerationDecision.Approved ? CommentStatus.Approved : CommentStatus.Rejected;
    // Atomic: transition assertion + version increment inside a single IDB readwrite transaction.
    // If two moderators read the same Pending comment simultaneously, the second updateWithLock
    // call will find the status already changed, causing assertTransition to throw StateMachineError.
    const updated = await this.commentRepo.updateWithLock(commentId, (current) => {
      if (current.organizationId !== actorOrgId) throw new AuthorizationError('Organization mismatch');
      assertTransition(COMMENT_TRANSITIONS, current.status as CommentStatus, targetStatus, 'Comment');
      return { ...current, status: targetStatus, moderationReason: reason, version: current.version + 1, updatedAt: now() };
    });
    const cases = await this.modRepo.getByComment(commentId);
    if (cases.length > 0) {
      const mc = cases[0]; mc.decision = decision; mc.decisionReason = reason; mc.decidedBy = actorId; mc.decidedAt = now(); mc.version += 1; mc.updatedAt = now();
      await this.modRepo.put(mc);
    }
    await this.audit.log(actorId, AuditAction.ModerationDecision, 'comment', commentId, actorOrgId, { decision, reason });
    return updated;
  }

  /**
   * List pending comments awaiting moderation.
   * RBAC: HR Coordinators and Administrators only.
   * ABAC: scoped to actorOrgId.
   */
  async getPendingComments(actorRoles: UserRole[], actorOrgId: string): Promise<Comment[]> {
    if (!this.isMgmt(actorRoles)) throw new AuthorizationError('Only HR Coordinators and Administrators can view pending comments');
    return (await this.commentRepo.getByStatus(CommentStatus.Pending)).filter(c => c.organizationId === actorOrgId);
  }

  /**
   * Get comments for a post.
   * ABAC: filters to actorOrgId to prevent cross-org comment exposure.
   * RBAC: includeUnapproved (Pending/Rejected) requires HR Coordinator or Administrator.
   *       By default (includeUnapproved=false), returns only Approved comments — no auth required.
   */
  async getCommentsForPost(postId: string, actorOrgId: string, actorRoles: UserRole[], includeUnapproved = false): Promise<Comment[]> {
    if (includeUnapproved && !this.isMgmt(actorRoles)) {
      throw new AuthorizationError('Only HR Coordinators and Administrators can view unapproved comments');
    }
    const comments = (await this.commentRepo.getByPost(postId)).filter(c => c.organizationId === actorOrgId);
    return includeUnapproved ? comments : comments.filter(c => c.status === CommentStatus.Approved);
  }

  /**
   * List all sensitive words in the blocklist.
   * RBAC: HR Coordinators and Administrators only.
   */
  async listSensitiveWords(actorRoles: UserRole[], actorOrgId: string): Promise<SensitiveWord[]> {
    if (!this.isMgmt(actorRoles)) throw new AuthorizationError('Only HR Coordinators and Administrators can view the blocklist');
    return this.wordRepo.getAll();
  }

  /**
   * Add a new sensitive word to the blocklist.
   * RBAC: Administrators only.
   */
  async addSensitiveWord(word: string, actorId: string, actorRoles: UserRole[]): Promise<SensitiveWord> {
    if (!actorRoles.includes(UserRole.Administrator)) throw new AuthorizationError('Only Administrators can add blocklist words');
    const trimmed = word.trim().toLowerCase();
    if (!trimmed) throw new ValidationError('Word cannot be empty');
    const entry: SensitiveWord = { id: generateId(), word: trimmed, createdAt: now(), createdBy: actorId };
    await this.wordRepo.add(entry);
    return entry;
  }

  /**
   * Remove a sensitive word from the blocklist.
   * RBAC: Administrators only.
   */
  async removeSensitiveWord(wordId: string, actorId: string, actorRoles: UserRole[]): Promise<void> {
    if (!actorRoles.includes(UserRole.Administrator)) throw new AuthorizationError('Only Administrators can remove blocklist words');
    await this.wordRepo.delete(wordId);
  }
}
