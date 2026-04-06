import { describe, it, expect } from 'vitest';
import { JobService } from '../job.service';
import { JobStatus, UserRole } from '../../enums';
import {
  AuthorizationError, ValidationError, OptimisticLockError,
} from '../../errors';
import { StateMachineError } from '../../state-machines';
import {
  FakeJobRepo, FakeLineageRepo, FakeUserRepo, fakeAudit, makeJob, makeUser,
} from './helpers';

const ORG = 'org1';
const OTHER_ORG = 'org2';
const EMPLOYER = 'employer1';
const CANDIDATE = 'candidate1';
const HR = 'hr1';
const CANDIDATE_ROLES = [UserRole.Candidate];
const EMPLOYER_ROLES  = [UserRole.Employer];
const HR_ROLES        = [UserRole.HRCoordinator];

function makeService(jobRepo: FakeJobRepo, userRepo = new FakeUserRepo()) {
  return new JobService(jobRepo as any, new FakeLineageRepo() as any, fakeAudit as any, userRepo as any);
}

// ── RBAC ──────────────────────────────────────────────────────────────────

describe('JobService — RBAC violations', () => {
  it('candidate cannot create a job', async () => {
    const svc = makeService(new FakeJobRepo());
    await expect(
      svc.createJob('Title', 'Desc', [], [], CANDIDATE, CANDIDATE_ROLES, ORG),
    ).rejects.toThrow(AuthorizationError);
  });

  it('candidate requesting non-Active status filter receives an empty list (not an error)', async () => {
    const job = makeJob({ status: JobStatus.Draft });
    const svc = makeService(new FakeJobRepo().seed([job]));
    const result = await svc.listJobs(CANDIDATE, CANDIDATE_ROLES, ORG, JobStatus.Draft);
    expect(result).toHaveLength(0);
  });

  it('candidate cannot see Draft jobs when listing all', async () => {
    const jobs = [
      makeJob({ status: JobStatus.Active }),
      makeJob({ status: JobStatus.Draft }),
      makeJob({ status: JobStatus.Closed }),
    ];
    const svc = makeService(new FakeJobRepo().seed(jobs));
    const result = await svc.listJobs(CANDIDATE, CANDIDATE_ROLES, ORG);
    expect(result.every(j => j.status === JobStatus.Active)).toBe(true);
  });

  it("candidate cannot list another owner's jobs", async () => {
    const svc = makeService(new FakeJobRepo());
    await expect(
      svc.listJobsByOwner(EMPLOYER, CANDIDATE, CANDIDATE_ROLES, ORG),
    ).rejects.toThrow(AuthorizationError);
  });

  it('non-management role cannot update a job they do not own', async () => {
    // Candidate (non-management) cannot update a job owned by someone else
    const job = makeJob({ id: 'job1', ownerUserId: 'other-employer', status: JobStatus.Draft });
    const svc = makeService(new FakeJobRepo().seed([job]));
    await expect(
      svc.updateJob('job1', { title: 'New Title' }, CANDIDATE, CANDIDATE_ROLES, ORG, job.version),
    ).rejects.toThrow(AuthorizationError);
  });

  it('interviewer role cannot create a job', async () => {
    const svc = makeService(new FakeJobRepo());
    await expect(
      svc.createJob('Title', 'Desc', [], [], 'int1', [UserRole.Interviewer], ORG),
    ).rejects.toThrow(AuthorizationError);
  });
});

// ── ABAC ──────────────────────────────────────────────────────────────────

describe('JobService — ABAC violations', () => {
  it('cannot read a job from a different organization', async () => {
    const job = makeJob({ id: 'job1', organizationId: OTHER_ORG });
    const svc = makeService(new FakeJobRepo().seed([job]));
    await expect(svc.getJob('job1', ORG)).rejects.toThrow(AuthorizationError);
  });

  it('cannot transition a job from a different organization', async () => {
    const job = makeJob({ id: 'job1', organizationId: OTHER_ORG, status: JobStatus.Draft });
    const svc = makeService(new FakeJobRepo().seed([job]));
    await expect(
      svc.transitionJobStatus('job1', JobStatus.Active, EMPLOYER, EMPLOYER_ROLES, ORG, job.version),
    ).rejects.toThrow(AuthorizationError);
  });

  it('org boundary is enforced on listJobsByOwner', async () => {
    // Owner has a job in another org; results should be empty (filter, not error)
    const job = makeJob({ ownerUserId: EMPLOYER, organizationId: OTHER_ORG });
    const svc = makeService(new FakeJobRepo().seed([job]));
    const result = await svc.listJobsByOwner(EMPLOYER, EMPLOYER, EMPLOYER_ROLES, ORG);
    expect(result).toHaveLength(0);
  });
});

// ── Department ABAC ───────────────────────────────────────────────────────

describe('JobService — department-level ABAC', () => {
  it('HRCoordinator with departmentId only sees jobs from their department or undepartmented jobs', async () => {
    const jobs = [
      makeJob({ id: 'j-eng', organizationId: ORG, departmentId: 'eng', status: JobStatus.Active }),
      makeJob({ id: 'j-hr', organizationId: ORG, departmentId: 'hr', status: JobStatus.Active }),
      makeJob({ id: 'j-none', organizationId: ORG, status: JobStatus.Active }),
    ];
    const hrUser = makeUser({ id: HR, departmentId: 'hr', organizationId: ORG, roles: ['hr_coordinator'] });
    const userRepo = new FakeUserRepo().seed([hrUser]);
    const svc = makeService(new FakeJobRepo().seed(jobs), userRepo);

    const result = await svc.listJobs(HR, HR_ROLES, ORG);

    expect(result.map(j => j.id)).toEqual(expect.arrayContaining(['j-hr', 'j-none']));
    expect(result.find(j => j.id === 'j-eng')).toBeUndefined();
  });

  it('HRCoordinator with no departmentId sees all org jobs', async () => {
    const jobs = [
      makeJob({ id: 'j-eng', organizationId: ORG, departmentId: 'eng', status: JobStatus.Active }),
      makeJob({ id: 'j-hr', organizationId: ORG, departmentId: 'hr', status: JobStatus.Active }),
    ];
    const hrUser = makeUser({ id: HR, departmentId: '', organizationId: ORG, roles: ['hr_coordinator'] });
    const userRepo = new FakeUserRepo().seed([hrUser]);
    const svc = makeService(new FakeJobRepo().seed(jobs), userRepo);

    const result = await svc.listJobs(HR, HR_ROLES, ORG);

    expect(result).toHaveLength(2);
  });

  it('Administrator sees all org jobs regardless of their own departmentId', async () => {
    const jobs = [
      makeJob({ id: 'j-eng', organizationId: ORG, departmentId: 'eng', status: JobStatus.Active }),
      makeJob({ id: 'j-hr', organizationId: ORG, departmentId: 'hr', status: JobStatus.Active }),
    ];
    const svc = makeService(new FakeJobRepo().seed(jobs));

    const result = await svc.listJobs('admin1', [UserRole.Administrator], ORG);

    expect(result).toHaveLength(2);
  });
});

// ── Invalid state transitions ──────────────────────────────────────────────

describe('JobService — invalid state transitions', () => {
  it('cannot transition Closed → Active', async () => {
    const job = makeJob({ id: 'job1', status: JobStatus.Closed });
    const svc = makeService(new FakeJobRepo().seed([job]));
    await expect(
      svc.transitionJobStatus('job1', JobStatus.Active, EMPLOYER, EMPLOYER_ROLES, ORG, job.version),
    ).rejects.toThrow(StateMachineError);
  });

  it('cannot transition Archived → Active', async () => {
    const job = makeJob({ id: 'job1', status: JobStatus.Archived });
    const svc = makeService(new FakeJobRepo().seed([job]));
    await expect(
      svc.transitionJobStatus('job1', JobStatus.Active, EMPLOYER, EMPLOYER_ROLES, ORG, job.version),
    ).rejects.toThrow(StateMachineError);
  });

  it('cannot transition Active → Draft (no backward moves)', async () => {
    const job = makeJob({ id: 'job1', status: JobStatus.Active });
    const svc = makeService(new FakeJobRepo().seed([job]));
    await expect(
      svc.transitionJobStatus('job1', JobStatus.Draft, EMPLOYER, EMPLOYER_ROLES, ORG, job.version),
    ).rejects.toThrow(StateMachineError);
  });

  it('cannot edit a non-Draft job (Active)', async () => {
    const job = makeJob({ id: 'job1', status: JobStatus.Active, ownerUserId: EMPLOYER });
    const svc = makeService(new FakeJobRepo().seed([job]));
    await expect(
      svc.updateJob('job1', { title: 'New' }, EMPLOYER, EMPLOYER_ROLES, ORG, job.version),
    ).rejects.toThrow(ValidationError);
  });

  it('cannot edit a non-Draft job (Closed)', async () => {
    const job = makeJob({ id: 'job1', status: JobStatus.Closed, ownerUserId: EMPLOYER });
    const svc = makeService(new FakeJobRepo().seed([job]));
    await expect(
      svc.updateJob('job1', { title: 'New' }, EMPLOYER, EMPLOYER_ROLES, ORG, job.version),
    ).rejects.toThrow(ValidationError);
  });
});

// ── Optimistic locking ─────────────────────────────────────────────────────

describe('JobService — optimistic lock enforcement', () => {
  it('wrong version throws OptimisticLockError on transitionJobStatus', async () => {
    const job = makeJob({ id: 'job1', status: JobStatus.Draft, version: 4 });
    const svc = makeService(new FakeJobRepo().seed([job]));
    await expect(
      svc.transitionJobStatus('job1', JobStatus.Active, EMPLOYER, EMPLOYER_ROLES, ORG, 1),
    ).rejects.toThrow(OptimisticLockError);
  });

  it('wrong version throws OptimisticLockError on updateJob', async () => {
    const job = makeJob({ id: 'job1', status: JobStatus.Draft, ownerUserId: EMPLOYER, version: 2 });
    const svc = makeService(new FakeJobRepo().seed([job]));
    await expect(
      svc.updateJob('job1', { title: 'New' }, EMPLOYER, EMPLOYER_ROLES, ORG, 99),
    ).rejects.toThrow(OptimisticLockError);
  });
});

// ── Validation ─────────────────────────────────────────────────────────────

describe('JobService — input validation', () => {
  it('rejects blank title', async () => {
    const svc = makeService(new FakeJobRepo());
    await expect(
      svc.createJob('   ', 'Description', [], [], EMPLOYER, EMPLOYER_ROLES, ORG),
    ).rejects.toThrow(ValidationError);
  });

  it('rejects blank description', async () => {
    const svc = makeService(new FakeJobRepo());
    await expect(
      svc.createJob('Title', '   ', [], [], EMPLOYER, EMPLOYER_ROLES, ORG),
    ).rejects.toThrow(ValidationError);
  });
});

// ── Happy paths ──────────────────────────────────────────────────────────────

describe('JobService — happy paths', () => {
  it('creates a Draft job successfully', async () => {
    const svc = makeService(new FakeJobRepo());
    const job = await svc.createJob('Engineer', 'Build things', ['tech'], [], EMPLOYER, EMPLOYER_ROLES, ORG);
    expect(job.title).toBe('Engineer');
    expect(job.status).toBe(JobStatus.Draft);
    expect(job.ownerUserId).toBe(EMPLOYER);
  });

  it('publishes a Draft job (Draft → Active)', async () => {
    const job = makeJob({ id: 'job1', status: JobStatus.Draft, ownerUserId: EMPLOYER });
    const svc = makeService(new FakeJobRepo().seed([job]));
    const result = await svc.transitionJobStatus('job1', JobStatus.Active, EMPLOYER, EMPLOYER_ROLES, ORG, job.version);
    expect(result.status).toBe(JobStatus.Active);
  });

  it('closes an Active job (Active → Closed)', async () => {
    const job = makeJob({ id: 'job1', status: JobStatus.Active, ownerUserId: EMPLOYER });
    const svc = makeService(new FakeJobRepo().seed([job]));
    const result = await svc.transitionJobStatus('job1', JobStatus.Closed, EMPLOYER, EMPLOYER_ROLES, ORG, job.version);
    expect(result.status).toBe(JobStatus.Closed);
  });
});

// ── Employer ABAC scoping ────────────────────────────────────────────────────

describe('JobService — Employer ABAC scoping', () => {
  it('Employer sees only own jobs via listJobs', async () => {
    const jobs = [
      makeJob({ id: 'j1', ownerUserId: EMPLOYER }),
      makeJob({ id: 'j2', ownerUserId: 'other-employer' }),
    ];
    const svc = makeService(new FakeJobRepo().seed(jobs));
    const result = await svc.listJobs(EMPLOYER, EMPLOYER_ROLES, ORG);
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe('j1');
  });

  it('HR Coordinator sees all org jobs via listJobs', async () => {
    const jobs = [
      makeJob({ id: 'j1', ownerUserId: EMPLOYER }),
      makeJob({ id: 'j2', ownerUserId: 'other-employer' }),
    ];
    const svc = makeService(new FakeJobRepo().seed(jobs));
    const result = await svc.listJobs('hr1', HR_ROLES, ORG);
    expect(result).toHaveLength(2);
  });
});
