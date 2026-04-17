/**
 * DashboardComponent tests — real services backed by in-memory repos.
 *
 * DocumentService is stubbed (plain async object) because it has 12 complex
 * dependencies including real crypto/key management that can't be trivialized.
 *
 * All other 8 services use real instances backed by FakeStore repos.
 *
 * Boundary stubs kept:
 *  - SessionService → plain stub
 *  - DocumentService → { listByOwner: async () => [] } (crypto boundary)
 */

import { describe, it, expect, afterEach, vi } from 'vitest';
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
import { DNDService } from '../../../../core/services/dnd.service';
import { AuditService } from '../../../../core/services/audit.service';

import {
  UserRole, InterviewStatus, JobStatus, ApplicationStatus, ApplicationStage,
} from '../../../../core/enums';
import { Application } from '../../../../core/models';

import {
  FakeJobRepo, FakeApplicationRepo, FakeInterviewRepo, FakeInterviewPlanRepo,
  FakeDocumentRepo, FakeUserRepo, FakeNotificationRepo, FakeNotificationPreferenceRepo,
  FakeDelayedDeliveryRepo, FakeLineageRepo, FakeContentPostRepo,
  FakeCommentRepo, FakeModerationCaseRepo, FakeSensitiveWordRepo, FakeAuditLogRepo,
  fakeCrypto, fakeNotifService,
  makeJob, makeApplication, makeInterview, makeNotification, makeDocument,
} from '../../../../core/services/__tests__/helpers';

afterEach(() => {
  TestBed.resetTestingModule();
});

// ── Session stub ──────────────────────────────────────────────────────────────

function makeSessionStub(role: UserRole) {
  return {
    activeRole: signal(role),
    isAuthenticated: computed(() => true),
    initialized: signal(true),
    currentUser: signal({ displayName: 'Test User' }),
    requireAuth: () => ({
      userId: 'user1', organizationId: 'org1', roles: [role], activeRole: role,
    }),
  };
}

// ── Dashboard service factory ─────────────────────────────────────────────────

interface SeedData {
  jobs?: ReturnType<typeof makeJob>[];
  applications?: ReturnType<typeof makeApplication>[];
  interviews?: ReturnType<typeof makeInterview>[];
  notifications?: ReturnType<typeof makeNotification>[];
  docs?: ReturnType<typeof makeDocument>[];
  users?: any[];
  contentPosts?: any[];
  comments?: any[];
}

function makeDashboardServices(seedData: SeedData = {}) {
  const jobRepo = new FakeJobRepo();
  if (seedData.jobs) jobRepo.seed(seedData.jobs);

  const appRepo = new FakeApplicationRepo();
  if (seedData.applications) appRepo.seed(seedData.applications);

  const interviewRepo = new FakeInterviewRepo();
  if (seedData.interviews) interviewRepo.seed(seedData.interviews);

  const notifRepo = new FakeNotificationRepo();
  if (seedData.notifications) notifRepo.seed(seedData.notifications);

  const docRepo = new FakeDocumentRepo();
  if (seedData.docs) docRepo.seed(seedData.docs);

  const userRepo = new FakeUserRepo();
  if (seedData.users) userRepo.seed(seedData.users);

  const contentPostRepo = new FakeContentPostRepo();
  if (seedData.contentPosts) contentPostRepo.seed(seedData.contentPosts);

  const commentRepo = new FakeCommentRepo();
  if (seedData.comments) commentRepo.seed(seedData.comments);

  const lineageRepo = new FakeLineageRepo();
  const planRepo = new FakeInterviewPlanRepo();
  const prefRepo = new FakeNotificationPreferenceRepo();
  const delayedRepo = new FakeDelayedDeliveryRepo();
  const modRepo = new FakeModerationCaseRepo();
  const wordRepo = new FakeSensitiveWordRepo();
  const auditLogRepo = new FakeAuditLogRepo();

  const realAuditSvc = new AuditService(auditLogRepo as any, fakeCrypto as any);
  const dnd = new DNDService(prefRepo as any, delayedRepo as any);
  const realNotifSvc = new NotificationService(notifRepo as any, prefRepo as any, dnd as any, delayedRepo as any);

  const realJobSvc = new JobService(jobRepo as any, lineageRepo as any, realAuditSvc as any, userRepo as any);
  const realAppSvc = new ApplicationService(
    appRepo as any, jobRepo as any, lineageRepo as any, notifRepo as any,
    realAuditSvc as any, fakeNotifService as any, userRepo as any,
  );
  const realInterviewSvc = new InterviewService(
    interviewRepo as any, planRepo as any, appRepo as any, jobRepo as any,
    lineageRepo as any, realAuditSvc as any, fakeNotifService as any, userRepo as any,
  );
  const realUserSvc = new UserService(userRepo as any, realAuditSvc as any, realNotifSvc as any);
  const realModSvc = new ModerationService(
    commentRepo as any, modRepo as any, wordRepo as any, userRepo as any, realAuditSvc as any,
  );
  const realContentSvc = new ContentService(contentPostRepo as any, realAuditSvc as any);

  // DocumentService has 12 deps (crypto + key mgmt) — use a plain stub
  const docSvcStub = {
    listByOwner: async (_ownerId: string, _actorId: string, _roles: UserRole[], _orgId: string) =>
      docRepo.snapshot(),
  };

  return {
    realJobSvc, realAppSvc, realInterviewSvc, realNotifSvc,
    realUserSvc, realModSvc, realContentSvc, docSvcStub,
    repos: { jobRepo, appRepo, interviewRepo, notifRepo, docRepo, userRepo, contentPostRepo, commentRepo },
  };
}

// ── Configure helper ─────────────────────────────────────────────────────────

function configureFor(role: UserRole, seedData: SeedData = {}) {
  const {
    realJobSvc, realAppSvc, realInterviewSvc, realNotifSvc,
    realUserSvc, realModSvc, realContentSvc, docSvcStub, repos,
  } = makeDashboardServices(seedData);

  TestBed.configureTestingModule({
    imports: [DashboardComponent],
    providers: [
      provideRouter([]),
      { provide: SessionService, useValue: makeSessionStub(role) },
      { provide: ApplicationService, useValue: realAppSvc },
      { provide: InterviewService, useValue: realInterviewSvc },
      { provide: JobService, useValue: realJobSvc },
      { provide: NotificationService, useValue: realNotifSvc },
      { provide: UserService, useValue: realUserSvc },
      { provide: ModerationService, useValue: realModSvc },
      { provide: DocumentService, useValue: docSvcStub },
      { provide: ContentService, useValue: realContentSvc },
    ],
  });

  const fixture = TestBed.createComponent(DashboardComponent);
  return { component: fixture.componentInstance, repos };
}

// ── Candidate ─────────────────────────────────────────────────────────────────

describe('DashboardComponent — Candidate', () => {
  it('builds 4 cards with real data from services', async () => {
    const apps = [
      makeApplication({ candidateId: 'user1', organizationId: 'org1', status: ApplicationStatus.Active, stage: ApplicationStage.Submitted }),
      makeApplication({ candidateId: 'user1', organizationId: 'org1', status: ApplicationStatus.Withdrawn, stage: ApplicationStage.Draft }),
    ];
    const interviews = [
      makeInterview({ candidateId: 'user1', organizationId: 'org1', status: InterviewStatus.Scheduled }),
    ];
    const notifs = [
      makeNotification({ userId: 'user1', organizationId: 'org1', isRead: false }),
      makeNotification({ userId: 'user1', organizationId: 'org1', isRead: false }),
    ];
    const docs = [
      makeDocument({ ownerUserId: 'user1', organizationId: 'org1' }),
      makeDocument({ ownerUserId: 'user1', organizationId: 'org1' }),
      makeDocument({ ownerUserId: 'user1', organizationId: 'org1' }),
    ];

    const { component } = configureFor(UserRole.Candidate, { applications: apps, interviews, notifications: notifs, docs });

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
    expect(cards[3].value).toBe(3);
  });
});

// ── Employer ──────────────────────────────────────────────────────────────────

describe('DashboardComponent — Employer', () => {
  it('builds cards with application stage counts from real data', async () => {
    const j1 = makeJob({ id: 'j1', ownerUserId: 'user1', organizationId: 'org1', status: JobStatus.Active });
    const j2 = makeJob({ id: 'j2', ownerUserId: 'user1', organizationId: 'org1', status: JobStatus.Closed });
    const jOther = makeJob({ id: 'j3', ownerUserId: 'other', organizationId: 'org1', status: JobStatus.Active });

    const apps = [
      makeApplication({ jobId: 'j1', organizationId: 'org1', status: ApplicationStatus.Active, stage: ApplicationStage.Submitted }),
      makeApplication({ jobId: 'j1', organizationId: 'org1', status: ApplicationStatus.Active, stage: ApplicationStage.UnderReview }),
      makeApplication({ jobId: 'j1', organizationId: 'org1', status: ApplicationStatus.Active, stage: ApplicationStage.InterviewScheduled }),
      makeApplication({ jobId: 'j2', organizationId: 'org1', status: ApplicationStatus.Active, stage: ApplicationStage.Submitted }),
      makeApplication({ jobId: 'j3', organizationId: 'org1', status: ApplicationStatus.Active, stage: ApplicationStage.Submitted }),
    ];

    const posts = [
      { id: 'p1', organizationId: 'org1', authorId: 'user1', title: 'Post', body: 'body', tags: [], topics: [], status: 'published', scheduledPublishAt: null, pinnedUntil: null, version: 1, createdAt: '2026-01-01', updatedAt: '2026-01-01' },
    ];

    const { component } = configureFor(UserRole.Employer, { jobs: [j1, j2, jOther], applications: apps, contentPosts: posts });

    await component.loadDashboard();

    const cards = component.cards();
    expect(cards).toHaveLength(4);
    expect(cards[0].label).toBe('Active Job Postings');
    expect(cards[0].value).toBe(1); // j1 is Active (owned by user1)
    expect(cards[1].label).toBe('Applications Pipeline');
    expect(cards[1].value).toBe(4); // j1 has 3 + j2 has 1 = 4 (j3 is not owned by user1)
    expect(cards[1].sub).toContain('submitted');
  });
});

// ── HR Coordinator ────────────────────────────────────────────────────────────

describe('DashboardComponent — HRCoordinator', () => {
  it('includes interview data and moderation indicators', async () => {
    const j1 = makeJob({ organizationId: 'org1', status: JobStatus.Active });
    const interviews = [
      makeInterview({ organizationId: 'org1', status: InterviewStatus.Scheduled }),
      makeInterview({ organizationId: 'org1', status: InterviewStatus.Scheduled }),
      makeInterview({ organizationId: 'org1', status: InterviewStatus.Completed }),
    ];

    const { component } = configureFor(UserRole.HRCoordinator, { jobs: [j1], interviews });

    await component.loadDashboard();

    const cards = component.cards();
    expect(cards).toHaveLength(4);
    expect(cards[0].label).toBe('Active Jobs');
    expect(cards[0].value).toBe(1);
    expect(cards[1].label).toBe('Scheduled Interviews');
    expect(cards[1].value).toBe(2);
  });
});

// ── Interviewer ───────────────────────────────────────────────────────────────

describe('DashboardComponent — Interviewer', () => {
  it('shows upcoming interviews and feedback-needed count', async () => {
    const interviews = [
      makeInterview({ interviewerId: 'user1', organizationId: 'org1', status: InterviewStatus.Scheduled }),
      makeInterview({ interviewerId: 'user1', organizationId: 'org1', status: InterviewStatus.Completed }),
      makeInterview({ interviewerId: 'user1', organizationId: 'org1', status: InterviewStatus.Completed }),
    ];
    const notifs = [
      makeNotification({ userId: 'user1', organizationId: 'org1', isRead: false }),
    ];

    const { component } = configureFor(UserRole.Interviewer, { interviews, notifications: notifs });

    await component.loadDashboard();

    const cards = component.cards();
    expect(cards).toHaveLength(4);
    expect(cards[0].value).toBe(1); // 1 upcoming
    expect(cards[1].label).toBe('Awaiting Feedback');
    expect(cards[1].value).toBe(2); // 2 completed
    expect(cards[1].color).toBe('red');
  });
});

// ── Administrator ─────────────────────────────────────────────────────────────

describe('DashboardComponent — Administrator', () => {
  it('shows org users and job totals with real data', async () => {
    const { makeUser } = await import('../../../../core/services/__tests__/helpers');
    const users = [
      makeUser({ id: 'u1', organizationId: 'org1' }),
      makeUser({ id: 'u2', organizationId: 'org1' }),
      makeUser({ id: 'u3', organizationId: 'org1' }),
    ];
    const jobs = [
      makeJob({ organizationId: 'org1', status: JobStatus.Active }),
      makeJob({ organizationId: 'org1', status: JobStatus.Closed }),
    ];
    const notifs = [
      makeNotification({ userId: 'user1', organizationId: 'org1', isRead: false }),
    ];

    const { component } = configureFor(UserRole.Administrator, { users, jobs, notifications: notifs });

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
    let resolveFirst!: (v: Application[]) => void;

    // Build all real services but override appRepo's getByCandidate for race test
    const {
      realJobSvc, realInterviewSvc, realNotifSvc,
      realUserSvc, realModSvc, realContentSvc, docSvcStub, repos,
    } = makeDashboardServices({
      applications: [],
      notifications: [],
      interviews: [],
      docs: [],
    });

    const slowApp = makeApplication({ candidateId: 'user1', organizationId: 'org1', status: ApplicationStatus.Active, stage: ApplicationStage.Submitted });
    let firstCall = true;

    const realAppSvcWithSlowFirst = {
      ...realAppSvc_placeholder(),
      listByCandidate: async (userId: string, _actorId: string, _roles: UserRole[], _orgId: string) => {
        if (firstCall) {
          firstCall = false;
          return new Promise<Application[]>(r => { resolveFirst = r; });
        }
        return [slowApp];
      },
    };

    function realAppSvc_placeholder() {
      return new ApplicationService(
        repos.appRepo as any, repos.jobRepo as any, new FakeLineageRepo() as any,
        repos.notifRepo as any, { log: async () => ({}) } as any,
        fakeNotifService as any, repos.userRepo as any,
      );
    }

    TestBed.configureTestingModule({
      imports: [DashboardComponent],
      providers: [
        provideRouter([]),
        { provide: SessionService, useValue: makeSessionStub(UserRole.Candidate) },
        { provide: ApplicationService, useValue: realAppSvcWithSlowFirst },
        { provide: InterviewService, useValue: realInterviewSvc },
        { provide: JobService, useValue: realJobSvc },
        { provide: NotificationService, useValue: realNotifSvc },
        { provide: UserService, useValue: realUserSvc },
        { provide: ModerationService, useValue: realModSvc },
        { provide: DocumentService, useValue: docSvcStub },
        { provide: ContentService, useValue: realContentSvc },
      ],
    });

    const fixture = TestBed.createComponent(DashboardComponent);
    const component = fixture.componentInstance;

    // Start first load (slow)
    const firstLoad = component.loadDashboard();
    // Immediately start second load (fast) — simulates rapid role switch
    const secondLoad = component.loadDashboard();

    // Second load completes first (firstCall=false for second load, returns slowApp immediately)
    await secondLoad;
    expect(component.cards()[0]?.value).toBe(1); // from second load

    // Now resolve the first (stale) load with more apps
    resolveFirst!([
      makeApplication({ candidateId: 'user1', organizationId: 'org1', status: ApplicationStatus.Active, stage: ApplicationStage.Draft }),
      makeApplication({ candidateId: 'user1', organizationId: 'org1', status: ApplicationStatus.Active, stage: ApplicationStage.Draft }),
    ]);
    await firstLoad;

    // Cards must still show second load's data, NOT the stale first load
    expect(component.cards()[0]?.value).toBe(1); // still 1, not 2
  });
});

// ── Error handling ────────────────────────────────────────────────────────────

describe('DashboardComponent — error handling', () => {
  it('sets error signal when requireAuth throws', async () => {
    const {
      realJobSvc, realAppSvc, realInterviewSvc, realNotifSvc,
      realUserSvc, realModSvc, realContentSvc, docSvcStub,
    } = makeDashboardServices({});

    const sessionMock = makeSessionStub(UserRole.Candidate);
    sessionMock.requireAuth = () => { throw new Error('Authentication required'); };

    TestBed.configureTestingModule({
      imports: [DashboardComponent],
      providers: [
        provideRouter([]),
        { provide: SessionService, useValue: sessionMock },
        { provide: ApplicationService, useValue: realAppSvc },
        { provide: InterviewService, useValue: realInterviewSvc },
        { provide: JobService, useValue: realJobSvc },
        { provide: NotificationService, useValue: realNotifSvc },
        { provide: UserService, useValue: realUserSvc },
        { provide: ModerationService, useValue: realModSvc },
        { provide: DocumentService, useValue: docSvcStub },
        { provide: ContentService, useValue: realContentSvc },
      ],
    });

    const fixture = TestBed.createComponent(DashboardComponent);
    const component = fixture.componentInstance;
    await component.loadDashboard();

    expect(component.error()).toBe('Authentication required');
    expect(component.isLoading()).toBe(false);
  });

  it('gracefully handles individual service failures via catch fallbacks', async () => {
    // Applications service will throw — but dashboard should still load with partial data
    const {
      realJobSvc, realInterviewSvc, realNotifSvc,
      realUserSvc, realModSvc, realContentSvc, docSvcStub, repos,
    } = makeDashboardServices({
      notifications: [makeNotification({ userId: 'user1', organizationId: 'org1', isRead: false })],
    });

    const failingAppSvc = {
      listByCandidate: async () => { throw new Error('DB unavailable'); },
      listByOrganization: async () => { throw new Error('DB unavailable'); },
    };

    TestBed.configureTestingModule({
      imports: [DashboardComponent],
      providers: [
        provideRouter([]),
        { provide: SessionService, useValue: makeSessionStub(UserRole.Candidate) },
        { provide: ApplicationService, useValue: failingAppSvc },
        { provide: InterviewService, useValue: realInterviewSvc },
        { provide: JobService, useValue: realJobSvc },
        { provide: NotificationService, useValue: realNotifSvc },
        { provide: UserService, useValue: realUserSvc },
        { provide: ModerationService, useValue: realModSvc },
        { provide: DocumentService, useValue: docSvcStub },
        { provide: ContentService, useValue: realContentSvc },
      ],
    });

    const fixture = TestBed.createComponent(DashboardComponent);
    const component = fixture.componentInstance;
    await component.loadDashboard();

    // No error — individual failures are caught
    expect(component.error()).toBeNull();
    const cards = component.cards();
    expect(cards).toHaveLength(4);
    expect(cards[0].value).toBe(0); // appSvc failed → empty fallback
    expect(cards[2].value).toBe(1); // notifications still loaded
  });
});
