import { describe, it, expect, beforeEach } from 'vitest';
import { AuditService } from '../audit.service';
import { AuditLog, AuditSearchParams } from '../../models';
import { AuditAction, UserRole } from '../../enums';
import { AuthorizationError } from '../../errors';
import { fakeCrypto } from './helpers';

// ── Inline FakeAuditLogRepo ───────────────────────────────────────────────────

class FakeAuditLogRepo {
  private logs: AuditLog[] = [];
  async getLast(): Promise<AuditLog | null> { return this.logs[this.logs.length - 1] ?? null; }
  async append(entry: AuditLog): Promise<void> { this.logs.push(entry); }
  async getByActor(actorId: string): Promise<AuditLog[]> { return this.logs.filter(l => l.actorId === actorId); }
  async getByDateRange(start: string, end: string): Promise<AuditLog[]> {
    return this.logs.filter(l => l.timestamp >= start && l.timestamp <= end);
  }
  async getAll(): Promise<AuditLog[]> { return [...this.logs]; }
}

const ORG = 'org1';
const OTHER_ORG = 'org2';
const ADMIN_ROLES = [UserRole.Administrator];
const HR_ROLES = [UserRole.HRCoordinator];
const EMPLOYER_ROLES = [UserRole.Employer];

function makeService(repo = new FakeAuditLogRepo()) {
  return { svc: new AuditService(repo as any, fakeCrypto as any), repo };
}

// ── log() — hash chaining ─────────────────────────────────────────────────────

describe('AuditService — log()', () => {
  it('creates an entry with previousHash of 64 zeros for the very first log', async () => {
    const { svc } = makeService();
    const entry = await svc.log('actor1', AuditAction.Login, 'session', 'sess1', ORG);
    expect(entry.previousHash).toBe('0'.repeat(64));
    expect(entry.entryHash).toBeTruthy();
  });

  it('chains hashes — second entry previousHash equals first entry entryHash', async () => {
    const { svc } = makeService();
    const first = await svc.log('actor1', AuditAction.Login, 'session', 's1', ORG);
    const second = await svc.log('actor1', AuditAction.Logout, 'session', 's1', ORG);
    expect(second.previousHash).toBe(first.entryHash);
  });

  it('stores actor, action, entityType, entityId, organizationId correctly', async () => {
    const { svc } = makeService();
    const entry = await svc.log('actor1', AuditAction.Register, 'user', 'u1', ORG, { extra: 'data' });
    expect(entry.actorId).toBe('actor1');
    expect(entry.action).toBe(AuditAction.Register);
    expect(entry.entityType).toBe('user');
    expect(entry.entityId).toBe('u1');
    expect(entry.organizationId).toBe(ORG);
    expect(entry.metadata).toEqual({ extra: 'data' });
  });

  it('generates a unique id for each log entry', async () => {
    const { svc } = makeService();
    const a = await svc.log('actor1', AuditAction.Login, 'session', 's1', ORG);
    const b = await svc.log('actor1', AuditAction.Login, 'session', 's2', ORG);
    expect(a.id).not.toBe(b.id);
  });
});

// ── search() — RBAC ───────────────────────────────────────────────────────────

describe('AuditService — search() RBAC', () => {
  it('Administrator can search', async () => {
    const { svc } = makeService();
    await svc.log('actor1', AuditAction.Login, 'session', 's1', ORG);
    const results = await svc.search({}, 'admin1', ADMIN_ROLES, ORG);
    expect(results).toHaveLength(1);
  });

  it('HRCoordinator can search', async () => {
    const { svc } = makeService();
    await svc.log('actor1', AuditAction.Login, 'session', 's1', ORG);
    const results = await svc.search({}, 'hr1', HR_ROLES, ORG);
    expect(results).toHaveLength(1);
  });

  it('Employer cannot search — throws AuthorizationError', async () => {
    const { svc } = makeService();
    await expect(svc.search({}, 'emp1', EMPLOYER_ROLES, ORG)).rejects.toThrow(AuthorizationError);
  });

  it('Candidate cannot search — throws AuthorizationError', async () => {
    const { svc } = makeService();
    await expect(svc.search({}, 'cand1', [UserRole.Candidate], ORG)).rejects.toThrow(AuthorizationError);
  });
});

// ── search() — ABAC org scoping ───────────────────────────────────────────────

describe('AuditService — search() org scoping', () => {
  it('scopes results to actorOrgId and ignores params.organizationId', async () => {
    const { svc } = makeService();
    await svc.log('actor1', AuditAction.Login, 'session', 's1', ORG);
    await svc.log('actor2', AuditAction.Login, 'session', 's2', OTHER_ORG);

    // Pass OTHER_ORG as params.organizationId — should still only return ORG logs
    const params: AuditSearchParams = { organizationId: OTHER_ORG } as any;
    const results = await svc.search(params, 'admin1', ADMIN_ROLES, ORG);
    expect(results).toHaveLength(1);
    expect(results[0].organizationId).toBe(ORG);
  });

  it('filters by actorId when provided', async () => {
    const { svc } = makeService();
    await svc.log('actor1', AuditAction.Login, 'session', 's1', ORG);
    await svc.log('actor2', AuditAction.Login, 'session', 's2', ORG);
    const results = await svc.search({ actorId: 'actor1' }, 'admin1', ADMIN_ROLES, ORG);
    expect(results).toHaveLength(1);
    expect(results[0].actorId).toBe('actor1');
  });

  it('filters by action when provided', async () => {
    const { svc } = makeService();
    await svc.log('actor1', AuditAction.Login, 'session', 's1', ORG);
    await svc.log('actor1', AuditAction.Logout, 'session', 's1', ORG);
    const results = await svc.search({ action: AuditAction.Login }, 'admin1', ADMIN_ROLES, ORG);
    expect(results).toHaveLength(1);
    expect(results[0].action).toBe(AuditAction.Login);
  });
});

// ── verifyIntegrity() ─────────────────────────────────────────────────────────

describe('AuditService — verifyIntegrity()', () => {
  it('returns valid:true for a clean chain', async () => {
    const { svc } = makeService();
    await svc.log('actor1', AuditAction.Login, 'session', 's1', ORG);
    await svc.log('actor1', AuditAction.Logout, 'session', 's1', ORG);
    const result = await svc.verifyIntegrity(ADMIN_ROLES);
    expect(result.valid).toBe(true);
    expect(result.brokenAt).toBeUndefined();
  });

  it('returns valid:true for empty log store', async () => {
    const { svc } = makeService();
    const result = await svc.verifyIntegrity(ADMIN_ROLES);
    expect(result.valid).toBe(true);
  });

  it('detects a tampered previousHash and returns brokenAt', async () => {
    const repo = new FakeAuditLogRepo();
    const { svc } = makeService(repo);
    await svc.log('actor1', AuditAction.Login, 'session', 's1', ORG);
    await svc.log('actor1', AuditAction.Logout, 'session', 's1', ORG);

    // Tamper: manipulate the second log's previousHash directly by inserting a bad entry
    const all = await repo.getAll();
    // Corrupt the first entry's previousHash (which should be 64 zeros)
    (all[0] as any).previousHash = 'tampered';
    // Re-append a fresh repo with tampered data
    const tamperedRepo = new FakeAuditLogRepo();
    for (const log of all) {
      await tamperedRepo.append(log);
    }
    const tamperedSvc = new AuditService(tamperedRepo as any, fakeCrypto as any);
    const result = await tamperedSvc.verifyIntegrity(ADMIN_ROLES);
    expect(result.valid).toBe(false);
    expect(result.brokenAt).toBe(all[0].id);
  });

  it('throws AuthorizationError for non-administrator', async () => {
    const { svc } = makeService();
    await expect(svc.verifyIntegrity(HR_ROLES)).rejects.toThrow(AuthorizationError);
    await expect(svc.verifyIntegrity(EMPLOYER_ROLES)).rejects.toThrow(AuthorizationError);
  });
});
