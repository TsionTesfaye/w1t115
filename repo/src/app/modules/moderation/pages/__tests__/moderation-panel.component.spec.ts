import { describe, it, expect, beforeAll, afterEach, vi } from 'vitest';
import { TestBed } from '@angular/core/testing';
import { signal, computed } from '@angular/core';
import { ModerationPanelComponent } from '../moderation-panel.component';
import { SessionService } from '../../../../core/services/session.service';
import { ModerationService } from '../../../../core/services/moderation.service';
import { UserRole, ModerationDecision, CommentStatus } from '../../../../core/enums';
import { Comment } from '../../../../core/models';

afterEach(() => {
  TestBed.resetTestingModule();
});

// ── Mock helpers ─────────────────────────────────────────────────────────────

function makeSessionMock(role: UserRole) {
  return {
    activeRole: signal(role),
    isAuthenticated: computed(() => true),
    initialized: signal(true),
    currentUser: signal({ displayName: 'Test Moderator' }),
    organizationId: computed(() => 'org1'),
    userId: computed(() => 'mod1'),
    userRoles: computed(() => [role]),
    requireAuth: () => ({
      userId: 'mod1',
      organizationId: 'org1',
      roles: [role],
      activeRole: role,
    }),
  };
}

const pendingComment1: Comment = {
  id: 'c1', organizationId: 'org1', postId: 'post1', authorId: 'author1',
  content: 'Suspicious comment', status: CommentStatus.Pending, moderationReason: null,
  version: 1, createdAt: '2026-01-01', updatedAt: '2026-01-01',
};

const pendingComment2: Comment = {
  id: 'c2', organizationId: 'org1', postId: 'post2', authorId: 'author2',
  content: 'Another flagged comment', status: CommentStatus.Pending, moderationReason: null,
  version: 1, createdAt: '2026-01-02', updatedAt: '2026-01-02',
};

function configure(role: UserRole, overrides: Record<string, any> = {}) {
  const modSvc = {
    getPendingComments: vi.fn().mockResolvedValue([]),
    decide: vi.fn().mockResolvedValue({ ...pendingComment1, status: CommentStatus.Approved }),
    ...overrides,
  };
  const sessionMock = makeSessionMock(role);

  TestBed.configureTestingModule({
    imports: [ModerationPanelComponent],
    providers: [
      { provide: SessionService, useValue: sessionMock },
      { provide: ModerationService, useValue: modSvc },
    ],
  });

  const fixture = TestBed.createComponent(ModerationPanelComponent);
  return { component: fixture.componentInstance, modSvc, sessionMock };
}

// ── Tests ────────────────────────────────────────────────────────────────────

describe('ModerationPanelComponent', () => {
  it('loads pending comments', async () => {
    const { component, modSvc } = configure(UserRole.HRCoordinator, {
      getPendingComments: vi.fn().mockResolvedValue([pendingComment1, pendingComment2]),
    });

    await component.loadPending();

    expect(modSvc.getPendingComments).toHaveBeenCalledWith([UserRole.HRCoordinator], 'org1');
    expect(component.pendingComments()).toHaveLength(2);
    expect(component.isLoading()).toBe(false);
  });

  it('approves a comment with reason', async () => {
    const { component, modSvc } = configure(UserRole.Administrator, {
      getPendingComments: vi.fn().mockResolvedValue([pendingComment1]),
      decide: vi.fn().mockResolvedValue({ ...pendingComment1, status: CommentStatus.Approved }),
    });

    await component.loadPending();
    expect(component.pendingComments()).toHaveLength(1);

    // Set a reason via the internal map
    (component as any).reasons.set('c1', 'Looks fine after review');
    await component.onApprove(pendingComment1);

    expect(modSvc.decide).toHaveBeenCalledWith(
      'c1', ModerationDecision.Approved, 'Looks fine after review', 'mod1', [UserRole.Administrator], 'org1',
    );
    // Comment should be removed from the pending list
    expect(component.pendingComments()).toHaveLength(0);
    expect(component.actionSuccess()).toBe('Comment approved');
  });

  it('rejects a comment with reason', async () => {
    const { component, modSvc } = configure(UserRole.HRCoordinator, {
      getPendingComments: vi.fn().mockResolvedValue([pendingComment1, pendingComment2]),
      decide: vi.fn().mockResolvedValue({ ...pendingComment2, status: CommentStatus.Rejected }),
    });

    await component.loadPending();
    expect(component.pendingComments()).toHaveLength(2);

    (component as any).reasons.set('c2', 'Contains spam links');
    await component.onReject(pendingComment2);

    expect(modSvc.decide).toHaveBeenCalledWith(
      'c2', ModerationDecision.Rejected, 'Contains spam links', 'mod1', [UserRole.HRCoordinator], 'org1',
    );
    // Only the rejected comment should be removed
    expect(component.pendingComments()).toHaveLength(1);
    expect(component.pendingComments()[0].id).toBe('c1');
    expect(component.actionSuccess()).toBe('Comment rejected');
  });
});
