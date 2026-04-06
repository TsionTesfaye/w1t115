import { describe, it, expect, beforeAll, afterEach, vi } from 'vitest';
import { TestBed } from '@angular/core/testing';
import { signal, computed } from '@angular/core';
import { ApplicationListComponent } from '../application-list.component';
import { SessionService } from '../../../../core/services/session.service';
import { ApplicationService } from '../../../../core/services/application.service';
import { JobService } from '../../../../core/services/job.service';
import { UserRole, ApplicationStage, ApplicationStatus } from '../../../../core/enums';
import { Application } from '../../../../core/models';

afterEach(() => {
  TestBed.resetTestingModule();
});

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

const draftApp: Application = {
  id: 'a1', jobId: 'j1', candidateId: 'user1', organizationId: 'org1',
  stage: ApplicationStage.Draft, status: ApplicationStatus.Active,
  offerExpiresAt: null, submittedAt: null, version: 1,
  createdAt: '2026-01-01', updatedAt: '2026-01-01',
};

const submittedApp: Application = {
  id: 'a2', jobId: 'j1', candidateId: 'user1', organizationId: 'org1',
  stage: ApplicationStage.Submitted, status: ApplicationStatus.Active,
  offerExpiresAt: null, submittedAt: '2026-01-02', version: 2,
  createdAt: '2026-01-01', updatedAt: '2026-01-02',
};

const underReviewApp: Application = {
  id: 'a3', jobId: 'j2', candidateId: 'c2', organizationId: 'org1',
  stage: ApplicationStage.UnderReview, status: ApplicationStatus.Active,
  offerExpiresAt: null, submittedAt: '2026-01-02', version: 3,
  createdAt: '2026-01-01', updatedAt: '2026-01-03',
};

function configure(role: UserRole, appOverrides: Record<string, any> = {}, jobOverrides: Record<string, any> = {}) {
  const appSvc = {
    listByCandidate: vi.fn().mockResolvedValue([]),
    listByOrganization: vi.fn().mockResolvedValue([]),
    transitionStage: vi.fn().mockResolvedValue({}),
    withdraw: vi.fn().mockResolvedValue({}),
    reject: vi.fn().mockResolvedValue({}),
    deleteDraft: vi.fn().mockResolvedValue(undefined),
    ...appOverrides,
  };
  const jobSvc = {
    listJobs: vi.fn().mockResolvedValue([
      { id: 'j1', title: 'Engineer', status: 'active' },
      { id: 'j2', title: 'Designer', status: 'active' },
    ]),
    ...jobOverrides,
  };

  TestBed.configureTestingModule({
    imports: [ApplicationListComponent],
    providers: [
      { provide: SessionService, useValue: makeSessionMock(role) },
      { provide: ApplicationService, useValue: appSvc },
      { provide: JobService, useValue: jobSvc },
    ],
  });

  const fixture = TestBed.createComponent(ApplicationListComponent);
  return { component: fixture.componentInstance, appSvc, jobSvc };
}

describe('ApplicationListComponent', () => {
  it('Candidate sees own applications', async () => {
    const { component, appSvc } = configure(UserRole.Candidate, {
      listByCandidate: vi.fn().mockResolvedValue([draftApp, submittedApp]),
    });

    await component.loadApps();
    expect(appSvc.listByCandidate).toHaveBeenCalledWith('user1', 'user1', 'org1');
    expect(component.apps()).toHaveLength(2);
  });

  it('Management sees all org applications', async () => {
    const { component, appSvc } = configure(UserRole.HRCoordinator, {
      listByOrganization: vi.fn().mockResolvedValue([draftApp, submittedApp, underReviewApp]),
    });

    await component.loadApps();
    expect(appSvc.listByOrganization).toHaveBeenCalledWith('user1', [UserRole.HRCoordinator], 'org1');
    expect(component.apps()).toHaveLength(3);
  });

  it('Candidate can submit a Draft application', async () => {
    const { component, appSvc } = configure(UserRole.Candidate, {
      listByCandidate: vi.fn().mockResolvedValue([draftApp]),
      transitionStage: vi.fn().mockResolvedValue({ ...draftApp, stage: ApplicationStage.Submitted }),
    });

    await component.loadApps();
    await component.onSubmit(draftApp);

    expect(appSvc.transitionStage).toHaveBeenCalledWith(
      'a1', ApplicationStage.Submitted, 'user1', [UserRole.Candidate], 'org1', 1,
    );
    expect(component.actionSuccess()).toBe('Application submitted successfully');
  });

  it('Candidate can withdraw a Submitted application', async () => {
    const { component, appSvc } = configure(UserRole.Candidate, {
      listByCandidate: vi.fn().mockResolvedValue([submittedApp]),
      withdraw: vi.fn().mockResolvedValue({ ...submittedApp, status: ApplicationStatus.Withdrawn }),
    });

    await component.loadApps();
    await component.onWithdraw(submittedApp);

    expect(appSvc.withdraw).toHaveBeenCalledWith('a2', 'user1', 'org1', 2);
    expect(component.actionSuccess()).toBe('Application withdrawn');
  });

  it('Management can advance application stage', async () => {
    const { component, appSvc } = configure(UserRole.HRCoordinator, {
      listByOrganization: vi.fn().mockResolvedValue([submittedApp]),
      transitionStage: vi.fn().mockResolvedValue({ ...submittedApp, stage: ApplicationStage.UnderReview }),
    });

    await component.loadApps();
    await component.onAdvance(submittedApp, ApplicationStage.UnderReview);

    expect(appSvc.transitionStage).toHaveBeenCalledWith(
      'a2', ApplicationStage.UnderReview, 'user1', [UserRole.HRCoordinator], 'org1', 2,
    );
    expect(component.actionSuccess()).toContain('advanced');
  });

  it('Management can reject an application', async () => {
    const { component, appSvc } = configure(UserRole.Employer, {
      listByOrganization: vi.fn().mockResolvedValue([submittedApp]),
      reject: vi.fn().mockResolvedValue({ ...submittedApp, status: ApplicationStatus.Rejected }),
    });

    await component.loadApps();
    await component.onReject(submittedApp);

    expect(appSvc.reject).toHaveBeenCalledWith('a2', 'user1', [UserRole.Employer], 'org1', 2);
    expect(component.actionSuccess()).toBe('Application rejected');
  });

  it('shows error on duplicate apply or invalid transition', async () => {
    const { component } = configure(UserRole.Candidate, {
      listByCandidate: vi.fn().mockResolvedValue([submittedApp]),
      withdraw: vi.fn().mockRejectedValue(new Error('Application status changed concurrently')),
    });

    await component.loadApps();
    await component.onWithdraw(submittedApp);

    expect(component.actionError()).toBe('Application status changed concurrently');
  });

  it('resolves job titles from job service', async () => {
    const { component } = configure(UserRole.Candidate, {
      listByCandidate: vi.fn().mockResolvedValue([draftApp]),
    });

    await component.loadApps();
    expect(component.jobTitleMap().get('j1')).toBe('Engineer');
  });

  it('filters by stage', async () => {
    const { component } = configure(UserRole.HRCoordinator, {
      listByOrganization: vi.fn().mockResolvedValue([draftApp, submittedApp, underReviewApp]),
    });

    await component.loadApps();
    expect(component.filteredApps()).toHaveLength(3);

    component.stageFilter.set('submitted');
    expect(component.filteredApps()).toHaveLength(1);
    expect(component.filteredApps()[0].id).toBe('a2');
  });
});
