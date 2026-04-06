import { describe, it, expect, beforeAll, beforeEach, afterEach, vi } from 'vitest';
import { TestBed } from '@angular/core/testing';
import { signal, computed } from '@angular/core';
import { JobListComponent } from '../job-list.component';
import { SessionService } from '../../../../core/services/session.service';
import { JobService } from '../../../../core/services/job.service';
import { ApplicationService } from '../../../../core/services/application.service';
import { UserRole, JobStatus } from '../../../../core/enums';
import { Job } from '../../../../core/models';

afterEach(() => {
  TestBed.resetTestingModule();
});

// ── Mock helpers ─────────────────────────────────────────────────────────────

function makeSessionMock(role: UserRole) {
  return {
    activeRole: signal(role),
    isAuthenticated: computed(() => true),
    initialized: signal(true),
    currentUser: signal({ displayName: 'Test User' }),
    organizationId: computed(() => 'org1'),
    userId: computed(() => 'user1'),
    userRoles: computed(() => [role]),
    requireAuth: () => ({
      userId: 'user1',
      organizationId: 'org1',
      roles: [role],
      activeRole: role,
    }),
  };
}

function makeJobSvcMock(overrides: Record<string, any> = {}) {
  return {
    listJobs: vi.fn().mockResolvedValue([]),
    listJobsByOwner: vi.fn().mockResolvedValue([]),
    createJob: vi.fn().mockResolvedValue({ id: 'new-job', title: 'New', status: JobStatus.Draft, version: 1 }),
    updateJob: vi.fn().mockResolvedValue({}),
    transitionJobStatus: vi.fn().mockResolvedValue({}),
    ...overrides,
  };
}

function makeAppSvcMock(overrides: Record<string, any> = {}) {
  return {
    createApplication: vi.fn().mockResolvedValue({ id: 'app1' }),
    ...overrides,
  };
}

const draftJob: Job = {
  id: 'j1', organizationId: 'org1', ownerUserId: 'user1',
  title: 'Draft Job', description: 'A draft', tags: ['ts'], topics: ['dev'],
  status: JobStatus.Draft, version: 1, createdAt: '2026-01-01', updatedAt: '2026-01-01',
};

const activeJob: Job = {
  id: 'j2', organizationId: 'org1', ownerUserId: 'user1',
  title: 'Active Job', description: 'An active one', tags: [], topics: [],
  status: JobStatus.Active, version: 2, createdAt: '2026-01-01', updatedAt: '2026-01-02',
};

const closedJob: Job = {
  id: 'j3', organizationId: 'org1', ownerUserId: 'user1',
  title: 'Closed Job', description: 'Closed', tags: [], topics: [],
  status: JobStatus.Closed, version: 3, createdAt: '2026-01-01', updatedAt: '2026-01-03',
};

function configure(role: UserRole, jobOverrides: Record<string, any> = {}, appOverrides: Record<string, any> = {}) {
  const jobSvc = makeJobSvcMock(jobOverrides);
  const appSvc = makeAppSvcMock(appOverrides);
  const sessionMock = makeSessionMock(role);

  TestBed.configureTestingModule({
    imports: [JobListComponent],
    providers: [
      { provide: SessionService, useValue: sessionMock },
      { provide: JobService, useValue: jobSvc },
      { provide: ApplicationService, useValue: appSvc },
    ],
  });

  const fixture = TestBed.createComponent(JobListComponent);
  return { component: fixture.componentInstance, jobSvc, appSvc, sessionMock };
}

// ── Tests ────────────────────────────────────────────────────────────────────

describe('JobListComponent', () => {
  it('shows loading state while jobs are being fetched', async () => {
    let resolveList!: (v: Job[]) => void;
    const pendingPromise = new Promise<Job[]>(r => { resolveList = r; });
    const { component } = configure(UserRole.HRCoordinator, {
      listJobs: vi.fn().mockReturnValue(pendingPromise),
    });

    const loadPromise = component.loadJobs();
    expect(component.isLoading()).toBe(true);

    resolveList([]);
    await loadPromise;
    expect(component.isLoading()).toBe(false);
  });

  it('Candidate sees only Active jobs', async () => {
    const { component, jobSvc } = configure(UserRole.Candidate, {
      listJobs: vi.fn().mockResolvedValue([activeJob]),
    });

    await component.loadJobs();
    expect(jobSvc.listJobs).toHaveBeenCalledWith('user1', [UserRole.Candidate], 'org1');
    expect(component.jobs()).toHaveLength(1);
    expect(component.jobs()[0].status).toBe(JobStatus.Active);
  });

  it('Employer loads own jobs via listJobsByOwner', async () => {
    const { component, jobSvc } = configure(UserRole.Employer, {
      listJobsByOwner: vi.fn().mockResolvedValue([draftJob, activeJob]),
    });

    await component.loadJobs();
    expect(jobSvc.listJobsByOwner).toHaveBeenCalledWith('user1', 'user1', [UserRole.Employer], 'org1');
    expect(component.jobs()).toHaveLength(2);
  });

  it('HR Coordinator loads all org jobs via listJobs', async () => {
    const { component, jobSvc } = configure(UserRole.HRCoordinator, {
      listJobs: vi.fn().mockResolvedValue([draftJob, activeJob, closedJob]),
    });

    await component.loadJobs();
    expect(jobSvc.listJobs).toHaveBeenCalledWith('user1', [UserRole.HRCoordinator], 'org1');
    expect(component.jobs()).toHaveLength(3);
  });

  it('creates a job and reloads list on success', async () => {
    const { component, jobSvc } = configure(UserRole.Employer, {
      listJobsByOwner: vi.fn().mockResolvedValue([]),
      createJob: vi.fn().mockResolvedValue({ id: 'new', title: 'New Job', status: 'draft', version: 1 }),
    });

    await component.loadJobs();
    component.showCreateForm.set(true);
    component.jobForm.patchValue({ title: 'New Job', description: 'A new job' });
    await component.onCreateJob();

    expect(jobSvc.createJob).toHaveBeenCalledWith(
      'New Job', 'A new job', [], [], 'user1', [UserRole.Employer], 'org1',
    );
    expect(component.showCreateForm()).toBe(false);
    expect(component.actionSuccess()).toBe('Job created successfully');
  });

  it('shows validation error when title is empty', async () => {
    const { component, jobSvc } = configure(UserRole.Employer);
    component.showCreateForm.set(true);
    component.jobForm.patchValue({ title: '', description: 'Desc' });
    component.jobForm.get('title')?.markAsTouched();

    // Form is invalid so onCreateJob should return early
    await component.onCreateJob();
    expect(jobSvc.createJob).not.toHaveBeenCalled();
  });

  it('publishes a Draft job (Draft -> Active)', async () => {
    const { component, jobSvc } = configure(UserRole.Employer, {
      listJobsByOwner: vi.fn().mockResolvedValue([draftJob]),
      transitionJobStatus: vi.fn().mockResolvedValue({ ...draftJob, status: JobStatus.Active }),
    });

    await component.loadJobs();
    await component.onPublish(draftJob);

    expect(jobSvc.transitionJobStatus).toHaveBeenCalledWith(
      'j1', JobStatus.Active, 'user1', [UserRole.Employer], 'org1', 1,
    );
    expect(component.actionSuccess()).toBe('Job published successfully');
  });

  it('closes an Active job (Active -> Closed)', async () => {
    const { component, jobSvc } = configure(UserRole.Employer, {
      listJobsByOwner: vi.fn().mockResolvedValue([activeJob]),
      transitionJobStatus: vi.fn().mockResolvedValue({ ...activeJob, status: JobStatus.Closed }),
    });

    await component.loadJobs();
    await component.onClose(activeJob);

    expect(jobSvc.transitionJobStatus).toHaveBeenCalledWith(
      'j2', JobStatus.Closed, 'user1', [UserRole.Employer], 'org1', 2,
    );
    expect(component.actionSuccess()).toBe('Job closed successfully');
  });

  it('Candidate can apply to Active job', async () => {
    const { component, appSvc } = configure(UserRole.Candidate, {
      listJobs: vi.fn().mockResolvedValue([activeJob]),
    });

    await component.loadJobs();
    await component.onApply(activeJob);

    expect(appSvc.createApplication).toHaveBeenCalledWith('j2', 'user1', 'org1', [UserRole.Candidate]);
    expect(component.actionSuccess()).toBe('Application submitted successfully');
  });

  it('shows error when service call fails', async () => {
    const { component } = configure(UserRole.HRCoordinator, {
      listJobs: vi.fn().mockRejectedValue(new Error('Network error')),
    });

    await component.loadJobs();
    expect(component.error()).toBe('Network error');
    expect(component.isLoading()).toBe(false);
  });

  it('shows RBAC error when unauthorized action attempted', async () => {
    const { component } = configure(UserRole.Candidate, {
      listJobs: vi.fn().mockResolvedValue([activeJob]),
    }, {
      createApplication: vi.fn().mockRejectedValue(new Error('Only candidates can create applications')),
    });

    await component.loadJobs();
    await component.onApply(activeJob);

    expect(component.actionError()).toBe('Only candidates can create applications');
  });

  it('filters jobs by status via statusFilter signal', async () => {
    const { component } = configure(UserRole.HRCoordinator, {
      listJobs: vi.fn().mockResolvedValue([draftJob, activeJob, closedJob]),
    });

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
    const { component } = configure(UserRole.Employer, {
      listJobsByOwner: vi.fn().mockResolvedValue([draftJob]),
    });

    await component.loadJobs();
    component.startEdit(draftJob);

    expect(component.editingJob()).toBe(draftJob);
    expect(component.jobForm.value.title).toBe('Draft Job');
    expect(component.jobForm.value.description).toBe('A draft');

    component.cancelForm();
    expect(component.editingJob()).toBeNull();
  });
});
