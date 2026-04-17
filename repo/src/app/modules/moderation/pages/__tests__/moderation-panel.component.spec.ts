/**
 * ModerationPanelComponent tests — real ModerationService backed by
 * in-memory repos from helpers.ts.
 *
 * Boundary stubs kept:
 *  - SessionService → plain stub (no crypto/IDB)
 */

import { describe, it, expect, afterEach } from 'vitest';
import { TestBed } from '@angular/core/testing';
import { signal, computed } from '@angular/core';

import { ModerationPanelComponent } from '../moderation-panel.component';
import { SessionService } from '../../../../core/services/session.service';
import { ModerationService } from '../../../../core/services/moderation.service';

import { UserRole, CommentStatus } from '../../../../core/enums';
import { Comment } from '../../../../core/models';
import { now } from '../../../../core/utils/id';

import {
  FakeCommentRepo, FakeModerationCaseRepo, FakeSensitiveWordRepo, FakeUserRepo,
  fakeAudit,
} from '../../../../core/services/__tests__/helpers';

afterEach(() => {
  TestBed.resetTestingModule();
});

// ── Session stub ──────────────────────────────────────────────────────────────

function makeSessionStub(role: UserRole, userId = 'mod1', orgId = 'org1') {
  return {
    activeRole: signal(role),
    isAuthenticated: computed(() => true),
    initialized: signal(true),
    currentUser: signal({ displayName: 'Test Moderator' }),
    organizationId: computed(() => orgId),
    userId: computed(() => userId),
    userRoles: computed(() => [role]),
    requireAuth: () => ({ userId, organizationId: orgId, roles: [role], activeRole: role }),
  };
}

// ── Pending comment factory ───────────────────────────────────────────────────

function makePendingComment(id: string, postId = 'post1'): Comment {
  return {
    id, organizationId: 'org1', postId, authorId: 'author1',
    content: 'Flagged comment content',
    status: CommentStatus.Pending, moderationReason: null,
    version: 1, createdAt: now(), updatedAt: now(),
  };
}

// ── Configure helper ─────────────────────────────────────────────────────────

function configure(role: UserRole, seedComments: Comment[] = []) {
  const commentRepo = new FakeCommentRepo();
  if (seedComments.length) commentRepo.seed(seedComments);

  const modRepo = new FakeModerationCaseRepo();
  const wordRepo = new FakeSensitiveWordRepo();
  const userRepo = new FakeUserRepo();

  const realModSvc = new ModerationService(
    commentRepo as any, modRepo as any, wordRepo as any, userRepo as any, fakeAudit as any,
  );

  const sessionStub = makeSessionStub(role);

  TestBed.configureTestingModule({
    imports: [ModerationPanelComponent],
    providers: [
      { provide: SessionService, useValue: sessionStub },
      { provide: ModerationService, useValue: realModSvc },
    ],
  });

  const fixture = TestBed.createComponent(ModerationPanelComponent);
  return { component: fixture.componentInstance, commentRepo, realModSvc };
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('ModerationPanelComponent', () => {
  it('loads pending comments via real ModerationService', async () => {
    const c1 = makePendingComment('c1', 'post1');
    const c2 = makePendingComment('c2', 'post2');
    const { component } = configure(UserRole.HRCoordinator, [c1, c2]);

    await component.loadPending();

    expect(component.pendingComments()).toHaveLength(2);
    expect(component.isLoading()).toBe(false);
  });

  it('approves a comment — real state machine transitions Pending→Approved', async () => {
    const c1 = makePendingComment('c1');
    const { component, commentRepo } = configure(UserRole.Administrator, [c1]);

    await component.loadPending();
    expect(component.pendingComments()).toHaveLength(1);

    (component as any).reasons.set('c1', 'Looks fine after review');
    await component.onApprove(c1);

    expect(component.pendingComments()).toHaveLength(0);
    expect(component.actionSuccess()).toBe('Comment approved');
    const updated = await commentRepo.getById('c1');
    expect(updated?.status).toBe(CommentStatus.Approved);
  });

  it('rejects a comment — real state machine transitions Pending→Rejected', async () => {
    const c1 = makePendingComment('c1', 'post1');
    const c2 = makePendingComment('c2', 'post2');
    const { component, commentRepo } = configure(UserRole.HRCoordinator, [c1, c2]);

    await component.loadPending();
    expect(component.pendingComments()).toHaveLength(2);

    (component as any).reasons.set('c2', 'Contains spam links');
    await component.onReject(c2);

    expect(component.pendingComments()).toHaveLength(1);
    expect(component.pendingComments()[0].id).toBe('c1');
    expect(component.actionSuccess()).toBe('Comment rejected');
    const updated = await commentRepo.getById('c2');
    expect(updated?.status).toBe(CommentStatus.Rejected);
  });

  it('Candidate cannot approve comments — real AuthorizationError from ModerationService', async () => {
    const c1 = makePendingComment('c1');
    const { component } = configure(UserRole.Candidate, [c1]);

    await component.loadPending();
    (component as any).reasons.set('c1', 'Looks fine');
    await component.onApprove(c1);

    // The component catches AuthorizationError and sets actionError
    expect(component.actionError()).toBeTruthy();
  });
});
