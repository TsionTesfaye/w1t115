/**
 * JobListComponent — real service integration tests.
 *
 * Uses real JobService and ApplicationService with FakeStore in-memory repos.
 * SessionService is a plain signal-based stub (no vi.fn).
 * Router.navigate is vi.fn() only.
 */

import { describe, it, expect, afterEach, vi } from 'vitest';
import { TestBed } from '@angular/core/testing';
import { signal, computed } from '@angular/core';
import { provideRouter } from '@angular/router';
import { JobListComponent } from '../job-list.component';
import { SessionService } from '../../../../core/services/session.service';
import { JobService } from '../../../../core/services/job.service';
import { ApplicationService } from '../../../../core/services/application.service';
import { UserRole, JobStatus, ApplicationStatus } from '../../../../core/enums';
import {
  FakeJobRepo, FakeApplicationRepo, FakeLineageRepo,
  FakeNotificationRepo, FakeUserRepo,
  makeJob, makeApplication,
  fakeAudit, fakeNotifService,
} from '../../../../core/services/__tests__/helpers';
import { OptimisticLockError } from '../../../../core/errors';

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

// ── Test setup ────────────────────────────────────────────────────────────────

function configure(
  role: UserRole,
  jobRepo = new FakeJobRepo(),
  appRepo = new FakeApplicationRepo(),
  userId = 'user1',
  orgId = 'org1',
) {
  const realJobSvc = makeJobService(jobRepo);
  const realAppSvc = makeAppService(appRepo, jobRepo);
  const session = makeSession(role, userId, orgId);

  TestBed.configureTestingModule({
    imports: [JobListComponent],
    providers: [
      provideRouter([]),
      { provide: SessionService, useValue: session },
      { provide: JobService, useValue: realJobSvc },
      { provide: ApplicationService, useValue: realAppSvc },
    ],
  });

  const fixture = TestBed.createComponent(JobListComponent);
  return { component: fixture.componentInstance, jobRepo, appRepo, realJobSvc, realAppSvc };
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('JobListComponent — real JobService', () => {
  it('Candidate sees only Active jobs via real RBAC', async () => {
    const jobRepo = new FakeJobRepo();
    jobRepo.seed([
      makeJob({ id: 'j1', status: JobStatus.Draft,  organizationId: 'org1', ownerUserId: 'user1' }),
      makeJob({ id: 'j2', status: JobStatus.Active, organizationId: 'org1', ownerUserId: 'user1' }),
      makeJob({ id: 'j3', status: JobStatus.Closed, organizationId: 'org1', ownerUserId: 'user1' }),
    ]);

    const { component } = configure(UserRole.Candidate, jobRepo);
    await component.loadJobs();

    expect(component.jobs()).toHaveLength(1);
    expect(component.jobs()[0].status).toBe(JobStatus.Active);
  });

  it('Employer loads own jobs via listJobsByOwner', async () => {
    const jobRepo = new FakeJobRepo();
    jobRepo.seed([
      makeJob({ id: 'j1', status: JobStatus.Draft,  organizationId: 'org1', ownerUserId: 'user1' }),
      makeJob({ id: 'j2', status: JobStatus.Active, organizationId: 'org1', ownerUserId: 'user1' }),
      makeJob({ id: 'j3', status: JobStatus.Active, organizationId: 'org1', ownerUserId: 'other' }),
    ]);

    const { component } = configure(UserRole.Employer, jobRepo);
    await component.loadJobs();

    // Only user1's jobs returned
    expect(component.jobs()).toHaveLength(2);
    expect(component.jobs().every((j: any) => j.ownerUserId === 'user1')).toBe(true);
  });

  it('HR Coordinator loads all org jobs', async () => {
    const jobRepo = new FakeJobRepo();
    jobRepo.seed([
      makeJob({ id: 'j1', status: JobStatus.Draft,  organizationId: 'org1', ownerUserId: 'a', departmentId: undefined }),
      makeJob({ id: 'j2', status: JobStatus.Active, organizationId: 'org1', ownerUserId: 'b', departmentId: undefined }),
      makeJob({ id: 'j3', status: JobStatus.Closed, organizationId: 'org1', ownerUserId: 'c', departmentId: undefined }),
    ]);

    const { component } = configure(UserRole.HRCoordinator, jobRepo);
    await component.loadJobs();

    expect(component.jobs()).toHaveLength(3);
  });

  it('Employer can create a job — real service creates in repo', async () => {
    const jobRepo = new FakeJobRepo();
    const { component } = configure(UserRole.Employer, jobRepo);

    component.showCreateForm.set(true);
    component.jobForm.patchValue({ title: 'Backend Engineer', description: 'Node.js role' });
    await component.onCreateJob();

    const all = await jobRepo.getAll();
    expect(all).toHaveLength(1);
    expect(all[0].title).toBe('Backend Engineer');
    expect(all[0].status).toBe(JobStatus.Draft);
    expect(component.actionSuccess()).toBe('Job created successfully');
    expect(component.showCreateForm()).toBe(false);
  });

  it('shows validation error when title is empty', async () => {
    const { component } = configure(UserRole.Employer);
    component.showCreateForm.set(true);
    component.jobForm.patchValue({ title: '', description: 'Desc' });
    component.jobForm.get('title')?.markAsTouched();

    await component.onCreateJob();
    // Form is invalid — service is never called, no repo entries
    expect(component.jobForm.invalid).toBe(true);
  });

  it('Candidate cannot create a job — real AuthorizationError', async () => {
    const { component } = configure(UserRole.Candidate);
    component.showCreateForm.set(true);
    component.jobForm.patchValue({ title: 'Sneaky Job', description: 'Unauthorized attempt' });

    await component.onCreateJob();

    expect(component.actionError()).toContain('Employer');
  });

  it('Employer can publish a Draft job (Draft -> Active)', async () => {
    const jobRepo = new FakeJobRepo();
    const draftJob = makeJob({ id: 'j1', status: JobStatus.Draft, organizationId: 'org1', ownerUserId: 'user1', version: 1 });
    jobRepo.seed([draftJob]);

    const { component } = configure(UserRole.Employer, jobRepo);
    await component.loadJobs();
    await component.onPublish(draftJob);

    const updated = await jobRepo.getById('j1');
    expect(updated?.status).toBe(JobStatus.Active);
    expect(component.actionSuccess()).toBe('Job published successfully');
  });

  it('Employer can close an Active job (Active -> Closed)', async () => {
    const jobRepo = new FakeJobRepo();
    const activeJob = makeJob({ id: 'j1', status: JobStatus.Active, organizationId: 'org1', ownerUserId: 'user1', version: 1 });
    jobRepo.seed([activeJob]);

    const { component } = configure(UserRole.Employer, jobRepo);
    await component.loadJobs();
    await component.onClose(activeJob);

    const updated = await jobRepo.getById('j1');
    expect(updated?.status).toBe(JobStatus.Closed);
    expect(component.actionSuccess()).toBe('Job closed successfully');
  });

  it('Candidate can apply to an Active job', async () => {
    const jobRepo = new FakeJobRepo();
    const appRepo = new FakeApplicationRepo();
    const activeJob = makeJob({ id: 'j1', status: JobStatus.Active, organizationId: 'org1', ownerUserId: 'employer1' });
    jobRepo.seed([activeJob]);

    const { component } = configure(UserRole.Candidate, jobRepo, appRepo);
    await component.loadJobs();
    await component.onApply(activeJob);

    const apps = await appRepo.getAll();
    expect(apps).toHaveLength(1);
    expect(apps[0].jobId).toBe('j1');
    expect(component.actionSuccess()).toBe('Application submitted successfully');
  });

  it('shows error when repo throws during load', async () => {
    const badRepo = new FakeJobRepo();
    (badRepo as any).getByOrganization = async () => { throw new Error('DB error'); };
    (badRepo as any).getByOwner = async () => { throw new Error('DB error'); };

    const { component } = configure(UserRole.Employer, badRepo);
    await component.loadJobs();

    expect(component.error()).toContain('DB error');
    expect(component.isLoading()).toBe(false);
  });

  it('shows RBAC error when Candidate tries to apply to Draft job', async () => {
    const jobRepo = new FakeJobRepo();
    const draftJob = makeJob({ id: 'j1', status: JobStatus.Draft, organizationId: 'org1' });
    jobRepo.seed([draftJob]);

    const { component } = configure(UserRole.Candidate, jobRepo);
    // Load (candidate sees nothing since it's draft) — force apply directly
    await component.onApply(draftJob);

    expect(component.actionError()).toBeTruthy();
  });

  it('filters jobs by status via statusFilter signal', async () => {
    const jobRepo = new FakeJobRepo();
    jobRepo.seed([
      makeJob({ id: 'j1', status: JobStatus.Draft,  organizationId: 'org1', ownerUserId: 'user1' }),
      makeJob({ id: 'j2', status: JobStatus.Active, organizationId: 'org1', ownerUserId: 'user1' }),
      makeJob({ id: 'j3', status: JobStatus.Closed, organizationId: 'org1', ownerUserId: 'user1' }),
    ]);

    const { component } = configure(UserRole.Employer, jobRepo);
    await component.loadJobs();

    expect(component.filteredJobs()).toHaveLength(3);

    component.statusFilter.set('draft');
    expect(component.filteredJobs()).toHaveLength(1);
    expect(component.filteredJobs()[0].id).toBe('j1');

    component.statusFilter.set('active');
    expect(component.filteredJobs()).toHaveLength(1);
    expect(component.filteredJobs()[0].id).toBe('j2');

    component.statusFilter.set('all');
    expect(component.filteredJobs()).toHaveLength(3);
  });

  it('startEdit populates form and cancelForm resets', async () => {
    const jobRepo = new FakeJobRepo();
    const draftJob = makeJob({ id: 'j1', title: 'Draft Job', description: 'A draft', status: JobStatus.Draft, organizationId: 'org1', ownerUserId: 'user1' });
    jobRepo.seed([draftJob]);

    const { component } = configure(UserRole.Employer, jobRepo);
    await component.loadJobs();
    component.startEdit(draftJob);

    expect(component.editingJob()).toBe(draftJob);
    expect(component.jobForm.value.title).toBe('Draft Job');
    expect(component.jobForm.value.description).toBe('A draft');

    component.cancelForm();
    expect(component.editingJob()).toBeNull();
  });

  it('shows loading state while jobs are being fetched', async () => {
    let resolveList!: (v: any[]) => void;
    const pending = new Promise<any[]>(r => { resolveList = r; });
    const jobRepo = new FakeJobRepo();
    (jobRepo as any).getByOrganization = () => pending;
    (jobRepo as any).getByOwner = () => pending;

    const { component } = configure(UserRole.HRCoordinator, jobRepo);
    const loadPromise = component.loadJobs();

    expect(component.isLoading()).toBe(true);

    resolveList([]);
    await loadPromise;
    expect(component.isLoading()).toBe(false);
  });

  it('onPublish sets OptimisticLockError when version is stale', async () => {
    const jobRepo = new FakeJobRepo();
    const job = makeJob({ id: 'j1', status: JobStatus.Draft, organizationId: 'org1', ownerUserId: 'user1', version: 1 });
    jobRepo.seed([job]);

    const { component } = configure(UserRole.Employer, jobRepo);
    await component.loadJobs();

    // Externally bump version in the repo
    const stored = (await jobRepo.getById('j1'))!;
    await jobRepo.put({ ...stored, version: 2 });

    // Component still holds reference to version: 1 — will throw OptimisticLockError
    await component.onPublish(job);

    expect(component.actionError()).toBeTruthy();
    expect(component.actionError()).toContain('modified');
  });
});
