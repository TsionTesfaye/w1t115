import { describe, it, expect, beforeAll, beforeEach, afterEach, vi } from 'vitest';
import { TestBed } from '@angular/core/testing';
import { signal, computed } from '@angular/core';
import { GovernanceComponent } from '../governance.component';
import { SessionService } from '../../../../core/services/session.service';
import { AuditService } from '../../../../core/services/audit.service';
import { GovernanceService } from '../../../../core/services/governance.service';
import { UserRole, AuditAction, SensitivityLevel } from '../../../../core/enums';
import { AuditLog, DataDictionaryEntry, LineageLink, MetricDefinition, DatasetSnapshot } from '../../../../core/models';

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

const mockAuditLogs: AuditLog[] = [
  {
    id: 'al1', actorId: 'user1', action: AuditAction.JobCreated,
    entityType: 'job', entityId: 'j1', organizationId: 'org1',
    timestamp: '2026-04-01T10:00:00Z', metadata: { title: 'Test Job' },
    previousHash: '0'.repeat(64), entryHash: 'abc123',
  },
  {
    id: 'al2', actorId: 'user2', action: AuditAction.Login,
    entityType: 'session', entityId: 's1', organizationId: 'org1',
    timestamp: '2026-04-02T12:00:00Z', metadata: {},
    previousHash: 'abc123', entryHash: 'def456',
  },
];

const mockDictEntries: DataDictionaryEntry[] = [
  { id: 'd1', entityType: 'User', fieldName: 'passwordHash', description: 'PBKDF2 hash', dataType: 'string', sensitivity: SensitivityLevel.Restricted, seededBySystem: true, updatedAt: '2026-01-01' },
  { id: 'd2', entityType: 'Application', fieldName: 'stage', description: 'Lifecycle position', dataType: 'ApplicationStage', sensitivity: SensitivityLevel.Internal, seededBySystem: true, updatedAt: '2026-01-01' },
];

const mockLineageLinks: LineageLink[] = [
  { id: 'l1', fromEntityType: 'job', fromEntityId: 'j1', toEntityType: 'application', toEntityId: 'a1' },
  { id: 'l2', fromEntityType: 'application', fromEntityId: 'a1', toEntityType: 'interview', toEntityId: 'i1' },
];

const mockMetrics: MetricDefinition[] = [
  { id: 'm1', key: 'views', label: 'Total Views', formulaDescription: 'Count of page views', seededBySystem: true, createdAt: '2026-01-01', updatedAt: '2026-01-01' },
  { id: 'm2', key: 'favorites', label: 'Favorites', formulaDescription: 'Count of favorites', seededBySystem: true, createdAt: '2026-01-01', updatedAt: '2026-01-01' },
];

const mockSnapshots: DatasetSnapshot[] = [
  {
    id: 'snap1', label: 'Q1 Snapshot', organizationId: 'org1', createdBy: 'admin1',
    manifest: { entityCounts: { jobs: 5, applications: 10, interviews: 3, documents: 2 }, entityIds: { jobs: [], applications: [], interviews: [], documents: [] }, entityData: { jobs: [], applications: [], interviews: [], documents: [] }, capturedAt: '2026-04-01T00:00:00Z' },
    queryNotes: 'End of Q1', version: 1, createdAt: '2026-04-01T00:00:00Z', updatedAt: '2026-04-01T00:00:00Z',
  },
];

function makeAuditSvcMock(overrides: Record<string, any> = {}) {
  return {
    search: vi.fn().mockResolvedValue(mockAuditLogs),
    verifyIntegrity: vi.fn().mockResolvedValue({ valid: true }),
    ...overrides,
  };
}

function makeGovSvcMock(overrides: Record<string, any> = {}) {
  return {
    getDataDictionary: vi.fn().mockResolvedValue(mockDictEntries),
    resolveLineage: vi.fn().mockResolvedValue(mockLineageLinks),
    getMetricDefinitions: vi.fn().mockResolvedValue(mockMetrics),
    listSnapshots: vi.fn().mockResolvedValue(mockSnapshots),
    createSnapshot: vi.fn().mockResolvedValue({
      id: 'snap2', label: 'New Snap', organizationId: 'org1', createdBy: 'admin1',
      manifest: { entityCounts: { jobs: 1 }, entityIds: { jobs: ['j1'] }, capturedAt: '2026-04-06T00:00:00Z' },
      queryNotes: '', version: 1, createdAt: '2026-04-06T00:00:00Z', updatedAt: '2026-04-06T00:00:00Z',
    }),
    ...overrides,
  };
}

function configure(auditOverrides: Record<string, any> = {}, govOverrides: Record<string, any> = {}) {
  const auditSvc = makeAuditSvcMock(auditOverrides);
  const govSvc = makeGovSvcMock(govOverrides);
  const sessionMock = makeSessionMock();

  TestBed.configureTestingModule({
    imports: [GovernanceComponent],
    providers: [
      { provide: SessionService, useValue: sessionMock },
      { provide: AuditService, useValue: auditSvc },
      { provide: GovernanceService, useValue: govSvc },
    ],
  });

  const fixture = TestBed.createComponent(GovernanceComponent);
  return { component: fixture.componentInstance, auditSvc, govSvc, sessionMock };
}

// ── Tests ────────────────────────────────────────────────────────────────────

describe('GovernanceComponent', () => {
  it('loads and displays audit log search results', async () => {
    const { component, auditSvc } = configure();

    component.auditSearchForm.patchValue({
      startDate: '2026-04-01',
      endDate: '2026-04-30',
      actorId: 'user1',
      action: AuditAction.JobCreated,
      entityType: 'job',
    });

    await component.onSearchAudit();

    expect(auditSvc.search).toHaveBeenCalledWith(
      {
        startDate: '2026-04-01T00:00:00.000Z',
        endDate: '2026-04-30T23:59:59.999Z',
        actorId: 'user1',
        action: AuditAction.JobCreated,
        entityType: 'job',
      },
      'admin1',
      [UserRole.Administrator],
      'org1',
    );
    expect(component.auditLogs()).toHaveLength(2);
    expect(component.auditSearched()).toBe(true);
  });

  it('loads data dictionary entries', async () => {
    const { component, govSvc } = configure();

    await component.loadDataDictionary();

    expect(govSvc.getDataDictionary).toHaveBeenCalledWith([UserRole.Administrator]);
    expect(component.dictEntries()).toHaveLength(2);
    expect(component.dictEntityTypes()).toContain('User');
    expect(component.dictEntityTypes()).toContain('Application');
  });

  it('resolves entity lineage', async () => {
    const { component, govSvc } = configure();

    component.lineageForm.patchValue({
      entityType: 'job',
      entityId: 'j1',
    });

    await component.onResolveLineage();

    expect(govSvc.resolveLineage).toHaveBeenCalledWith('job', 'j1', [UserRole.Administrator], 'org1');
    expect(component.lineageLinks()).toHaveLength(2);
    expect(component.lineageLinks()[0].fromEntityType).toBe('job');
    expect(component.lineageLinks()[1].toEntityType).toBe('interview');
    expect(component.lineageSearched()).toBe(true);
  });

  it('loads metric definitions', async () => {
    const { component, govSvc } = configure();

    await component.loadMetrics();

    expect(govSvc.getMetricDefinitions).toHaveBeenCalledWith([UserRole.Administrator]);
    expect(component.metrics()).toHaveLength(2);
    expect(component.metrics()[0].key).toBe('views');
    expect(component.metrics()[1].label).toBe('Favorites');
  });

  it('loads and creates snapshots', async () => {
    const { component, govSvc } = configure();

    await component.loadSnapshots();
    expect(govSvc.listSnapshots).toHaveBeenCalledWith([UserRole.Administrator], 'org1');
    expect(component.snapshots()).toHaveLength(1);
    expect(component.snapshots()[0].label).toBe('Q1 Snapshot');

    component.snapshotForm.patchValue({ label: 'New Snap', queryNotes: 'Test notes' });
    await component.onCreateSnapshot();

    expect(govSvc.createSnapshot).toHaveBeenCalledWith('New Snap', 'Test notes', 'admin1', [UserRole.Administrator], 'org1');
    expect(component.actionSuccess()).toBe('Snapshot created successfully');
  });

  it('verifies audit integrity', async () => {
    const { component, auditSvc } = configure();

    await component.onVerifyIntegrity();

    expect(auditSvc.verifyIntegrity).toHaveBeenCalledWith([UserRole.Administrator]);
    expect(component.integrityResult()).toEqual({ valid: true });

    // Test broken chain
    TestBed.resetTestingModule();
    const { component: c2, auditSvc: a2 } = configure({
      verifyIntegrity: vi.fn().mockResolvedValue({ valid: false, brokenAt: 'al2' }),
    });

    await c2.onVerifyIntegrity();

    expect(a2.verifyIntegrity).toHaveBeenCalled();
    expect(c2.integrityResult()).toEqual({ valid: false, brokenAt: 'al2' });
  });
});
