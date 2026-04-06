import { describe, it, expect, beforeAll, afterEach, vi } from 'vitest';
import { TestBed } from '@angular/core/testing';
import { signal, computed } from '@angular/core';
import { InterviewListComponent } from '../interview-list.component';
import { SessionService } from '../../../../core/services/session.service';
import { InterviewService } from '../../../../core/services/interview.service';
import { InterviewPlanService } from '../../../../core/services/interview-plan.service';
import { ApplicationService } from '../../../../core/services/application.service';
import { UserService } from '../../../../core/services/user.service';
import { UserRole, InterviewStatus } from '../../../../core/enums';
import { Interview } from '../../../../core/models';

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

const scheduledInterview: Interview = {
  id: 'i1', applicationId: 'a1', interviewPlanId: 'plan1', organizationId: 'org1',
  interviewerId: 'user1', candidateId: 'c1',
  startTime: '2026-04-10T10:00:00Z', endTime: '2026-04-10T11:00:00Z',
  status: InterviewStatus.Scheduled, rescheduledAt: null, rescheduledBy: null,
  version: 1, createdAt: '2026-04-01', updatedAt: '2026-04-01',
};

const completedInterview: Interview = {
  id: 'i2', applicationId: 'a2', interviewPlanId: 'plan1', organizationId: 'org1',
  interviewerId: 'user2', candidateId: 'c2',
  startTime: '2026-04-08T10:00:00Z', endTime: '2026-04-08T11:00:00Z',
  status: InterviewStatus.Completed, rescheduledAt: null, rescheduledBy: null,
  version: 2, createdAt: '2026-04-01', updatedAt: '2026-04-08',
};

function configure(role: UserRole, overrides: Record<string, any> = {}) {
  const interviewSvc = {
    getByInterviewer: vi.fn().mockResolvedValue([]),
    getByCandidate: vi.fn().mockResolvedValue([]),
    listByOrganization: vi.fn().mockResolvedValue([]),
    scheduleInterview: vi.fn().mockResolvedValue({ id: 'new-i' }),
    completeInterview: vi.fn().mockResolvedValue({}),
    cancelInterview: vi.fn().mockResolvedValue({}),
    ...overrides,
  };
  const planSvc = {
    ensurePlanForJob: vi.fn().mockResolvedValue({ id: 'plan1' }),
    ...(overrides['planSvc'] ?? {}),
  };
  const appSvc = {
    listByOrganization: vi.fn().mockResolvedValue([
      { id: 'a1', jobId: 'j1', candidateId: 'c1', status: 'active', stage: 'submitted' },
    ]),
    ...(overrides['appSvc'] ?? {}),
  };
  const userSvc = {
    listByOrganization: vi.fn().mockResolvedValue([
      { id: 'interviewer1', displayName: 'Interviewer One', username: 'int1', roles: [UserRole.Interviewer] },
      { id: 'user2', displayName: 'Manager', username: 'mgr1', roles: [UserRole.Employer] },
    ]),
    ...(overrides['userSvc'] ?? {}),
  };

  TestBed.configureTestingModule({
    imports: [InterviewListComponent],
    providers: [
      { provide: SessionService, useValue: makeSessionMock(role) },
      { provide: InterviewService, useValue: interviewSvc },
      { provide: InterviewPlanService, useValue: planSvc },
      { provide: ApplicationService, useValue: appSvc },
      { provide: UserService, useValue: userSvc },
    ],
  });

  const fixture = TestBed.createComponent(InterviewListComponent);
  return { component: fixture.componentInstance, interviewSvc, planSvc, appSvc, userSvc };
}

describe('InterviewListComponent', () => {
  it('Interviewer sees own interviews', async () => {
    const { component, interviewSvc } = configure(UserRole.Interviewer, {
      getByInterviewer: vi.fn().mockResolvedValue([scheduledInterview]),
    });

    await component.loadInterviews();
    expect(interviewSvc.getByInterviewer).toHaveBeenCalledWith('user1', 'user1', [UserRole.Interviewer], 'org1');
    expect(component.interviews()).toHaveLength(1);
  });

  it('Candidate sees own interviews', async () => {
    const { component, interviewSvc } = configure(UserRole.Candidate, {
      getByCandidate: vi.fn().mockResolvedValue([scheduledInterview]),
    });

    await component.loadInterviews();
    expect(interviewSvc.getByCandidate).toHaveBeenCalledWith('user1', 'user1', [UserRole.Candidate], 'org1');
    expect(component.interviews()).toHaveLength(1);
  });

  it('Management sees all org interviews', async () => {
    const { component, interviewSvc } = configure(UserRole.HRCoordinator, {
      listByOrganization: vi.fn().mockResolvedValue([scheduledInterview, completedInterview]),
    });

    await component.loadInterviews();
    expect(interviewSvc.listByOrganization).toHaveBeenCalledWith('user1', [UserRole.HRCoordinator], 'org1');
    expect(component.interviews()).toHaveLength(2);
  });

  it('Management can schedule a new interview', async () => {
    const { component, interviewSvc, planSvc } = configure(UserRole.Employer, {
      listByOrganization: vi.fn().mockResolvedValue([]),
      scheduleInterview: vi.fn().mockResolvedValue({ id: 'new-interview' }),
    });

    await component.loadInterviews();

    // Simulate selecting an application
    component.scheduleForm.patchValue({ applicationId: 'a1' });
    await component.onApplicationSelected();
    expect(planSvc.ensurePlanForJob).toHaveBeenCalledWith('j1', [UserRole.Employer], 'org1', 'user1');

    // Fill rest of the form
    component.scheduleForm.patchValue({
      interviewerId: 'interviewer1',
      startTime: '2026-04-15T10:00',
      endTime: '2026-04-15T11:00',
    });

    await component.onSchedule();
    expect(interviewSvc.scheduleInterview).toHaveBeenCalled();
    expect(component.actionSuccess()).toBe('Interview scheduled successfully');
  });

  it('shows conflict error on overlapping schedule', async () => {
    const { component } = configure(UserRole.Employer, {
      listByOrganization: vi.fn().mockResolvedValue([]),
      scheduleInterview: vi.fn().mockRejectedValue(new Error('Scheduling conflict with interview i1')),
    });

    await component.loadInterviews();
    component.scheduleForm.patchValue({ applicationId: 'a1' });
    await component.onApplicationSelected();
    component.scheduleForm.patchValue({
      interviewerId: 'interviewer1',
      startTime: '2026-04-10T10:00',
      endTime: '2026-04-10T11:00',
    });

    await component.onSchedule();
    expect(component.actionError()).toContain('Scheduling conflict');
  });

  it('can complete a Scheduled interview', async () => {
    const { component, interviewSvc } = configure(UserRole.HRCoordinator, {
      listByOrganization: vi.fn().mockResolvedValue([scheduledInterview]),
      completeInterview: vi.fn().mockResolvedValue({ ...scheduledInterview, status: InterviewStatus.Completed }),
    });

    await component.loadInterviews();
    await component.onComplete(scheduledInterview);

    expect(interviewSvc.completeInterview).toHaveBeenCalledWith('i1', 'user1', [UserRole.HRCoordinator], 'org1', 1);
    expect(component.actionSuccess()).toBe('Interview marked as completed');
  });

  it('can cancel a Scheduled interview', async () => {
    const { component, interviewSvc } = configure(UserRole.HRCoordinator, {
      listByOrganization: vi.fn().mockResolvedValue([scheduledInterview]),
      cancelInterview: vi.fn().mockResolvedValue({ ...scheduledInterview, status: InterviewStatus.Canceled }),
    });

    await component.loadInterviews();
    await component.onCancel(scheduledInterview);

    expect(interviewSvc.cancelInterview).toHaveBeenCalledWith('i1', 'user1', [UserRole.HRCoordinator], 'org1', 1);
    expect(component.actionSuccess()).toBe('Interview canceled');
  });

  it('shows error when load fails', async () => {
    const { component } = configure(UserRole.HRCoordinator, {
      listByOrganization: vi.fn().mockRejectedValue(new Error('DB unavailable')),
    });

    await component.loadInterviews();
    expect(component.error()).toBe('DB unavailable');
    expect(component.isLoading()).toBe(false);
  });
});
