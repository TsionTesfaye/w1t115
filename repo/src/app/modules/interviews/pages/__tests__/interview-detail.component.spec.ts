import { describe, it, expect, afterEach, vi } from 'vitest';
import { TestBed } from '@angular/core/testing';
import { signal, computed } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { ReactiveFormsModule } from '@angular/forms';
import { InterviewDetailComponent } from '../interview-detail.component';
import { SessionService } from '../../../../core/services/session.service';
import { InterviewService } from '../../../../core/services/interview.service';
import { FeedbackService } from '../../../../core/services/feedback.service';
import { UserRole, InterviewStatus } from '../../../../core/enums';
import { Interview, InterviewFeedback } from '../../../../core/models';

afterEach(() => {
  vi.restoreAllMocks();
  TestBed.resetTestingModule();
});

// ── Shared fixtures ───────────────────────────────────────────────────────────

const scheduledInterview: Interview = {
  id: 'int1', applicationId: 'app1', interviewPlanId: 'plan1',
  organizationId: 'org1', interviewerId: 'user1', candidateId: 'candidate1',
  startTime: '2026-05-01T10:00:00.000Z', endTime: '2026-05-01T11:00:00.000Z',
  status: InterviewStatus.Scheduled, rescheduledAt: null, rescheduledBy: null,
  version: 1, createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z',
};

const completedInterview: Interview = {
  ...scheduledInterview,
  id: 'int2',
  status: InterviewStatus.Completed,
  version: 2,
};

const sampleFeedback: InterviewFeedback = {
  id: 'fb1', interviewId: 'int2', organizationId: 'org1',
  interviewerId: 'user1', score: 8, notes: 'Great candidate',
  submittedAt: '2026-05-01T12:00:00.000Z',
  version: 1, createdAt: '2026-05-01T12:00:00.000Z', updatedAt: '2026-05-01T12:00:00.000Z',
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

function makeRouteMock(interviewId: string) {
  return {
    snapshot: {
      paramMap: {
        get: (_key: string) => interviewId,
      },
    },
  };
}

function configure(
  role: UserRole,
  interviewId: string,
  interviewSvcOverrides: Record<string, any> = {},
  feedbackSvcOverrides: Record<string, any> = {},
) {
  const interviews = [scheduledInterview, completedInterview];

  const defaultInterviewSvc = {
    listByOrganization: vi.fn().mockResolvedValue(interviews),
    getByInterviewer: vi.fn().mockResolvedValue(interviews),
    getByCandidate: vi.fn().mockResolvedValue(interviews),
    completeInterview: vi.fn().mockResolvedValue({ ...scheduledInterview, status: InterviewStatus.Completed }),
    cancelInterview: vi.fn().mockResolvedValue({ ...scheduledInterview, status: InterviewStatus.Canceled }),
    ...interviewSvcOverrides,
  };

  const defaultFeedbackSvc = {
    getFeedbackForInterview: vi.fn().mockResolvedValue([]),
    submitFeedback: vi.fn().mockResolvedValue(sampleFeedback),
    ...feedbackSvcOverrides,
  };

  const sessionMock = makeSessionMock(role);

  TestBed.configureTestingModule({
    imports: [InterviewDetailComponent],
    providers: [
      { provide: SessionService, useValue: sessionMock },
      { provide: InterviewService, useValue: defaultInterviewSvc },
      { provide: FeedbackService, useValue: defaultFeedbackSvc },
      { provide: ActivatedRoute, useValue: makeRouteMock(interviewId) },
      { provide: Router, useValue: { navigate: vi.fn() } },
    ],
  });

  const fixture = TestBed.createComponent(InterviewDetailComponent);
  return {
    component: fixture.componentInstance,
    interviewSvc: defaultInterviewSvc,
    feedbackSvc: defaultFeedbackSvc,
    session: sessionMock,
  };
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('InterviewDetailComponent', () => {
  it('interviewer loads interview by calling getByInterviewer', async () => {
    const { component, interviewSvc } = configure(
      UserRole.Interviewer, 'int1',
      { getByInterviewer: vi.fn().mockResolvedValue([scheduledInterview]) },
    );

    await component.loadInterview();

    expect(interviewSvc.getByInterviewer).toHaveBeenCalledWith('user1', 'user1', [UserRole.Interviewer], 'org1');
    expect(component.interview()?.id).toBe('int1');
  });

  it('management loads interview by calling listByOrganization', async () => {
    const { component, interviewSvc } = configure(
      UserRole.HRCoordinator, 'int1',
      { listByOrganization: vi.fn().mockResolvedValue([scheduledInterview]) },
    );

    await component.loadInterview();

    expect(interviewSvc.listByOrganization).toHaveBeenCalledWith('user1', [UserRole.HRCoordinator], 'org1');
    expect(component.interview()?.id).toBe('int1');
  });

  it('interviewer can complete interview (onComplete)', async () => {
    const completedIv = { ...scheduledInterview, status: InterviewStatus.Completed, version: 2 };
    const { component, interviewSvc } = configure(
      UserRole.Interviewer, 'int1',
      {
        getByInterviewer: vi.fn().mockResolvedValue([scheduledInterview]),
        completeInterview: vi.fn().mockResolvedValue(completedIv),
      },
    );

    await component.loadInterview();
    await component.onComplete();

    expect(interviewSvc.completeInterview).toHaveBeenCalledWith(
      'int1', 'user1', [UserRole.Interviewer], 'org1', 1,
    );
    expect(component.interview()?.status).toBe(InterviewStatus.Completed);
  });

  it('management can cancel interview (onCancel)', async () => {
    const canceledIv = { ...scheduledInterview, status: InterviewStatus.Canceled, version: 2 };
    const { component, interviewSvc } = configure(
      UserRole.HRCoordinator, 'int1',
      {
        listByOrganization: vi.fn().mockResolvedValue([scheduledInterview]),
        cancelInterview: vi.fn().mockResolvedValue(canceledIv),
      },
    );

    await component.loadInterview();
    await component.onCancel();

    expect(interviewSvc.cancelInterview).toHaveBeenCalledWith(
      'int1', 'user1', [UserRole.HRCoordinator], 'org1', 1,
    );
    expect(component.interview()?.status).toBe(InterviewStatus.Canceled);
  });

  it('interviewer can submit feedback after completion', async () => {
    const { component, feedbackSvc } = configure(
      UserRole.Interviewer, 'int2',
      {
        getByInterviewer: vi.fn().mockResolvedValue([completedInterview]),
      },
      {
        getFeedbackForInterview: vi.fn().mockResolvedValue([]),
        submitFeedback: vi.fn().mockResolvedValue(sampleFeedback),
      },
    );

    await component.loadInterview();
    expect(component.interview()?.status).toBe(InterviewStatus.Completed);

    // Set form values
    component.feedbackForm.setValue({ score: 8, notes: 'Great candidate' });
    await component.onSubmitFeedback();

    expect(feedbackSvc.submitFeedback).toHaveBeenCalledWith(
      'int2', 8, 'Great candidate', 'user1', [UserRole.Interviewer], 'org1',
    );
    expect(component.feedbackList().length).toBeGreaterThan(0);
  });

  it('shows error when loadInterview fails', async () => {
    const { component } = configure(
      UserRole.Interviewer, 'int-nonexistent',
      { getByInterviewer: vi.fn().mockResolvedValue([]) },
    );

    await component.loadInterview();

    expect(component.error()).toBeTruthy();
    expect(component.interview()).toBeNull();
  });

  it('shows error message when getByInterviewer throws', async () => {
    const { component } = configure(
      UserRole.Interviewer, 'int1',
      { getByInterviewer: vi.fn().mockRejectedValue(new Error('Network error')) },
    );

    await component.loadInterview();

    expect(component.error()).toBe('Network error');
  });

  it('isManagement is true for Employer role', async () => {
    const { component } = configure(UserRole.Employer, 'int1');
    expect(component.isManagement()).toBe(true);
  });

  it('isInterviewer is true for Interviewer role', async () => {
    const { component } = configure(UserRole.Interviewer, 'int1');
    expect(component.isInterviewer()).toBe(true);
  });

  it('isManagement is false for Interviewer role', async () => {
    const { component } = configure(UserRole.Interviewer, 'int1');
    expect(component.isManagement()).toBe(false);
  });
});
