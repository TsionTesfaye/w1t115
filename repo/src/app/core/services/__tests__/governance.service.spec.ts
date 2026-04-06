import { describe, it, expect } from 'vitest';
import { GovernanceService } from '../governance.service';
import { UserRole } from '../../enums';
import { AuthorizationError } from '../../errors';
import {
  FakeMetricDefinitionRepo, FakeDataDictionaryRepo, FakeDatasetSnapshotRepo,
  FakeLineageRepo, FakeJobRepo, FakeApplicationRepo, FakeInterviewRepo, FakeDocumentRepo,
  fakeAudit, makeJob, makeApplication, makeDocument,
} from './helpers';
import { generateId } from '../../utils/id';

const ORG = 'org1';
const ADMIN = 'admin1';
const HR = 'hr1';
const ADMIN_ROLES = [UserRole.Administrator];
const HR_ROLES = [UserRole.HRCoordinator];
const CANDIDATE_ROLES = [UserRole.Candidate];

function makeService(
  snapRepo = new FakeDatasetSnapshotRepo(),
  jobRepo  = new FakeJobRepo(),
  appRepo  = new FakeApplicationRepo(),
  intRepo  = new FakeInterviewRepo(),
  docRepo  = new FakeDocumentRepo(),
) {
  return new GovernanceService(
    new FakeMetricDefinitionRepo() as any,
    new FakeDataDictionaryRepo() as any,
    new FakeLineageRepo() as any,
    snapRepo as any,
    jobRepo as any,
    appRepo as any,
    intRepo as any,
    docRepo as any,
    fakeAudit as any,
  );
}

// ── RBAC ─────────────────────────────────────────────────────────────────

describe('GovernanceService — RBAC', () => {
  it('candidate cannot create a snapshot', async () => {
    const svc = makeService();
    await expect(
      svc.createSnapshot('Test', '', 'c1', CANDIDATE_ROLES, ORG),
    ).rejects.toThrow(AuthorizationError);
  });

  it('candidate cannot list snapshots', async () => {
    const svc = makeService();
    await expect(svc.listSnapshots(CANDIDATE_ROLES, ORG)).rejects.toThrow(AuthorizationError);
  });
});

// ── Snapshot entityData ───────────────────────────────────────────────────

describe('GovernanceService — createSnapshot stores full record data', () => {
  it('manifest.entityData contains actual job records', async () => {
    const job = makeJob({ id: 'j1', organizationId: ORG });
    const snapRepo = new FakeDatasetSnapshotRepo();
    const svc = makeService(snapRepo, new FakeJobRepo().seed([job]));

    const snap = await svc.createSnapshot('Q1 Snapshot', 'notes', ADMIN, ADMIN_ROLES, ORG);

    expect(snap.manifest.entityData).toBeDefined();
    expect(snap.manifest.entityData.jobs).toHaveLength(1);
    expect(snap.manifest.entityData.jobs[0].id).toBe('j1');
  });

  it('manifest.entityData contains actual application records', async () => {
    const app = makeApplication({ id: 'a1', organizationId: ORG });
    const snapRepo = new FakeDatasetSnapshotRepo();
    const svc = makeService(snapRepo, undefined, new FakeApplicationRepo().seed([app]));

    const snap = await svc.createSnapshot('Snapshot', '', HR, HR_ROLES, ORG);

    expect(snap.manifest.entityData.applications).toHaveLength(1);
    expect(snap.manifest.entityData.applications[0].id).toBe('a1');
  });

  it('document encryptedBlob and encryptionIv are stripped from entityData', async () => {
    const doc = makeDocument({ id: 'd1', organizationId: ORG, encryptedBlob: 'secret', encryptionIv: 'iv' });
    const snapRepo = new FakeDatasetSnapshotRepo();
    const svc = makeService(snapRepo, undefined, undefined, undefined, new FakeDocumentRepo().seed([doc]));

    const snap = await svc.createSnapshot('Snapshot', '', ADMIN, ADMIN_ROLES, ORG);

    const storedDoc = snap.manifest.entityData.documents[0];
    expect(storedDoc).toBeDefined();
    expect((storedDoc as any).encryptedBlob).toBeUndefined();
    expect((storedDoc as any).encryptionIv).toBeUndefined();
    expect(storedDoc.id).toBe('d1');
  });

  it('entityCounts and entityIds remain consistent with entityData', async () => {
    const jobs = [makeJob({ organizationId: ORG }), makeJob({ organizationId: ORG })];
    const snapRepo = new FakeDatasetSnapshotRepo();
    const svc = makeService(snapRepo, new FakeJobRepo().seed(jobs));

    const snap = await svc.createSnapshot('Snapshot', '', ADMIN, ADMIN_ROLES, ORG);

    expect(snap.manifest.entityCounts['jobs']).toBe(2);
    expect(snap.manifest.entityIds['jobs']).toHaveLength(2);
    expect(snap.manifest.entityData.jobs).toHaveLength(2);
  });
});
