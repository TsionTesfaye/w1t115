/**
 * JobDetailComponent — real service integration tests.
 *
 * Uses real JobService and ApplicationService with FakeStore in-memory repos.
 * Includes optimistic-lock test: seed job v1, bump to v2 externally, call action.
 */

import { describe, it, expect, afterEach, vi } from 'vitest';
import { TestBed } from '@angular/core/testing';
import { signal, computed } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { provideRouter } from '@angular/router';
import { JobDetailComponent } from '../job-detail.component';
import { SessionService } from '../../../../core/services/session.service';
import { JobService } from '../../../../core/services/job.service';
import { ApplicationService } from '../../../../core/services/application.service';
import { UserRole, JobStatus } from '../../../../core/enums';
import {
  FakeJobRepo, FakeApplicationRepo, FakeLineageRepo,
  FakeNotificationRepo, FakeUserRepo,
  makeJob,
  fakeAudit, fakeNotifService,
} from '../../../../core/services/__tests__/helpers';

afterEach(() => {
  TestBed.resetTestingModule();
});

// ── Session stub ──────────────────────────────────────────────────────────────

function makeSession(role: UserRole, userId = 'user1', orgId = 'org1') {
  return {
    activeRole: signal(role),
    isAuthenticated: computed(() => true),
    initialized: signal(true),
    currentUser: signal({ displayName: 'Test User' }),
    organizationId: computed(() => orgId),
    userId: computed(() => userId),
    userRoles: computed(() => [role]),
    requireAuth: () => ({ userId, organizationId: orgId, roles: [role], activeRole: role }),
  };
}

function makeRouteMock(jobId: string) {
  return {
    snapshot: {
      paramMap: {
        get: (key: string) => key === 'jobId' ? jobId : null,
      },
    },
  };
}

// ── Real service factories ────────────────────────────────────────────────────

function makeJobService(jobRepo = new FakeJobRepo()) {
  return new JobService(
    jobRepo as any,
    new FakeLineageRepo() as any,
    fakeAudit as any,
    new FakeUserRepo() as any,
  );
}

function makeAppService(appRepo = new FakeApplicationRepo(), jobRepo = new FakeJobRepo()) {
  return new ApplicationService(
    appRepo as any,
    jobRepo as any,
    new FakeLineageRepo() as any,
    new FakeNotificationRepo() as any,
    fakeAudit as any,
    fakeNotifService as any,
    new FakeUserRepo() as any,
  );
}

// ── Configure ─────────────────────────────────────────────────────────────────

function configure(
  role: UserRole,
  jobId: string,
  jobRepo = new FakeJobRepo(),
  appRepo = new FakeApplicationRepo(),
  userId = 'user1',
  orgId = 'org1',
) {
  const realJobSvc = makeJobService(jobRepo);
  const realAppSvc = makeAppService(appRepo, jobRepo);
  const session = makeSession(role, userId, orgId);

  TestBed.configureTestingModule({
    imports: [JobDetailComponent],
    providers: [
      provideRouter([]),
      { provide: SessionService, useValue: session },
      { provide: JobService, useValue: realJobSvc },
      { provide: ApplicationService, useValue: realAppSvc },
      { provide: ActivatedRoute, useValue: makeRouteMock(jobId) },
      { provide: Router, useValue: { navigate: vi.fn() } },
    ],
  });

  const fixture = TestBed.createComponent(JobDetailComponent);
  return { component: fixture.componentInstance, jobRepo, appRepo, realJobSvc, realAppSvc };
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('JobDetailComponent — real JobService', () => {
  it('loads job by ID from route param via real service', async () => {
    const jobRepo = new FakeJobRepo();
    const job = makeJob({ id: 'j1', status: JobStatus.Active, organizationId: 'org1', ownerUserId: 'user1' });
    jobRepo.seed([job]);

    const { component } = configure(UserRole.Candidate, 'j1', jobRepo);
    await component.loadJob();

    expect(component.job()?.id).toBe('j1');
    expect(component.isLoading()).toBe(false);
    expect(component.error()).toBeNull();
  });

  it('job() is null when job not found in repo', async () => {
    const { component } = configure(UserRole.Employer, 'missing');
    await component.loadJob();

    expect(component.job()).toBeNull();
    expect(component.isLoading()).toBe(false);
    expect(component.error()).toBeTruthy();
  });

  it('shows error when job belongs to different org', async () => {
    const jobRepo = new FakeJobRepo();
    jobRepo.seed([makeJob({ id: 'j1', organizationId: 'other-org', ownerUserId: 'user1' })]);

    const { component } = configure(UserRole.Employer, 'j1', jobRepo);
    await component.loadJob();

    expect(component.error()).toBeTruthy();
    expect(component.job()).toBeNull();
  });

  it('Employer can publish a Draft job via onTransition', async () => {
    const jobRepo = new FakeJobRepo();
    const draftJob = makeJob({ id: 'j1', status: JobStatus.Draft, organizationId: 'org1', ownerUserId: 'user1', version: 1 });
    jobRepo.seed([draftJob]);

    const { component } = configure(UserRole.Employer, 'j1', jobRepo);
    await component.loadJob();

    expect(component.job()?.status).toBe(JobStatus.Draft);
    expect(component.isManagement()).toBe(true);

    await component.onTransition('active');

    const updated = await jobRepo.getById('j1');
    expect(updated?.status).toBe(JobStatus.Active);
    expect(component.job()?.status).toBe(JobStatus.Active);
    expect(component.actionSuccess()).toBe('Job status changed to active');
  });

  it('shows actionError when invalid status transition attempted', async () => {
    const jobRepo = new FakeJobRepo();
    // Closed job: Closed → Draft is not a valid transition
    const closedJob = makeJob({ id: 'j1', status: JobStatus.Closed, organizationId: 'org1', ownerUserId: 'user1', version: 1 });
    jobRepo.seed([closedJob]);

    const { component } = configure(UserRole.Employer, 'j1', jobRepo);
    await component.loadJob();
    // 'active' is not a valid transition from 'closed' — state machine should throw
    await component.onTransition('active');

    expect(component.actionError()).toBeTruthy();
    expect(component.actionSuccess()).toBeNull();
  });

  it('Candidate can apply to an Active job via onApply', async () => {
    const jobRepo = new FakeJobRepo();
    const appRepo = new FakeApplicationRepo();
    const activeJob = makeJob({ id: 'j2', status: JobStatus.Active, organizationId: 'org1', ownerUserId: 'employer1' });
    jobRepo.seed([activeJob]);

    const { component } = configure(UserRole.Candidate, 'j2', jobRepo, appRepo);
    await component.loadJob();
    await component.onApply();

    const apps = await appRepo.getAll();
    expect(apps).toHaveLength(1);
    expect(apps[0].jobId).toBe('j2');
    expect(component.actionSuccess()).toContain('Application created');
  });

  it('shows actionError when Candidate applies to Draft job', async () => {
    const jobRepo = new FakeJobRepo();
    const draftJob = makeJob({ id: 'j1', status: JobStatus.Draft, organizationId: 'org1' });
    jobRepo.seed([draftJob]);

    const { component } = configure(UserRole.Candidate, 'j1', jobRepo);
    await component.loadJob();
    await component.onApply();

    expect(component.actionError()).toBeTruthy();
  });

  it('isManagement is false for Candidate role', () => {
    const { component } = configure(UserRole.Candidate, 'j1');
    expect(component.isManagement()).toBe(false);
  });

  it('isManagement is true for HRCoordinator role', () => {
    const { component } = configure(UserRole.HRCoordinator, 'j1');
    expect(component.isManagement()).toBe(true);
  });

  it('isCandidate is false for Employer role', () => {
    const { component } = configure(UserRole.Employer, 'j1');
    expect(component.isCandidate()).toBe(false);
  });
});

// ── Optimistic-lock test ──────────────────────────────────────────────────────

describe('JobDetailComponent — optimistic locking', () => {
  it('onTransition fails with OptimisticLockError when version is stale', async () => {
    const jobRepo = new FakeJobRepo();
    const job = makeJob({ id: 'j1', status: JobStatus.Draft, organizationId: 'org1', ownerUserId: 'user1', version: 1 });
    jobRepo.seed([job]);

    const { component } = configure(UserRole.Employer, 'j1', jobRepo);
    await component.loadJob();

    // Component holds job with version: 1
    expect(component.job()?.version).toBe(1);

    // Externally bump the repo version to 2 (simulates concurrent write)
    const stored = (await jobRepo.getById('j1'))!;
    await jobRepo.put({ ...stored, version: 2 });

    // Now attempt to publish — optimistic lock check fails
    await component.onTransition('active');

    expect(component.actionError()).toBeTruthy();
    expect(component.actionError()).toContain('modified');
    expect(component.actionSuccess()).toBeNull();
  });

  it('onClose fails with OptimisticLockError when version is stale', async () => {
    const jobRepo = new FakeJobRepo();
    const job = makeJob({ id: 'j2', status: JobStatus.Active, organizationId: 'org1', ownerUserId: 'user1', version: 2 });
    jobRepo.seed([job]);

    const { component } = configure(UserRole.Employer, 'j2', jobRepo);
    await component.loadJob();

    // Bump version externally
    await jobRepo.put({ ...job, version: 5 });

    await component.onTransition('closed');

    expect(component.actionError()).toBeTruthy();
  });
});
