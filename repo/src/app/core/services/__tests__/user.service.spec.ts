import { describe, it, expect, beforeEach } from 'vitest';
import { UserService } from '../user.service';
import { UserRole, AuditAction } from '../../enums';
import { AuthorizationError, NotFoundError, ValidationError, OptimisticLockError } from '../../errors';
import { FakeUserRepo, makeUser, fakeAudit, fakeNotifService } from './helpers';

const ORG = 'org1';
const OTHER_ORG = 'org2';
const ADMIN_ROLES = [UserRole.Administrator];
const EMPLOYER_ROLES = [UserRole.Employer];
const HR_ROLES = [UserRole.HRCoordinator];
const CANDIDATE_ROLES = [UserRole.Candidate];

function makeService(userRepo = new FakeUserRepo()) {
  return new UserService(userRepo as any, fakeAudit as any, fakeNotifService as any);
}

// ── getUser ───────────────────────────────────────────────────────────────────

describe('UserService — getUser', () => {
  it('management can look up any user in the same org', async () => {
    const target = makeUser({ id: 'target1', organizationId: ORG });
    const repo = new FakeUserRepo().seed([target]);
    const svc = makeService(repo);
    const result = await svc.getUser('target1', 'employer1', EMPLOYER_ROLES, ORG);
    expect(result.id).toBe('target1');
  });

  it('candidate can look up themselves', async () => {
    const candidate = makeUser({ id: 'candidate1', organizationId: ORG });
    const repo = new FakeUserRepo().seed([candidate]);
    const svc = makeService(repo);
    const result = await svc.getUser('candidate1', 'candidate1', CANDIDATE_ROLES, ORG);
    expect(result.id).toBe('candidate1');
  });

  it('candidate cannot look up another user', async () => {
    const other = makeUser({ id: 'other1', organizationId: ORG });
    const repo = new FakeUserRepo().seed([other]);
    const svc = makeService(repo);
    await expect(svc.getUser('other1', 'candidate1', CANDIDATE_ROLES, ORG)).rejects.toThrow(AuthorizationError);
  });

  it('throws AuthorizationError for cross-org access', async () => {
    const target = makeUser({ id: 'target1', organizationId: OTHER_ORG });
    const repo = new FakeUserRepo().seed([target]);
    const svc = makeService(repo);
    await expect(svc.getUser('target1', 'employer1', EMPLOYER_ROLES, ORG)).rejects.toThrow(AuthorizationError);
  });

  it('throws NotFoundError when user does not exist', async () => {
    const svc = makeService(new FakeUserRepo());
    await expect(svc.getUser('ghost', 'employer1', EMPLOYER_ROLES, ORG)).rejects.toThrow(NotFoundError);
  });
});

// ── listByOrganization ────────────────────────────────────────────────────────

describe('UserService — listByOrganization', () => {
  it('administrator gets full records including sensitive fields', async () => {
    const user = makeUser({ id: 'u1', organizationId: ORG, passwordHash: 'hash', passwordSalt: 'salt', encryptionKeySalt: 'ks' });
    const repo = new FakeUserRepo().seed([user]);
    const svc = makeService(repo);
    const results = await svc.listByOrganization(ADMIN_ROLES, ORG);
    expect((results[0] as any).passwordHash).toBe('hash');
    expect((results[0] as any).passwordSalt).toBe('salt');
    expect((results[0] as any).encryptionKeySalt).toBe('ks');
  });

  it('non-admin gets records stripped of credential fields', async () => {
    const user = makeUser({ id: 'u1', organizationId: ORG, passwordHash: 'hash', passwordSalt: 'salt', encryptionKeySalt: 'ks' });
    const repo = new FakeUserRepo().seed([user]);
    const svc = makeService(repo);
    const results = await svc.listByOrganization(EMPLOYER_ROLES, ORG);
    expect((results[0] as any).passwordHash).toBeUndefined();
    expect((results[0] as any).passwordSalt).toBeUndefined();
    expect((results[0] as any).encryptionKeySalt).toBeUndefined();
  });

  it('candidate also gets stripped records', async () => {
    const user = makeUser({ id: 'u1', organizationId: ORG, encryptionKeySalt: 'ks' });
    const repo = new FakeUserRepo().seed([user]);
    const svc = makeService(repo);
    const results = await svc.listByOrganization(CANDIDATE_ROLES, ORG);
    expect((results[0] as any).encryptionKeySalt).toBeUndefined();
  });

  it('only returns users from the actor org', async () => {
    const orgUser = makeUser({ id: 'u1', organizationId: ORG });
    const otherUser = makeUser({ id: 'u2', organizationId: OTHER_ORG });
    const repo = new FakeUserRepo().seed([orgUser, otherUser]);
    const svc = makeService(repo);
    const results = await svc.listByOrganization(EMPLOYER_ROLES, ORG);
    expect(results).toHaveLength(1);
    expect(results[0].id).toBe('u1');
  });
});

// ── updateProfile ─────────────────────────────────────────────────────────────

describe('UserService — updateProfile', () => {
  it('user can update their own profile', async () => {
    const user = makeUser({ id: 'u1', organizationId: ORG, displayName: 'Old Name', version: 1 });
    const repo = new FakeUserRepo().seed([user]);
    const svc = makeService(repo);
    const updated = await svc.updateProfile('u1', { displayName: 'New Name' }, 'u1', ORG, 1);
    expect(updated.displayName).toBe('New Name');
    expect(updated.version).toBe(2);
  });

  it('user cannot update another user\'s profile', async () => {
    const target = makeUser({ id: 'target1', organizationId: ORG, version: 1 });
    const repo = new FakeUserRepo().seed([target]);
    const svc = makeService(repo);
    await expect(svc.updateProfile('target1', { displayName: 'X' }, 'other', ORG, 1)).rejects.toThrow(AuthorizationError);
  });

  it('throws OptimisticLockError when version mismatch', async () => {
    const user = makeUser({ id: 'u1', organizationId: ORG, version: 2 });
    const repo = new FakeUserRepo().seed([user]);
    const svc = makeService(repo);
    await expect(svc.updateProfile('u1', { displayName: 'X' }, 'u1', ORG, 1)).rejects.toThrow(OptimisticLockError);
  });

  it('throws AuthorizationError for cross-org update', async () => {
    const user = makeUser({ id: 'u1', organizationId: OTHER_ORG, version: 1 });
    const repo = new FakeUserRepo().seed([user]);
    const svc = makeService(repo);
    await expect(svc.updateProfile('u1', { displayName: 'X' }, 'u1', ORG, 1)).rejects.toThrow(AuthorizationError);
  });

  it('throws NotFoundError when user does not exist', async () => {
    const svc = makeService(new FakeUserRepo());
    await expect(svc.updateProfile('ghost', { displayName: 'X' }, 'ghost', ORG, 1)).rejects.toThrow(NotFoundError);
  });
});

// ── changeRoles ───────────────────────────────────────────────────────────────

describe('UserService — changeRoles', () => {
  it('administrator can change roles', async () => {
    const target = makeUser({ id: 'target1', organizationId: ORG, roles: ['candidate'] });
    const repo = new FakeUserRepo().seed([target]);
    const svc = makeService(repo);
    const updated = await svc.changeRoles('target1', [UserRole.Employer], 'admin1', ADMIN_ROLES, ORG);
    expect(updated.roles).toContain(UserRole.Employer);
  });

  it('non-admin throws AuthorizationError and logs PrivilegeEscalation', async () => {
    const target = makeUser({ id: 'target1', organizationId: ORG });
    const repo = new FakeUserRepo().seed([target]);
    const auditCalls: unknown[] = [];
    const trackingAudit = {
      log: async (...args: unknown[]) => { auditCalls.push(args); },
    };
    const svc = new UserService(repo as any, trackingAudit as any, fakeNotifService as any);
    await expect(svc.changeRoles('target1', [UserRole.Administrator], 'notadmin', EMPLOYER_ROLES, ORG))
      .rejects.toThrow(AuthorizationError);
    expect(auditCalls.length).toBeGreaterThan(0);
    const firstCall = auditCalls[0] as unknown[];
    expect(firstCall[1]).toBe(AuditAction.PrivilegeEscalation);
  });

  it('throws ValidationError when newRoles is empty', async () => {
    const target = makeUser({ id: 'target1', organizationId: ORG });
    const repo = new FakeUserRepo().seed([target]);
    const svc = makeService(repo);
    await expect(svc.changeRoles('target1', [], 'admin1', ADMIN_ROLES, ORG)).rejects.toThrow(ValidationError);
  });

  it('throws AuthorizationError for cross-org role change', async () => {
    const target = makeUser({ id: 'target1', organizationId: OTHER_ORG });
    const repo = new FakeUserRepo().seed([target]);
    const svc = makeService(repo);
    await expect(svc.changeRoles('target1', [UserRole.Employer], 'admin1', ADMIN_ROLES, ORG)).rejects.toThrow(AuthorizationError);
  });

  it('throws NotFoundError when target does not exist', async () => {
    const svc = makeService(new FakeUserRepo());
    await expect(svc.changeRoles('ghost', [UserRole.Employer], 'admin1', ADMIN_ROLES, ORG)).rejects.toThrow(NotFoundError);
  });
});

// ── deactivateUser ────────────────────────────────────────────────────────────

describe('UserService — deactivateUser', () => {
  it('administrator can deactivate another user', async () => {
    const target = makeUser({ id: 'target1', organizationId: ORG, deactivatedAt: null });
    const repo = new FakeUserRepo().seed([target]);
    const svc = makeService(repo);
    const result = await svc.deactivateUser('target1', 'admin1', ADMIN_ROLES, ORG);
    expect(result.deactivatedAt).not.toBeNull();
  });

  it('non-admin cannot deactivate', async () => {
    const target = makeUser({ id: 'target1', organizationId: ORG });
    const repo = new FakeUserRepo().seed([target]);
    const svc = makeService(repo);
    await expect(svc.deactivateUser('target1', 'employer1', EMPLOYER_ROLES, ORG)).rejects.toThrow(AuthorizationError);
  });

  it('admin cannot deactivate themselves', async () => {
    const admin = makeUser({ id: 'admin1', organizationId: ORG, roles: ['administrator'] });
    const repo = new FakeUserRepo().seed([admin]);
    const svc = makeService(repo);
    await expect(svc.deactivateUser('admin1', 'admin1', ADMIN_ROLES, ORG)).rejects.toThrow(ValidationError);
  });

  it('throws AuthorizationError for cross-org deactivation', async () => {
    const target = makeUser({ id: 'target1', organizationId: OTHER_ORG });
    const repo = new FakeUserRepo().seed([target]);
    const svc = makeService(repo);
    await expect(svc.deactivateUser('target1', 'admin1', ADMIN_ROLES, ORG)).rejects.toThrow(AuthorizationError);
  });

  it('throws NotFoundError when target does not exist', async () => {
    const svc = makeService(new FakeUserRepo());
    await expect(svc.deactivateUser('ghost', 'admin1', ADMIN_ROLES, ORG)).rejects.toThrow(NotFoundError);
  });
});
