import { describe, it, expect, beforeAll, beforeEach, afterEach, vi } from 'vitest';
import { TestBed } from '@angular/core/testing';
import { signal, computed } from '@angular/core';
import { AdminConsoleComponent } from '../admin-console.component';
import { SessionService } from '../../../../core/services/session.service';
import { UserService } from '../../../../core/services/user.service';
import { ImportExportService } from '../../../../core/services/import-export.service';
import { UserRole, ImportStrategy } from '../../../../core/enums';
import { User } from '../../../../core/models';
import { ModerationService } from '../../../../core/services/moderation.service';

afterEach(() => {
  TestBed.resetTestingModule();
});

// ── Mock helpers ─────────────────────────────────────────────────────────────

function makeSessionMock() {
  return {
    activeRole: signal(UserRole.Administrator),
    isAuthenticated: computed(() => true),
    initialized: signal(true),
    currentUser: signal({ displayName: 'Admin User' }),
    organizationId: computed(() => 'org1'),
    userId: computed(() => 'admin1'),
    userRoles: computed(() => [UserRole.Administrator]),
    requireAuth: () => ({
      userId: 'admin1',
      organizationId: 'org1',
      roles: [UserRole.Administrator],
      activeRole: UserRole.Administrator,
    }),
  };
}

const mockUsers: Partial<User>[] = [
  {
    id: 'u1', username: 'alice', displayName: 'Alice Admin',
    roles: [UserRole.Administrator], organizationId: 'org1',
    version: 1, createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-01T00:00:00Z',
  },
  {
    id: 'u2', username: 'bob', displayName: 'Bob Employer',
    roles: [UserRole.Employer], organizationId: 'org1',
    version: 1, createdAt: '2026-02-01T00:00:00Z', updatedAt: '2026-02-01T00:00:00Z',
  },
];

function makeUserSvcMock(overrides: Record<string, any> = {}) {
  return {
    listByOrganization: vi.fn().mockResolvedValue(mockUsers),
    ...overrides,
  };
}

function makeModerationSvcMock(overrides: Record<string, any> = {}) {
  return {
    listSensitiveWords: vi.fn().mockResolvedValue([]),
    addSensitiveWord: vi.fn().mockResolvedValue({ id: 'w1', word: 'test', createdAt: '2026-01-01T00:00:00Z' }),
    removeSensitiveWord: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  };
}

function makeImportExportSvcMock(overrides: Record<string, any> = {}) {
  return {
    exportJson: vi.fn().mockResolvedValue({
      manifest: { version: '1.0', exportedAt: '2026-04-06T00:00:00Z', entityType: 'jobs', count: 2 },
      data: [{ id: 'j1', title: 'Job 1' }, { id: 'j2', title: 'Job 2' }],
    }),
    exportCsv: vi.fn().mockResolvedValue('id,title\nj1,Job 1\nj2,Job 2'),
    previewImport: vi.fn().mockResolvedValue({
      entityType: 'jobs', total: 3, newCount: 2, existingCount: 1,
      conflicts: ['Record j3: organizationId mismatch'],
      importToken: 'token-abc',
    }),
    applyImport: vi.fn().mockResolvedValue({ imported: 2, skipped: 1 }),
    ...overrides,
  };
}

function configure(userOverrides: Record<string, any> = {}, ieOverrides: Record<string, any> = {}) {
  const userSvc = makeUserSvcMock(userOverrides);
  const ieSvc = makeImportExportSvcMock(ieOverrides);
  const modSvc = makeModerationSvcMock();
  const sessionMock = makeSessionMock();

  TestBed.configureTestingModule({
    imports: [AdminConsoleComponent],
    providers: [
      { provide: SessionService, useValue: sessionMock },
      { provide: UserService, useValue: userSvc },
      { provide: ImportExportService, useValue: ieSvc },
      { provide: ModerationService, useValue: modSvc },
    ],
  });

  const fixture = TestBed.createComponent(AdminConsoleComponent);
  return { component: fixture.componentInstance, userSvc, ieSvc, sessionMock };
}

// ── Tests ────────────────────────────────────────────────────────────────────

describe('AdminConsoleComponent', () => {
  it('loads org users', async () => {
    const { component, userSvc } = configure();

    await component.loadUsers();

    expect(userSvc.listByOrganization).toHaveBeenCalledWith(
      [UserRole.Administrator], 'org1',
    );
    expect(component.users()).toHaveLength(2);
    expect(component.users()[0].displayName).toBe('Alice Admin');
    expect(component.users()[1].username).toBe('bob');
  });

  it('exports JSON data', async () => {
    const { component, ieSvc } = configure();

    // Mock document.createElement to capture download
    const mockAnchor = { href: '', download: '', click: vi.fn() };
    vi.spyOn(document, 'createElement').mockReturnValue(mockAnchor as any);
    vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:mock-url');
    vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {});

    component.exportEntityType.setValue('jobs');
    await component.onExportJson();

    expect(ieSvc.exportJson).toHaveBeenCalledWith('jobs', 'admin1', [UserRole.Administrator], 'org1');
    expect(mockAnchor.download).toBe('jobs-export.json');
    expect(mockAnchor.click).toHaveBeenCalled();
    expect(component.actionSuccess()).toContain('Exported 2 jobs records as JSON');

    vi.restoreAllMocks();
  });

  it('exports CSV data', async () => {
    const { component, ieSvc } = configure();

    const mockAnchor = { href: '', download: '', click: vi.fn() };
    vi.spyOn(document, 'createElement').mockReturnValue(mockAnchor as any);
    vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:mock-url');
    vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {});

    component.exportEntityType.setValue('applications');
    await component.onExportCsv();

    expect(ieSvc.exportCsv).toHaveBeenCalledWith('applications', 'admin1', [UserRole.Administrator], 'org1');
    expect(mockAnchor.download).toBe('applications-export.csv');
    expect(mockAnchor.click).toHaveBeenCalled();

    vi.restoreAllMocks();
  });

  it('previews import showing conflicts', async () => {
    const { component, ieSvc } = configure();

    const testData = [{ id: 'j1', title: 'Job 1' }, { id: 'j2', title: 'Job 2' }, { id: 'j3', title: 'Job 3' }];
    component.importFileData.set(testData);
    component.importEntityType.setValue('jobs');

    await component.onPreviewImport();

    expect(ieSvc.previewImport).toHaveBeenCalledWith('jobs', testData, [UserRole.Administrator], 'org1');
    expect(component.importPreview()).toBeDefined();
    expect(component.importPreview()!.total).toBe(3);
    expect(component.importPreview()!.newCount).toBe(2);
    expect(component.importPreview()!.existingCount).toBe(1);
    expect(component.importPreview()!.conflicts).toHaveLength(1);
    expect(component.importPreview()!.conflicts[0]).toContain('organizationId mismatch');
  });

  it('applies import with strategy', async () => {
    const { component, ieSvc } = configure();

    const testData = [{ id: 'j1', title: 'Job 1' }, { id: 'j2', title: 'Job 2' }, { id: 'j3', title: 'Job 3' }];
    component.importFileData.set(testData);
    component.importPreview.set({
      entityType: 'jobs', total: 3, newCount: 2, existingCount: 1,
      conflicts: [], importToken: 'token-abc',
    });
    component.importEntityType.setValue('jobs');
    component.importStrategy.setValue(ImportStrategy.Merge);

    await component.onApplyImport();

    expect(ieSvc.applyImport).toHaveBeenCalledWith(
      'jobs', testData, ImportStrategy.Merge, 'token-abc',
      'admin1', [UserRole.Administrator], 'org1',
    );
    expect(component.importResult()).toEqual({ imported: 2, skipped: 1 });
    expect(component.importPreview()).toBeNull();
    expect(component.actionSuccess()).toContain('Import complete');
  });
});
