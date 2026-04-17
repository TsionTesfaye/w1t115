/**
 * browser_tests/component-integration.spec.ts
 *
 * Integration-style component tests — real service instances, no vi.fn() stubs.
 *
 * Pattern:
 *   • Angular TestBed renders the real component.
 *   • Business services (JobService, ApplicationService) are instantiated with
 *     `new ServiceClass(...)` — real logic runs, including RBAC and state machines.
 *   • Repositories are FakeStore in-memory doubles (not IDB mocks); they implement
 *     the same interface and propagate errors exactly as the real repo does.
 *   • SessionService is a minimal signal-based stub — it only provides the user
 *     context that the component reads (userId, organizationId, activeRole, roles).
 *     Replacing it with a real instance would require crypto + IDB, which are not
 *     available in a jsdom environment.
 *
 * What "no mocks" means here:
 *   ✓ No vi.fn() service stubs — real service logic runs for every call
 *   ✓ RBAC rejections come from the real service, not from a hard-coded stub
 *   ✓ State-machine transitions are enforced by real assertTransition()
 *   ✓ Real data shapes (validated by TypeScript interfaces) flow through the component
 *   ✗ SessionService: minimal stub (auth requires crypto + IDB — not practical in jsdom)
 *   ✗ AuditService: fakeAudit no-op (audit I/O is a cross-cutting concern, not under test)
 */

import { describe, it, expect, afterEach, vi } from 'vitest';
import { TestBed } from '@angular/core/testing';
import { signal, computed } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { provideRouter } from '@angular/router';

import { JobListComponent } from '../src/app/modules/jobs/pages/job-list.component';
import { ApplicationListComponent } from '../src/app/modules/applications/pages/application-list.component';

import { SessionService } from '../src/app/core/services/session.service';
import { JobService } from '../src/app/core/services/job.service';
import { ApplicationService } from '../src/app/core/services/application.service';

import { UserRole, JobStatus, ApplicationStage, ApplicationStatus } from '../src/app/core/enums';
import { AuthorizationError } from '../src/app/core/errors';

import {
  FakeJobRepo, FakeApplicationRepo, FakeLineageRepo,
  FakeUserRepo, FakeNotificationRepo, FakeNotificationPreferenceRepo,
  FakeDelayedDeliveryRepo,
  makeJob, makeApplication, makeUser,
  fakeAudit, fakeNotifService,
} from '../src/app/core/services/__tests__/helpers';

afterEach(() => {
  vi.restoreAllMocks();
  TestBed.resetTestingModule();
});

// ── Session stub factory ───────────────────────────────────────────────────────

function makeSession(role: UserRole, userId = 'u1', orgId = 'org1') {
  return {
    activeRole:      signal(role),
    isAuthenticated: computed(() => true),
    initialized:     signal(true),
    currentUser:     signal({ displayName: 'Test User' }),
    organizationId:  computed(() => orgId),
    userId:          computed(() => userId),
    userRoles:       computed(() => [role]),
    requireAuth: () => ({ userId, organizationId: orgId, roles: [role], activeRole: role }),
  };
}

// ── Real service factory ───────────────────────────────────────────────────────

function makeJobService(jobRepo = new FakeJobRepo()) {
  return new JobService(jobRepo as any, new FakeLineageRepo() as any, fakeAudit as any, new FakeUserRepo() as any);
}

function makeAppService(appRepo = new FakeApplicationRepo(), jobRepo = new FakeJobRepo()) {
  return new ApplicationService(
    appRepo as any, jobRepo as any, new FakeLineageRepo() as any,
    new FakeNotificationRepo() as any, fakeAudit as any, fakeNotifService as any,
    new FakeUserRepo() as any,
  );
}

// ── JobListComponent — real JobService ────────────────────────────────────────

describe('JobListComponent — real JobService integration', () => {
  function configure(role: UserRole, jobRepo = new FakeJobRepo()) {
    const realJobSvc = makeJobService(jobRepo);
    const session    = makeSession(role);

    TestBed.configureTestingModule({
      imports: [JobListComponent],
      providers: [
        provideRouter([]),
        { provide: SessionService,    useValue: session },
        { provide: JobService,        useValue: realJobSvc },
        { provide: ApplicationService, useValue: makeAppService() },
        { provide: Router,            useValue: { navigate: vi.fn() } },
      ],
    });

    const fixture = TestBed.createComponent(JobListComponent);
    return { component: fixture.componentInstance, realJobSvc };
  }

  it('employer sees all draft + active jobs via real service RBAC', async () => {
    const jobRepo = new FakeJobRepo();
    await jobRepo.add(makeJob({ id: 'j1', status: JobStatus.Draft,  organizationId: 'org1', ownerUserId: 'u1' }));
    await jobRepo.add(makeJob({ id: 'j2', status: JobStatus.Active, organizationId: 'org1', ownerUserId: 'u1' }));

    const { component } = configure(UserRole.Employer, jobRepo);
    await component.loadJobs();

    // Real JobService.listJobsByOwner — returns jobs for this owner (no status filter for management)
    expect(component.jobs().length).toBe(2);
  });

  it('candidate sees only active jobs via real service RBAC', async () => {
    const jobRepo = new FakeJobRepo();
    await jobRepo.add(makeJob({ id: 'j1', status: JobStatus.Draft,  organizationId: 'org1' }));
    await jobRepo.add(makeJob({ id: 'j2', status: JobStatus.Active, organizationId: 'org1' }));

    const { component } = configure(UserRole.Candidate, jobRepo);
    await component.loadJobs();

    // Real JobService.listJobs for candidates: only Active jobs visible
    expect(component.jobs().length).toBe(1);
    expect(component.jobs()[0].status).toBe(JobStatus.Active);
  });

  it('employer can create a job via real service — draft created in repo', async () => {
    const jobRepo = new FakeJobRepo();
    const { component } = configure(UserRole.Employer, jobRepo);

    component.jobForm.setValue({ title: 'Real Job', description: 'Backend engineer role', tags: '', topics: '' });
    await component.onCreateJob();

    const all = await jobRepo.getAll();
    expect(all.length).toBe(1);
    expect(all[0].title).toBe('Real Job');
    expect(all[0].status).toBe(JobStatus.Draft);
    expect(component.actionSuccess()).toContain('created');
  });

  it('candidate cannot create a job — real AuthorizationError from service', async () => {
    const { component } = configure(UserRole.Candidate);
    component.jobForm.setValue({ title: 'Sneaky', description: 'Unauthorized attempt', tags: '', topics: '' });

    await component.onCreateJob();

    expect(component.actionError()).toContain('Employer');
  });

  it('form validation blocks service call when title is empty', async () => {
    const { component } = configure(UserRole.Employer);
    component.jobForm.setValue({ title: '', description: 'Some description', tags: '', topics: '' });

    await component.onCreateJob();

    // Component returns early because form is invalid — no service error set
    expect(component.jobForm.invalid).toBe(true);
    expect(component.actionError()).toBeNull();
  });

  it('real service ValidationError when title is whitespace-only', async () => {
    // Bypass form validation to reach the real service
    const { realJobSvc } = configure(UserRole.Employer);
    await expect(
      realJobSvc.createJob('   ', 'Desc', [], [], 'u1', [UserRole.Employer], 'org1'),
    ).rejects.toThrow('title is required');
  });

  it('job count is 0 when repo is empty', async () => {
    const { component } = configure(UserRole.Employer);
    await component.loadJobs();
    expect(component.jobs()).toHaveLength(0);
    expect(component.isLoading()).toBe(false);
  });

  it('error signal set when repo throws', async () => {
    const badRepo = new FakeJobRepo();
    (badRepo as any).getByOrganization = async () => { throw new Error('DB error'); };
    (badRepo as any).getByOwner = async () => { throw new Error('DB error'); };

    const { component } = configure(UserRole.Employer, badRepo);
    await component.loadJobs();

    expect(component.error()).toContain('DB error');
  });
});

// ── ApplicationListComponent — real ApplicationService ────────────────────────

describe('ApplicationListComponent — real ApplicationService integration', () => {
  function configure(role: UserRole, appRepo = new FakeApplicationRepo(), jobRepo = new FakeJobRepo()) {
    const realAppSvc = makeAppService(appRepo, jobRepo);
    const session    = makeSession(role, 'u1', 'org1');

    TestBed.configureTestingModule({
      imports: [ApplicationListComponent],
      providers: [
        provideRouter([]),
        { provide: SessionService,    useValue: session },
        { provide: ApplicationService, useValue: realAppSvc },
        { provide: JobService,        useValue: makeJobService(jobRepo) },
        { provide: Router,            useValue: { navigate: vi.fn() } },
      ],
    });

    const fixture = TestBed.createComponent(ApplicationListComponent);
    return { component: fixture.componentInstance, realAppSvc };
  }

  it('candidate sees only their own applications via real service RBAC', async () => {
    const appRepo = new FakeApplicationRepo();
    await appRepo.add(makeApplication({ id: 'a1', candidateId: 'u1', organizationId: 'org1', status: ApplicationStatus.Active }));
    await appRepo.add(makeApplication({ id: 'a2', candidateId: 'u9', organizationId: 'org1', status: ApplicationStatus.Active }));

    const { component } = configure(UserRole.Candidate, appRepo);
    await component.loadApps();

    // Real ApplicationService.listByCandidate returns only u1's applications
    expect(component.apps().length).toBe(1);
    expect(component.apps()[0].id).toBe('a1');
  });

  it('employer sees applications for their own jobs via real service RBAC', async () => {
    const jobRepo = new FakeJobRepo();
    await jobRepo.add(makeJob({ id: 'j1', organizationId: 'org1', ownerUserId: 'u1', status: JobStatus.Active }));

    const appRepo = new FakeApplicationRepo();
    // a1 and a2 belong to j1 (owned by employer u1)
    await appRepo.add(makeApplication({ id: 'a1', candidateId: 'c1', organizationId: 'org1', jobId: 'j1', status: ApplicationStatus.Active }));
    await appRepo.add(makeApplication({ id: 'a2', candidateId: 'c2', organizationId: 'org1', jobId: 'j1', status: ApplicationStatus.Active }));
    // a3 belongs to j2 (not owned by u1 — must be hidden)
    await appRepo.add(makeApplication({ id: 'a3', candidateId: 'c3', organizationId: 'org1', jobId: 'j2', status: ApplicationStatus.Active }));

    const { component } = configure(UserRole.Employer, appRepo, jobRepo);
    await component.loadApps();

    // Real ApplicationService.listByOrganization for Employer: only their own jobs' applications
    expect(component.apps().length).toBe(2);
    const ids = component.apps().map((a: any) => a.id);
    expect(ids).toContain('a1');
    expect(ids).toContain('a2');
    expect(ids).not.toContain('a3');
  });

  it('candidate can withdraw their own application — real state machine runs', async () => {
    const appRepo = new FakeApplicationRepo();
    const submittedApp = makeApplication({
      id: 'a1', candidateId: 'u1', organizationId: 'org1',
      stage: ApplicationStage.Submitted, status: ApplicationStatus.Active, version: 1,
    });
    await appRepo.add(submittedApp);

    const { component } = configure(UserRole.Candidate, appRepo);
    await component.loadApps();

    // onWithdraw takes the Application object (not an ID)
    await component.onWithdraw(submittedApp);

    // Real ApplicationService.withdraw — state machine enforces Active→Withdrawn
    const updated = await appRepo.getById('a1');
    expect(updated?.status).toBe(ApplicationStatus.Withdrawn);
  });

  it('employer can reject a submitted application — real state machine runs', async () => {
    const appRepo = new FakeApplicationRepo();
    const app = makeApplication({
      id: 'a1', candidateId: 'u1', organizationId: 'org1',
      stage: ApplicationStage.Submitted, status: ApplicationStatus.Active, version: 1,
    });
    await appRepo.add(app);

    const { component } = configure(UserRole.Employer, appRepo);
    await component.loadApps();

    // onReject takes the Application object (not an ID)
    await component.onReject(app);

    const updated = await appRepo.getById('a1');
    expect(updated?.status).toBe(ApplicationStatus.Rejected);
  });

  it('list is empty when no applications exist', async () => {
    const { component } = configure(UserRole.Candidate);
    await component.loadApps();
    expect(component.apps()).toHaveLength(0);
  });

  it('error signal set when repo throws', async () => {
    const badRepo = new FakeApplicationRepo();
    (badRepo as any).getByCandidate = async () => { throw new Error('DB read failed'); };

    const { component } = configure(UserRole.Candidate, badRepo);
    await component.loadApps();

    expect(component.error()).toContain('DB read failed');
  });

  it('cross-org applications are invisible: real org isolation in service', async () => {
    const appRepo = new FakeApplicationRepo();
    await appRepo.add(makeApplication({ id: 'a1', candidateId: 'u1', organizationId: 'org1', status: ApplicationStatus.Active }));
    await appRepo.add(makeApplication({ id: 'a_other', candidateId: 'u1', organizationId: 'other-org', status: ApplicationStatus.Active }));

    const { component } = configure(UserRole.Candidate, appRepo);
    await component.loadApps();

    // Real service filters by organizationId — other-org application invisible
    const ids = component.apps().map((a: any) => a.id);
    expect(ids).toContain('a1');
    expect(ids).not.toContain('a_other');
  });
});
