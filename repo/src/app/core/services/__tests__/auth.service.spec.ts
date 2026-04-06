/**
 * AuthService tests
 *
 * Tests cover: register, login (success/failure/CAPTCHA/lockout),
 * validateSession (happy/expired/locked/deactivated), and logout.
 *
 * No IndexedDB — all repos are in-memory FakeStore instances.
 * No real crypto — fakeCrypto / failingCrypto stubs are used so tests are fast.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { AuthService } from '../auth.service';
import { CaptchaRequiredError, LockoutError } from '../../errors';
import {
  FakeUserRepo, FakeSessionRepo,
  fakeAudit, fakeCrypto, failingCrypto,
  makeUser, makeSession,
} from './helpers';

// ── Factory helpers ─────────────────────────────────────────────────────────

function makeSvc(
  userRepo = new FakeUserRepo(),
  sessionRepo = new FakeSessionRepo(),
  crypto: any = fakeCrypto,
) {
  return new AuthService(userRepo as any, sessionRepo as any, crypto, fakeAudit as any);
}

// ── register ────────────────────────────────────────────────────────────────

describe('AuthService.register', () => {
  it('creates a user and returns it', async () => {
    const svc = makeSvc();
    const user = await svc.register('alice', 'password1', 'Alice', 'org1', 'dept1');
    expect(user.username).toBe('alice');
    expect(user.organizationId).toBe('org1');
    expect(user.passwordHash).toBeTruthy();
  });

  it('throws ConflictError for duplicate username', async () => {
    const repo = new FakeUserRepo().seed([makeUser({ username: 'alice' })]);
    const svc = makeSvc(repo);
    await expect(svc.register('alice', 'password1', 'Alice', 'org1', 'dept1'))
      .rejects.toThrow('Username already exists');
  });

  it('throws ValidationError when required fields are missing', async () => {
    const svc = makeSvc();
    await expect(svc.register('', 'password1', 'Alice', 'org1', 'dept1'))
      .rejects.toThrow('required');
    await expect(svc.register('alice', '', 'Alice', 'org1', 'dept1'))
      .rejects.toThrow('required');
    await expect(svc.register('alice', 'password1', '', 'org1', 'dept1'))
      .rejects.toThrow('required');
    await expect(svc.register('alice', 'password1', 'Alice', '', 'dept1'))
      .rejects.toThrow('required');
  });

  it('throws ValidationError for password shorter than 8 characters', async () => {
    const svc = makeSvc();
    await expect(svc.register('alice', 'short', 'Alice', 'org1', 'dept1'))
      .rejects.toThrow('8 characters');
  });
});

// ── login ────────────────────────────────────────────────────────────────────

describe('AuthService.login', () => {
  it('returns user and session on success', async () => {
    const repo = new FakeUserRepo().seed([makeUser({ username: 'alice', failedAttempts: 0 })]);
    const svc = makeSvc(repo);
    const { user, session } = await svc.login('alice', 'anypassword');
    expect(user.username).toBe('alice');
    expect(session.userId).toBe(user.id);
    expect(session.isLocked).toBe(false);
  });

  it('throws AuthenticationError for unknown username', async () => {
    const svc = makeSvc();
    await expect(svc.login('nobody', 'pass')).rejects.toThrow('Invalid credentials');
  });

  it('throws AuthenticationError for deactivated user', async () => {
    const repo = new FakeUserRepo().seed([makeUser({ username: 'alice', deactivatedAt: new Date().toISOString() })]);
    const svc = makeSvc(repo);
    await expect(svc.login('alice', 'pass')).rejects.toThrow('Invalid credentials');
  });

  it('throws AuthenticationError on wrong password (below CAPTCHA threshold)', async () => {
    const repo = new FakeUserRepo().seed([makeUser({ username: 'alice', failedAttempts: 0 })]);
    const svc = makeSvc(repo, undefined, failingCrypto);
    // failedAttempts goes from 0 → 1 → 2 over 2 wrong-password calls; 2 < CAPTCHA_THRESHOLD(3)
    await expect(svc.login('alice', 'wrong')).rejects.toThrow('Invalid credentials');
    await expect(svc.login('alice', 'wrong')).rejects.toThrow('Invalid credentials');
  });

  it('throws CaptchaRequiredError when failedAttempts reaches CAPTCHA_THRESHOLD without captcha', async () => {
    // After 3 failed logins the next attempt without a captcha should throw CaptchaRequiredError.
    const repo = new FakeUserRepo().seed([makeUser({ username: 'alice', failedAttempts: 3 })]);
    const svc = makeSvc(repo);
    await expect(svc.login('alice', 'anypassword')).rejects.toThrow(CaptchaRequiredError);
  });

  it('passes CAPTCHA gate and logs in when correct captcha is provided', async () => {
    const repo = new FakeUserRepo().seed([makeUser({ username: 'alice', failedAttempts: 3 })]);
    const svc = makeSvc(repo);
    const display = svc.generateCaptcha();
    const answer = (svc as any).captchas.get(display.id)!.answer as string;
    const { user } = await svc.login('alice', 'anypassword', display.id, answer);
    expect(user.username).toBe('alice');
    expect(user.failedAttempts).toBe(0);
  });

  it('throws AuthenticationError for wrong captcha answer', async () => {
    const repo = new FakeUserRepo().seed([makeUser({ username: 'alice', failedAttempts: 3 })]);
    const svc = makeSvc(repo);
    const display = svc.generateCaptcha();
    await expect(svc.login('alice', 'anypassword', display.id, 'WRONGANSWER'))
      .rejects.toThrow('Invalid CAPTCHA');
  });

  it('throws LockoutError when MAX_FAILED_ATTEMPTS is reached', async () => {
    // failedAttempts=4 means one more wrong password triggers lockout (threshold=5).
    // Need valid captcha since 4 >= CAPTCHA_THRESHOLD(3).
    const repo = new FakeUserRepo().seed([makeUser({ username: 'alice', failedAttempts: 4 })]);
    const svc = makeSvc(repo, undefined, failingCrypto);
    const display = svc.generateCaptcha();
    const answer = (svc as any).captchas.get(display.id)!.answer as string;
    await expect(svc.login('alice', 'wrong', display.id, answer)).rejects.toThrow(LockoutError);
  });

  it('auto-clears an expired lockout and allows login', async () => {
    const expiredLockout = new Date(Date.now() - 1000).toISOString();
    const repo = new FakeUserRepo().seed([
      makeUser({ username: 'alice', lockoutUntil: expiredLockout, failedAttempts: 5 }),
    ]);
    const svc = makeSvc(repo);
    const { user } = await svc.login('alice', 'anypassword');
    expect(user.lockoutUntil).toBeNull();
    expect(user.failedAttempts).toBe(0);
  });

  it('throws LockoutError when lockout has NOT yet expired', async () => {
    const futureLockout = new Date(Date.now() + 60_000).toISOString();
    const repo = new FakeUserRepo().seed([
      makeUser({ username: 'alice', lockoutUntil: futureLockout, failedAttempts: 5 }),
    ]);
    const svc = makeSvc(repo);
    await expect(svc.login('alice', 'anypassword')).rejects.toThrow(LockoutError);
  });

  it('throws ValidationError when username or password is empty', async () => {
    const svc = makeSvc();
    await expect(svc.login('', 'pass')).rejects.toThrow('required');
    await expect(svc.login('alice', '')).rejects.toThrow('required');
  });
});

// ── logout ───────────────────────────────────────────────────────────────────

describe('AuthService.logout', () => {
  it('deletes the session', async () => {
    const sessionRepo = new FakeSessionRepo();
    const userRepo = new FakeUserRepo().seed([makeUser({ id: 'u1', username: 'alice' })]);
    const svc = makeSvc(userRepo, sessionRepo);
    const { session } = await svc.login('alice', 'pass');
    await svc.logout(session.id, 'u1', 'org1');
    expect(await sessionRepo.getById(session.id)).toBeNull();
  });

  it('is idempotent — does not throw for a missing session', async () => {
    const svc = makeSvc();
    await expect(svc.logout('nonexistent', 'u1', 'org1')).resolves.toBeUndefined();
  });
});

// ── validateSession ───────────────────────────────────────────────────────────

describe('AuthService.validateSession', () => {
  it('returns valid=true with user and session for a valid session', async () => {
    const user = makeUser({ id: 'u1' });
    const session = makeSession({ userId: 'u1', isLocked: false });
    const userRepo = new FakeUserRepo().seed([user]);
    const sessionRepo = new FakeSessionRepo().seed([session]);
    const svc = makeSvc(userRepo, sessionRepo);
    const result = await svc.validateSession(session.id);
    expect(result.valid).toBe(true);
    if (result.valid) expect(result.user.id).toBe('u1');
  });

  it('returns valid=false reason=expired and deletes an expired session', async () => {
    const user = makeUser({ id: 'u1' });
    const session = makeSession({
      userId: 'u1',
      expiresAt: new Date(Date.now() - 1000).toISOString(),
    });
    const userRepo = new FakeUserRepo().seed([user]);
    const sessionRepo = new FakeSessionRepo().seed([session]);
    const svc = makeSvc(userRepo, sessionRepo);
    const result = await svc.validateSession(session.id);
    expect(result.valid).toBe(false);
    if (!result.valid) expect(result.reason).toBe('expired');
    expect(await sessionRepo.getById(session.id)).toBeNull();
  });

  it('returns valid=false reason=locked for a locked session', async () => {
    const user = makeUser({ id: 'u1' });
    const session = makeSession({ userId: 'u1', isLocked: true });
    const userRepo = new FakeUserRepo().seed([user]);
    const sessionRepo = new FakeSessionRepo().seed([session]);
    const svc = makeSvc(userRepo, sessionRepo);
    const result = await svc.validateSession(session.id);
    expect(result.valid).toBe(false);
    if (!result.valid) expect(result.reason).toBe('locked');
  });

  it('returns valid=false reason=deactivated and deletes session when user is deactivated', async () => {
    const user = makeUser({ id: 'u1', deactivatedAt: new Date().toISOString() });
    const session = makeSession({ userId: 'u1' });
    const userRepo = new FakeUserRepo().seed([user]);
    const sessionRepo = new FakeSessionRepo().seed([session]);
    const svc = makeSvc(userRepo, sessionRepo);
    const result = await svc.validateSession(session.id);
    expect(result.valid).toBe(false);
    if (!result.valid) expect(result.reason).toBe('deactivated');
    expect(await sessionRepo.getById(session.id)).toBeNull();
  });

  it('returns valid=false reason=not_found for a session ID that does not exist', async () => {
    const svc = makeSvc();
    const result = await svc.validateSession('ghost-session-id');
    expect(result.valid).toBe(false);
    if (!result.valid) expect(result.reason).toBe('not_found');
  });

  it('slides the expiry window on each validation', async () => {
    const user = makeUser({ id: 'u1' });
    const session = makeSession({ userId: 'u1' });
    const originalExpiry = session.expiresAt;
    const userRepo = new FakeUserRepo().seed([user]);
    const sessionRepo = new FakeSessionRepo().seed([session]);
    const svc = makeSvc(userRepo, sessionRepo);
    await new Promise(r => setTimeout(r, 10));
    const result = await svc.validateSession(session.id);
    expect(result.valid).toBe(true);
    if (result.valid) expect(result.session.expiresAt > originalExpiry).toBe(true);
  });
});

// ── generateCaptcha / verifyCaptcha ───────────────────────────────────────────

describe('AuthService.generateCaptcha / verifyCaptcha', () => {
  it('generateCaptcha returns a challenge with id but no answer', () => {
    const svc = makeSvc();
    const display = svc.generateCaptcha();
    expect(display.id).toBeTruthy();
    expect((display as any).answer).toBeUndefined();
  });

  it('verifyCaptcha is case-insensitive', () => {
    const svc = makeSvc();
    const display = svc.generateCaptcha();
    const answer = (svc as any).captchas.get(display.id)!.answer as string;
    // Regenerate because the captcha is consumed on verify — need a fresh one
    const display2 = svc.generateCaptcha();
    const answer2 = (svc as any).captchas.get(display2.id)!.answer as string;
    expect(svc.verifyCaptcha(display2.id, answer2.toUpperCase())).toBe(true);
  });

  it('verifyCaptcha deletes challenge after use (one-time)', () => {
    const svc = makeSvc();
    const display = svc.generateCaptcha();
    const answer = (svc as any).captchas.get(display.id)!.answer as string;
    expect(svc.verifyCaptcha(display.id, answer)).toBe(true);
    expect(svc.verifyCaptcha(display.id, answer)).toBe(false); // consumed
  });

  it('verifyCaptcha returns false for unknown challenge ID', () => {
    const svc = makeSvc();
    expect(svc.verifyCaptcha('unknown-id', 'anything')).toBe(false);
  });
});

// ── math CAPTCHA ────────────────────────────────────────────────────────────

describe('AuthService — math CAPTCHA', () => {
  it('generateCaptcha returns a challenge with a numeric answer', () => {
    const svc = makeSvc();
    const display = svc.generateCaptcha();
    expect(display.id).toBeTruthy();
    // Verify the answer is a number by checking the private captchas map
    const answer = (svc as any).captchas.get(display.id)!.answer as string;
    expect(Number.isFinite(Number(answer))).toBe(true);
  });

  it('verifyCaptcha accepts correct math answer', () => {
    const svc = makeSvc();
    const display = svc.generateCaptcha();
    const answer = (svc as any).captchas.get(display.id)!.answer as string;
    expect(svc.verifyCaptcha(display.id, answer)).toBe(true);
  });
});

// ── changePassword ──────────────────────────────────────────────────────────

describe('AuthService — changePassword', () => {
  it('changes password successfully', async () => {
    const svc = makeSvc();
    const user = await svc.register('alice', 'OldPass123', 'Alice', 'org1', 'dept1');
    // Login with old password should work
    await expect(svc.login('alice', 'OldPass123')).resolves.toBeDefined();
    // Change password
    await svc.changePassword(user.id, 'OldPass123', 'NewPass456');
    // Login with new password should work (fakeCrypto always verifies)
    await expect(svc.login('alice', 'NewPass456')).resolves.toBeDefined();
  });

  it('rejects wrong old password', async () => {
    // Use failingCrypto to simulate wrong password verification
    const userRepo = new FakeUserRepo();
    const sessionRepo = new FakeSessionRepo();
    // First register with normal crypto
    const regSvc = makeSvc(userRepo, sessionRepo);
    const user = await regSvc.register('bob', 'BobPass123', 'Bob', 'org1', 'dept1');
    // Now create a service with failingCrypto for the changePassword call
    const failSvc = makeSvc(userRepo, sessionRepo, failingCrypto);
    await expect(failSvc.changePassword(user.id, 'WrongOld', 'NewPass456'))
      .rejects.toThrow('incorrect');
  });

  it('rejects short new password', async () => {
    const svc = makeSvc();
    const user = await svc.register('carol', 'CarolPass1', 'Carol', 'org1', 'dept1');
    await expect(svc.changePassword(user.id, 'CarolPass1', 'short'))
      .rejects.toThrow('8 characters');
  });
});
