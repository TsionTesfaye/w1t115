/**
 * DashboardComponent tests
 *
 * Tests cover: per-role card construction, real service data, race condition
 * prevention via load-version tracking, and error handling.
 *
 * Strategy: provide mock services via TestBed, trigger loadDashboard(), and
 * assert signal values.  Template rendering is not tested here — only the
 * data pipeline from services → cards signal.
 */

import { describe, it, expect, beforeAll, beforeEach, afterEach, vi } from 'vitest';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { signal, computed } from '@angular/core';
import { DashboardComponent } from '../dashboard.component';
import { SessionService } from '../../../../core/services/session.service';
import { ApplicationService } from '../../../../core/services/application.service';
import { InterviewService } from '../../../../core/services/interview.service';
import { JobService } from '../../../../core/services/job.service';
import { NotificationService } from '../../../../core/services/notification.service';
import { UserService } from '../../../../core/services/user.service';
import { ModerationService } from '../../../../core/services/moderation.service';
import { DocumentService } from '../../../../core/services/document.service';
import { ContentService } from '../../../../core/services/content.service';
import { UserRole, InterviewStatus, JobStatus, ApplicationStatus, ApplicationStage } from '../../../../core/enums';

// ── TestBed bootstrap ─────────────────────────────────────────────────────────

afterEach(() => {
  TestBed.resetTestingModule();
});

// ── Mock factories ────────────────────────────────────────────────────────────

function makeSessionMock(role: UserRole) {
  return {
    activeRole: signal(role),
    isAuthenticated: computed(() => true),
    initialized: signal(true),
    currentUser: signal({ displayName: 'Test User' }),
    requireAuth: () => ({
      userId: 'user1',
      organizationId: 'org1',
      roles: [role],
      activeRole: role,
    }),
  };
}

function emptyMock() {
  return {
    listByCandidate: vi.fn().mockResolvedValue([]),
    listByOrganization: vi.fn().mockResolvedValue([]),
    listByJob: vi.fn().mockResolvedValue([]),
    getByCandidate: vi.fn().mockResolvedValue([]),
    getByInterviewer: vi.fn().mockResolvedValue([]),
    listJobsByOwner: vi.fn().mockResolvedValue([]),
    listJobs: vi.fn().mockResolvedValue([]),
    getUnreadForUser: vi.fn().mockResolvedValue([]),
    listByOwner: vi.fn().mockResolvedValue([]),
    listPosts: vi.fn().mockResolvedValue([]),
    getPendingComments: vi.fn().mockResolvedValue([]),
  };
}

function configureFor(role: UserRole, overrides: Record<string, any> = {}) {
  const mock = emptyMock();
  Object.assign(mock, overrides);

  TestBed.configureTestingModule({
    imports: [DashboardComponent],
    providers: [
      provideRouter([]),
      { provide: SessionService, useValue: makeSessionMock(role) },
      { provide: ApplicationService, useValue: mock },
      { provide: InterviewService, useValue: mock },
      { provide: JobService, useValue: mock },
      { provide: NotificationService, useValue: mock },
      { provide: UserService, useValue: mock },
      { provide: ModerationService, useValue: mock },
      { provide: DocumentService, useValue: mock },
      { provide: ContentService, useValue: mock },
    ],
  });

  const fixture = TestBed.createComponent(DashboardComponent);
  return fixture.componentInstance;
}

// ── Candidate ─────────────────────────────────────────────────────────────────

describe('DashboardComponent — Candidate', () => {
  it('builds 4 cards with real data from services', async () => {
    const component = configureFor(UserRole.Candidate, {
      listByCandidate: vi.fn().mockResolvedValue([
        { id: 'a1', status: ApplicationStatus.Active, stage: ApplicationStage.Submitted },
        { id: 'a2', status: ApplicationStatus.Withdrawn, stage: ApplicationStage.Draft },
      ]),
      getByCandidate: vi.fn().mockResolvedValue([
        { id: 'i1', status: InterviewStatus.Scheduled },
      ]),
      getUnreadForUser: vi.fn().mockResolvedValue([{ id: 'n1' }, { id: 'n2' }]),
      listByOwner: vi.fn().mockResolvedValue([{ id: 'd1' }, { id: 'd2' }, { id: 'd3' }]),
    });

    await component.loadDashboard();
    const cards = component.cards();
    expect(cards).toHaveLength(4);
    expect(cards[0].label).toBe('Active Applications');
    expect(cards[0].value).toBe(1); // only 1 Active
    expect(cards[1].label).toBe('Upcoming Interviews');
    expect(cards[1].value).toBe(1);
    expect(cards[2].label).toBe('Unread Notifications');
    expect(cards[2].value).toBe(2);
    expect(cards[3].label).toBe('My Documents');
    expect(cards[3].value).toBe(3); // real count, not '—'
  });
});

// ── Employer ──────────────────────────────────────────────────────────────────

describe('DashboardComponent — Employer', () => {
  it('builds cards with application stage counts from real data', async () => {
    const component = configureFor(UserRole.Employer, {
      listJobsByOwner: vi.fn().mockResolvedValue([
        { id: 'j1', status: JobStatus.Active },
        { id: 'j2', status: JobStatus.Closed },
      ]),
      listByOrganization: vi.fn().mockResolvedValue([
        { id: 'a1', jobId: 'j1', status: ApplicationStatus.Active, stage: ApplicationStage.Submitted },
        { id: 'a2', jobId: 'j1', status: ApplicationStatus.Active, stage: ApplicationStage.UnderReview },
        { id: 'a3', jobId: 'j1', status: ApplicationStatus.Active, stage: ApplicationStage.InterviewScheduled },
        { id: 'a4', jobId: 'j2', status: ApplicationStatus.Active, stage: ApplicationStage.Submitted },
        { id: 'a5', jobId: 'other-employer', status: ApplicationStatus.Active, stage: ApplicationStage.Submitted },
      ]),
      getUnreadForUser: vi.fn().mockResolvedValue([]),
      listPosts: vi.fn().mockResolvedValue([{ id: 'p1' }]),
    });

    await component.loadDashboard();
    const cards = component.cards();
    expect(cards).toHaveLength(4);
    expect(cards[0].label).toBe('Active Job Postings');
    expect(cards[0].value).toBe(1); // only j1 is Active
    expect(cards[1].label).toBe('Applications Pipeline');
    expect(cards[1].value).toBe(4); // 4 active apps for employer's jobs (j1 + j2), not the 'other-employer' one
    expect(cards[1].sub).toContain('submitted');
    expect(cards[1].sub).toContain('reviewing');
    expect(cards[1].sub).toContain('interviewing');
    expect(cards[3].label).toBe('Content & Posts');
    expect(cards[3].value).toBe(1); // real count
  });
});

// ── HR Coordinator ────────────────────────────────────────────────────────────

describe('DashboardComponent — HRCoordinator', () => {
  it('includes interview data and moderation indicators', async () => {
    const component = configureFor(UserRole.HRCoordinator, {
      listJobs: vi.fn().mockResolvedValue([
        { id: 'j1', status: JobStatus.Active },
      ]),
      listByOrganization: vi.fn().mockResolvedValue([
        { id: 'i1', status: InterviewStatus.Scheduled },
        { id: 'i2', status: InterviewStatus.Scheduled },
        { id: 'i3', status: InterviewStatus.Completed },
      ]),
      getUnreadForUser: vi.fn().mockResolvedValue([]),
      getPendingComments: vi.fn().mockResolvedValue([{ id: 'c1' }]),
    });

    await component.loadDashboard();
    const cards = component.cards();
    expect(cards).toHaveLength(4);
    expect(cards[0].label).toBe('Active Jobs');
    expect(cards[0].value).toBe(1);
    expect(cards[1].label).toBe('Scheduled Interviews');
    expect(cards[1].value).toBe(2); // real interview data
    expect(cards[2].label).toBe('Moderation Queue');
    expect(cards[2].value).toBe(1);
    expect(cards[2].color).toBe('red'); // active items
  });
});

// ── Interviewer ───────────────────────────────────────────────────────────────

describe('DashboardComponent — Interviewer', () => {
  it('shows upcoming interviews and feedback-needed count', async () => {
    const component = configureFor(UserRole.Interviewer, {
      getByInterviewer: vi.fn().mockResolvedValue([
        { id: 'i1', status: InterviewStatus.Scheduled },
        { id: 'i2', status: InterviewStatus.Completed },
        { id: 'i3', status: InterviewStatus.Completed },
      ]),
      getUnreadForUser: vi.fn().mockResolvedValue([{ id: 'n1' }]),
    });

    await component.loadDashboard();
    const cards = component.cards();
    expect(cards).toHaveLength(4);
    expect(cards[0].value).toBe(1); // 1 upcoming
    expect(cards[1].label).toBe('Awaiting Feedback');
    expect(cards[1].value).toBe(2); // 2 completed needing feedback
    expect(cards[1].color).toBe('red');
  });
});

// ── Administrator ─────────────────────────────────────────────────────────────

describe('DashboardComponent — Administrator', () => {
  it('shows org users and job totals with real data', async () => {
    const component = configureFor(UserRole.Administrator, {
      listByOrganization: vi.fn().mockResolvedValue([
        { id: 'u1' }, { id: 'u2' }, { id: 'u3' },
      ]),
      listJobs: vi.fn().mockResolvedValue([
        { id: 'j1', status: JobStatus.Active },
        { id: 'j2', status: JobStatus.Closed },
      ]),
      getUnreadForUser: vi.fn().mockResolvedValue([{ id: 'n1' }]),
    });

    await component.loadDashboard();
    const cards = component.cards();
    expect(cards).toHaveLength(4);
    expect(cards[0].label).toBe('Org Users');
    expect(cards[0].value).toBe(3);
    expect(cards[1].label).toBe('Total Job Postings');
    expect(cards[1].value).toBe(2);
    expect(cards[2].label).toBe('Unread Notifications');
    expect(cards[2].value).toBe(1);
  });
});

// ── Race condition ────────────────────────────────────────────────────────────

describe('DashboardComponent — race condition guard', () => {
  it('discards stale load results when a newer load has started', async () => {
    let resolveFirst: (v: any) => void;
    const slowPromise = new Promise<any[]>(r => { resolveFirst = r; });

    const component = configureFor(UserRole.Candidate, {
      listByCandidate: vi.fn()
        .mockReturnValueOnce(slowPromise) // first call: slow
        .mockResolvedValueOnce([{ id: 'a1', status: ApplicationStatus.Active, stage: ApplicationStage.Submitted }]), // second call: fast
      getByCandidate: vi.fn().mockResolvedValue([]),
      getUnreadForUser: vi.fn().mockResolvedValue([]),
      listByOwner: vi.fn().mockResolvedValue([]),
    });

    // Start first load (slow)
    const firstLoad = component.loadDashboard();
    // Immediately start second load (fast) — simulates rapid role switch
    const secondLoad = component.loadDashboard();

    // Second load completes first
    await secondLoad;
    expect(component.cards()[0]?.value).toBe(1); // from second load

    // Now resolve the first (stale) load
    resolveFirst!([
      { id: 'stale1', status: ApplicationStatus.Active, stage: ApplicationStage.Draft },
      { id: 'stale2', status: ApplicationStatus.Active, stage: ApplicationStage.Draft },
    ]);
    await firstLoad;

    // Cards must still show second load's data, NOT the stale first load
    expect(component.cards()[0]?.value).toBe(1); // still 1, not 2
  });
});

// ── Error handling ────────────────────────────────────────────────────────────

describe('DashboardComponent — error handling', () => {
  it('sets error signal when requireAuth throws', async () => {
    // Service-level errors are caught by .catch(() => []) inside buildCards,
    // so they don't propagate.  The error path is triggered when requireAuth
    // itself throws (e.g. session expired mid-load).
    const mock = emptyMock();
    const sessionMock = makeSessionMock(UserRole.Candidate);
    sessionMock.requireAuth = () => { throw new Error('Authentication required'); };

    TestBed.configureTestingModule({
      imports: [DashboardComponent],
      providers: [
        provideRouter([]),
        { provide: SessionService, useValue: sessionMock },
        { provide: ApplicationService, useValue: mock },
        { provide: InterviewService, useValue: mock },
        { provide: JobService, useValue: mock },
        { provide: NotificationService, useValue: mock },
        { provide: UserService, useValue: mock },
        { provide: ModerationService, useValue: mock },
        { provide: DocumentService, useValue: mock },
        { provide: ContentService, useValue: mock },
      ],
    });

    const fixture = TestBed.createComponent(DashboardComponent);
    const component = fixture.componentInstance;
    await component.loadDashboard();
    expect(component.error()).toBe('Authentication required');
    expect(component.isLoading()).toBe(false);
  });

  it('gracefully handles individual service failures via catch fallbacks', async () => {
    // Even when one service rejects, the dashboard should still load with
    // partial data rather than showing an error state.
    const component = configureFor(UserRole.Candidate, {
      listByCandidate: vi.fn().mockRejectedValue(new Error('DB unavailable')),
      getByCandidate: vi.fn().mockResolvedValue([]),
      getUnreadForUser: vi.fn().mockResolvedValue([{ id: 'n1' }]),
      listByOwner: vi.fn().mockResolvedValue([]),
    });

    await component.loadDashboard();
    // No error — individual failures are caught
    expect(component.error()).toBeNull();
    const cards = component.cards();
    expect(cards).toHaveLength(4);
    expect(cards[0].value).toBe(0); // listByCandidate failed → empty fallback
    expect(cards[2].value).toBe(1); // notifications still loaded
  });
});
