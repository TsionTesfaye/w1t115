/**
 * ModerationService tests
 *
 * Covers: submitComment (clean/blocklisted/cooldown/link limit),
 * decide (approve/reject/RBAC/ABAC/concurrency), getPendingComments (RBAC/ABAC),
 * getCommentsForPost (RBAC/ABAC).
 *
 * No IndexedDB — all repos are in-memory FakeStore instances.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { ModerationService } from '../moderation.service';
import { ModerationDecision, CommentStatus, UserRole } from '../../enums';
import { AuthorizationError, RateLimitError, ValidationError } from '../../errors';
import { StateMachineError } from '../../state-machines';
import {
  FakeCommentRepo,
  FakeModerationCaseRepo,
  FakeSensitiveWordRepo,
  FakeUserRepo,
  fakeAudit,
  makeUser,
  makeComment,
  makeSensitiveWord,
} from './helpers';
import { now } from '../../utils/id';

// ── Setup ────────────────────────────────────────────────────────────────────

const HR_ROLES = [UserRole.HRCoordinator];
const ADMIN_ROLES = [UserRole.Administrator];
const CANDIDATE_ROLES = [UserRole.Candidate];

function makeSvc(
  commentRepo = new FakeCommentRepo(),
  modRepo = new FakeModerationCaseRepo(),
  wordRepo = new FakeSensitiveWordRepo(),
  userRepo = new FakeUserRepo(),
) {
  return new ModerationService(
    commentRepo as any,
    modRepo as any,
    wordRepo as any,
    userRepo as any,
    fakeAudit as any,
  );
}

// ── submitComment ─────────────────────────────────────────────────────────────

describe('ModerationService.submitComment', () => {
  it('creates an Approved comment when content is clean', async () => {
    const userRepo = new FakeUserRepo().seed([makeUser({ id: 'u1' })]);
    const commentRepo = new FakeCommentRepo();
    const svc = makeSvc(commentRepo, undefined, undefined, userRepo);
    const comment = await svc.submitComment('post1', 'Great article!', 'u1', 'org1');
    expect(comment.status).toBe(CommentStatus.Approved);
    expect(comment.organizationId).toBe('org1');
    expect((await commentRepo.getAll()).length).toBe(1);
  });

  it('creates a Pending comment and ModerationCase when content has a blocklisted word', async () => {
    const wordRepo = new FakeSensitiveWordRepo().seed([makeSensitiveWord('badword')]);
    const userRepo = new FakeUserRepo().seed([makeUser({ id: 'u1' })]);
    const commentRepo = new FakeCommentRepo();
    const modRepo = new FakeModerationCaseRepo();
    const svc = makeSvc(commentRepo, modRepo, wordRepo, userRepo);
    const comment = await svc.submitComment('post1', 'This is badword content', 'u1', 'org1');
    expect(comment.status).toBe(CommentStatus.Pending);
    const cases = await modRepo.getByComment(comment.id);
    expect(cases.length).toBe(1);
    expect(cases[0].detectedIssues[0]).toContain('badword');
  });

  it('throws RateLimitError when author is within the cooldown window', async () => {
    const recentComment = new Date(Date.now() - 5_000).toISOString(); // 5s ago, cooldown=30s
    const userRepo = new FakeUserRepo().seed([makeUser({ id: 'u1', lastCommentAt: recentComment })]);
    const svc = makeSvc(undefined, undefined, undefined, userRepo);
    await expect(svc.submitComment('post1', 'Too soon!', 'u1', 'org1')).rejects.toThrow(RateLimitError);
  });

  it('allows comment after the cooldown window has passed', async () => {
    const oldComment = new Date(Date.now() - 60_000).toISOString(); // 60s ago, cooldown=30s
    const userRepo = new FakeUserRepo().seed([makeUser({ id: 'u1', lastCommentAt: oldComment })]);
    const svc = makeSvc(undefined, undefined, undefined, userRepo);
    const comment = await svc.submitComment('post1', 'Enough time passed', 'u1', 'org1');
    expect(comment.status).toBe(CommentStatus.Approved);
  });

  it('throws ValidationError when link count exceeds the limit', async () => {
    const userRepo = new FakeUserRepo().seed([makeUser({ id: 'u1' })]);
    const svc = makeSvc(undefined, undefined, undefined, userRepo);
    // MAX_LINKS_PER_COMMENT=3 — four links should fail
    const tooManyLinks = 'See http://a.com and http://b.com and http://c.com and http://d.com';
    await expect(svc.submitComment('post1', tooManyLinks, 'u1', 'org1')).rejects.toThrow(ValidationError);
  });

  it('throws ValidationError for empty or whitespace-only content', async () => {
    const userRepo = new FakeUserRepo().seed([makeUser({ id: 'u1' })]);
    const svc = makeSvc(undefined, undefined, undefined, userRepo);
    await expect(svc.submitComment('post1', '   ', 'u1', 'org1')).rejects.toThrow(ValidationError);
  });
});

// ── decide ────────────────────────────────────────────────────────────────────

describe('ModerationService.decide', () => {
  it('approves a Pending comment', async () => {
    const comment = makeComment({ status: CommentStatus.Pending, organizationId: 'org1' });
    const commentRepo = new FakeCommentRepo().seed([comment]);
    const svc = makeSvc(commentRepo);
    const updated = await svc.decide(comment.id, ModerationDecision.Approved, 'OK', 'mod1', HR_ROLES, 'org1');
    expect(updated.status).toBe(CommentStatus.Approved);
    expect(updated.moderationReason).toBe('OK');
  });

  it('rejects a Pending comment', async () => {
    const comment = makeComment({ status: CommentStatus.Pending, organizationId: 'org1' });
    const commentRepo = new FakeCommentRepo().seed([comment]);
    const svc = makeSvc(commentRepo);
    const updated = await svc.decide(comment.id, ModerationDecision.Rejected, 'spam', 'mod1', HR_ROLES, 'org1');
    expect(updated.status).toBe(CommentStatus.Rejected);
  });

  it('throws AuthorizationError for non-management roles', async () => {
    const comment = makeComment({ status: CommentStatus.Pending, organizationId: 'org1' });
    const commentRepo = new FakeCommentRepo().seed([comment]);
    const svc = makeSvc(commentRepo);
    await expect(
      svc.decide(comment.id, ModerationDecision.Approved, '', 'u1', CANDIDATE_ROLES, 'org1'),
    ).rejects.toThrow(AuthorizationError);
  });

  it('throws AuthorizationError when comment belongs to a different org', async () => {
    const comment = makeComment({ status: CommentStatus.Pending, organizationId: 'org2' });
    const commentRepo = new FakeCommentRepo().seed([comment]);
    const svc = makeSvc(commentRepo);
    await expect(
      svc.decide(comment.id, ModerationDecision.Approved, '', 'mod1', HR_ROLES, 'org1'),
    ).rejects.toThrow(AuthorizationError);
  });

  it('concurrent decide on the same comment — second call throws StateMachineError', async () => {
    const comment = makeComment({ status: CommentStatus.Pending, organizationId: 'org1' });
    const commentRepo = new FakeCommentRepo().seed([comment]);
    const svc = makeSvc(commentRepo);
    // First decide succeeds; status becomes Approved
    await svc.decide(comment.id, ModerationDecision.Approved, 'OK', 'mod1', HR_ROLES, 'org1');
    // Second decide tries Approved → Approved — assertTransition inside updateWithLock throws
    await expect(
      svc.decide(comment.id, ModerationDecision.Approved, 'OK again', 'mod1', HR_ROLES, 'org1'),
    ).rejects.toThrow(StateMachineError);
  });

  it('records the decision on the ModerationCase if one exists', async () => {
    const comment = makeComment({ id: 'c1', status: CommentStatus.Pending, organizationId: 'org1' });
    const { generateId } = await import('../../utils/id');
    const modCase = {
      id: generateId(), organizationId: 'org1', commentId: 'c1',
      detectedIssues: ['blocklisted:x'], decision: null,
      decisionReason: null, decidedBy: null, decidedAt: null,
      version: 1, createdAt: now(), updatedAt: now(),
    };
    const commentRepo = new FakeCommentRepo().seed([comment]);
    const modRepo = new FakeModerationCaseRepo().seed([modCase]);
    const svc = makeSvc(commentRepo, modRepo);
    await svc.decide('c1', ModerationDecision.Approved, 'looks good', 'mod1', HR_ROLES, 'org1');
    const updatedCase = await modRepo.getById(modCase.id);
    expect(updatedCase!.decision).toBe(ModerationDecision.Approved);
    expect(updatedCase!.decidedBy).toBe('mod1');
  });
});

// ── getPendingComments ────────────────────────────────────────────────────────

describe('ModerationService.getPendingComments', () => {
  it('returns only Pending comments for the actor org', async () => {
    const commentRepo = new FakeCommentRepo().seed([
      makeComment({ status: CommentStatus.Pending, organizationId: 'org1' }),
      makeComment({ status: CommentStatus.Approved, organizationId: 'org1' }),
      makeComment({ status: CommentStatus.Pending, organizationId: 'org2' }),
    ]);
    const svc = makeSvc(commentRepo);
    const pending = await svc.getPendingComments(HR_ROLES, 'org1');
    expect(pending.length).toBe(1);
    expect(pending[0].status).toBe(CommentStatus.Pending);
    expect(pending[0].organizationId).toBe('org1');
  });

  it('throws AuthorizationError for non-management roles', async () => {
    const svc = makeSvc();
    await expect(svc.getPendingComments(CANDIDATE_ROLES, 'org1')).rejects.toThrow(AuthorizationError);
  });

  it('allows Administrator to view pending comments', async () => {
    const commentRepo = new FakeCommentRepo().seed([
      makeComment({ status: CommentStatus.Pending, organizationId: 'org1' }),
    ]);
    const svc = makeSvc(commentRepo);
    const pending = await svc.getPendingComments(ADMIN_ROLES, 'org1');
    expect(pending.length).toBe(1);
  });
});

// ── getCommentsForPost ────────────────────────────────────────────────────────

describe('ModerationService.getCommentsForPost', () => {
  it('returns only Approved comments for anonymous (non-mgmt) viewers', async () => {
    const commentRepo = new FakeCommentRepo().seed([
      makeComment({ postId: 'p1', status: CommentStatus.Approved, organizationId: 'org1' }),
      makeComment({ postId: 'p1', status: CommentStatus.Pending, organizationId: 'org1' }),
      makeComment({ postId: 'p1', status: CommentStatus.Rejected, organizationId: 'org1' }),
    ]);
    const svc = makeSvc(commentRepo);
    const result = await svc.getCommentsForPost('p1', 'org1', CANDIDATE_ROLES, false);
    expect(result.every(c => c.status === CommentStatus.Approved)).toBe(true);
    expect(result.length).toBe(1);
  });

  it('returns all comments (including unapproved) for HR Coordinator', async () => {
    const commentRepo = new FakeCommentRepo().seed([
      makeComment({ postId: 'p1', status: CommentStatus.Approved, organizationId: 'org1' }),
      makeComment({ postId: 'p1', status: CommentStatus.Pending, organizationId: 'org1' }),
    ]);
    const svc = makeSvc(commentRepo);
    const result = await svc.getCommentsForPost('p1', 'org1', HR_ROLES, true);
    expect(result.length).toBe(2);
  });

  it('throws AuthorizationError when non-mgmt requests includeUnapproved=true', async () => {
    const svc = makeSvc();
    await expect(
      svc.getCommentsForPost('p1', 'org1', CANDIDATE_ROLES, true),
    ).rejects.toThrow(AuthorizationError);
  });

  it('filters to actor org (ABAC)', async () => {
    const commentRepo = new FakeCommentRepo().seed([
      makeComment({ postId: 'p1', status: CommentStatus.Approved, organizationId: 'org1' }),
      makeComment({ postId: 'p1', status: CommentStatus.Approved, organizationId: 'org2' }),
    ]);
    const svc = makeSvc(commentRepo);
    const result = await svc.getCommentsForPost('p1', 'org1', CANDIDATE_ROLES, false);
    expect(result.every(c => c.organizationId === 'org1')).toBe(true);
    expect(result.length).toBe(1);
  });
});
