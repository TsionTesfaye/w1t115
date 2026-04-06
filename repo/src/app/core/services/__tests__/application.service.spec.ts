import { describe, it, expect, beforeEach } from 'vitest';
import { ApplicationService } from '../application.service';
import { ApplicationStage, ApplicationStatus, JobStatus, UserRole } from '../../enums';
import {
  AuthorizationError, ValidationError, ConflictError, OptimisticLockError,
} from '../../errors';
import {
  FakeApplicationRepo, FakeJobRepo, FakeLineageRepo, FakeNotificationRepo, FakeUserRepo,
  fakeAudit, fakeNotifService, makeJob, makeApplication,
} from './helpers';

// ── Fixture helpers ────────────────────────────────────────────────────────

const ORG = 'org1';
const OTHER_ORG = 'org2';
const CANDIDATE = 'candidate1';
const OTHER_CANDIDATE = 'candidate2';
const EMPLOYER = 'employer1';

const CANDIDATE_ROLES = [UserRole.Candidate];
const EMPLOYER_ROLES  = [UserRole.Employer];
const HR_ROLES        = [UserRole.HRCoordinator];
const ADMIN_ROLES     = [UserRole.Administrator];

function makeService(appRepo: FakeApplicationRepo, jobRepo: FakeJobRepo, userRepo = new FakeUserRepo()) {
  return new ApplicationService(
    appRepo as any, jobRepo as any,
    new FakeLineageRepo() as any,
    new FakeNotificationRepo() as any,
    fakeAudit as any,
    fakeNotifService as any,
    userRepo as any,
  );
}

// ── Tests ──────────────────────────────────────────────────────────────────

describe('ApplicationService — RBAC violations', () => {
  it('non-candidate cannot create an application', async () => {
    const jobRepo = new FakeJobRepo().seed([makeJob({ id: 'job1', status: JobStatus.Active })]);
    const svc = makeService(new FakeApplicationRepo(), jobRepo);
    await expect(
      svc.createApplication('job1', EMPLOYER, ORG, EMPLOYER_ROLES),
    ).rejects.toThrow(AuthorizationError);
  });

  it('candidate cannot list applications by job', async () => {
    const jobRepo = new FakeJobRepo().seed([makeJob({ id: 'job1' })]);
    const svc = makeService(new FakeApplicationRepo(), jobRepo);
    await expect(
      svc.listByJob('job1', CANDIDATE_ROLES, ORG),
    ).rejects.toThrow(AuthorizationError);
  });

  it('candidate cannot reject an application', async () => {
    const app = makeApplication({ id: 'app1', stage: ApplicationStage.Submitted, status: ApplicationStatus.Active });
    const appRepo = new FakeApplicationRepo().seed([app]);
    const svc = makeService(appRepo, new FakeJobRepo());
    await expect(
      svc.reject('app1', CANDIDATE, CANDIDATE_ROLES, ORG, app.version),
    ).rejects.toThrow(AuthorizationError);
  });

  it('candidate cannot advance stage beyond submission', async () => {
    const app = makeApplication({ id: 'app1', candidateId: CANDIDATE, stage: ApplicationStage.Submitted, status: ApplicationStatus.Active });
    const appRepo = new FakeApplicationRepo().seed([app]);
    const svc = makeService(appRepo, new FakeJobRepo());
    await expect(
      svc.transitionStage('app1', ApplicationStage.UnderReview, CANDIDATE, CANDIDATE_ROLES, ORG, app.version),
    ).rejects.toThrow(AuthorizationError);
  });

  it('candidate cannot archive an application', async () => {
    const app = makeApplication({ id: 'app1', status: ApplicationStatus.Rejected });
    const appRepo = new FakeApplicationRepo().seed([app]);
    const svc = makeService(appRepo, new FakeJobRepo());
    await expect(
      svc.archiveApplication('app1', CANDIDATE, CANDIDATE_ROLES, ORG, app.version),
    ).rejects.toThrow(AuthorizationError);
  });
});

describe('ApplicationService — ABAC violations', () => {
  it('cannot read application from a different organization', async () => {
    const app = makeApplication({ id: 'app1', organizationId: OTHER_ORG });
    const appRepo = new FakeApplicationRepo().seed([app]);
    const svc = makeService(appRepo, new FakeJobRepo());
    await expect(
      svc.getApplication('app1', EMPLOYER, EMPLOYER_ROLES, ORG),
    ).rejects.toThrow(AuthorizationError);
  });

  it("candidate cannot read another candidate's application", async () => {
    const app = makeApplication({ id: 'app1', candidateId: OTHER_CANDIDATE, organizationId: ORG });
    const appRepo = new FakeApplicationRepo().seed([app]);
    const svc = makeService(appRepo, new FakeJobRepo());
    await expect(
      svc.getApplication('app1', CANDIDATE, CANDIDATE_ROLES, ORG),
    ).rejects.toThrow(AuthorizationError);
  });

  it("candidate cannot list another candidate's own applications", async () => {
    const appRepo = new FakeApplicationRepo();
    const svc = makeService(appRepo, new FakeJobRepo());
    await expect(
      svc.listByCandidate(OTHER_CANDIDATE, CANDIDATE, ORG),
    ).rejects.toThrow(AuthorizationError);
  });

  it('management cannot reject an application from a different org', async () => {
    const app = makeApplication({ id: 'app1', organizationId: OTHER_ORG, stage: ApplicationStage.Submitted, status: ApplicationStatus.Active });
    const appRepo = new FakeApplicationRepo().seed([app]);
    const svc = makeService(appRepo, new FakeJobRepo());
    await expect(
      svc.reject('app1', EMPLOYER, EMPLOYER_ROLES, ORG, app.version),
    ).rejects.toThrow(AuthorizationError);
  });

  it('cannot apply to a job from a different organization', async () => {
    const job = makeJob({ id: 'job1', organizationId: OTHER_ORG, status: JobStatus.Active });
    const jobRepo = new FakeJobRepo().seed([job]);
    const svc = makeService(new FakeApplicationRepo(), jobRepo);
    await expect(
      svc.createApplication('job1', CANDIDATE, ORG, CANDIDATE_ROLES),
    ).rejects.toThrow(AuthorizationError);
  });
});

describe('ApplicationService — duplicate applications', () => {
  it('throws ConflictError when candidate applies to the same job twice', async () => {
    const existing = makeApplication({ jobId: 'job1', candidateId: CANDIDATE, status: ApplicationStatus.Active });
    const job = makeJob({ id: 'job1', status: JobStatus.Active });
    const appRepo = new FakeApplicationRepo().seed([existing]);
    const jobRepo = new FakeJobRepo().seed([job]);
    const svc = makeService(appRepo, jobRepo);
    await expect(
      svc.createApplication('job1', CANDIDATE, ORG, CANDIDATE_ROLES),
    ).rejects.toThrow(ConflictError);
  });

  it('allows re-application after the previous application is deleted', async () => {
    const deleted = makeApplication({
      jobId: 'job1', candidateId: CANDIDATE, status: ApplicationStatus.Deleted,
    });
    const job = makeJob({ id: 'job1', status: JobStatus.Active });
    const appRepo = new FakeApplicationRepo().seed([deleted]);
    const jobRepo = new FakeJobRepo().seed([job]);
    const svc = makeService(appRepo, jobRepo);
    const newApp = await svc.createApplication('job1', CANDIDATE, ORG, CANDIDATE_ROLES);
    expect(newApp.status).toBe(ApplicationStatus.Active);
  });
});

describe('ApplicationService — invalid state transitions', () => {
  it('cannot apply to a closed job', async () => {
    const job = makeJob({ id: 'job1', status: JobStatus.Closed });
    const jobRepo = new FakeJobRepo().seed([job]);
    const svc = makeService(new FakeApplicationRepo(), jobRepo);
    await expect(
      svc.createApplication('job1', CANDIDATE, ORG, CANDIDATE_ROLES),
    ).rejects.toThrow(ValidationError);
  });

  it('cannot apply to a draft job', async () => {
    const job = makeJob({ id: 'job1', status: JobStatus.Draft });
    const jobRepo = new FakeJobRepo().seed([job]);
    const svc = makeService(new FakeApplicationRepo(), jobRepo);
    await expect(
      svc.createApplication('job1', CANDIDATE, ORG, CANDIDATE_ROLES),
    ).rejects.toThrow(ValidationError);
  });

  it('cannot withdraw from Draft stage (not yet submitted)', async () => {
    const app = makeApplication({
      id: 'app1', candidateId: CANDIDATE, stage: ApplicationStage.Draft, status: ApplicationStatus.Active,
    });
    const appRepo = new FakeApplicationRepo().seed([app]);
    const svc = makeService(appRepo, new FakeJobRepo());
    await expect(
      svc.withdraw('app1', CANDIDATE, ORG, app.version),
    ).rejects.toThrow(ValidationError);
  });

  it('cannot reject a Draft-stage application (candidate not yet submitted)', async () => {
    const app = makeApplication({
      id: 'app1', stage: ApplicationStage.Draft, status: ApplicationStatus.Active,
    });
    const appRepo = new FakeApplicationRepo().seed([app]);
    const svc = makeService(appRepo, new FakeJobRepo());
    await expect(
      svc.reject('app1', EMPLOYER, EMPLOYER_ROLES, ORG, app.version),
    ).rejects.toThrow(ValidationError);
  });

  it('cannot accept an offer when no offer has been extended', async () => {
    const app = makeApplication({
      id: 'app1', candidateId: CANDIDATE,
      stage: ApplicationStage.InterviewCompleted, status: ApplicationStatus.Active,
    });
    const appRepo = new FakeApplicationRepo().seed([app]);
    const svc = makeService(appRepo, new FakeJobRepo());
    await expect(
      svc.acceptOffer('app1', CANDIDATE, ORG, app.version),
    ).rejects.toThrow(ValidationError);
  });

  it('cannot accept an expired offer', async () => {
    const past = new Date(Date.now() - 1000).toISOString();
    const app = makeApplication({
      id: 'app1', candidateId: CANDIDATE,
      stage: ApplicationStage.OfferExtended, status: ApplicationStatus.Active,
      offerExpiresAt: past,
    });
    const appRepo = new FakeApplicationRepo().seed([app]);
    const svc = makeService(appRepo, new FakeJobRepo());
    await expect(
      svc.acceptOffer('app1', CANDIDATE, ORG, app.version),
    ).rejects.toThrow(ValidationError);
  });

  it('cannot skip stages (Draft → UnderReview skips Submitted)', async () => {
    const app = makeApplication({
      id: 'app1', candidateId: CANDIDATE,
      stage: ApplicationStage.Draft, status: ApplicationStatus.Active,
    });
    const appRepo = new FakeApplicationRepo().seed([app]);
    const svc = makeService(appRepo, new FakeJobRepo());
    // Management trying to skip straight to UnderReview should fail state machine assertion
    await expect(
      svc.transitionStage('app1', ApplicationStage.UnderReview, EMPLOYER, EMPLOYER_ROLES, ORG, app.version),
    ).rejects.toThrow(); // StateMachineError (or ValidationError due to Draft stage)
  });

  it('cannot archive an Active application', async () => {
    const app = makeApplication({ id: 'app1', status: ApplicationStatus.Active });
    const appRepo = new FakeApplicationRepo().seed([app]);
    const svc = makeService(appRepo, new FakeJobRepo());
    await expect(
      svc.archiveApplication('app1', EMPLOYER, EMPLOYER_ROLES, ORG, app.version),
    ).rejects.toThrow(ValidationError);
  });

  it('expireOffer rejects when offer has not yet expired', async () => {
    const future = new Date(Date.now() + 3_600_000).toISOString();
    const app = makeApplication({
      id: 'app1', stage: ApplicationStage.OfferExtended,
      status: ApplicationStatus.Active, offerExpiresAt: future,
    });
    const appRepo = new FakeApplicationRepo().seed([app]);
    const svc = makeService(appRepo, new FakeJobRepo());
    await expect(
      svc.expireOffer('app1', ORG, app.version),
    ).rejects.toThrow(ValidationError);
  });
});

describe('ApplicationService — optimistic lock enforcement', () => {
  it('wrong version throws OptimisticLockError on transitionStage', async () => {
    const app = makeApplication({
      id: 'app1', candidateId: CANDIDATE,
      stage: ApplicationStage.Draft, status: ApplicationStatus.Active,
      version: 3,
    });
    const appRepo = new FakeApplicationRepo().seed([app]);
    const svc = makeService(appRepo, new FakeJobRepo());
    await expect(
      svc.transitionStage('app1', ApplicationStage.Submitted, CANDIDATE, CANDIDATE_ROLES, ORG, 1), // stale version
    ).rejects.toThrow(OptimisticLockError);
  });

  it('wrong version throws OptimisticLockError on reject', async () => {
    const app = makeApplication({
      id: 'app1', stage: ApplicationStage.Submitted,
      status: ApplicationStatus.Active, version: 5,
    });
    const appRepo = new FakeApplicationRepo().seed([app]);
    const svc = makeService(appRepo, new FakeJobRepo());
    await expect(
      svc.reject('app1', EMPLOYER, EMPLOYER_ROLES, ORG, 2), // stale version
    ).rejects.toThrow(OptimisticLockError);
  });

  it('wrong version throws OptimisticLockError on withdraw', async () => {
    const app = makeApplication({
      id: 'app1', candidateId: CANDIDATE,
      stage: ApplicationStage.Submitted, status: ApplicationStatus.Active, version: 7,
    });
    const appRepo = new FakeApplicationRepo().seed([app]);
    const svc = makeService(appRepo, new FakeJobRepo());
    await expect(
      svc.withdraw('app1', CANDIDATE, ORG, 3),
    ).rejects.toThrow(OptimisticLockError);
  });
});

// ── Happy paths ──────────────────────────────────────────────────────────────

describe('ApplicationService — happy paths', () => {
  it('creates an application for an Active job', async () => {
    const job = makeJob({ id: 'job1', status: JobStatus.Active });
    const jobRepo = new FakeJobRepo().seed([job]);
    const svc = makeService(new FakeApplicationRepo(), jobRepo);
    const app = await svc.createApplication('job1', CANDIDATE, ORG, CANDIDATE_ROLES);
    expect(app.stage).toBe(ApplicationStage.Draft);
    expect(app.status).toBe(ApplicationStatus.Active);
    expect(app.candidateId).toBe(CANDIDATE);
  });

  it('candidate submits their Draft application', async () => {
    const app = makeApplication({
      id: 'app1', candidateId: CANDIDATE, stage: ApplicationStage.Draft, status: ApplicationStatus.Active,
    });
    const svc = makeService(new FakeApplicationRepo().seed([app]), new FakeJobRepo());
    const result = await svc.transitionStage('app1', ApplicationStage.Submitted, CANDIDATE, CANDIDATE_ROLES, ORG, app.version);
    expect(result.stage).toBe(ApplicationStage.Submitted);
    expect(result.submittedAt).toBeTruthy();
  });

  it('management advances Submitted → UnderReview', async () => {
    const app = makeApplication({
      id: 'app1', stage: ApplicationStage.Submitted, status: ApplicationStatus.Active,
    });
    const svc = makeService(new FakeApplicationRepo().seed([app]), new FakeJobRepo());
    const result = await svc.transitionStage('app1', ApplicationStage.UnderReview, EMPLOYER, EMPLOYER_ROLES, ORG, app.version);
    expect(result.stage).toBe(ApplicationStage.UnderReview);
  });

  it('candidate withdraws a Submitted application', async () => {
    const app = makeApplication({
      id: 'app1', candidateId: CANDIDATE, stage: ApplicationStage.Submitted, status: ApplicationStatus.Active,
    });
    const svc = makeService(new FakeApplicationRepo().seed([app]), new FakeJobRepo());
    const result = await svc.withdraw('app1', CANDIDATE, ORG, app.version);
    expect(result.status).toBe(ApplicationStatus.Withdrawn);
  });
});

// ── Employer ABAC scoping ────────────────────────────────────────────────────

describe('ApplicationService — Employer ABAC scoping', () => {
  it('Employer sees only applications for own jobs via listByOrganization', async () => {
    const apps = [
      makeApplication({ id: 'a1', jobId: 'j1' }),
      makeApplication({ id: 'a2', jobId: 'j2' }),
    ];
    const jobs = [
      makeJob({ id: 'j1', ownerUserId: EMPLOYER }),
      makeJob({ id: 'j2', ownerUserId: 'other-employer' }),
    ];
    const svc = makeService(new FakeApplicationRepo().seed(apps), new FakeJobRepo().seed(jobs));
    const result = await svc.listByOrganization(EMPLOYER, EMPLOYER_ROLES, ORG);
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe('a1');
  });

  it('HR sees all org applications via listByOrganization', async () => {
    const apps = [
      makeApplication({ id: 'a1', jobId: 'j1' }),
      makeApplication({ id: 'a2', jobId: 'j2' }),
    ];
    const svc = makeService(new FakeApplicationRepo().seed(apps), new FakeJobRepo());
    const result = await svc.listByOrganization('hr1', HR_ROLES, ORG);
    expect(result).toHaveLength(2);
  });
});
