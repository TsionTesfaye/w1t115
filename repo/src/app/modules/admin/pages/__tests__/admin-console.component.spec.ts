/**
 * AdminConsoleComponent tests — real UserService, ImportExportService and
 * ModerationService backed by in-memory repos from helpers.ts.
 *
 * Boundary stubs kept:
 *  - SessionService → plain stub (no crypto/IDB)
 *  - document.createElement / URL.createObjectURL → vi.spyOn (download side-effect only)
 */

import { describe, it, expect, afterEach, vi } from 'vitest';
import { TestBed } from '@angular/core/testing';
import { signal, computed } from '@angular/core';

import { AdminConsoleComponent } from '../admin-console.component';
import { SessionService } from '../../../../core/services/session.service';
import { UserService } from '../../../../core/services/user.service';
import { ImportExportService } from '../../../../core/services/import-export.service';
import { ModerationService } from '../../../../core/services/moderation.service';

import { UserRole, ImportStrategy } from '../../../../core/enums';
import { User } from '../../../../core/models';
import { now } from '../../../../core/utils/id';

import {
  FakeUserRepo, FakeJobRepo, FakeApplicationRepo, FakeInterviewRepo, FakeContentPostRepo,
  FakeCommentRepo, FakeModerationCaseRepo, FakeSensitiveWordRepo,
  FakeNotificationRepo, FakeNotificationPreferenceRepo, FakeDelayedDeliveryRepo,
  FakeAuditLogRepo,
  fakeCrypto, fakeAudit, makeUser,
} from '../../../../core/services/__tests__/helpers';
import { AuditService } from '../../../../core/services/audit.service';
import { NotificationService } from '../../../../core/services/notification.service';
import { DNDService } from '../../../../core/services/dnd.service';

afterEach(() => {
  vi.restoreAllMocks();
  TestBed.resetTestingModule();
});

// ── Session stub ──────────────────────────────────────────────────────────────

function makeSessionStub(userId = 'admin1', orgId = 'org1') {
  return {
    activeRole: signal(UserRole.Administrator),
    isAuthenticated: computed(() => true),
    initialized: signal(true),
    currentUser: signal({ displayName: 'Admin User' }),
    organizationId: computed(() => orgId),
    userId: computed(() => userId),
    userRoles: computed(() => [UserRole.Administrator]),
    requireAuth: () => ({
      userId, organizationId: orgId,
      roles: [UserRole.Administrator], activeRole: UserRole.Administrator,
    }),
  };
}

// ── Seed users ────────────────────────────────────────────────────────────────

const seedUsers: User[] = [
  makeUser({ id: 'u1', username: 'alice', displayName: 'Alice Admin', roles: [UserRole.Administrator], organizationId: 'org1' }),
  makeUser({ id: 'u2', username: 'bob', displayName: 'Bob Employer', roles: [UserRole.Employer], organizationId: 'org1' }),
];

// ── Configure helper ─────────────────────────────────────────────────────────

function configure(seedUsersIn: User[] = []) {
  const userRepo = new FakeUserRepo();
  if (seedUsersIn.length) userRepo.seed(seedUsersIn);

  const jobRepo = new FakeJobRepo();
  const appRepo = new FakeApplicationRepo();
  const interviewRepo = new FakeInterviewRepo();
  const contentPostRepo = new FakeContentPostRepo();
  const commentRepo = new FakeCommentRepo();
  const modRepo = new FakeModerationCaseRepo();
  const wordRepo = new FakeSensitiveWordRepo();

  const notifRepo = new FakeNotificationRepo();
  const prefRepo = new FakeNotificationPreferenceRepo();
  const delayedRepo = new FakeDelayedDeliveryRepo();
  const auditLogRepo = new FakeAuditLogRepo();

  const realAuditSvc = new AuditService(auditLogRepo as any, fakeCrypto as any);
  const dnd = new DNDService(prefRepo as any, delayedRepo as any);
  const realNotifSvc = new NotificationService(notifRepo as any, prefRepo as any, dnd as any, delayedRepo as any);

  const realUserSvc = new UserService(userRepo as any, realAuditSvc as any, realNotifSvc as any);
  const realImportExportSvc = new ImportExportService(
    jobRepo as any, appRepo as any, userRepo as any, interviewRepo as any,
    contentPostRepo as any, realAuditSvc as any, fakeCrypto as any,
  );
  const realModSvc = new ModerationService(
    commentRepo as any, modRepo as any, wordRepo as any, userRepo as any, realAuditSvc as any,
  );

  const sessionStub = makeSessionStub();

  TestBed.configureTestingModule({
    imports: [AdminConsoleComponent],
    providers: [
      { provide: SessionService, useValue: sessionStub },
      { provide: UserService, useValue: realUserSvc },
      { provide: ImportExportService, useValue: realImportExportSvc },
      { provide: ModerationService, useValue: realModSvc },
    ],
  });

  const fixture = TestBed.createComponent(AdminConsoleComponent);
  return {
    component: fixture.componentInstance,
    userRepo, jobRepo, appRepo, wordRepo,
  };
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('AdminConsoleComponent', () => {
  it('loads org users via real UserService', async () => {
    const { component } = configure(seedUsers);

    await component.loadUsers();

    expect(component.users()).toHaveLength(2);
    expect(component.users()[0].displayName).toBe('Alice Admin');
    expect(component.users()[1].username).toBe('bob');
  });

  it('exports JSON data via real ImportExportService', async () => {
    // Configure FIRST (TestBed.createComponent must run with real document.createElement)
    const { component } = configure();
    component.exportEntityType.setValue('jobs');

    // Only spy AFTER component is created
    const mockAnchor = { href: '', download: '', click: vi.fn(), setAttribute: vi.fn(), style: {} };
    const origCreate = document.createElement.bind(document);
    const spy = vi.spyOn(document, 'createElement').mockImplementation((tag: string) =>
      tag === 'a' ? (mockAnchor as any) : origCreate(tag),
    );
    vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:mock-url');
    vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {});

    await component.onExportJson();

    expect(mockAnchor.download).toBe('jobs-export.json');
    expect(mockAnchor.click).toHaveBeenCalled();
    expect(component.actionSuccess()).toContain('Exported');
    spy.mockRestore();
  });

  it('exports CSV data via real ImportExportService', async () => {
    const { component } = configure();
    component.exportEntityType.setValue('applications');

    const mockAnchor = { href: '', download: '', click: vi.fn(), setAttribute: vi.fn(), style: {} };
    const origCreate = document.createElement.bind(document);
    const spy = vi.spyOn(document, 'createElement').mockImplementation((tag: string) =>
      tag === 'a' ? (mockAnchor as any) : origCreate(tag),
    );
    vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:mock-url');
    vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {});

    await component.onExportCsv();

    expect(mockAnchor.download).toBe('applications-export.csv');
    expect(mockAnchor.click).toHaveBeenCalled();
    spy.mockRestore();
  });

  it('previews import showing real validation', async () => {
    const { component } = configure();

    const testData = [
      { id: 'j1', organizationId: 'org1', ownerUserId: 'u1', title: 'Job 1', description: 'Desc', status: 'active', version: 1, createdAt: now(), updatedAt: now(), tags: [], topics: [] },
    ];
    component.importFileData.set(testData);
    component.importEntityType.setValue('jobs');

    await component.onPreviewImport();

    expect(component.importPreview()).toBeDefined();
    expect(component.importPreview()!.total).toBe(1);
  });

  it('Non-administrator cannot export — real AuthorizationError from ImportExportService', async () => {
    // Configure with Candidate session to test RBAC rejection on export
    const candidateSession = {
      activeRole: signal(UserRole.Candidate),
      isAuthenticated: computed(() => true),
      initialized: signal(true),
      currentUser: signal({ displayName: 'Candidate User' }),
      organizationId: computed(() => 'org1'),
      userId: computed(() => 'cand1'),
      userRoles: computed(() => [UserRole.Candidate]),
      requireAuth: () => ({
        userId: 'cand1', organizationId: 'org1',
        roles: [UserRole.Candidate], activeRole: UserRole.Candidate,
      }),
    };

    const userRepo = new FakeUserRepo();
    const auditLogRepo = new FakeAuditLogRepo();
    const realAuditSvc = new AuditService(auditLogRepo as any, fakeCrypto as any);
    const notifRepo = new FakeNotificationRepo();
    const prefRepo = new FakeNotificationPreferenceRepo();
    const delayedRepo = new FakeDelayedDeliveryRepo();
    const dnd = new DNDService(prefRepo as any, delayedRepo as any);
    const realNotifSvc = new NotificationService(notifRepo as any, prefRepo as any, dnd as any, delayedRepo as any);
    const realUserSvc = new UserService(userRepo as any, realAuditSvc as any, realNotifSvc as any);
    const realImportExportSvc = new ImportExportService(
      new FakeJobRepo() as any, new FakeApplicationRepo() as any, userRepo as any,
      new FakeInterviewRepo() as any, new FakeContentPostRepo() as any,
      realAuditSvc as any, fakeCrypto as any,
    );
    const realModSvc = new ModerationService(
      new FakeCommentRepo() as any, new FakeModerationCaseRepo() as any,
      new FakeSensitiveWordRepo() as any, userRepo as any, realAuditSvc as any,
    );

    TestBed.configureTestingModule({
      imports: [AdminConsoleComponent],
      providers: [
        { provide: SessionService, useValue: candidateSession },
        { provide: UserService, useValue: realUserSvc },
        { provide: ImportExportService, useValue: realImportExportSvc },
        { provide: ModerationService, useValue: realModSvc },
      ],
    });

    const fixture = TestBed.createComponent(AdminConsoleComponent);
    const component = fixture.componentInstance;
    component.exportEntityType.setValue('jobs');

    // exportJson throws AuthorizationError for non-administrators
    await component.onExportJson();

    expect(component.actionError()).toBeTruthy();
  });
});
