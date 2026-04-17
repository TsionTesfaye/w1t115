import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { TestBed } from '@angular/core/testing';
import { signal, computed } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { ApplicationDetailComponent } from '../application-detail.component';
import { SessionService } from '../../../../core/services/session.service';
import { ApplicationService } from '../../../../core/services/application.service';
import { UserRole, ApplicationStage, ApplicationStatus } from '../../../../core/enums';
import { Application } from '../../../../core/models';

afterEach(() => {
  vi.restoreAllMocks();
  TestBed.resetTestingModule();
});

// ── Shared fixtures ───────────────────────────────────────────────────────────

const draftApp: Application = {
  id: 'app1', jobId: 'job1', candidateId: 'user1', organizationId: 'org1',
  stage: ApplicationStage.Draft, status: ApplicationStatus.Active,
  offerExpiresAt: null, submittedAt: null, version: 1,
  createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z',
};

const submittedApp: Application = {
  id: 'app2', jobId: 'job1', candidateId: 'user1', organizationId: 'org1',
  stage: ApplicationStage.Submitted, status: ApplicationStatus.Active,
  offerExpiresAt: null, submittedAt: '2026-01-02T00:00:00.000Z', version: 2,
  createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-02T00:00:00.000Z',
};

function makeSessionMock(role: UserRole) {
  return {
    activeRole: signal(role),
    isAuthenticated: computed(() => true),
    initialized: signal(true),
    currentUser: signal({ displayName: 'Test User' }),
    organizationId: computed(() => 'org1'),
    userId: computed(() => 'user1'),
    userRoles: computed(() => [role]),
    requireAuth: vi.fn().mockReturnValue({
      userId: 'user1',
      organizationId: 'org1',
      roles: [role],
      activeRole: role,
    }),
  };
}

function makeRouteMock(applicationId = 'app1') {
  return {
    snapshot: {
      paramMap: {
        get: (_key: string) => applicationId,
      },
    },
  };
}

function configure(
  role: UserRole,
  applicationId: string,
  appSvcOverrides: Record<string, any> = {},
) {
  const defaultAppSvc = {
    getApplication: vi.fn().mockResolvedValue(draftApp),
    transitionStage: vi.fn().mockResolvedValue({ ...draftApp, stage: ApplicationStage.Submitted }),
    withdraw: vi.fn().mockResolvedValue({ ...submittedApp, status: ApplicationStatus.Withdrawn }),
    deleteDraft: vi.fn().mockResolvedValue(undefined),
    acceptOffer: vi.fn().mockResolvedValue({ ...draftApp, status: ApplicationStatus.Accepted }),
    reject: vi.fn().mockResolvedValue({ ...submittedApp, status: ApplicationStatus.Rejected }),
    ...appSvcOverrides,
  };

  const sessionMock = makeSessionMock(role);

  TestBed.configureTestingModule({
    imports: [ApplicationDetailComponent],
    providers: [
      { provide: SessionService, useValue: sessionMock },
      { provide: ApplicationService, useValue: defaultAppSvc },
      { provide: ActivatedRoute, useValue: makeRouteMock(applicationId) },
      { provide: Router, useValue: { navigate: vi.fn() } },
    ],
  });

  const fixture = TestBed.createComponent(ApplicationDetailComponent);
  return { component: fixture.componentInstance, appSvc: defaultAppSvc, session: sessionMock };
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('ApplicationDetailComponent', () => {
  it('candidate can load their own application', async () => {
    const { component, appSvc } = configure(UserRole.Candidate, 'app1', {
      getApplication: vi.fn().mockResolvedValue(draftApp),
    });

    await component.loadApplication();

    expect(appSvc.getApplication).toHaveBeenCalledWith('app1', 'user1', [UserRole.Candidate], 'org1');
    expect(component.app()).toEqual(draftApp);
    expect(component.error()).toBeNull();
  });

  it('candidate can submit application (onSubmit calls transitionStage to Submitted)', async () => {
    const updatedApp = { ...draftApp, stage: ApplicationStage.Submitted };
    const { component, appSvc } = configure(UserRole.Candidate, 'app1', {
      getApplication: vi.fn().mockResolvedValue(draftApp),
      transitionStage: vi.fn().mockResolvedValue(updatedApp),
    });

    await component.loadApplication();
    await component.onSubmit();

    expect(appSvc.transitionStage).toHaveBeenCalledWith(
      'app1', ApplicationStage.Submitted, 'user1', [UserRole.Candidate], 'org1', 1,
    );
    expect(component.app()?.stage).toBe(ApplicationStage.Submitted);
  });

  it('candidate can withdraw an active non-draft application', async () => {
    const withdrawnApp = { ...submittedApp, status: ApplicationStatus.Withdrawn };
    const { component, appSvc } = configure(UserRole.Candidate, 'app2', {
      getApplication: vi.fn().mockResolvedValue(submittedApp),
      withdraw: vi.fn().mockResolvedValue(withdrawnApp),
    });

    await component.loadApplication();
    expect(component.canWithdraw()).toBe(true);

    await component.onWithdraw();

    expect(appSvc.withdraw).toHaveBeenCalledWith('app2', 'user1', 'org1', 2);
    expect(component.app()?.status).toBe(ApplicationStatus.Withdrawn);
  });

  it('canWithdraw is false for Draft stage', async () => {
    const { component } = configure(UserRole.Candidate, 'app1', {
      getApplication: vi.fn().mockResolvedValue(draftApp),
    });

    await component.loadApplication();

    expect(component.app()?.stage).toBe(ApplicationStage.Draft);
    expect(component.canWithdraw()).toBe(false);
  });

  it('management can advance stage (onAdvanceStage)', async () => {
    const underReviewApp = { ...submittedApp, stage: ApplicationStage.UnderReview, version: 3 };
    const { component, appSvc } = configure(UserRole.HRCoordinator, 'app2', {
      getApplication: vi.fn().mockResolvedValue(submittedApp),
      transitionStage: vi.fn().mockResolvedValue(underReviewApp),
    });

    await component.loadApplication();
    await component.onAdvanceStage();

    expect(appSvc.transitionStage).toHaveBeenCalledWith(
      'app2', ApplicationStage.UnderReview, 'user1', [UserRole.HRCoordinator], 'org1', 2,
    );
    expect(component.app()?.stage).toBe(ApplicationStage.UnderReview);
  });

  it('management can reject application (onReject)', async () => {
    const rejectedApp = { ...submittedApp, status: ApplicationStatus.Rejected };
    const { component, appSvc } = configure(UserRole.Employer, 'app2', {
      getApplication: vi.fn().mockResolvedValue(submittedApp),
      reject: vi.fn().mockResolvedValue(rejectedApp),
    });

    await component.loadApplication();
    await component.onReject();

    expect(appSvc.reject).toHaveBeenCalledWith('app2', 'user1', [UserRole.Employer], 'org1', 2);
    expect(component.app()?.status).toBe(ApplicationStatus.Rejected);
  });

  it('shows error when loadApplication fails', async () => {
    const { component } = configure(UserRole.Candidate, 'app1', {
      getApplication: vi.fn().mockRejectedValue(new Error('Application not found')),
    });

    await component.loadApplication();

    expect(component.error()).toBe('Application not found');
    expect(component.app()).toBeNull();
  });

  it('isManagement is true for HR Coordinator role', async () => {
    const { component } = configure(UserRole.HRCoordinator, 'app1');
    expect(component.isManagement()).toBe(true);
  });

  it('isCandidate is true for Candidate role', async () => {
    const { component } = configure(UserRole.Candidate, 'app1');
    expect(component.isCandidate()).toBe(true);
  });

  it('isManagement is false for Candidate role', async () => {
    const { component } = configure(UserRole.Candidate, 'app1');
    expect(component.isManagement()).toBe(false);
  });
});
