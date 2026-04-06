import { describe, it, expect, beforeAll, afterEach, vi } from 'vitest';
import { TestBed } from '@angular/core/testing';
import { signal, computed } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { JobDetailComponent } from '../job-detail.component';
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

function makeRouteMock(jobId: string) {
  return {
    snapshot: {
      paramMap: {
        get: (key: string) => key === 'jobId' ? jobId : null,
      },
    },
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

function configure(
  role: UserRole,
  jobId: string,
  jobOverrides: Record<string, any> = {},
  appOverrides: Record<string, any> = {},
) {
  const jobSvc = {
    getJob: vi.fn().mockResolvedValue(activeJob),
    transitionJobStatus: vi.fn().mockResolvedValue({ ...draftJob, status: JobStatus.Active }),
    ...jobOverrides,
  };
  const appSvc = {
    createApplication: vi.fn().mockResolvedValue({ id: 'app1' }),
    ...appOverrides,
  };
  const sessionMock = makeSessionMock(role);
  const routeMock = makeRouteMock(jobId);
  const routerMock = { navigate: vi.fn() };

  TestBed.configureTestingModule({
    imports: [JobDetailComponent],
    providers: [
      { provide: SessionService, useValue: sessionMock },
      { provide: JobService, useValue: jobSvc },
      { provide: ApplicationService, useValue: appSvc },
      { provide: ActivatedRoute, useValue: routeMock },
      { provide: Router, useValue: routerMock },
    ],
  });

  const fixture = TestBed.createComponent(JobDetailComponent);
  return { component: fixture.componentInstance, jobSvc, appSvc, sessionMock, routerMock };
}

// ── Tests ────────────────────────────────────────────────────────────────────

describe('JobDetailComponent', () => {
  it('loads job by ID from route param', async () => {
    const { component, jobSvc } = configure(UserRole.Candidate, 'j2', {
      getJob: vi.fn().mockResolvedValue(activeJob),
    });

    await component.loadJob();

    expect(jobSvc.getJob).toHaveBeenCalledWith('j2', 'org1');
    expect(component.job()).toEqual(activeJob);
    expect(component.isLoading()).toBe(false);
  });

  it('shows status transition buttons for management', async () => {
    const updatedJob = { ...draftJob, status: JobStatus.Active, version: 2 };
    const { component, jobSvc } = configure(UserRole.Employer, 'j1', {
      getJob: vi.fn().mockResolvedValue(draftJob),
      transitionJobStatus: vi.fn().mockResolvedValue(updatedJob),
    });

    await component.loadJob();
    expect(component.job()!.status).toBe(JobStatus.Draft);
    expect(component.isManagement()).toBe(true);

    // Simulate publishing the draft
    await component.onTransition('active');

    expect(jobSvc.transitionJobStatus).toHaveBeenCalledWith(
      'j1', JobStatus.Active, 'user1', [UserRole.Employer], 'org1', 1,
    );
    expect(component.job()!.status).toBe(JobStatus.Active);
    expect(component.actionSuccess()).toBe('Job status changed to active');
  });
});
