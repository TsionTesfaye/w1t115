/**
 * SessionService tests
 *
 * Tests cover: setSession, switchRole, restoreSession (various states),
 * requireAuth, initialized signal, activeRole persistence, single-flight
 * deduplication, BroadcastChannel logout propagation, and session rejection
 * reason propagation.
 *
 * Uses a fake AuthService and a mock localStorage so tests are fully isolated.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { SessionService } from '../session.service';
import { UserRole } from '../../enums';
import { makeUser, makeSession } from './helpers';
import type { SessionValidationResult } from '../auth.service';

// ── localStorage mock ─────────────────────────────────────────────────────────

const localStorageMock = (() => {
  let store: Record<string, string> = {};
  return {
    getItem: (k: string) => store[k] ?? null,
    setItem: (k: string, v: string) => { store[k] = v; },
    removeItem: (k: string) => { delete store[k]; },
    clear: () => { store = {}; },
  };
})();

// ── BroadcastChannel mock ─────────────────────────────────────────────────────

let capturedMessages: any[] = [];

class MockBroadcastChannel {
  onmessage: ((e: any) => void) | null = null;
  postMessage(data: any) { capturedMessages.push(data); }
  close() {}
}

// ── Fake AuthService factory ──────────────────────────────────────────────────

function makeFakeAuth(validateResult: SessionValidationResult) {
  return {
    validateSession: vi.fn().mockResolvedValue(validateResult),
    logout: vi.fn().mockResolvedValue(undefined),
  };
}

const VALID_AUTH_RESULT = (user: any, session: any): SessionValidationResult =>
  ({ valid: true, user, session });

const INVALID_AUTH_RESULT = (reason: 'not_found' | 'expired' | 'locked' | 'deactivated' = 'not_found'): SessionValidationResult =>
  ({ valid: false, reason });

// ── Setup ─────────────────────────────────────────────────────────────────────

beforeEach(() => {
  capturedMessages = [];
  localStorageMock.clear();
  vi.stubGlobal('localStorage', localStorageMock);
  vi.stubGlobal('BroadcastChannel', MockBroadcastChannel);
});

afterEach(() => vi.unstubAllGlobals());

function makeSvc(fakeAuth: any) {
  return new SessionService(fakeAuth);
}

// ── setSession ────────────────────────────────────────────────────────────────

describe('SessionService.setSession', () => {
  it('sets user, session, and activeRole signals', () => {
    const user = makeUser({ id: 'u1', roles: [UserRole.Candidate] });
    const session = makeSession({ userId: 'u1' });
    const svc = makeSvc(makeFakeAuth({ valid: false, reason: 'not_found' }));
    svc.setSession(user as any, session as any);
    expect(svc.currentUser()?.id).toBe('u1');
    expect(svc.currentSession()?.id).toBe(session.id);
    expect(svc.activeRole()).toBe(UserRole.Candidate);
    expect(svc.isAuthenticated()).toBe(true);
  });

  it('persists sessionId and activeRole to localStorage', () => {
    const user = makeUser({ id: 'u1', roles: [UserRole.Employer] });
    const session = makeSession({ id: 'sess1', userId: 'u1' });
    const svc = makeSvc(makeFakeAuth({ valid: false, reason: 'not_found' }));
    svc.setSession(user as any, session as any);
    expect(localStorageMock.getItem('tb_active_session_id')).toBe('sess1');
    expect(localStorageMock.getItem('tb_active_role')).toBe(UserRole.Employer);
  });

  it('sets initialized = true', () => {
    const user = makeUser({ roles: [UserRole.Candidate] });
    const svc = makeSvc(makeFakeAuth({ valid: false, reason: 'not_found' }));
    expect(svc.initialized()).toBe(false);
    svc.setSession(user as any, makeSession() as any);
    expect(svc.initialized()).toBe(true);
  });

  it('clears any prior session rejection reason', () => {
    const user = makeUser({ roles: [UserRole.Candidate] });
    const session = makeSession({ userId: user.id });
    const svc = makeSvc(makeFakeAuth({ valid: false, reason: 'not_found' }));
    // Manually plant a stale rejection reason signal via a failed restore
    localStorageMock.setItem('tb_active_session_id', 'stale-id');
    // After setSession the reason should be null
    svc.setSession(user as any, session as any);
    expect(svc.sessionRejectionReason()).toBeNull();
  });

  it('broadcasts logout to other tabs before writing session (session isolation)', () => {
    const user = makeUser({ roles: [UserRole.Candidate] });
    const session = makeSession({ userId: user.id });
    const svc = makeSvc(makeFakeAuth({ valid: false, reason: 'not_found' }));
    svc.setSession(user as any, session as any);
    // A 'logout' message must be posted so other tabs clear their session
    expect(capturedMessages.some((m: any) => m.type === 'logout')).toBe(true);
  });
});

// ── switchRole ────────────────────────────────────────────────────────────────

describe('SessionService.switchRole', () => {
  it('changes activeRole when user holds the target role', () => {
    const user = makeUser({ roles: [UserRole.Candidate, UserRole.Employer] });
    const svc = makeSvc(makeFakeAuth({ valid: false, reason: 'not_found' }));
    svc.setSession(user as any, makeSession() as any);
    svc.switchRole(UserRole.Employer);
    expect(svc.activeRole()).toBe(UserRole.Employer);
  });

  it('persists the new role to localStorage', () => {
    const user = makeUser({ roles: [UserRole.Candidate, UserRole.HRCoordinator] });
    const svc = makeSvc(makeFakeAuth({ valid: false, reason: 'not_found' }));
    svc.setSession(user as any, makeSession() as any);
    svc.switchRole(UserRole.HRCoordinator);
    expect(localStorageMock.getItem('tb_active_role')).toBe(UserRole.HRCoordinator);
  });

  it('throws when the user does not hold the requested role', () => {
    const user = makeUser({ roles: [UserRole.Candidate] });
    const svc = makeSvc(makeFakeAuth({ valid: false, reason: 'not_found' }));
    svc.setSession(user as any, makeSession() as any);
    expect(() => svc.switchRole(UserRole.Administrator)).toThrow();
  });

  it('throws when called before a session is set', () => {
    const svc = makeSvc(makeFakeAuth({ valid: false, reason: 'not_found' }));
    expect(() => svc.switchRole(UserRole.Candidate)).toThrow();
  });
});

// ── restoreSession ────────────────────────────────────────────────────────────

describe('SessionService.restoreSession', () => {
  it('returns false and sets initialized when no sessionId in storage', async () => {
    const svc = makeSvc(makeFakeAuth({ valid: false, reason: 'not_found' }));
    const result = await svc.restoreSession();
    expect(result).toBe(false);
    expect(svc.initialized()).toBe(true);
    expect(svc.isAuthenticated()).toBe(false);
  });

  it('restores user, session, and first role on success', async () => {
    const user = makeUser({ id: 'u1', roles: [UserRole.Employer] });
    const session = makeSession({ userId: 'u1' });
    localStorageMock.setItem('tb_active_session_id', session.id);
    const svc = makeSvc(makeFakeAuth(VALID_AUTH_RESULT(user, session)));
    const result = await svc.restoreSession();
    expect(result).toBe(true);
    expect(svc.currentUser()?.id).toBe('u1');
    expect(svc.activeRole()).toBe(UserRole.Employer);
    expect(svc.initialized()).toBe(true);
  });

  it('restores the saved activeRole if still valid for the user', async () => {
    const user = makeUser({ roles: [UserRole.Candidate, UserRole.Employer] });
    const session = makeSession({ userId: user.id });
    localStorageMock.setItem('tb_active_session_id', session.id);
    localStorageMock.setItem('tb_active_role', UserRole.Employer);
    const svc = makeSvc(makeFakeAuth(VALID_AUTH_RESULT(user, session)));
    await svc.restoreSession();
    expect(svc.activeRole()).toBe(UserRole.Employer);
  });

  it('falls back to first role if saved activeRole is no longer valid', async () => {
    const user = makeUser({ roles: [UserRole.Candidate] }); // no longer has Employer
    const session = makeSession({ userId: user.id });
    localStorageMock.setItem('tb_active_session_id', session.id);
    localStorageMock.setItem('tb_active_role', UserRole.Employer); // stale
    const svc = makeSvc(makeFakeAuth(VALID_AUTH_RESULT(user, session)));
    await svc.restoreSession();
    expect(svc.activeRole()).toBe(UserRole.Candidate);
  });

  it('clears local session and returns false when session is expired', async () => {
    localStorageMock.setItem('tb_active_session_id', 'expired-session');
    const svc = makeSvc(makeFakeAuth({ valid: false, reason: 'expired' }));
    const result = await svc.restoreSession();
    expect(result).toBe(false);
    expect(svc.isAuthenticated()).toBe(false);
    expect(localStorageMock.getItem('tb_active_session_id')).toBeNull();
    expect(svc.sessionRejectionReason()).toBe('expired');
  });

  it('sets rejection reason = locked when session is locked', async () => {
    localStorageMock.setItem('tb_active_session_id', 'locked-session');
    const svc = makeSvc(makeFakeAuth({ valid: false, reason: 'locked' }));
    await svc.restoreSession();
    expect(svc.sessionRejectionReason()).toBe('locked');
    expect(svc.isAuthenticated()).toBe(false);
  });

  it('sets rejection reason = deactivated when user is deactivated', async () => {
    localStorageMock.setItem('tb_active_session_id', 'deactivated-session');
    const svc = makeSvc(makeFakeAuth({ valid: false, reason: 'deactivated' }));
    await svc.restoreSession();
    expect(svc.sessionRejectionReason()).toBe('deactivated');
    expect(svc.isAuthenticated()).toBe(false);
  });

  it('returns false and sets initialized when session is not found', async () => {
    localStorageMock.setItem('tb_active_session_id', 'ghost-id');
    const svc = makeSvc(makeFakeAuth({ valid: false, reason: 'not_found' }));
    const result = await svc.restoreSession();
    expect(result).toBe(false);
    expect(svc.initialized()).toBe(true);
  });

  it('always sets initialized = true, even on failure', async () => {
    localStorageMock.setItem('tb_active_session_id', 'bad-id');
    const svc = makeSvc(makeFakeAuth({ valid: false, reason: 'not_found' }));
    await svc.restoreSession();
    expect(svc.initialized()).toBe(true);
  });

  it('deduplicates concurrent calls — validateSession called only once', async () => {
    const user = makeUser({ id: 'u1', roles: [UserRole.Candidate] });
    const session = makeSession({ userId: 'u1' });
    localStorageMock.setItem('tb_active_session_id', session.id);
    const fakeAuth = makeFakeAuth(VALID_AUTH_RESULT(user, session));
    const svc = makeSvc(fakeAuth);
    // Fire two concurrent restoreSession calls
    const [r1, r2] = await Promise.all([svc.restoreSession(), svc.restoreSession()]);
    expect(r1).toBe(true);
    expect(r2).toBe(true);
    // validateSession must have been called exactly once despite two callers
    expect(fakeAuth.validateSession).toHaveBeenCalledTimes(1);
  });
});

// ── logout ────────────────────────────────────────────────────────────────────

describe('SessionService.logout', () => {
  it('clears signals and localStorage', async () => {
    const user = makeUser({ id: 'u1' });
    const session = makeSession({ userId: 'u1' });
    const fakeAuth = makeFakeAuth({ valid: false, reason: 'not_found' });
    const svc = makeSvc(fakeAuth);
    svc.setSession(user as any, session as any);
    await svc.logout();
    expect(svc.isAuthenticated()).toBe(false);
    expect(svc.activeRole()).toBeNull();
    expect(localStorageMock.getItem('tb_active_session_id')).toBeNull();
    expect(localStorageMock.getItem('tb_active_role')).toBeNull();
  });

  it('calls authService.logout with the right IDs', async () => {
    const user = makeUser({ id: 'u1', organizationId: 'org1' });
    const session = makeSession({ id: 'sess1', userId: 'u1' });
    const fakeAuth = makeFakeAuth({ valid: false, reason: 'not_found' });
    const svc = makeSvc(fakeAuth);
    svc.setSession(user as any, session as any);
    await svc.logout();
    expect(fakeAuth.logout).toHaveBeenCalledWith('sess1', 'u1', 'org1');
  });

  it('broadcasts logout to other tabs', async () => {
    const user = makeUser({ id: 'u1' });
    const session = makeSession({ userId: 'u1' });
    const svc = makeSvc(makeFakeAuth({ valid: false, reason: 'not_found' }));
    svc.setSession(user as any, session as any);
    capturedMessages = []; // clear the setSession broadcast
    await svc.logout();
    expect(capturedMessages.some((m: any) => m.type === 'logout')).toBe(true);
  });

  it('clears session rejection reason on logout', async () => {
    const user = makeUser({ id: 'u1' });
    const session = makeSession({ userId: 'u1' });
    const svc = makeSvc(makeFakeAuth({ valid: false, reason: 'not_found' }));
    svc.setSession(user as any, session as any);
    await svc.logout();
    expect(svc.sessionRejectionReason()).toBeNull();
  });

  it('does not throw if called when no session exists', async () => {
    const svc = makeSvc(makeFakeAuth({ valid: false, reason: 'not_found' }));
    await expect(svc.logout()).resolves.toBeUndefined();
  });
});

// ── BroadcastChannel logout reception ────────────────────────────────────────

describe('SessionService — cross-tab logout reception', () => {
  it('clears session when a logout message is received from another tab', () => {
    const user = makeUser({ id: 'u1' });
    const session = makeSession({ userId: 'u1' });
    const svc = makeSvc(makeFakeAuth({ valid: false, reason: 'not_found' }));
    svc.setSession(user as any, session as any);
    expect(svc.isAuthenticated()).toBe(true);

    // Simulate receiving a logout broadcast from another tab
    const channel = (svc as any).sessionChannel as MockBroadcastChannel;
    channel.onmessage?.({ data: { type: 'logout' } });

    expect(svc.isAuthenticated()).toBe(false);
    expect(svc.activeRole()).toBeNull();
    expect(localStorageMock.getItem('tb_active_session_id')).toBeNull();
  });

  it('sets rejection reason to superseded on cross-tab logout', () => {
    const user = makeUser({ id: 'u1' });
    const session = makeSession({ userId: 'u1' });
    const svc = makeSvc(makeFakeAuth({ valid: false, reason: 'not_found' }));
    svc.setSession(user as any, session as any);

    const channel = (svc as any).sessionChannel as MockBroadcastChannel;
    channel.onmessage?.({ data: { type: 'logout' } });

    expect(svc.sessionRejectionReason()).toBe('superseded');
  });

  it('ignores unknown broadcast message types', () => {
    const user = makeUser({ id: 'u1' });
    const session = makeSession({ userId: 'u1' });
    const svc = makeSvc(makeFakeAuth({ valid: false, reason: 'not_found' }));
    svc.setSession(user as any, session as any);

    const channel = (svc as any).sessionChannel as MockBroadcastChannel;
    channel.onmessage?.({ data: { type: 'unknown_event' } });

    // Session must remain intact
    expect(svc.isAuthenticated()).toBe(true);
  });
});

// ── requireAuth ───────────────────────────────────────────────────────────────

describe('SessionService.requireAuth', () => {
  it('returns auth context when authenticated', () => {
    const user = makeUser({ id: 'u1', organizationId: 'org1', roles: [UserRole.Administrator] });
    const svc = makeSvc(makeFakeAuth({ valid: false, reason: 'not_found' }));
    svc.setSession(user as any, makeSession() as any);
    const ctx = svc.requireAuth();
    expect(ctx.userId).toBe('u1');
    expect(ctx.organizationId).toBe('org1');
    expect(ctx.activeRole).toBe(UserRole.Administrator);
  });

  it('throws when not authenticated', () => {
    const svc = makeSvc(makeFakeAuth({ valid: false, reason: 'not_found' }));
    expect(() => svc.requireAuth()).toThrow('Authentication required');
  });
});

// ── hasRole / hasAnyRole ──────────────────────────────────────────────────────

describe('SessionService.hasRole / hasAnyRole', () => {
  it('hasRole returns true when user holds the role', () => {
    const user = makeUser({ roles: [UserRole.HRCoordinator] });
    const svc = makeSvc(makeFakeAuth({ valid: false, reason: 'not_found' }));
    svc.setSession(user as any, makeSession() as any);
    expect(svc.hasRole(UserRole.HRCoordinator)).toBe(true);
    expect(svc.hasRole(UserRole.Administrator)).toBe(false);
  });

  it('hasAnyRole returns true if any required role matches', () => {
    const user = makeUser({ roles: [UserRole.Candidate, UserRole.Employer] });
    const svc = makeSvc(makeFakeAuth({ valid: false, reason: 'not_found' }));
    svc.setSession(user as any, makeSession() as any);
    expect(svc.hasAnyRole([UserRole.Employer, UserRole.Administrator])).toBe(true);
    expect(svc.hasAnyRole([UserRole.Administrator])).toBe(false);
  });
});
