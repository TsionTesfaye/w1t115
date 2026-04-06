/**
 * unit_tests/abac-department.spec.ts
 *
 * Department-level ABAC enforcement across Job, Application, and Interview services.
 * These tests verify that HRCoordinators see only entities scoped to their own department,
 * while Administrators retain full org-wide visibility.
 */

import { describe, it, expect } from 'vitest';
import { JobService } from '../src/app/core/services/job.service';
import { ApplicationService } from '../src/app/core/services/application.service';
import { InterviewService } from '../src/app/core/services/interview.service';
import { UserRole, JobStatus } from '../src/app/core/enums';
import {
  FakeJobRepo, FakeLineageRepo, FakeApplicationRepo, FakeInterviewRepo,
  FakeInterviewPlanRepo, FakeUserRepo, FakeNotificationRepo,
  fakeAudit, fakeNotifService,
  makeJob, makeApplication, makeInterview, makeUser,
} from '../src/app/core/services/__tests__/helpers';

const ORG = 'org1';
const HR_ID = 'hr1';
const ADMIN_ID = 'admin1';
const HR_DEPT = 'engineering';
const OTHER_DEPT = 'sales';

// ── Job ABAC ──────────────────────────────────────────────────────────────

describe('ABAC: JobService department filter', () => {
  function makeJobSvc(jobRepo: FakeJobRepo, userRepo: FakeUserRepo) {
    return new JobService(jobRepo as any, new FakeLineageRepo() as any, fakeAudit as any, userRepo as any);
  }

  it('HRCoordinator with department sees only dept + undepartmented jobs', async () => {
    const jobs = [
      makeJob({ id: 'j-eng', organizationId: ORG, departmentId: HR_DEPT, status: JobStatus.Active }),
      makeJob({ id: 'j-sales', organizationId: ORG, departmentId: OTHER_DEPT, status: JobStatus.Active }),
      makeJob({ id: 'j-general', organizationId: ORG, status: JobStatus.Active }),
    ];
    const hrUser = makeUser({ id: HR_ID, departmentId: HR_DEPT, organizationId: ORG, roles: ['hr_coordinator'] });
    const svc = makeJobSvc(new FakeJobRepo().seed(jobs), new FakeUserRepo().seed([hrUser]));

    const result = await svc.listJobs(HR_ID, [UserRole.HRCoordinator], ORG);
    const ids = result.map(j => j.id);
    expect(ids).toContain('j-eng');
    expect(ids).toContain('j-general');
    expect(ids).not.toContain('j-sales');
  });

  it('Administrator sees all org jobs regardless of department', async () => {
    const jobs = [
      makeJob({ organizationId: ORG, departmentId: HR_DEPT }),
      makeJob({ organizationId: ORG, departmentId: OTHER_DEPT }),
    ];
    const svc = makeJobSvc(new FakeJobRepo().seed(jobs), new FakeUserRepo());
    const result = await svc.listJobs(ADMIN_ID, [UserRole.Administrator], ORG);
    expect(result).toHaveLength(2);
  });

  it('HRCoordinator with no departmentId sees all org jobs', async () => {
    const jobs = [
      makeJob({ organizationId: ORG, departmentId: HR_DEPT }),
      makeJob({ organizationId: ORG, departmentId: OTHER_DEPT }),
    ];
    const hrUser = makeUser({ id: HR_ID, departmentId: '', organizationId: ORG, roles: ['hr_coordinator'] });
    const svc = makeJobSvc(new FakeJobRepo().seed(jobs), new FakeUserRepo().seed([hrUser]));
    const result = await svc.listJobs(HR_ID, [UserRole.HRCoordinator], ORG);
    expect(result).toHaveLength(2);
  });
});

// ── Application ABAC ──────────────────────────────────────────────────────

describe('ABAC: ApplicationService department filter', () => {
  function makeAppSvc(appRepo: FakeApplicationRepo, jobRepo: FakeJobRepo, userRepo: FakeUserRepo) {
    return new ApplicationService(
      appRepo as any, jobRepo as any,
      new FakeLineageRepo() as any,
      new FakeNotificationRepo() as any,
      fakeAudit as any,
      fakeNotifService as any,
      userRepo as any,
    );
  }

  it('HRCoordinator with department only sees applications for jobs in their dept', async () => {
    const engJob = makeJob({ id: 'j-eng', organizationId: ORG, departmentId: HR_DEPT });
    const salesJob = makeJob({ id: 'j-sales', organizationId: ORG, departmentId: OTHER_DEPT });
    const engApp = makeApplication({ id: 'a-eng', jobId: 'j-eng', organizationId: ORG });
    const salesApp = makeApplication({ id: 'a-sales', jobId: 'j-sales', organizationId: ORG });
    const hrUser = makeUser({ id: HR_ID, departmentId: HR_DEPT, organizationId: ORG, roles: ['hr_coordinator'] });

    const svc = makeAppSvc(
      new FakeApplicationRepo().seed([engApp, salesApp]),
      new FakeJobRepo().seed([engJob, salesJob]),
      new FakeUserRepo().seed([hrUser]),
    );

    const result = await svc.listByOrganization(HR_ID, [UserRole.HRCoordinator], ORG);
    const ids = result.map(a => a.id);
    expect(ids).toContain('a-eng');
    expect(ids).not.toContain('a-sales');
  });

  it('Administrator sees all applications', async () => {
    const apps = [
      makeApplication({ organizationId: ORG }),
      makeApplication({ organizationId: ORG }),
    ];
    const svc = makeAppSvc(
      new FakeApplicationRepo().seed(apps),
      new FakeJobRepo(),
      new FakeUserRepo(),
    );
    const result = await svc.listByOrganization(ADMIN_ID, [UserRole.Administrator], ORG);
    expect(result).toHaveLength(2);
  });
});

// ── Interview ABAC ────────────────────────────────────────────────────────

describe('ABAC: InterviewService department filter', () => {
  function makeIntSvc(
    interviewRepo: FakeInterviewRepo,
    appRepo: FakeApplicationRepo,
    jobRepo: FakeJobRepo,
    userRepo: FakeUserRepo,
  ) {
    return new InterviewService(
      interviewRepo as any,
      new FakeInterviewPlanRepo() as any,
      appRepo as any,
      jobRepo as any,
      new FakeLineageRepo() as any,
      fakeAudit as any,
      fakeNotifService as any,
      userRepo as any,
    );
  }

  it('HRCoordinator with department only sees interviews for dept applications', async () => {
    const engJob = makeJob({ id: 'j-eng', organizationId: ORG, departmentId: HR_DEPT });
    const salesJob = makeJob({ id: 'j-sales', organizationId: ORG, departmentId: OTHER_DEPT });
    const engApp = makeApplication({ id: 'a-eng', jobId: 'j-eng', organizationId: ORG });
    const salesApp = makeApplication({ id: 'a-sales', jobId: 'j-sales', organizationId: ORG });
    const engInterview = makeInterview({ id: 'i-eng', applicationId: 'a-eng', organizationId: ORG });
    const salesInterview = makeInterview({ id: 'i-sales', applicationId: 'a-sales', organizationId: ORG });
    const hrUser = makeUser({ id: HR_ID, departmentId: HR_DEPT, organizationId: ORG, roles: ['hr_coordinator'] });

    const svc = makeIntSvc(
      new FakeInterviewRepo().seed([engInterview, salesInterview]),
      new FakeApplicationRepo().seed([engApp, salesApp]),
      new FakeJobRepo().seed([engJob, salesJob]),
      new FakeUserRepo().seed([hrUser]),
    );

    const result = await svc.listByOrganization(HR_ID, [UserRole.HRCoordinator], ORG);
    const ids = result.map(i => i.id);
    expect(ids).toContain('i-eng');
    expect(ids).not.toContain('i-sales');
  });

  it('Administrator sees all interviews', async () => {
    const interviews = [makeInterview({ organizationId: ORG }), makeInterview({ organizationId: ORG })];
    const svc = makeIntSvc(
      new FakeInterviewRepo().seed(interviews),
      new FakeApplicationRepo(),
      new FakeJobRepo(),
      new FakeUserRepo(),
    );
    const result = await svc.listByOrganization(ADMIN_ID, [UserRole.Administrator], ORG);
    expect(result).toHaveLength(2);
  });
});
