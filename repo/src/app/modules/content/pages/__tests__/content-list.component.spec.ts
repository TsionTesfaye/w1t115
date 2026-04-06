import { describe, it, expect, beforeAll, afterEach, vi } from 'vitest';
import { TestBed } from '@angular/core/testing';
import { signal, computed } from '@angular/core';
import { ContentListComponent } from '../content-list.component';
import { SessionService } from '../../../../core/services/session.service';
import { ContentService } from '../../../../core/services/content.service';
import { ModerationService } from '../../../../core/services/moderation.service';
import { UserRole, ContentPostStatus } from '../../../../core/enums';
import { ContentPost } from '../../../../core/models';

afterEach(() => {
  TestBed.resetTestingModule();
});

// ── Mock helpers ─────────────────────────────────────────────────────────────

function makeSessionMock(role: UserRole) {
  return {
    activeRole: signal(role),
    isAuthenticated: computed(() => true),
    initialized: signal(true),
    currentUser: signal({ displayName: 'Test User' }),
    organizationId: computed(() => 'org1'),
    userId: computed(() => 'user1'),
    userRoles: computed(() => [role]),
    requireAuth: () => ({
      userId: 'user1',
      organizationId: 'org1',
      roles: [role],
      activeRole: role,
    }),
  };
}

const draftPost: ContentPost = {
  id: 'p1', organizationId: 'org1', authorId: 'user1',
  title: 'Draft Post', body: 'Some draft body', tags: ['tag1'], topics: [],
  status: ContentPostStatus.Draft, scheduledPublishAt: null, pinnedUntil: null,
  version: 1, createdAt: '2026-01-01', updatedAt: '2026-01-01',
};

const publishedPost: ContentPost = {
  id: 'p2', organizationId: 'org1', authorId: 'user1',
  title: 'Published Post', body: 'Live content', tags: [], topics: [],
  status: ContentPostStatus.Published, scheduledPublishAt: null, pinnedUntil: null,
  version: 2, createdAt: '2026-01-01', updatedAt: '2026-01-02',
};

const fakeModerationSvc = {
  submitComment: vi.fn().mockResolvedValue({}),
  getCommentsForPost: vi.fn().mockResolvedValue([]),
  getPendingComments: vi.fn().mockResolvedValue([]),
  decide: vi.fn().mockResolvedValue({}),
};

function configure(role: UserRole, overrides: Record<string, any> = {}) {
  const contentSvc = {
    listPosts: vi.fn().mockResolvedValue([]),
    createPost: vi.fn().mockResolvedValue({ ...draftPost }),
    transitionStatus: vi.fn().mockResolvedValue({ ...draftPost, status: ContentPostStatus.Published }),
    pinPost: vi.fn().mockResolvedValue({}),
    ...overrides,
  };
  const sessionMock = makeSessionMock(role);

  TestBed.configureTestingModule({
    imports: [ContentListComponent],
    providers: [
      { provide: SessionService, useValue: sessionMock },
      { provide: ContentService, useValue: contentSvc },
      { provide: ModerationService, useValue: fakeModerationSvc },
    ],
  });

  const fixture = TestBed.createComponent(ContentListComponent);
  return { component: fixture.componentInstance, contentSvc, sessionMock };
}

// ── Tests ────────────────────────────────────────────────────────────────────

describe('ContentListComponent', () => {
  it('loads posts from service', async () => {
    const { component, contentSvc } = configure(UserRole.HRCoordinator, {
      listPosts: vi.fn().mockResolvedValue([draftPost, publishedPost]),
    });

    await component.loadPosts();

    expect(contentSvc.listPosts).toHaveBeenCalledWith([UserRole.HRCoordinator], 'org1');
    expect(component.posts()).toHaveLength(2);
    expect(component.isLoading()).toBe(false);
  });

  it('creates a new post', async () => {
    const { component, contentSvc } = configure(UserRole.Employer, {
      listPosts: vi.fn().mockResolvedValue([]),
      createPost: vi.fn().mockResolvedValue(draftPost),
    });

    await component.loadPosts();
    component.showCreateForm.set(true);
    component.postForm.patchValue({ title: 'Draft Post', body: 'Some draft body', tags: 'tag1', topics: '' });
    await component.onCreatePost();

    expect(contentSvc.createPost).toHaveBeenCalledWith(
      'Draft Post', 'Some draft body', ['tag1'], [], 'user1', [UserRole.Employer], 'org1',
    );
    expect(component.showCreateForm()).toBe(false);
    expect(component.actionSuccess()).toBe('Post created as draft');
  });

  it('publishes a draft post', async () => {
    const { component, contentSvc } = configure(UserRole.HRCoordinator, {
      listPosts: vi.fn().mockResolvedValue([draftPost]),
      transitionStatus: vi.fn().mockResolvedValue({ ...draftPost, status: ContentPostStatus.Published }),
    });

    await component.loadPosts();
    await component.onPublish(draftPost);

    expect(contentSvc.transitionStatus).toHaveBeenCalledWith(
      'p1', ContentPostStatus.Published, 'user1', [UserRole.HRCoordinator], 'org1', 1,
    );
    expect(component.actionSuccess()).toBe('Post published');
  });
});
