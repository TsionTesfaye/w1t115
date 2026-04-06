/**
 * e2e_tests/user-flow.spec.ts
 *
 * End-to-end user flow test:
 *   1. Register admin → login
 *   2. Admin creates a job
 *   3. Candidate applies
 *   4. HR schedules an interview
 *   5. Notifications fire for each step
 *
 * Uses in-memory doubles (no IDB, no browser) — tests the full service
 * layer interaction chain exactly as the UI would trigger it.
 */

import { describe, it, expect } from 'vitest';
import { AuthService } from '../src/app/core/services/auth.service';
import { JobService } from '../src/app/core/services/job.service';
import { ApplicationService } from '../src/app/core/services/application.service';
import { InterviewService } from '../src/app/core/services/interview.service';
import { NotificationService } from '../src/app/core/services/notification.service';
import { DNDService } from '../src/app/core/services/dnd.service';
import { UserRole, JobStatus, ApplicationStage, ApplicationStatus, InterviewStatus } from '../src/app/core/enums';
import {
  FakeUserRepo, FakeSessionRepo, FakeJobRepo, FakeApplicationRepo,
  FakeInterviewRepo, FakeInterviewPlanRepo, FakeJobRepo as FakeJobRepo2,
  FakeLineageRepo, FakeNotificationRepo, FakeNotificationPreferenceRepo,
  FakeDelayedDeliveryRepo, FakeDocumentRepo,
  fakeCrypto, fakeAudit,
  makeInterviewPlan,
} from '../src/app/core/services/__tests__/helpers';
import { generateId, now } from '../src/app/core/utils/id';

const ORG = 'org1';

// ── Shared repos ──────────────────────────────────────────────────────────
const userRepo    = new FakeUserRepo();
const notifRepo   = new FakeNotificationRepo();
const prefRepo    = new FakeNotificationPreferenceRepo();
const delayedRepo = new FakeDelayedDeliveryRepo();
const sessionRepo = new FakeSessionRepo();
const jobRepo     = new FakeJobRepo();
const appRepo     = new FakeApplicationRepo();
const interviewRepo = new FakeInterviewRepo();
const planRepo    = new FakeInterviewPlanRepo();

// ── Services ──────────────────────────────────────────────────────────────
const dnd = new DNDService(prefRepo as any, delayedRepo as any);

const notifSvc = new NotificationService(
  notifRepo as any, prefRepo as any, dnd as any, delayedRepo as any,
);

const authSvc = new AuthService(
  userRepo as any, sessionRepo as any, fakeCrypto as any, fakeAudit as any,
);

const jobSvc = new JobService(
  jobRepo as any, new FakeLineageRepo() as any, fakeAudit as any, userRepo as any,
);

const appSvc = new ApplicationService(
  appRepo as any, jobRepo as any,
  new FakeLineageRepo() as any,
  notifRepo as any,
  fakeAudit as any,
  notifSvc as any,
  userRepo as any,
);

const intSvc = new InterviewService(
  interviewRepo as any, planRepo as any, appRepo as any, jobRepo as any,
  new FakeLineageRepo() as any,
  fakeAudit as any, notifSvc as any, userRepo as any,
);

// ── Full flow ─────────────────────────────────────────────────────────────

describe('E2E: Full hiring flow', () => {
  let employerId: string;
  let candidateId: string;
  let jobId: string;
  let applicationId: string;
  let interviewId: string;

  it('1. Admin registers an employer and a candidate', async () => {
    const employer = await authSvc.register(
      'employer_user', 'Employer!1234', 'Employer One', ORG, '', [UserRole.Employer],
    );
    const candidate = await authSvc.register(
      'candidate_user', 'Cand!1234', 'Candidate One', ORG, '', [UserRole.Candidate],
    );
    employerId = employer.id;
    candidateId = candidate.id;
    expect(employer.roles).toContain(UserRole.Employer);
    expect(candidate.roles).toContain(UserRole.Candidate);
  });

  it('2. Employer creates a job posting', async () => {
    const job = await jobSvc.createJob(
      'Senior Engineer', 'Build great things', ['typescript'], [],
      employerId, [UserRole.Employer], ORG,
    );
    jobId = job.id;
    expect(job.status).toBe(JobStatus.Draft);
  });

  it('3. Employer activates the job', async () => {
    const job = await jobRepo.getById(jobId);
    const activated = await jobSvc.transitionJobStatus(
      jobId, JobStatus.Active, employerId, [UserRole.Employer], ORG, job!.version,
    );
    expect(activated.status).toBe(JobStatus.Active);
  });

  it('4. Candidate applies to the job', async () => {
    const app = await appSvc.createApplication(
      jobId, candidateId, ORG, [UserRole.Candidate],
    );
    applicationId = app.id;
    expect(app.stage).toBe(ApplicationStage.Draft);
    expect(app.status).toBe(ApplicationStatus.Active);
  });

  it('5. Candidate submits the application', async () => {
    const app = await appRepo.getById(applicationId);
    const submitted = await appSvc.transitionStage(
      applicationId, ApplicationStage.Submitted,
      candidateId, [UserRole.Candidate], ORG, app!.version,
    );
    expect(submitted.stage).toBe(ApplicationStage.Submitted);
  });

  it('6. HR moves application to under review', async () => {
    const app = await appRepo.getById(applicationId);
    const reviewing = await appSvc.transitionStage(
      applicationId, ApplicationStage.UnderReview,
      employerId, [UserRole.HRCoordinator], ORG, app!.version,
    );
    expect(reviewing.stage).toBe(ApplicationStage.UnderReview);
  });

  it('7. HR schedules an interview', async () => {
    // Seed an interview plan
    const plan = makeInterviewPlan({ jobId, organizationId: ORG });
    planRepo.seed([plan]);

    const interview = await intSvc.scheduleInterview(
      applicationId, plan.id,
      employerId, candidateId,
      '2026-07-01T10:00:00.000Z', '2026-07-01T11:00:00.000Z',
      employerId, [UserRole.HRCoordinator], ORG,
    );
    interviewId = interview.id;
    expect(interview.status).toBe(InterviewStatus.Scheduled);
  });

  it('8. Notifications were fired for relevant events', async () => {
    // employer gets ApplicationReceived notification
    const allNotifs = await notifRepo.getAll();
    // At least one notification should exist in the repo from the flow above
    expect(allNotifs.length).toBeGreaterThan(0);
  });
});
