import { describe, it, expect } from 'vitest';
import { DocumentService } from '../document.service';
import { DocumentStatus, PacketStatus, UserRole } from '../../enums';
import {
  AuthorizationError, ValidationError, QuotaExceededError, NotFoundError,
} from '../../errors';
import { DOCUMENT_CONSTANTS } from '../../constants';
import {
  FakeDocumentRepo, FakeDocumentQuotaRepo, FakeApplicationPacketRepo,
  FakeApplicationRepo, FakeJobRepo,
  FakeLineageRepo, FakeUserRepo, FakeInterviewRepo, FakeOrgAdminKeyRepo,
  fakeCrypto, fakeAudit, fakeNotifService,
  makeDocument, makeUser, makePacket, makeApplication, makeJob,
} from './helpers';
import { generateId, now } from '../../utils/id';

const ORG = 'org1';
const OTHER_ORG = 'org2';
const OWNER = 'candidate1';
const OTHER_USER = 'candidate2';
const EMPLOYER = 'employer1';

const CANDIDATE_ROLES  = [UserRole.Candidate];
const EMPLOYER_ROLES   = [UserRole.Employer];
const ADMIN_ROLES      = [UserRole.Administrator];
const INTERVIEWER_ROLES = [UserRole.Interviewer];

function makeService(
  docRepo           = new FakeDocumentRepo(),
  quotaRepo         = new FakeDocumentQuotaRepo(),
  packetRepo        = new FakeApplicationPacketRepo(),
  lineageRepo       = new FakeLineageRepo(),
  userRepo          = new FakeUserRepo(),
  interviewRepo     = new FakeInterviewRepo(),
  appRepo           = new FakeApplicationRepo(),
  jobRepo           = new FakeJobRepo(),
  orgAdminKeyRepo   = new FakeOrgAdminKeyRepo(),
) {
  return new DocumentService(
    docRepo as any, quotaRepo as any, packetRepo as any,
    lineageRepo as any, userRepo as any,
    interviewRepo as any,
    fakeCrypto as any, fakeAudit as any,
    appRepo as any, jobRepo as any,
    fakeNotifService as any,
    orgAdminKeyRepo as any,
  );
}

// ── Upload validation ──────────────────────────────────────────────────────

describe('DocumentService — upload validation', () => {
  it('rejects an unsupported MIME type', async () => {
    const userRepo = new FakeUserRepo().seed([makeUser({ id: OWNER })]);
    const svc = makeService(undefined, undefined, undefined, undefined, userRepo);
    await expect(
      svc.uploadDocument(
        { name: 'file.mp4', type: 'video/mp4', size: 100, data: new ArrayBuffer(100) },
        null, OWNER, ORG, 'password',
      ),
    ).rejects.toThrow(ValidationError);
  });

  it('rejects when file extension does not match MIME type', async () => {
    const userRepo = new FakeUserRepo().seed([makeUser({ id: OWNER })]);
    const svc = makeService(undefined, undefined, undefined, undefined, userRepo);
    // .png extension with application/pdf MIME — mismatch
    await expect(
      svc.uploadDocument(
        { name: 'resume.png', type: 'application/pdf', size: 100, data: new ArrayBuffer(100) },
        null, OWNER, ORG, 'password',
      ),
    ).rejects.toThrow(ValidationError);
  });

  it('rejects a file that exceeds the per-file size limit', async () => {
    const userRepo = new FakeUserRepo().seed([makeUser({ id: OWNER })]);
    const svc = makeService(undefined, undefined, undefined, undefined, userRepo);
    const oversized = DOCUMENT_CONSTANTS.MAX_FILE_SIZE_BYTES + 1;
    await expect(
      svc.uploadDocument(
        { name: 'big.pdf', type: 'application/pdf', size: oversized, data: new ArrayBuffer(oversized) },
        null, OWNER, ORG, 'password',
      ),
    ).rejects.toThrow(QuotaExceededError);
  });

  it('rejects upload when account storage quota would be exceeded', async () => {
    const userRepo = new FakeUserRepo().seed([makeUser({ id: OWNER })]);
    const quotaRepo = new FakeDocumentQuotaRepo();
    // Pre-fill quota to near the limit
    await quotaRepo.put({
      userId: OWNER,
      totalBytes: DOCUMENT_CONSTANTS.MAX_ACCOUNT_STORAGE_BYTES - 500,
      updatedAt: new Date().toISOString(),
    });
    const svc = makeService(undefined, quotaRepo, undefined, undefined, userRepo);
    await expect(
      svc.uploadDocument(
        { name: 'resume.pdf', type: 'application/pdf', size: 1000, data: new ArrayBuffer(1000) },
        null, OWNER, ORG, 'password',
      ),
    ).rejects.toThrow(QuotaExceededError);
  });
});

// ── Download — unauthorized access ────────────────────────────────────────

describe('DocumentService — unauthorized download', () => {
  it("candidate cannot download another user's document", async () => {
    const doc = makeDocument({ id: 'doc1', ownerUserId: OTHER_USER, organizationId: ORG });
    const docRepo = new FakeDocumentRepo().seed([doc]);
    const userRepo = new FakeUserRepo().seed([makeUser({ id: OTHER_USER })]);
    const svc = makeService(docRepo, undefined, undefined, undefined, userRepo);
    await expect(
      svc.downloadDocument('doc1', 'password', OWNER, CANDIDATE_ROLES, ORG),
    ).rejects.toThrow(AuthorizationError);
  });

  it('document from a different org is inaccessible (ABAC)', async () => {
    const doc = makeDocument({ id: 'doc1', ownerUserId: OWNER, organizationId: OTHER_ORG });
    const docRepo = new FakeDocumentRepo().seed([doc]);
    const userRepo = new FakeUserRepo().seed([makeUser({ id: OWNER, organizationId: OTHER_ORG })]);
    const svc = makeService(docRepo, undefined, undefined, undefined, userRepo);
    await expect(
      svc.downloadDocument('doc1', 'password', OWNER, CANDIDATE_ROLES, ORG),
    ).rejects.toThrow(AuthorizationError);
  });

  it('employer CAN download a document linked to an application for their job', async () => {
    const job = makeJob({ id: 'j1', ownerUserId: EMPLOYER, organizationId: ORG });
    const app = makeApplication({ id: 'app1', jobId: 'j1', organizationId: ORG, candidateId: OTHER_USER });
    const doc = makeDocument({ id: 'doc1', ownerUserId: OTHER_USER, applicationId: 'app1', organizationId: ORG });
    const docRepo = new FakeDocumentRepo().seed([doc]);
    const userRepo = new FakeUserRepo().seed([makeUser({ id: OTHER_USER })]);
    const svc = makeService(
      docRepo, undefined, undefined, undefined, userRepo, undefined,
      new FakeApplicationRepo().seed([app]),
      new FakeJobRepo().seed([job]),
    );
    // Should not throw
    const result = await svc.downloadDocument('doc1', 'password', EMPLOYER, EMPLOYER_ROLES, ORG);
    expect(result.fileName).toBe('resume.pdf');
  });
});

// ── Status gate — archived / rejected ─────────────────────────────────────

describe('DocumentService — status-based access control', () => {
  it('archived document cannot be downloaded by anyone', async () => {
    const doc = makeDocument({ id: 'doc1', ownerUserId: OWNER, organizationId: ORG, status: DocumentStatus.Archived });
    const docRepo = new FakeDocumentRepo().seed([doc]);
    const userRepo = new FakeUserRepo().seed([makeUser({ id: OWNER })]);
    const svc = makeService(docRepo, undefined, undefined, undefined, userRepo);
    await expect(
      svc.downloadDocument('doc1', 'password', OWNER, CANDIDATE_ROLES, ORG),
    ).rejects.toThrow(AuthorizationError);
  });

  it('archived document cannot be downloaded even by admin', async () => {
    const doc = makeDocument({ id: 'doc1', ownerUserId: OWNER, organizationId: ORG, status: DocumentStatus.Archived });
    const docRepo = new FakeDocumentRepo().seed([doc]);
    const userRepo = new FakeUserRepo().seed([makeUser({ id: OWNER })]);
    const svc = makeService(docRepo, undefined, undefined, undefined, userRepo);
    await expect(
      svc.downloadDocument('doc1', 'password', 'admin1', ADMIN_ROLES, ORG),
    ).rejects.toThrow(AuthorizationError);
  });

  it('rejected document is blocked for non-HR users', async () => {
    const doc = makeDocument({ id: 'doc1', ownerUserId: OWNER, organizationId: ORG, status: DocumentStatus.Rejected });
    const docRepo = new FakeDocumentRepo().seed([doc]);
    const userRepo = new FakeUserRepo().seed([makeUser({ id: OWNER })]);
    const svc = makeService(docRepo, undefined, undefined, undefined, userRepo);
    await expect(
      svc.downloadDocument('doc1', 'password', OWNER, CANDIDATE_ROLES, ORG),
    ).rejects.toThrow(AuthorizationError);
  });

  it('rejected document is accessible to HR for audit', async () => {
    const doc = makeDocument({ id: 'doc1', ownerUserId: OWNER, organizationId: ORG, status: DocumentStatus.Rejected });
    const docRepo = new FakeDocumentRepo().seed([doc]);
    const userRepo = new FakeUserRepo().seed([makeUser({ id: OWNER })]);
    const svc = makeService(docRepo, undefined, undefined, undefined, userRepo);
    // Should not throw — HR can access rejected docs for audit purposes
    const result = await svc.downloadDocument('doc1', 'password', 'hr1', [UserRole.HRCoordinator], ORG);
    expect(result.fileName).toBe('resume.pdf');
  });

  it('archived document is also blocked by getDocument', async () => {
    const doc = makeDocument({ id: 'doc1', ownerUserId: OWNER, organizationId: ORG, status: DocumentStatus.Archived });
    const docRepo = new FakeDocumentRepo().seed([doc]);
    const svc = makeService(docRepo);
    await expect(
      svc.getDocument('doc1', OWNER, CANDIDATE_ROLES, ORG),
    ).rejects.toThrow(AuthorizationError);
  });
});

// ── getDocument — unauthorized access ─────────────────────────────────────

describe('DocumentService — unauthorized getDocument', () => {
  it("candidate cannot get another user's document metadata", async () => {
    const doc = makeDocument({ id: 'doc1', ownerUserId: OTHER_USER, organizationId: ORG });
    const docRepo = new FakeDocumentRepo().seed([doc]);
    const svc = makeService(docRepo);
    await expect(
      svc.getDocument('doc1', OWNER, CANDIDATE_ROLES, ORG),
    ).rejects.toThrow(AuthorizationError);
  });

  it('document from different org is not found from caller perspective', async () => {
    const doc = makeDocument({ id: 'doc1', ownerUserId: OWNER, organizationId: OTHER_ORG });
    const docRepo = new FakeDocumentRepo().seed([doc]);
    const svc = makeService(docRepo);
    await expect(
      svc.getDocument('doc1', OWNER, CANDIDATE_ROLES, ORG),
    ).rejects.toThrow(AuthorizationError);
  });
});

// ── listByOwner — RBAC ─────────────────────────────────────────────────────

describe('DocumentService — listByOwner RBAC', () => {
  it("candidate cannot list another candidate's documents", async () => {
    const svc = makeService();
    await expect(
      svc.listByOwner(OTHER_USER, OWNER, CANDIDATE_ROLES, ORG),
    ).rejects.toThrow(AuthorizationError);
  });

  it('employer can only list documents linked to applications for their own jobs', async () => {
    const job = makeJob({ id: 'j1', ownerUserId: EMPLOYER, organizationId: ORG });
    const app = makeApplication({ id: 'app1', jobId: 'j1', organizationId: ORG, candidateId: OWNER });
    const docs = [
      makeDocument({ ownerUserId: OWNER, applicationId: 'app1', organizationId: ORG }),
      makeDocument({ ownerUserId: OWNER, applicationId: null, organizationId: ORG }),
    ];
    const docRepo = new FakeDocumentRepo().seed(docs);
    const svc = makeService(
      docRepo, undefined, undefined, undefined, undefined, undefined,
      new FakeApplicationRepo().seed([app]),
      new FakeJobRepo().seed([job]),
    );
    const result = await svc.listByOwner(OWNER, EMPLOYER, EMPLOYER_ROLES, ORG);
    expect(result).toHaveLength(1);
  });
});

// ── deleteDocument — guards ────────────────────────────────────────────────

describe('DocumentService — deleteDocument guards', () => {
  it("non-admin cannot delete another user's document", async () => {
    const doc = makeDocument({ id: 'doc1', ownerUserId: OTHER_USER, organizationId: ORG });
    const docRepo = new FakeDocumentRepo().seed([doc]);
    const svc = makeService(docRepo);
    await expect(
      svc.deleteDocument('doc1', OWNER, CANDIDATE_ROLES, ORG),
    ).rejects.toThrow(AuthorizationError);
  });

  it('cannot delete a document linked to a submitted packet', async () => {
    const doc = makeDocument({ id: 'doc1', ownerUserId: OWNER, applicationId: 'app1' });
    const docRepo = new FakeDocumentRepo().seed([doc]);
    const packetRepo = new FakeApplicationPacketRepo().seed([
      makePacket({ applicationId: 'app1', status: PacketStatus.Submitted }),
    ]);
    const svc = makeService(docRepo, undefined, packetRepo);
    await expect(
      svc.deleteDocument('doc1', OWNER, CANDIDATE_ROLES, ORG),
    ).rejects.toThrow(ValidationError);
  });

  it('cannot delete a document linked to a locked packet', async () => {
    const doc = makeDocument({ id: 'doc1', ownerUserId: OWNER, applicationId: 'app1' });
    const docRepo = new FakeDocumentRepo().seed([doc]);
    const packetRepo = new FakeApplicationPacketRepo().seed([
      makePacket({ applicationId: 'app1', status: PacketStatus.Locked }),
    ]);
    const svc = makeService(docRepo, undefined, packetRepo);
    await expect(
      svc.deleteDocument('doc1', OWNER, CANDIDATE_ROLES, ORG),
    ).rejects.toThrow(ValidationError);
  });

  it('admin CAN delete any document', async () => {
    const doc = makeDocument({ id: 'doc1', ownerUserId: OTHER_USER, organizationId: ORG });
    const docRepo = new FakeDocumentRepo().seed([doc]);
    const quotaRepo = new FakeDocumentQuotaRepo();
    await quotaRepo.put({ userId: OTHER_USER, totalBytes: 5000, updatedAt: new Date().toISOString() });
    const svc = makeService(docRepo, quotaRepo);
    // Should not throw
    await svc.deleteDocument('doc1', 'admin1', ADMIN_ROLES, ORG);
    expect(await docRepo.getById('doc1')).toBeNull();
  });
});

// ── Interviewer document access control ───────────────────────────────────────

/** Minimal interview record seeded into FakeInterviewRepo. */
function makeInterviewRecord(overrides: Record<string, unknown> = {}) {
  return {
    id: generateId(), organizationId: ORG, applicationId: 'app1',
    interviewerId: EMPLOYER, candidateId: OTHER_USER,
    startTime: now(), endTime: now(), status: 'scheduled',
    rescheduledAt: null, rescheduledBy: null,
    version: 1, createdAt: now(), updatedAt: now(),
    ...overrides,
  } as any;
}

describe('DocumentService — Interviewer document access', () => {
  it('interviewer cannot list documents for a user when they have no assigned interview', async () => {
    const doc = makeDocument({ id: 'doc1', ownerUserId: OTHER_USER, applicationId: 'app1', organizationId: ORG });
    const docRepo = new FakeDocumentRepo().seed([doc]);
    // interviewRepo is empty — this interviewer has no assigned interviews
    const svc = makeService(docRepo);
    const result = await svc.listByOwner(OTHER_USER, EMPLOYER, INTERVIEWER_ROLES, ORG);
    expect(result).toHaveLength(0);
  });

  it('interviewer cannot list a document whose applicationId does not match their assigned interview', async () => {
    // doc is linked to app2, but interviewer is only assigned to app1
    const doc = makeDocument({ id: 'doc1', ownerUserId: OTHER_USER, applicationId: 'app2', organizationId: ORG });
    const docRepo = new FakeDocumentRepo().seed([doc]);
    const interviewRepo = new FakeInterviewRepo().seed([makeInterviewRecord({ applicationId: 'app1' })]);
    const svc = makeService(docRepo, undefined, undefined, undefined, undefined, interviewRepo);
    const result = await svc.listByOwner(OTHER_USER, EMPLOYER, INTERVIEWER_ROLES, ORG);
    expect(result).toHaveLength(0);
  });

  it('interviewer CAN list a document linked to their assigned application', async () => {
    const doc = makeDocument({ id: 'doc1', ownerUserId: OTHER_USER, applicationId: 'app1', organizationId: ORG });
    const docRepo = new FakeDocumentRepo().seed([doc]);
    const interviewRepo = new FakeInterviewRepo().seed([makeInterviewRecord({ applicationId: 'app1' })]);
    const svc = makeService(docRepo, undefined, undefined, undefined, undefined, interviewRepo);
    const result = await svc.listByOwner(OTHER_USER, EMPLOYER, INTERVIEWER_ROLES, ORG);
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe('doc1');
  });

  it('interviewer cannot download a document not linked to their assigned interview', async () => {
    const doc = makeDocument({ id: 'doc1', ownerUserId: OTHER_USER, applicationId: 'app2', organizationId: ORG });
    const docRepo = new FakeDocumentRepo().seed([doc]);
    const userRepo = new FakeUserRepo().seed([makeUser({ id: OTHER_USER })]);
    // Interviewer is assigned to app1 only
    const interviewRepo = new FakeInterviewRepo().seed([makeInterviewRecord({ applicationId: 'app1' })]);
    const svc = makeService(docRepo, undefined, undefined, undefined, userRepo, interviewRepo);
    await expect(
      svc.downloadDocument('doc1', 'password', EMPLOYER, INTERVIEWER_ROLES, ORG),
    ).rejects.toThrow(AuthorizationError);
  });

  it('interviewer CAN download a document linked to their assigned application', async () => {
    const doc = makeDocument({ id: 'doc1', ownerUserId: OTHER_USER, applicationId: 'app1', organizationId: ORG });
    const docRepo = new FakeDocumentRepo().seed([doc]);
    const userRepo = new FakeUserRepo().seed([makeUser({ id: OTHER_USER })]);
    const interviewRepo = new FakeInterviewRepo().seed([makeInterviewRecord({ applicationId: 'app1' })]);
    const svc = makeService(docRepo, undefined, undefined, undefined, userRepo, interviewRepo);
    const result = await svc.downloadDocument('doc1', 'password', EMPLOYER, INTERVIEWER_ROLES, ORG);
    expect(result.fileName).toBe('resume.pdf');
  });

  it('interviewer cannot get metadata for a document not linked to their assigned interview', async () => {
    const doc = makeDocument({ id: 'doc1', ownerUserId: OTHER_USER, applicationId: 'app2', organizationId: ORG });
    const docRepo = new FakeDocumentRepo().seed([doc]);
    const interviewRepo = new FakeInterviewRepo().seed([makeInterviewRecord({ applicationId: 'app1' })]);
    const svc = makeService(docRepo, undefined, undefined, undefined, undefined, interviewRepo);
    await expect(
      svc.getDocument('doc1', EMPLOYER, INTERVIEWER_ROLES, ORG),
    ).rejects.toThrow(AuthorizationError);
  });

  it('interviewer CAN access their own documents regardless of applicationId', async () => {
    // Own documents — ownerId === actorId — Interviewer check does not apply
    const doc = makeDocument({ id: 'doc1', ownerUserId: EMPLOYER, applicationId: null, organizationId: ORG });
    const docRepo = new FakeDocumentRepo().seed([doc]);
    const svc = makeService(docRepo);
    const result = await svc.listByOwner(EMPLOYER, EMPLOYER, INTERVIEWER_ROLES, ORG);
    expect(result).toHaveLength(1);
  });
});

// ── Employer ABAC scoping ────────────────────────────────────────────────────

describe('DocumentService — Employer ABAC scoping', () => {
  it('Employer can access documents linked to their own job applications', async () => {
    const job = makeJob({ id: 'j1', ownerUserId: EMPLOYER, organizationId: ORG });
    const app = makeApplication({ id: 'app1', jobId: 'j1', organizationId: ORG, candidateId: OWNER });
    const doc = makeDocument({ id: 'doc1', ownerUserId: OWNER, applicationId: 'app1', organizationId: ORG });
    const svc = makeService(
      new FakeDocumentRepo().seed([doc]),
      undefined, undefined, undefined,
      new FakeUserRepo().seed([makeUser({ id: OWNER })]),
      undefined,
      new FakeApplicationRepo().seed([app]),
      new FakeJobRepo().seed([job]),
    );
    const result = await svc.getDocument('doc1', EMPLOYER, EMPLOYER_ROLES, ORG);
    expect(result.id).toBe('doc1');
  });

  it('Employer CANNOT access documents linked to another employer job', async () => {
    const job = makeJob({ id: 'j1', ownerUserId: 'other-employer', organizationId: ORG });
    const app = makeApplication({ id: 'app1', jobId: 'j1', organizationId: ORG, candidateId: OWNER });
    const doc = makeDocument({ id: 'doc1', ownerUserId: OWNER, applicationId: 'app1', organizationId: ORG });
    const svc = makeService(
      new FakeDocumentRepo().seed([doc]),
      undefined, undefined, undefined,
      new FakeUserRepo().seed([makeUser({ id: OWNER })]),
      undefined,
      new FakeApplicationRepo().seed([app]),
      new FakeJobRepo().seed([job]),
    );
    await expect(
      svc.getDocument('doc1', EMPLOYER, EMPLOYER_ROLES, ORG),
    ).rejects.toThrow(AuthorizationError);
  });

  it('Employer CANNOT access document with no applicationId for another user', async () => {
    const doc = makeDocument({ id: 'doc1', ownerUserId: OWNER, applicationId: null, organizationId: ORG });
    const svc = makeService(
      new FakeDocumentRepo().seed([doc]),
      undefined, undefined, undefined,
      new FakeUserRepo().seed([makeUser({ id: OWNER })]),
    );
    await expect(
      svc.getDocument('doc1', EMPLOYER, EMPLOYER_ROLES, ORG),
    ).rejects.toThrow(AuthorizationError);
  });

  it('Employer listByOwner returns only docs linked to their jobs applications', async () => {
    const job1 = makeJob({ id: 'j1', ownerUserId: EMPLOYER, organizationId: ORG });
    const job2 = makeJob({ id: 'j2', ownerUserId: 'other-employer', organizationId: ORG });
    const app1 = makeApplication({ id: 'app1', jobId: 'j1', organizationId: ORG, candidateId: OWNER });
    const app2 = makeApplication({ id: 'app2', jobId: 'j2', organizationId: ORG, candidateId: OWNER });
    const doc1 = makeDocument({ id: 'doc1', ownerUserId: OWNER, applicationId: 'app1', organizationId: ORG });
    const doc2 = makeDocument({ id: 'doc2', ownerUserId: OWNER, applicationId: 'app2', organizationId: ORG });
    const doc3 = makeDocument({ id: 'doc3', ownerUserId: OWNER, applicationId: null, organizationId: ORG });
    const svc = makeService(
      new FakeDocumentRepo().seed([doc1, doc2, doc3]),
      undefined, undefined, undefined, undefined, undefined,
      new FakeApplicationRepo().seed([app1, app2]),
      new FakeJobRepo().seed([job1, job2]),
    );
    const result = await svc.listByOwner(OWNER, EMPLOYER, EMPLOYER_ROLES, ORG);
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe('doc1');
  });

  it('HR Coordinator can still access all org documents', async () => {
    const doc = makeDocument({ id: 'doc1', ownerUserId: OWNER, organizationId: ORG });
    const svc = makeService(
      new FakeDocumentRepo().seed([doc]),
    );
    const result = await svc.getDocument('doc1', 'hr1', [UserRole.HRCoordinator], ORG);
    expect(result.id).toBe('doc1');
  });
});

// ── Cross-role document download (admin key path) ─────────────────────────
describe('DocumentService — cross-role admin-key download', () => {
  it('HR can download a document without knowing the owner password (admin key path)', async () => {
    // Doc has adminEncryptedBlob set — HR download uses admin key, ignores provided password
    const doc = makeDocument({
      id: 'doc1', ownerUserId: OWNER, organizationId: ORG,
      adminEncryptedBlob: 'enc:admin-path-data', adminEncryptionIv: 'adminiv',
    });
    const docRepo = new FakeDocumentRepo().seed([doc]);
    // userRepo does NOT need to have the owner for admin-key path
    const svc = makeService(docRepo);

    const result = await svc.downloadDocument('doc1', 'wrong-password', 'hr1', [UserRole.HRCoordinator], ORG);
    // fakeCrypto.decrypt strips 'enc:' prefix — result should be 'admin-path-data'
    expect(result.fileName).toBe('resume.pdf');
    expect(result.blob).toBeDefined();
  });

  it('Admin can download a document without knowing the owner password (admin key path)', async () => {
    const doc = makeDocument({
      id: 'doc1', ownerUserId: OWNER, organizationId: ORG,
      adminEncryptedBlob: 'enc:admin-data', adminEncryptionIv: 'iv2',
    });
    const docRepo = new FakeDocumentRepo().seed([doc]);
    const svc = makeService(docRepo);

    const result = await svc.downloadDocument('doc1', 'anything', 'admin1', ADMIN_ROLES, ORG);
    expect(result.mimeType).toBe('application/pdf');
  });

  it('owner always uses owner-key path (password-derived) even if admin key exists', async () => {
    const doc = makeDocument({
      id: 'doc1', ownerUserId: OWNER, organizationId: ORG,
      encryptedBlob: 'enc:owner-data', encryptionIv: 'owneriv',
      adminEncryptedBlob: 'enc:admin-data', adminEncryptionIv: 'adminiv',
    });
    const docRepo = new FakeDocumentRepo().seed([doc]);
    const userRepo = new FakeUserRepo().seed([makeUser({ id: OWNER })]);
    const svc = makeService(docRepo, undefined, undefined, undefined, userRepo);

    const result = await svc.downloadDocument('doc1', 'owner-password', OWNER, CANDIDATE_ROLES, ORG);
    expect(result.fileName).toBe('resume.pdf');
  });

  it('non-admin non-owner without admin key falls back to owner-key path', async () => {
    // adminEncryptedBlob is null — employer goes through owner-key path
    const doc = makeDocument({
      id: 'doc1', ownerUserId: OTHER_USER, organizationId: ORG,
      applicationId: 'app1',
      adminEncryptedBlob: null, adminEncryptionIv: null,
    });
    const job = makeJob({ id: 'j1', ownerUserId: EMPLOYER, organizationId: ORG });
    const app = makeApplication({ id: 'app1', jobId: 'j1', organizationId: ORG, candidateId: OTHER_USER });
    const docRepo = new FakeDocumentRepo().seed([doc]);
    const userRepo = new FakeUserRepo().seed([makeUser({ id: OTHER_USER })]);
    const svc = makeService(
      docRepo, undefined, undefined, undefined, userRepo, undefined,
      new FakeApplicationRepo().seed([app]),
      new FakeJobRepo().seed([job]),
    );
    // fakeCrypto.decrypt always succeeds regardless of key
    const result = await svc.downloadDocument('doc1', 'any-password', EMPLOYER, EMPLOYER_ROLES, ORG);
    expect(result.fileName).toBe('resume.pdf');
  });

  it('unauthorized role still fails even if admin key exists', async () => {
    const doc = makeDocument({
      id: 'doc1', ownerUserId: OTHER_USER, organizationId: ORG,
      adminEncryptedBlob: 'enc:data', adminEncryptionIv: 'iv',
    });
    const docRepo = new FakeDocumentRepo().seed([doc]);
    const svc = makeService(docRepo);

    // Candidate trying to download another user's doc — even with admin blob present
    await expect(
      svc.downloadDocument('doc1', 'password', OWNER, CANDIDATE_ROLES, ORG),
    ).rejects.toThrow(AuthorizationError);
  });
});
