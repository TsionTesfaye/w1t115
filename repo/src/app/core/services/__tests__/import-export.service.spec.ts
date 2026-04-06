import { describe, it, expect } from 'vitest';
import { ImportExportService } from '../import-export.service';
import { ImportStrategy, JobStatus, ApplicationStatus, ApplicationStage,
         InterviewStatus, ContentPostStatus, UserRole } from '../../enums';
import { AuthorizationError, ValidationError } from '../../errors';
import {
  FakeJobRepo, FakeApplicationRepo, FakeInterviewRepo,
  FakeContentPostRepo, FakeUserRepo, FakeLineageRepo,
  fakeCrypto, fakeAudit, makeJob, makeApplication,
} from './helpers';
import { generateId, now } from '../../utils/id';

const ORG       = 'org1';
const OTHER_ORG = 'org2';
const ADMIN_ID  = 'admin1';
const ADMIN_ROLES   = [UserRole.Administrator];
const EMPLOYER_ROLES = [UserRole.Employer];

function makeService(jobRepo = new FakeJobRepo(), appRepo = new FakeApplicationRepo()) {
  return new ImportExportService(
    jobRepo as any, appRepo as any,
    new FakeUserRepo() as any,
    new FakeInterviewRepo() as any,
    new FakeContentPostRepo() as any,
    fakeAudit as any,
    fakeCrypto as any,
  );
}

/** Minimal valid job record for import. */
function validJobRecord(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: generateId(), organizationId: ORG, ownerUserId: 'employer1',
    title: 'Test Job', description: 'Description', status: JobStatus.Active,
    tags: [], topics: [], version: 1, createdAt: now(), updatedAt: now(),
    ...overrides,
  };
}

/** Minimal valid application record for import. */
function validAppRecord(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: generateId(), organizationId: ORG, jobId: 'job1',
    candidateId: 'candidate1', stage: ApplicationStage.Submitted,
    status: ApplicationStatus.Active,
    offerExpiresAt: null, submittedAt: now(),
    version: 1, createdAt: now(), updatedAt: now(),
    ...overrides,
  };
}

/** Minimal valid interview record for import. */
function validInterviewRecord(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: generateId(), organizationId: ORG, applicationId: 'app1',
    interviewerId: 'int1', candidateId: 'candidate1',
    startTime: new Date(Date.now() + 3600_000).toISOString(),
    endTime:   new Date(Date.now() + 7200_000).toISOString(),
    status: InterviewStatus.Scheduled,
    version: 1, createdAt: now(), updatedAt: now(),
    ...overrides,
  };
}

// ── Authorization ──────────────────────────────────────────────────────────

describe('ImportExportService — authorization', () => {
  it('non-admin cannot export', async () => {
    const svc = makeService();
    await expect(
      svc.exportJson('jobs', ADMIN_ID, EMPLOYER_ROLES, ORG),
    ).rejects.toThrow(AuthorizationError);
  });

  it('non-admin cannot preview import', async () => {
    const svc = makeService();
    await expect(
      svc.previewImport('jobs', [validJobRecord()], EMPLOYER_ROLES, ORG),
    ).rejects.toThrow(AuthorizationError);
  });

  it('non-admin cannot apply import', async () => {
    const svc = makeService();
    await expect(
      svc.applyImport('jobs', [validJobRecord()], ImportStrategy.Skip, 'fake-token', ADMIN_ID, EMPLOYER_ROLES, ORG),
    ).rejects.toThrow(AuthorizationError);
  });
});

// ── Preview-gate enforcement ───────────────────────────────────────────────

describe('ImportExportService — preview token gate', () => {
  it('applyImport without a token throws ValidationError', async () => {
    const svc = makeService();
    await expect(
      svc.applyImport('jobs', [validJobRecord()], ImportStrategy.Overwrite, 'not-a-token', ADMIN_ID, ADMIN_ROLES, ORG),
    ).rejects.toThrow(ValidationError);
  });

  it('token is single-use: second call with same token throws ValidationError', async () => {
    const svc = makeService();
    const data = [validJobRecord()];
    const { importToken } = await svc.previewImport('jobs', data, ADMIN_ROLES, ORG);

    // First apply — consumes token
    await svc.applyImport('jobs', data, ImportStrategy.Skip, importToken, ADMIN_ID, ADMIN_ROLES, ORG);

    // Second apply with same token — must fail
    await expect(
      svc.applyImport('jobs', data, ImportStrategy.Skip, importToken, ADMIN_ID, ADMIN_ROLES, ORG),
    ).rejects.toThrow(ValidationError);
  });

  it('token entity type mismatch throws ValidationError', async () => {
    const svc = makeService();
    const data = [validJobRecord()];
    const { importToken } = await svc.previewImport('jobs', data, ADMIN_ROLES, ORG);

    // Try to apply as 'applications' using a token issued for 'jobs'
    await expect(
      svc.applyImport('applications', [validAppRecord()], ImportStrategy.Skip, importToken, ADMIN_ID, ADMIN_ROLES, ORG),
    ).rejects.toThrow(ValidationError);
  });

  it('token data-count mismatch throws ValidationError', async () => {
    const svc = makeService();
    const data = [validJobRecord()];
    const { importToken } = await svc.previewImport('jobs', data, ADMIN_ROLES, ORG);

    // Apply with a different number of records
    const moreDdata = [validJobRecord(), validJobRecord()];
    await expect(
      svc.applyImport('jobs', moreDdata, ImportStrategy.Skip, importToken, ADMIN_ID, ADMIN_ROLES, ORG),
    ).rejects.toThrow(ValidationError);
  });
});

// ── Schema validation — missing / empty required fields ────────────────────

describe('ImportExportService — missing required fields', () => {
  it('missing "title" field is reported in preview conflicts', async () => {
    const svc = makeService();
    const bad = validJobRecord({ title: '' }); // empty required field
    const { conflicts } = await svc.previewImport('jobs', [bad], ADMIN_ROLES, ORG);
    expect(conflicts.length).toBeGreaterThan(0);
    expect(conflicts[0]).toContain('title');
  });

  it('missing "status" field is reported in preview conflicts', async () => {
    const svc = makeService();
    const { status: _, ...noStatus } = validJobRecord();
    const { conflicts } = await svc.previewImport('jobs', [noStatus], ADMIN_ROLES, ORG);
    expect(conflicts.length).toBeGreaterThan(0);
    expect(conflicts[0]).toContain('status');
  });

  it('missing "stage" field in application record is reported', async () => {
    const svc = makeService();
    const { stage: _, ...noStage } = validAppRecord();
    const { conflicts } = await svc.previewImport('applications', [noStage], ADMIN_ROLES, ORG);
    expect(conflicts.length).toBeGreaterThan(0);
    expect(conflicts[0]).toContain('stage');
  });

  it('interview missing startTime is reported', async () => {
    const svc = makeService();
    const { startTime: _, ...noStart } = validInterviewRecord();
    const { conflicts } = await svc.previewImport('interviews', [noStart], ADMIN_ROLES, ORG);
    expect(conflicts.length).toBeGreaterThan(0);
    expect(conflicts[0]).toContain('startTime');
  });
});

// ── Schema validation — enum values ───────────────────────────────────────

describe('ImportExportService — enum validation', () => {
  it('invalid job status is rejected in preview', async () => {
    const svc = makeService();
    const bad = validJobRecord({ status: 'in-review' }); // not a valid JobStatus
    const { conflicts } = await svc.previewImport('jobs', [bad], ADMIN_ROLES, ORG);
    expect(conflicts.some(c => c.includes('status'))).toBe(true);
  });

  it('invalid application stage is rejected in preview', async () => {
    const svc = makeService();
    const bad = validAppRecord({ stage: 'accepted' }); // not a valid ApplicationStage
    const { conflicts } = await svc.previewImport('applications', [bad], ADMIN_ROLES, ORG);
    expect(conflicts.some(c => c.includes('stage'))).toBe(true);
  });

  it('invalid application status is rejected in preview', async () => {
    const svc = makeService();
    const bad = validAppRecord({ status: 'pending' }); // not a valid ApplicationStatus
    const { conflicts } = await svc.previewImport('applications', [bad], ADMIN_ROLES, ORG);
    expect(conflicts.some(c => c.includes('status'))).toBe(true);
  });

  it('invalid interview status is rejected in preview', async () => {
    const svc = makeService();
    const bad = validInterviewRecord({ status: 'no-show' }); // not a valid InterviewStatus
    const { conflicts } = await svc.previewImport('interviews', [bad], ADMIN_ROLES, ORG);
    expect(conflicts.some(c => c.includes('status'))).toBe(true);
  });

  it('invalid date string for startTime is rejected', async () => {
    const svc = makeService();
    const bad = validInterviewRecord({ startTime: 'not-a-date' });
    const { conflicts } = await svc.previewImport('interviews', [bad], ADMIN_ROLES, ORG);
    expect(conflicts.some(c => c.includes('startTime'))).toBe(true);
  });
});

// ── ABAC — organization boundary ──────────────────────────────────────────

describe('ImportExportService — organization boundary', () => {
  it('records from a different org are reported as conflicts in preview', async () => {
    const svc = makeService();
    const foreign = validJobRecord({ organizationId: OTHER_ORG });
    const { conflicts } = await svc.previewImport('jobs', [foreign], ADMIN_ROLES, ORG);
    expect(conflicts.some(c => c.includes('organizationId'))).toBe(true);
  });

  it('foreign-org records are skipped (not imported) in applyImport', async () => {
    const svc = makeService();
    const foreign = validJobRecord({ organizationId: OTHER_ORG });
    const data = [foreign];
    const { importToken } = await svc.previewImport('jobs', data, ADMIN_ROLES, ORG);
    const { imported, skipped } = await svc.applyImport('jobs', data, ImportStrategy.Overwrite, importToken, ADMIN_ID, ADMIN_ROLES, ORG);
    expect(imported).toBe(0);
    expect(skipped).toBe(1);
  });

  it('audit logs cannot be imported', async () => {
    const svc = makeService();
    await expect(
      svc.previewImport('auditLogs', [{}], ADMIN_ROLES, ORG),
    ).rejects.toThrow(ValidationError);
  });

  it('unsupported entity type is rejected', async () => {
    const svc = makeService();
    await expect(
      svc.previewImport('sessions', [{}], ADMIN_ROLES, ORG),
    ).rejects.toThrow(ValidationError);
  });
});

// ── Safe merge / overwrite ─────────────────────────────────────────────────

describe('ImportExportService — safe merge and overwrite', () => {
  it('Overwrite preserves existing organizationId (cannot be changed by import)', async () => {
    const existing = makeJob({ id: 'job1', organizationId: ORG, version: 2 });
    const jobRepo = new FakeJobRepo().seed([existing]);
    const svc = makeService(jobRepo);

    const rec = validJobRecord({ id: 'job1', organizationId: ORG, title: 'Updated Title' });
    const data = [rec];
    const { importToken } = await svc.previewImport('jobs', data, ADMIN_ROLES, ORG);
    await svc.applyImport('jobs', data, ImportStrategy.Overwrite, importToken, ADMIN_ID, ADMIN_ROLES, ORG);

    const updated = await jobRepo.getById('job1');
    expect(updated!.organizationId).toBe(ORG);
    expect(updated!.title).toBe('Updated Title');
    // Version must have incremented (not taken verbatim from import payload)
    expect(updated!.version).toBe(3); // was 2, incremented to 3
  });

  it('Merge only updates mutable fields, preserves non-mutable fields', async () => {
    const existing = makeJob({
      id: 'job1', organizationId: ORG, ownerUserId: 'original-owner',
      title: 'Original Title', status: JobStatus.Active, version: 1,
    });
    const jobRepo = new FakeJobRepo().seed([existing]);
    const svc = makeService(jobRepo);

    const rec = validJobRecord({
      id: 'job1', organizationId: ORG,
      ownerUserId: 'hacker', // attempt to change ownership via merge
      title: 'Merged Title', status: JobStatus.Closed,
    });
    const data = [rec];
    const { importToken } = await svc.previewImport('jobs', data, ADMIN_ROLES, ORG);
    await svc.applyImport('jobs', data, ImportStrategy.Merge, importToken, ADMIN_ID, ADMIN_ROLES, ORG);

    const merged = await jobRepo.getById('job1');
    // Mutable field updated
    expect(merged!.title).toBe('Merged Title');
    // Non-mutable ownership field preserved from original
    expect(merged!.ownerUserId).toBe('original-owner');
  });

  it('Skip leaves an existing record untouched', async () => {
    const existing = makeJob({ id: 'job1', title: 'Keep Me', version: 5 });
    const jobRepo = new FakeJobRepo().seed([existing]);
    const svc = makeService(jobRepo);

    const rec = validJobRecord({ id: 'job1', title: 'Overwrite Me' });
    const data = [rec];
    const { importToken } = await svc.previewImport('jobs', data, ADMIN_ROLES, ORG);
    await svc.applyImport('jobs', data, ImportStrategy.Skip, importToken, ADMIN_ID, ADMIN_ROLES, ORG);

    const untouched = await jobRepo.getById('job1');
    expect(untouched!.title).toBe('Keep Me');
    expect(untouched!.version).toBe(5);
  });

  it('new records get version:1 regardless of imported version', async () => {
    const svc = makeService();
    const rec = validJobRecord({ version: 99 }); // attacker sets a high version
    const data = [rec];
    const { importToken } = await svc.previewImport('jobs', data, ADMIN_ROLES, ORG);
    const jobRepo = (svc as any).jobRepo as FakeJobRepo;
    await svc.applyImport('jobs', data, ImportStrategy.Overwrite, importToken, ADMIN_ID, ADMIN_ROLES, ORG);

    const created = jobRepo.snapshot()[0];
    expect(created.version).toBe(1);
  });
});

// ── Empty / malformed input ────────────────────────────────────────────────

describe('ImportExportService — malformed input', () => {
  it('empty data array throws ValidationError', async () => {
    const svc = makeService();
    await expect(
      svc.previewImport('jobs', [], ADMIN_ROLES, ORG),
    ).rejects.toThrow(ValidationError);
  });

  it('non-array data throws ValidationError', async () => {
    const svc = makeService();
    await expect(
      svc.previewImport('jobs', 'not-an-array' as any, ADMIN_ROLES, ORG),
    ).rejects.toThrow(ValidationError);
  });
});
