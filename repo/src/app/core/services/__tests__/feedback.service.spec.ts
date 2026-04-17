import { describe, it, expect, beforeEach } from 'vitest';
import { FeedbackService } from '../feedback.service';
import { InterviewFeedback, AuditLog } from '../../models';
import { InterviewStatus, AuditAction, UserRole } from '../../enums';
import { AuthorizationError, NotFoundError, ValidationError } from '../../errors';
import { FakeInterviewRepo, makeInterview, fakeAudit } from './helpers';

// ── Inline FakeInterviewFeedbackRepo ──────────────────────────────────────────

class FakeInterviewFeedbackRepo {
  private items: InterviewFeedback[] = [];
  async getByInterview(id: string) { return this.items.filter(f => f.interviewId === id); }
  async add(item: InterviewFeedback) { this.items.push(item); }
  async getById(id: string) { return this.items.find(f => f.id === id) ?? null; }
}

const ORG = 'org1';
const OTHER_ORG = 'org2';
const INTERVIEWER_ID = 'interviewer1';
const CANDIDATE_ID = 'candidate1';
const MGMT_ROLES = [UserRole.HRCoordinator];
const ADMIN_ROLES = [UserRole.Administrator];
const INTERVIEWER_ROLES = [UserRole.Interviewer];
const CANDIDATE_ROLES = [UserRole.Candidate];

function makeService(feedbackRepo = new FakeInterviewFeedbackRepo(), interviewRepo = new FakeInterviewRepo()) {
  return { svc: new FeedbackService(feedbackRepo as any, interviewRepo as any, fakeAudit as any), feedbackRepo, interviewRepo };
}

// ── submitFeedback ────────────────────────────────────────────────────────────

describe('FeedbackService — submitFeedback', () => {
  it('assigned interviewer can submit feedback for completed interview', async () => {
    const interview = makeInterview({
      id: 'int1', organizationId: ORG,
      interviewerId: INTERVIEWER_ID,
      candidateId: CANDIDATE_ID,
      status: InterviewStatus.Completed,
    });
    const { svc } = makeService(new FakeInterviewFeedbackRepo(), new FakeInterviewRepo().seed([interview]));
    const result = await svc.submitFeedback('int1', 7, 'Good candidate', INTERVIEWER_ID, INTERVIEWER_ROLES, ORG);
    expect(result.score).toBe(7);
    expect(result.interviewerId).toBe(INTERVIEWER_ID);
    expect(result.interviewId).toBe('int1');
  });

  it('rejects non-interviewer (wrong actorId)', async () => {
    const interview = makeInterview({
      id: 'int1', organizationId: ORG,
      interviewerId: INTERVIEWER_ID,
      status: InterviewStatus.Completed,
    });
    const { svc } = makeService(new FakeInterviewFeedbackRepo(), new FakeInterviewRepo().seed([interview]));
    await expect(svc.submitFeedback('int1', 7, 'Notes', 'wrongactor', INTERVIEWER_ROLES, ORG))
      .rejects.toThrow(AuthorizationError);
  });

  it('rejects feedback for a non-completed (Scheduled) interview', async () => {
    const interview = makeInterview({
      id: 'int1', organizationId: ORG,
      interviewerId: INTERVIEWER_ID,
      status: InterviewStatus.Scheduled,
    });
    const { svc } = makeService(new FakeInterviewFeedbackRepo(), new FakeInterviewRepo().seed([interview]));
    await expect(svc.submitFeedback('int1', 7, 'Notes', INTERVIEWER_ID, INTERVIEWER_ROLES, ORG))
      .rejects.toThrow(ValidationError);
  });

  it('rejects duplicate feedback from the same interviewer', async () => {
    const interview = makeInterview({
      id: 'int1', organizationId: ORG,
      interviewerId: INTERVIEWER_ID,
      status: InterviewStatus.Completed,
    });
    const feedbackRepo = new FakeInterviewFeedbackRepo();
    const { svc } = makeService(feedbackRepo, new FakeInterviewRepo().seed([interview]));
    await svc.submitFeedback('int1', 7, 'Notes', INTERVIEWER_ID, INTERVIEWER_ROLES, ORG);
    await expect(svc.submitFeedback('int1', 8, 'Again', INTERVIEWER_ID, INTERVIEWER_ROLES, ORG))
      .rejects.toThrow(ValidationError);
  });

  it('rejects score of 0 (out of range)', async () => {
    const interview = makeInterview({
      id: 'int1', organizationId: ORG,
      interviewerId: INTERVIEWER_ID,
      status: InterviewStatus.Completed,
    });
    const { svc } = makeService(new FakeInterviewFeedbackRepo(), new FakeInterviewRepo().seed([interview]));
    await expect(svc.submitFeedback('int1', 0, 'Notes', INTERVIEWER_ID, INTERVIEWER_ROLES, ORG))
      .rejects.toThrow(ValidationError);
  });

  it('rejects score of 11 (out of range)', async () => {
    const interview = makeInterview({
      id: 'int1', organizationId: ORG,
      interviewerId: INTERVIEWER_ID,
      status: InterviewStatus.Completed,
    });
    const { svc } = makeService(new FakeInterviewFeedbackRepo(), new FakeInterviewRepo().seed([interview]));
    await expect(svc.submitFeedback('int1', 11, 'Notes', INTERVIEWER_ID, INTERVIEWER_ROLES, ORG))
      .rejects.toThrow(ValidationError);
  });

  it('throws NotFoundError for non-existent interview', async () => {
    const { svc } = makeService();
    await expect(svc.submitFeedback('ghost', 7, 'Notes', INTERVIEWER_ID, INTERVIEWER_ROLES, ORG))
      .rejects.toThrow(NotFoundError);
  });
});

// ── getFeedbackForInterview ───────────────────────────────────────────────────

describe('FeedbackService — getFeedbackForInterview', () => {
  it('management sees all feedback for a completed interview', async () => {
    const interview = makeInterview({
      id: 'int1', organizationId: ORG,
      interviewerId: INTERVIEWER_ID,
      status: InterviewStatus.Completed,
    });
    const feedbackRepo = new FakeInterviewFeedbackRepo();
    const { svc } = makeService(feedbackRepo, new FakeInterviewRepo().seed([interview]));
    await feedbackRepo.add({
      id: 'fb1', interviewId: 'int1', organizationId: ORG,
      interviewerId: INTERVIEWER_ID, score: 8, notes: 'Great',
      submittedAt: new Date().toISOString(), version: 1,
      createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
    });
    const results = await svc.getFeedbackForInterview('int1', 'hr1', MGMT_ROLES, ORG);
    expect(results).toHaveLength(1);
  });

  it('interviewer sees only their own feedback', async () => {
    const interview = makeInterview({
      id: 'int1', organizationId: ORG,
      interviewerId: INTERVIEWER_ID,
      status: InterviewStatus.Completed,
    });
    const feedbackRepo = new FakeInterviewFeedbackRepo();
    const interviewRepo = new FakeInterviewRepo().seed([interview]);
    const { svc } = makeService(feedbackRepo, interviewRepo);
    await feedbackRepo.add({
      id: 'fb1', interviewId: 'int1', organizationId: ORG,
      interviewerId: INTERVIEWER_ID, score: 8, notes: 'Good',
      submittedAt: new Date().toISOString(), version: 1,
      createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
    });
    await feedbackRepo.add({
      id: 'fb2', interviewId: 'int1', organizationId: ORG,
      interviewerId: 'other-interviewer', score: 6, notes: 'Other feedback',
      submittedAt: new Date().toISOString(), version: 1,
      createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
    });
    const results = await svc.getFeedbackForInterview('int1', INTERVIEWER_ID, INTERVIEWER_ROLES, ORG);
    expect(results).toHaveLength(1);
    expect(results[0].interviewerId).toBe(INTERVIEWER_ID);
  });

  it('candidate throws AuthorizationError', async () => {
    const interview = makeInterview({
      id: 'int1', organizationId: ORG,
      interviewerId: INTERVIEWER_ID,
      status: InterviewStatus.Completed,
    });
    const { svc } = makeService(new FakeInterviewFeedbackRepo(), new FakeInterviewRepo().seed([interview]));
    await expect(svc.getFeedbackForInterview('int1', CANDIDATE_ID, CANDIDATE_ROLES, ORG))
      .rejects.toThrow(AuthorizationError);
  });

  it('management cannot view feedback for non-completed interview', async () => {
    const interview = makeInterview({
      id: 'int1', organizationId: ORG,
      interviewerId: INTERVIEWER_ID,
      status: InterviewStatus.Scheduled,
    });
    const { svc } = makeService(new FakeInterviewFeedbackRepo(), new FakeInterviewRepo().seed([interview]));
    await expect(svc.getFeedbackForInterview('int1', 'hr1', MGMT_ROLES, ORG))
      .rejects.toThrow(ValidationError);
  });

  it('throws NotFoundError for non-existent interview', async () => {
    const { svc } = makeService();
    await expect(svc.getFeedbackForInterview('ghost', 'hr1', MGMT_ROLES, ORG))
      .rejects.toThrow(NotFoundError);
  });
});
