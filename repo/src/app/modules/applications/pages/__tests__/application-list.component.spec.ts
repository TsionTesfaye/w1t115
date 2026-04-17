/**
 * ApplicationListComponent — real service integration tests.
 *
 * Uses real ApplicationService with FakeApplicationRepo + FakeJobRepo.
 * Includes optimistic-lock test.
 */

import { describe, it, expect, afterEach, vi } from 'vitest';
import { TestBed } from '@angular/core/testing';
import { signal, computed } from '@angular/core';
import { provideRouter, Router } from '@angular/router';
import { ApplicationListComponent } from '../application-list.component';
import { SessionService } from '../../../../core/services/session.service';
import { ApplicationService } from '../../../../core/services/application.service';
import { JobService } from '../../../../core/services/job.service';
import { UserRole, ApplicationStage, ApplicationStatus, JobStatus } from '../../../../core/enums';
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

// ── Configure ─────────────────────────────────────────────────────────────────

function configure(
  role: UserRole,
  appRepo = new FakeApplicationRepo(),
  jobRepo = new FakeJobRepo(),
  userId = 'user1',
  orgId = 'org1',
) {
  const realAppSvc = makeAppService(appRepo, jobRepo);
  const realJobSvc = makeJobService(jobRepo);
  const session = makeSession(role, userId, orgId);

  TestBed.configureTestingModule({
    imports: [ApplicationListComponent],
    providers: [
      provideRouter([]),
      { provide: SessionService, useValue: session },
      { provide: ApplicationService, useValue: realAppSvc },
      { provide: JobService, useValue: realJobSvc },
    ],
  });

  const fixture = TestBed.createComponent(ApplicationListComponent);
  return { component: fixture.componentInstance, appRepo, jobRepo, realAppSvc, realJobSvc };
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('ApplicationListComponent — real ApplicationService', () => {
  it('Candidate sees only their own applications', async () => {
    const appRepo = new FakeApplicationRepo();
    appRepo.seed([
      makeApplication({ id: 'a1', candidateId: 'user1', organizationId: 'org1', status: ApplicationStatus.Active }),
      makeApplication({ id: 'a2', candidateId: 'other', organizationId: 'org1', status: ApplicationStatus.Active }),
    ]);

    const { component } = configure(UserRole.Candidate, appRepo);
    await component.loadApps();

    expect(component.apps()).toHaveLength(1);
    expect(component.apps()[0].id).toBe('a1');
  });

  it('Management (HRCoordinator) sees all org applications', async () => {
    const appRepo = new FakeApplicationRepo();
    appRepo.seed([
      makeApplication({ id: 'a1', candidateId: 'u1', organizationId: 'org1', stage: ApplicationStage.Draft, status: ApplicationStatus.Active }),
      makeApplication({ id: 'a2', candidateId: 'u2', organizationId: 'org1', stage: ApplicationStage.Submitted, status: ApplicationStatus.Active }),
      makeApplication({ id: 'a3', candidateId: 'u3', organizationId: 'org1', stage: ApplicationStage.UnderReview, status: ApplicationStatus.Active }),
    ]);

    const { component } = configure(UserRole.HRCoordinator, appRepo);
    await component.loadApps();

    expect(component.apps()).toHaveLength(3);
  });

  it('Candidate can submit a Draft application', async () => {
    const appRepo = new FakeApplicationRepo();
    const draftApp = makeApplication({
      id: 'a1', candidateId: 'user1', organizationId: 'org1',
      stage: ApplicationStage.Draft, status: ApplicationStatus.Active, version: 1,
    });
    appRepo.seed([draftApp]);

    const { component } = configure(UserRole.Candidate, appRepo);
    await component.loadApps();
    await component.onSubmit(draftApp);

    const updated = await appRepo.getById('a1');
    expect(updated?.stage).toBe(ApplicationStage.Submitted);
    expect(component.actionSuccess()).toBe('Application submitted successfully');
  });

  it('Candidate can withdraw a Submitted application', async () => {
    const appRepo = new FakeApplicationRepo();
    const submittedApp = makeApplication({
      id: 'a2', candidateId: 'user1', organizationId: 'org1',
      stage: ApplicationStage.Submitted, status: ApplicationStatus.Active, version: 2,
    });
    appRepo.seed([submittedApp]);

    const { component } = configure(UserRole.Candidate, appRepo);
    await component.loadApps();
    await component.onWithdraw(submittedApp);

    const updated = await appRepo.getById('a2');
    expect(updated?.status).toBe(ApplicationStatus.Withdrawn);
    expect(component.actionSuccess()).toBe('Application withdrawn');
  });

  it('Management (HRCoordinator) can advance application stage', async () => {
    const appRepo = new FakeApplicationRepo();
    const submittedApp = makeApplication({
      id: 'a2', candidateId: 'u1', organizationId: 'org1',
      stage: ApplicationStage.Submitted, status: ApplicationStatus.Active, version: 2,
    });
    appRepo.seed([submittedApp]);

    const { component } = configure(UserRole.HRCoordinator, appRepo);
    await component.loadApps();
    await component.onAdvance(submittedApp, ApplicationStage.UnderReview);

    const updated = await appRepo.getById('a2');
    expect(updated?.stage).toBe(ApplicationStage.UnderReview);
    expect(component.actionSuccess()).toContain('advanced');
  });

  it('Management (Employer) can reject a submitted application', async () => {
    const appRepo = new FakeApplicationRepo();
    const submittedApp = makeApplication({
      id: 'a2', candidateId: 'u1', organizationId: 'org1',
      stage: ApplicationStage.Submitted, status: ApplicationStatus.Active, version: 2,
    });
    appRepo.seed([submittedApp]);

    const { component } = configure(UserRole.Employer, appRepo);
    await component.loadApps();
    await component.onReject(submittedApp);

    const updated = await appRepo.getById('a2');
    expect(updated?.status).toBe(ApplicationStatus.Rejected);
    expect(component.actionSuccess()).toBe('Application rejected');
  });

  it('resolves job titles from real job service', async () => {
    const jobRepo = new FakeJobRepo();
    jobRepo.seed([
      makeJob({ id: 'j1', title: 'Engineer', status: JobStatus.Active, organizationId: 'org1' }),
    ]);

    const appRepo = new FakeApplicationRepo();
    appRepo.seed([
      makeApplication({ id: 'a1', candidateId: 'user1', organizationId: 'org1', jobId: 'j1', status: ApplicationStatus.Active }),
    ]);

    const { component } = configure(UserRole.Candidate, appRepo, jobRepo);
    await component.loadApps();

    expect(component.jobTitleMap().get('j1')).toBe('Engineer');
  });

  it('filters applications by stage', async () => {
    const appRepo = new FakeApplicationRepo();
    appRepo.seed([
      makeApplication({ id: 'a1', candidateId: 'user1', organizationId: 'org1', stage: ApplicationStage.Draft, status: ApplicationStatus.Active }),
      makeApplication({ id: 'a2', candidateId: 'user1', organizationId: 'org1', stage: ApplicationStage.Submitted, status: ApplicationStatus.Active }),
    ]);

    const { component } = configure(UserRole.Candidate, appRepo);
    await component.loadApps();

    expect(component.filteredApps()).toHaveLength(2);

    component.stageFilter.set('submitted');
    expect(component.filteredApps()).toHaveLength(1);
    expect(component.filteredApps()[0].id).toBe('a2');
  });

  it('shows error when repo throws during load', async () => {
    const badRepo = new FakeApplicationRepo();
    (badRepo as any).getByCandidate = async () => { throw new Error('DB read failed'); };

    const { component } = configure(UserRole.Candidate, badRepo);
    await component.loadApps();

    expect(component.error()).toContain('DB read failed');
  });

  it('empty list when no applications exist', async () => {
    const { component } = configure(UserRole.Candidate);
    await component.loadApps();
    expect(component.apps()).toHaveLength(0);
    expect(component.isLoading()).toBe(false);
  });
});

// ── Packet / detail navigation ────────────────────────────────────────────────

describe('ApplicationListComponent — candidate packet flow navigation', () => {
  it('goToDetail navigates to /applications/:id', async () => {
    const appRepo = new FakeApplicationRepo();
    const app = makeApplication({ id: 'a1', candidateId: 'user1', organizationId: 'org1', status: ApplicationStatus.Active });
    appRepo.seed([app]);

    const { component } = configure(UserRole.Candidate, appRepo);
    await component.loadApps();

    const router = TestBed.inject(Router);
    const spy = vi.spyOn(router, 'navigate').mockResolvedValue(true);

    component.goToDetail(app);

    expect(spy).toHaveBeenCalledWith(['/applications', 'a1']);
  });

  it('goToPacket navigates to /application-packet/:id', async () => {
    const appRepo = new FakeApplicationRepo();
    const app = makeApplication({ id: 'a1', candidateId: 'user1', organizationId: 'org1', status: ApplicationStatus.Active });
    appRepo.seed([app]);

    const { component } = configure(UserRole.Candidate, appRepo);
    await component.loadApps();

    const router = TestBed.inject(Router);
    const spy = vi.spyOn(router, 'navigate').mockResolvedValue(true);

    component.goToPacket(app);

    expect(spy).toHaveBeenCalledWith(['/application-packet', 'a1']);
  });

  it('candidate with active application exposes goToPacket on every active app', async () => {
    const appRepo = new FakeApplicationRepo();
    appRepo.seed([
      makeApplication({ id: 'a1', candidateId: 'user1', organizationId: 'org1', status: ApplicationStatus.Active, stage: ApplicationStage.Draft }),
      makeApplication({ id: 'a2', candidateId: 'user1', organizationId: 'org1', status: ApplicationStatus.Active, stage: ApplicationStage.Submitted }),
      makeApplication({ id: 'a3', candidateId: 'user1', organizationId: 'org1', status: ApplicationStatus.Withdrawn, stage: ApplicationStage.Submitted }),
    ]);

    const { component } = configure(UserRole.Candidate, appRepo);
    await component.loadApps();

    const router = TestBed.inject(Router);
    const spy = vi.spyOn(router, 'navigate').mockResolvedValue(true);

    component.goToPacket(component.apps()[0]);
    expect(spy).toHaveBeenLastCalledWith(['/application-packet', 'a1']);

    component.goToPacket(component.apps()[1]);
    expect(spy).toHaveBeenLastCalledWith(['/application-packet', 'a2']);
  });
});

// ── Optimistic-lock test ──────────────────────────────────────────────────────

describe('ApplicationListComponent — optimistic locking', () => {
  it('onWithdraw fails with OptimisticLockError when version is stale', async () => {
    const appRepo = new FakeApplicationRepo();
    const app = makeApplication({
      id: 'a1', candidateId: 'user1', organizationId: 'org1',
      stage: ApplicationStage.Submitted, status: ApplicationStatus.Active, version: 1,
    });
    appRepo.seed([app]);

    const { component } = configure(UserRole.Candidate, appRepo);
    await component.loadApps();

    // Component holds app with version: 1
    expect(component.apps()[0].version).toBe(1);

    // Externally bump version in repo (simulates concurrent write)
    const stored = (await appRepo.getById('a1'))!;
    await appRepo.put({ ...stored, version: 5 });

    // Now attempt withdraw — optimistic lock check will fail
    await component.onWithdraw(app);

    expect(component.actionError()).toBeTruthy();
    // OptimisticLockError message contains 'modified'
    expect(component.actionError()).toContain('modified');
  });

  it('onSubmit fails with OptimisticLockError when version is stale', async () => {
    const appRepo = new FakeApplicationRepo();
    const app = makeApplication({
      id: 'a1', candidateId: 'user1', organizationId: 'org1',
      stage: ApplicationStage.Draft, status: ApplicationStatus.Active, version: 1,
    });
    appRepo.seed([app]);

    const { component } = configure(UserRole.Candidate, appRepo);
    await component.loadApps();

    // Externally bump version
    await appRepo.put({ ...app, version: 3 });

    await component.onSubmit(app);

    expect(component.actionError()).toBeTruthy();
  });
});
