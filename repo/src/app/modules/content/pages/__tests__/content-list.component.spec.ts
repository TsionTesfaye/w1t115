/**
 * ContentListComponent tests — real ContentService and ModerationService backed
 * by in-memory FakeContentPostRepo, etc. from helpers.ts.
 *
 * Boundary stubs kept:
 *  - SessionService → plain stub (no crypto/IDB)
 */

import { describe, it, expect, afterEach } from 'vitest';
import { TestBed } from '@angular/core/testing';
import { signal, computed } from '@angular/core';

import { ContentListComponent } from '../content-list.component';
import { SessionService } from '../../../../core/services/session.service';
import { ContentService } from '../../../../core/services/content.service';
import { ModerationService } from '../../../../core/services/moderation.service';

import { UserRole, ContentPostStatus } from '../../../../core/enums';
import { ContentPost } from '../../../../core/models';
import { now } from '../../../../core/utils/id';

import {
  FakeContentPostRepo, FakeCommentRepo, FakeModerationCaseRepo,
  FakeSensitiveWordRepo, FakeUserRepo,
  fakeAudit,
} from '../../../../core/services/__tests__/helpers';

afterEach(() => {
  TestBed.resetTestingModule();
});

// ── Session stub ──────────────────────────────────────────────────────────────

function makeSessionStub(role: UserRole, userId = 'user1', orgId = 'org1') {
  return {
    activeRole: signal(role),
    isAuthenticated: computed(() => true),
    initialized: signal(true),
    currentUser: signal({ displayName: 'Test User' }),
    organizationId: computed(() => orgId),
    userId: computed(() => userId),
    userRoles: computed(() => [role]),
    requireAuth: () => ({ userId, organizationId: orgId, roles: [role], activeRole: role }),
  };
}

// ── Seed data ─────────────────────────────────────────────────────────────────

const draftPost: ContentPost = {
  id: 'p1', organizationId: 'org1', authorId: 'user1',
  title: 'Draft Post', body: 'Some draft body', tags: ['tag1'], topics: [],
  status: ContentPostStatus.Draft, scheduledPublishAt: null, pinnedUntil: null,
  version: 1, createdAt: now(), updatedAt: now(),
};

const publishedPost: ContentPost = {
  id: 'p2', organizationId: 'org1', authorId: 'user1',
  title: 'Published Post', body: 'Live content', tags: [], topics: [],
  status: ContentPostStatus.Published, scheduledPublishAt: null, pinnedUntil: null,
  version: 2, createdAt: now(), updatedAt: now(),
};

// ── Configure helper ─────────────────────────────────────────────────────────

function configure(role: UserRole, seedPosts: ContentPost[] = []) {
  const contentPostRepo = new FakeContentPostRepo();
  if (seedPosts.length) contentPostRepo.seed(seedPosts);

  const commentRepo = new FakeCommentRepo();
  const modRepo = new FakeModerationCaseRepo();
  const wordRepo = new FakeSensitiveWordRepo();
  const userRepo = new FakeUserRepo();

  const realContentSvc = new ContentService(contentPostRepo as any, fakeAudit as any);
  const realModerationSvc = new ModerationService(
    commentRepo as any, modRepo as any, wordRepo as any, userRepo as any, fakeAudit as any,
  );

  const sessionStub = makeSessionStub(role);

  TestBed.configureTestingModule({
    imports: [ContentListComponent],
    providers: [
      { provide: SessionService, useValue: sessionStub },
      { provide: ContentService, useValue: realContentSvc },
      { provide: ModerationService, useValue: realModerationSvc },
    ],
  });

  const fixture = TestBed.createComponent(ContentListComponent);
  return { component: fixture.componentInstance, contentPostRepo, realContentSvc };
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('ContentListComponent', () => {
  it('loads posts from real ContentService — management sees all statuses', async () => {
    const { component } = configure(UserRole.HRCoordinator, [draftPost, publishedPost]);

    await component.loadPosts();

    expect(component.posts()).toHaveLength(2);
    expect(component.isLoading()).toBe(false);
  });

  it('candidate sees only published posts via real RBAC filter', async () => {
    const { component } = configure(UserRole.Candidate, [draftPost, publishedPost]);

    await component.loadPosts();

    expect(component.posts()).toHaveLength(1);
    expect(component.posts()[0].status).toBe(ContentPostStatus.Published);
  });

  it('creates a new draft post via real ContentService', async () => {
    const { component, contentPostRepo } = configure(UserRole.Employer);

    await component.loadPosts();
    component.showCreateForm.set(true);
    component.postForm.patchValue({ title: 'Draft Post', body: 'Some draft body', tags: 'tag1', topics: '' });
    await component.onCreatePost();

    expect(component.showCreateForm()).toBe(false);
    expect(component.actionSuccess()).toBe('Post created as draft');
    expect(contentPostRepo.snapshot().some(p => p.title === 'Draft Post')).toBe(true);
  });

  it('publishes a draft post via real state machine — Draft→Published', async () => {
    const { component, contentPostRepo } = configure(UserRole.HRCoordinator, [draftPost]);

    await component.loadPosts();
    await component.onPublish(draftPost);

    expect(component.actionSuccess()).toBe('Post published');
    const updated = contentPostRepo.snapshot().find(p => p.id === 'p1');
    expect(updated?.status).toBe(ContentPostStatus.Published);
  });

  it('Candidate cannot create a post — real AuthorizationError from ContentService', async () => {
    const { component } = configure(UserRole.Candidate);

    component.showCreateForm.set(true);
    component.postForm.patchValue({ title: 'Hack Post', body: 'body', tags: '', topics: '' });
    await component.onCreatePost();

    // Component catches the AuthorizationError and sets actionError
    expect(component.actionError()).toBeTruthy();
  });
});
