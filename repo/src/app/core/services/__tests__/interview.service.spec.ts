import { describe, it, expect } from 'vitest';
import { InterviewService } from '../interview.service';
import { UserRole, ApplicationStatus, InterviewStatus } from '../../enums';
import { AuthorizationError, ValidationError, ConflictError, NotFoundError, OptimisticLockError } from '../../errors';
import {
  FakeApplicationRepo, FakeInterviewRepo, FakeInterviewPlanRepo, FakeJobRepo, FakeLineageRepo, FakeUserRepo,
  fakeAudit, fakeNotifService, makeApplication, makeInterview, makeInterviewPlan,
} from './helpers';
import { generateId, now } from '../../utils/id';

const ORG        = 'org1';
const OTHER_ORG  = 'org2';
const EMPLOYER   = 'employer1';
const CANDIDATE  = 'candidate1';

const EMPLOYER_ROLES   = [UserRole.Employer];
const CANDIDATE_ROLES  = [UserRole.Candidate];

// Base times for non-conflicting slots
const T1_START = '2026-06-01T09:00:00.000Z';
const T1_END   = '2026-06-01T10:00:00.000Z';
const T2_START = '2026-06-01T10:00:00.000Z'; // adjacent — no overlap
const T2_END   = '2026-06-01T11:00:00.000Z';
const T_OVERLAP_START = '2026-06-01T09:30:00.000Z'; // overlaps T1
const T_OVERLAP_END   = '2026-06-01T10:30:00.000Z';

function makeService(
  appRepo       = new FakeApplicationRepo(),
  planRepo      = new FakeInterviewPlanRepo(),
  interviewRepo = new FakeInterviewRepo(),
  lineageRepo   = new FakeLineageRepo(),
  jobRepo       = new FakeJobRepo(),
  userRepo      = new FakeUserRepo(),
) {
  return new InterviewService(
    interviewRepo as any,
    planRepo as any,
    appRepo as any,
    jobRepo as any,
    lineageRepo as any,
    fakeAudit as any,
    fakeNotifService as any,
    userRepo as any,
  );
}

// ── RBAC ──────────────────────────────────────────────────────────────────────

describe('InterviewService — RBAC', () => {
  it('candidate cannot schedule an interview', async () => {
    const app  = makeApplication({ id: 'app1', organizationId: ORG, status: 'active' });
    const plan = makeInterviewPlan({ id: 'plan1', organizationId: ORG });
    const svc  = makeService(
      new FakeApplicationRepo().seed([app]),
      new FakeInterviewPlanRepo().seed([plan]),
    );
    await expect(
      svc.scheduleInterview('app1', 'plan1', EMPLOYER, CANDIDATE, T1_START, T1_END, CANDIDATE, CANDIDATE_ROLES, ORG),
    ).rejects.toThrow(AuthorizationError);
  });
});

// ── Validation ────────────────────────────────────────────────────────────────

describe('InterviewService — pre-flight validation', () => {
  it('throws NotFoundError when application does not exist', async () => {
    const svc = makeService();
    await expect(
      svc.scheduleInterview('missing', 'plan1', EMPLOYER, CANDIDATE, T1_START, T1_END, EMPLOYER, EMPLOYER_ROLES, ORG),
    ).rejects.toThrow(NotFoundError);
  });

  it('throws AuthorizationError when application belongs to a different org', async () => {
    const app = makeApplication({ id: 'app1', organizationId: OTHER_ORG, status: 'active' });
    const svc = makeService(new FakeApplicationRepo().seed([app]));
    await expect(
      svc.scheduleInterview('app1', 'plan1', EMPLOYER, CANDIDATE, T1_START, T1_END, EMPLOYER, EMPLOYER_ROLES, ORG),
    ).rejects.toThrow(AuthorizationError);
  });

  it('throws ValidationError when application is not active', async () => {
    const app  = makeApplication({ id: 'app1', organizationId: ORG, status: ApplicationStatus.Rejected });
    const svc  = makeService(new FakeApplicationRepo().seed([app]));
    await expect(
      svc.scheduleInterview('app1', 'plan1', EMPLOYER, CANDIDATE, T1_START, T1_END, EMPLOYER, EMPLOYER_ROLES, ORG),
    ).rejects.toThrow(ValidationError);
  });

  it('throws NotFoundError when interview plan does not exist', async () => {
    const app = makeApplication({ id: 'app1', organizationId: ORG, status: 'active' });
    const svc = makeService(new FakeApplicationRepo().seed([app]));
    await expect(
      svc.scheduleInterview('app1', 'missing-plan', EMPLOYER, CANDIDATE, T1_START, T1_END, EMPLOYER, EMPLOYER_ROLES, ORG),
    ).rejects.toThrow(NotFoundError);
  });

  it('throws ValidationError when end time is before start time', async () => {
    const app  = makeApplication({ id: 'app1', organizationId: ORG, status: 'active' });
    const plan = makeInterviewPlan({ id: 'plan1', organizationId: ORG });
    const svc  = makeService(
      new FakeApplicationRepo().seed([app]),
      new FakeInterviewPlanRepo().seed([plan]),
    );
    await expect(
      svc.scheduleInterview('app1', 'plan1', EMPLOYER, CANDIDATE, T1_END, T1_START, EMPLOYER, EMPLOYER_ROLES, ORG),
    ).rejects.toThrow(ValidationError);
  });
});

// ── Atomic conflict detection — scheduleInterview ─────────────────────────────

describe('InterviewService — scheduleInterview conflict detection', () => {
  it('throws ConflictError when the new interview overlaps an existing one for the interviewer', async () => {
    const existing = makeInterview({ interviewerId: EMPLOYER, candidateId: 'other-cand', startTime: T1_START, endTime: T1_END, status: InterviewStatus.Scheduled });
    const app  = makeApplication({ id: 'app2', organizationId: ORG, status: 'active' });
    const plan = makeInterviewPlan({ id: 'plan1', organizationId: ORG });
    const interviewRepo = new FakeInterviewRepo().seed([existing]);
    const svc = makeService(
      new FakeApplicationRepo().seed([app]),
      new FakeInterviewPlanRepo().seed([plan]),
      interviewRepo,
    );
    // Overlapping time — same interviewer
    await expect(
      svc.scheduleInterview('app2', 'plan1', EMPLOYER, 'other-cand-2', T_OVERLAP_START, T_OVERLAP_END, EMPLOYER, EMPLOYER_ROLES, ORG),
    ).rejects.toThrow(ConflictError);
  });

  it('throws ConflictError when the new interview overlaps an existing one for the candidate', async () => {
    const existing = makeInterview({ interviewerId: 'other-emp', candidateId: CANDIDATE, startTime: T1_START, endTime: T1_END, status: InterviewStatus.Scheduled });
    const app  = makeApplication({ id: 'app2', organizationId: ORG, status: 'active' });
    const plan = makeInterviewPlan({ id: 'plan1', organizationId: ORG });
    const interviewRepo = new FakeInterviewRepo().seed([existing]);
    const svc = makeService(
      new FakeApplicationRepo().seed([app]),
      new FakeInterviewPlanRepo().seed([plan]),
      interviewRepo,
    );
    await expect(
      svc.scheduleInterview('app2', 'plan1', 'another-emp', CANDIDATE, T_OVERLAP_START, T_OVERLAP_END, EMPLOYER, EMPLOYER_ROLES, ORG),
    ).rejects.toThrow(ConflictError);
  });

  it('allows scheduling adjacent (non-overlapping) interviews for the same person', async () => {
    const existing = makeInterview({ interviewerId: EMPLOYER, candidateId: CANDIDATE, startTime: T1_START, endTime: T1_END, status: InterviewStatus.Scheduled });
    const app  = makeApplication({ id: 'app2', organizationId: ORG, status: 'active' });
    const plan = makeInterviewPlan({ id: 'plan1', organizationId: ORG });
    const interviewRepo = new FakeInterviewRepo().seed([existing]);
    const svc = makeService(
      new FakeApplicationRepo().seed([app]),
      new FakeInterviewPlanRepo().seed([plan]),
      interviewRepo,
    );
    // T2 starts exactly when T1 ends — no overlap
    const result = await svc.scheduleInterview('app2', 'plan1', EMPLOYER, CANDIDATE, T2_START, T2_END, EMPLOYER, EMPLOYER_ROLES, ORG);
    expect(result.status).toBe(InterviewStatus.Scheduled);
  });

  it('does NOT flag a conflict with a canceled interview', async () => {
    const canceled = makeInterview({ interviewerId: EMPLOYER, candidateId: CANDIDATE, startTime: T1_START, endTime: T1_END, status: InterviewStatus.Canceled });
    const app  = makeApplication({ id: 'app2', organizationId: ORG, status: 'active' });
    const plan = makeInterviewPlan({ id: 'plan1', organizationId: ORG });
    const interviewRepo = new FakeInterviewRepo().seed([canceled]);
    const svc = makeService(
      new FakeApplicationRepo().seed([app]),
      new FakeInterviewPlanRepo().seed([plan]),
      interviewRepo,
    );
    // Same slot — but existing interview is canceled, so no conflict
    const result = await svc.scheduleInterview('app2', 'plan1', EMPLOYER, CANDIDATE, T1_START, T1_END, EMPLOYER, EMPLOYER_ROLES, ORG);
    expect(result.status).toBe(InterviewStatus.Scheduled);
  });

  it('returns the scheduled interview with correct metadata on success', async () => {
    const app  = makeApplication({ id: 'app1', organizationId: ORG, status: 'active' });
    const plan = makeInterviewPlan({ id: 'plan1', organizationId: ORG });
    const svc  = makeService(
      new FakeApplicationRepo().seed([app]),
      new FakeInterviewPlanRepo().seed([plan]),
    );
    const result = await svc.scheduleInterview('app1', 'plan1', EMPLOYER, CANDIDATE, T1_START, T1_END, EMPLOYER, EMPLOYER_ROLES, ORG);
    expect(result.interviewerId).toBe(EMPLOYER);
    expect(result.candidateId).toBe(CANDIDATE);
    expect(result.organizationId).toBe(ORG);
    expect(result.status).toBe(InterviewStatus.Scheduled);
    expect(result.version).toBe(1);
  });
});

// ── Atomic conflict detection — reschedule ────────────────────────────────────

describe('InterviewService — reschedule conflict detection', () => {
  it('throws ConflictError when rescheduled time overlaps another interview for the same person', async () => {
    const iv1 = makeInterview({ id: 'iv1', interviewerId: EMPLOYER, candidateId: CANDIDATE, startTime: T1_START, endTime: T1_END, version: 1 });
    const iv2 = makeInterview({ id: 'iv2', interviewerId: EMPLOYER, candidateId: 'other', startTime: T2_START, endTime: T2_END, version: 1 });
    const svc = makeService(
      new FakeApplicationRepo(),
      new FakeInterviewPlanRepo(),
      new FakeInterviewRepo().seed([iv1, iv2]),
    );
    // Try to reschedule iv1 into T2 slot — conflicts with iv2 (same interviewer)
    await expect(
      svc.reschedule('iv1', T2_START, T2_END, EMPLOYER, EMPLOYER_ROLES, ORG, 1),
    ).rejects.toThrow(ConflictError);
  });

  it('throws OptimisticLockError when expectedVersion is stale', async () => {
    const iv = makeInterview({ id: 'iv1', interviewerId: EMPLOYER, candidateId: CANDIDATE, startTime: T1_START, endTime: T1_END, version: 2 });
    const svc = makeService(
      new FakeApplicationRepo(),
      new FakeInterviewPlanRepo(),
      new FakeInterviewRepo().seed([iv]),
    );
    await expect(
      svc.reschedule('iv1', T2_START, T2_END, EMPLOYER, EMPLOYER_ROLES, ORG, 1 /* stale */),
    ).rejects.toThrow(OptimisticLockError);
  });

  it('throws ValidationError when rescheduling a non-Scheduled interview', async () => {
    const iv = makeInterview({ id: 'iv1', status: InterviewStatus.Completed, version: 1 });
    const svc = makeService(
      new FakeApplicationRepo(),
      new FakeInterviewPlanRepo(),
      new FakeInterviewRepo().seed([iv]),
    );
    await expect(
      svc.reschedule('iv1', T2_START, T2_END, EMPLOYER, EMPLOYER_ROLES, ORG, 1),
    ).rejects.toThrow(ValidationError);
  });

  it('succeeds and returns updated interview with incremented version', async () => {
    const iv = makeInterview({ id: 'iv1', interviewerId: EMPLOYER, candidateId: CANDIDATE, startTime: T1_START, endTime: T1_END, version: 1, organizationId: ORG });
    const svc = makeService(
      new FakeApplicationRepo(),
      new FakeInterviewPlanRepo(),
      new FakeInterviewRepo().seed([iv]),
    );
    const result = await svc.reschedule('iv1', T2_START, T2_END, EMPLOYER, EMPLOYER_ROLES, ORG, 1);
    expect(result.startTime).toBe(T2_START);
    expect(result.endTime).toBe(T2_END);
    expect(result.version).toBe(2);
    expect(result.rescheduledBy).toBe(EMPLOYER);
  });

  it('does NOT flag a conflict with its own current time slot when rescheduling', async () => {
    // Only one interview exists — rescheduling it should never conflict with itself
    const iv = makeInterview({ id: 'iv1', interviewerId: EMPLOYER, candidateId: CANDIDATE, startTime: T1_START, endTime: T1_END, version: 1, organizationId: ORG });
    const svc = makeService(
      new FakeApplicationRepo(),
      new FakeInterviewPlanRepo(),
      new FakeInterviewRepo().seed([iv]),
    );
    const result = await svc.reschedule('iv1', T2_START, T2_END, EMPLOYER, EMPLOYER_ROLES, ORG, 1);
    expect(result.status).toBe(InterviewStatus.Scheduled);
  });
});

// ── Complete / Cancel ─────────────────────────────────────────────────────────

describe('InterviewService — completeInterview / cancelInterview', () => {
  it('completes a scheduled interview', async () => {
    const iv = makeInterview({ id: 'iv1', status: InterviewStatus.Scheduled, version: 1, organizationId: ORG });
    const svc = makeService(new FakeApplicationRepo(), new FakeInterviewPlanRepo(), new FakeInterviewRepo().seed([iv]));
    const result = await svc.completeInterview('iv1', EMPLOYER, EMPLOYER_ROLES, ORG, 1);
    expect(result.status).toBe(InterviewStatus.Completed);
    expect(result.version).toBe(2);
  });

  it('cancels a scheduled interview', async () => {
    const iv = makeInterview({ id: 'iv1', status: InterviewStatus.Scheduled, version: 1, organizationId: ORG });
    const svc = makeService(new FakeApplicationRepo(), new FakeInterviewPlanRepo(), new FakeInterviewRepo().seed([iv]));
    const result = await svc.cancelInterview('iv1', EMPLOYER, EMPLOYER_ROLES, ORG, 1);
    expect(result.status).toBe(InterviewStatus.Canceled);
    expect(result.version).toBe(2);
  });

  it('cannot complete an already-completed interview', async () => {
    const iv = makeInterview({ id: 'iv1', status: InterviewStatus.Completed, version: 1, organizationId: ORG });
    const svc = makeService(new FakeApplicationRepo(), new FakeInterviewPlanRepo(), new FakeInterviewRepo().seed([iv]));
    await expect(svc.completeInterview('iv1', EMPLOYER, EMPLOYER_ROLES, ORG, 1)).rejects.toThrow();
  });
});

// ── Interviewer completion ───────────────────────────────────────────────────

describe('InterviewService — Interviewer can complete own interview', () => {
  it('Interviewer completes their assigned interview', async () => {
    const iv = makeInterview({
      id: 'iv1', interviewerId: 'int1', status: InterviewStatus.Scheduled, version: 1, organizationId: ORG,
    });
    const svc = makeService(
      new FakeApplicationRepo(), new FakeInterviewPlanRepo(),
      new FakeInterviewRepo().seed([iv]),
    );
    const result = await svc.completeInterview('iv1', 'int1', [UserRole.Interviewer], ORG, 1);
    expect(result.status).toBe(InterviewStatus.Completed);
  });

  it('Interviewer cannot complete another interviewer\'s interview', async () => {
    const iv = makeInterview({
      id: 'iv1', interviewerId: 'int-other', status: InterviewStatus.Scheduled, version: 1, organizationId: ORG,
    });
    const svc = makeService(
      new FakeApplicationRepo(), new FakeInterviewPlanRepo(),
      new FakeInterviewRepo().seed([iv]),
    );
    await expect(
      svc.completeInterview('iv1', 'int1', [UserRole.Interviewer], ORG, 1),
    ).rejects.toThrow(AuthorizationError);
  });
});

// ── Terminal state enforcement ───────────────────────────────────────────────

describe('InterviewService — terminal state enforcement', () => {
  it('cannot cancel an already-completed interview', async () => {
    const iv = makeInterview({ id: 'iv1', status: InterviewStatus.Completed, version: 1, organizationId: ORG });
    const svc = makeService(new FakeApplicationRepo(), new FakeInterviewPlanRepo(), new FakeInterviewRepo().seed([iv]));
    await expect(svc.cancelInterview('iv1', EMPLOYER, EMPLOYER_ROLES, ORG, 1)).rejects.toThrow();
  });

  it('cannot cancel an already-canceled interview', async () => {
    const iv = makeInterview({ id: 'iv1', status: InterviewStatus.Canceled, version: 1, organizationId: ORG });
    const svc = makeService(new FakeApplicationRepo(), new FakeInterviewPlanRepo(), new FakeInterviewRepo().seed([iv]));
    await expect(svc.cancelInterview('iv1', EMPLOYER, EMPLOYER_ROLES, ORG, 1)).rejects.toThrow();
  });

  it('cannot complete a canceled interview', async () => {
    const iv = makeInterview({ id: 'iv1', status: InterviewStatus.Canceled, version: 1, organizationId: ORG });
    const svc = makeService(new FakeApplicationRepo(), new FakeInterviewPlanRepo(), new FakeInterviewRepo().seed([iv]));
    await expect(svc.completeInterview('iv1', EMPLOYER, EMPLOYER_ROLES, ORG, 1)).rejects.toThrow();
  });
});
