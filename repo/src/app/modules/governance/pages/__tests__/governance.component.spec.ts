/**
 * GovernanceComponent tests — real AuditService and GovernanceService backed by
 * in-memory repos from helpers.ts.
 *
 * Boundary stubs kept:
 *  - SessionService → plain stub (no crypto/IDB)
 *  - fakeCrypto → sha256 returns the input string (sufficient for hash chain tests)
 */

import { describe, it, expect, afterEach } from 'vitest';
import { TestBed } from '@angular/core/testing';
import { signal, computed } from '@angular/core';

import { GovernanceComponent } from '../governance.component';
import { SessionService } from '../../../../core/services/session.service';
import { AuditService } from '../../../../core/services/audit.service';
import { GovernanceService } from '../../../../core/services/governance.service';

import { UserRole, AuditAction, SensitivityLevel } from '../../../../core/enums';
import { AuditLog, DataDictionaryEntry, LineageLink, MetricDefinition, DatasetSnapshot } from '../../../../core/models';
import { now } from '../../../../core/utils/id';

import {
  FakeAuditLogRepo, FakeMetricDefinitionRepo, FakeDataDictionaryRepo,
  FakeDatasetSnapshotRepo, FakeLineageRepo, FakeJobRepo, FakeApplicationRepo,
  FakeInterviewRepo, FakeDocumentRepo,
  fakeCrypto,
} from '../../../../core/services/__tests__/helpers';

afterEach(() => {
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

// ── Seed data ─────────────────────────────────────────────────────────────────

const mockDictEntries: DataDictionaryEntry[] = [
  { id: 'd1', entityType: 'User', fieldName: 'passwordHash', description: 'PBKDF2 hash', dataType: 'string', sensitivity: SensitivityLevel.Restricted, seededBySystem: true, updatedAt: now() },
  { id: 'd2', entityType: 'Application', fieldName: 'stage', description: 'Lifecycle position', dataType: 'ApplicationStage', sensitivity: SensitivityLevel.Internal, seededBySystem: true, updatedAt: now() },
];

const mockMetrics: MetricDefinition[] = [
  { id: 'm1', key: 'views', label: 'Total Views', formulaDescription: 'Count of page views', seededBySystem: true, createdAt: now(), updatedAt: now() },
  { id: 'm2', key: 'favorites', label: 'Favorites', formulaDescription: 'Count of favorites', seededBySystem: true, createdAt: now(), updatedAt: now() },
];

// ── Configure helper ─────────────────────────────────────────────────────────

function configure(opts: {
  seedLogs?: AuditLog[];
  seedDict?: DataDictionaryEntry[];
  seedMetrics?: MetricDefinition[];
} = {}) {
  const auditLogRepo = new FakeAuditLogRepo();
  if (opts.seedLogs) {
    for (const log of opts.seedLogs) auditLogRepo.append(log);
  }

  const metricRepo = new FakeMetricDefinitionRepo();
  if (opts.seedMetrics) metricRepo.seed(opts.seedMetrics);

  const dictRepo = new FakeDataDictionaryRepo();
  if (opts.seedDict) dictRepo.seed(opts.seedDict);

  const lineageRepo = new FakeLineageRepo();
  const snapRepo = new FakeDatasetSnapshotRepo();
  const jobRepo = new FakeJobRepo();
  const appRepo = new FakeApplicationRepo();
  const interviewRepo = new FakeInterviewRepo();
  const docRepo = new FakeDocumentRepo();

  const realAuditSvc = new AuditService(auditLogRepo as any, fakeCrypto as any);
  const realGovSvc = new GovernanceService(
    metricRepo as any, dictRepo as any, lineageRepo as any, snapRepo as any,
    jobRepo as any, appRepo as any, interviewRepo as any, docRepo as any,
    realAuditSvc as any,
  );

  const sessionStub = makeSessionStub();

  TestBed.configureTestingModule({
    imports: [GovernanceComponent],
    providers: [
      { provide: SessionService, useValue: sessionStub },
      { provide: AuditService, useValue: realAuditSvc },
      { provide: GovernanceService, useValue: realGovSvc },
    ],
  });

  const fixture = TestBed.createComponent(GovernanceComponent);
  return {
    component: fixture.componentInstance,
    auditLogRepo, metricRepo, dictRepo, lineageRepo, snapRepo,
    realAuditSvc, realGovSvc,
  };
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('GovernanceComponent', () => {
  it('loads and displays audit log search results via real AuditService', async () => {
    // Seed two audit entries by logging them
    const { component, realAuditSvc } = configure();

    await realAuditSvc.log('user1', AuditAction.JobCreated, 'job', 'j1', 'org1', { title: 'Test Job' });
    await realAuditSvc.log('user2', AuditAction.Login, 'session', 's1', 'org1', {});

    component.auditSearchForm.patchValue({
      startDate: '', endDate: '', actorId: '', action: '', entityType: '',
    });

    await component.onSearchAudit();

    expect(component.auditLogs()).toHaveLength(2);
    expect(component.auditSearched()).toBe(true);
  });

  it('loads data dictionary entries via real GovernanceService', async () => {
    const { component } = configure({ seedDict: mockDictEntries });

    await component.loadDataDictionary();

    expect(component.dictEntries()).toHaveLength(2);
    expect(component.dictEntityTypes()).toContain('User');
    expect(component.dictEntityTypes()).toContain('Application');
  });

  it('loads metric definitions via real GovernanceService', async () => {
    const { component } = configure({ seedMetrics: mockMetrics });

    await component.loadMetrics();

    expect(component.metrics()).toHaveLength(2);
    expect(component.metrics()[0].key).toBe('views');
    expect(component.metrics()[1].label).toBe('Favorites');
  });

  it('creates a snapshot via real GovernanceService', async () => {
    const { component, snapRepo } = configure();

    await component.loadSnapshots();
    component.snapshotForm.patchValue({ label: 'New Snap', queryNotes: 'Test notes' });
    await component.onCreateSnapshot();

    expect(component.actionSuccess()).toBe('Snapshot created successfully');
    expect(snapRepo.snapshot().some(s => s.label === 'New Snap')).toBe(true);
  });

  it('verifies audit integrity — valid chain', async () => {
    const { component, realAuditSvc } = configure();

    // Log 2 entries with real service so chain is built correctly
    await realAuditSvc.log('admin1', AuditAction.Login, 'session', 's1', 'org1', {});
    await realAuditSvc.log('admin1', AuditAction.JobCreated, 'job', 'j1', 'org1', {});

    await component.onVerifyIntegrity();

    expect(component.integrityResult()?.valid).toBe(true);
  });

  it('verifies audit integrity — broken chain detected', async () => {
    const { component, auditLogRepo } = configure();

    // Manually insert a broken chain: second entry has wrong previousHash
    await auditLogRepo.append({
      id: 'al1', actorId: 'user1', action: AuditAction.JobCreated,
      entityType: 'job', entityId: 'j1', organizationId: 'org1',
      timestamp: '2026-04-01T10:00:00Z', metadata: {},
      previousHash: '0'.repeat(64), entryHash: 'correcthash',
    });
    await auditLogRepo.append({
      id: 'al2', actorId: 'user2', action: AuditAction.Login,
      entityType: 'session', entityId: 's1', organizationId: 'org1',
      timestamp: '2026-04-02T12:00:00Z', metadata: {},
      previousHash: 'wronghash', // should be 'correcthash'
      entryHash: 'somehash',
    });

    await component.onVerifyIntegrity();

    expect(component.integrityResult()?.valid).toBe(false);
    // brokenAt is set to the first entry whose hash/chain fails
    expect(component.integrityResult()?.brokenAt).toBeTruthy();
  });
});
