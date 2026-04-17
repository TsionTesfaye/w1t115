/**
 * LoginComponent tests
 *
 * Mixes two test modes:
 *   1. Stub-based tests for UI behavior (session rejection messages, form, router redirect)
 *      where the authService stub is simpler.
 *   2. Real AuthService tests for auth error scenarios.
 *
 * Real AuthService constructor: AuthService(userRepo, sessionRepo, crypto, audit)
 * fakeCrypto.verifyPassword returns true; failingCrypto.verifyPassword returns false.
 */

import { describe, it, expect, afterEach, vi } from 'vitest';
import { TestBed } from '@angular/core/testing';
import { provideRouter, Router } from '@angular/router';
import { signal, computed } from '@angular/core';
import { LoginComponent } from '../login.component';
import { AuthService } from '../../../../core/services/auth.service';
import { SessionService } from '../../../../core/services/session.service';
import { AuthenticationError, LockoutError, CaptchaRequiredError } from '../../../../core/errors';
import {
  FakeUserRepo, FakeSessionRepo,
  fakeCrypto, failingCrypto,
  fakeAudit, makeUser,
} from '../../../../core/services/__tests__/helpers';

afterEach(() => {
  TestBed.resetTestingModule();
});

// ── Session stub ──────────────────────────────────────────────────────────────

function makeSessionStub(opts: { authenticated?: boolean; rejectionReason?: string | null } = {}) {
  return {
    isAuthenticated: computed(() => opts.authenticated ?? false),
    sessionRejectionReason: signal(opts.rejectionReason ?? null),
    setSession: () => undefined,
  };
}

// ── Auth stub (for UI-only tests) ─────────────────────────────────────────────

function makeAuthStub(overrides: Record<string, any> = {}) {
  return {
    login: vi.fn(),
    generateCaptcha: vi.fn().mockReturnValue({
      id: 'cap1',
      imageDataUrl: 'data:image/png;base64,abc',
      createdAt: Date.now(),
      expiresAt: Date.now() + 60000,
    }),
    ...overrides,
  };
}

// ── Real AuthService factory ──────────────────────────────────────────────────

function makeRealAuthService(crypto: typeof fakeCrypto = fakeCrypto) {
  return new AuthService(
    new FakeUserRepo() as any,
    new FakeSessionRepo() as any,
    crypto as any,
    fakeAudit as any,
  );
}

function makeRealAuthServiceWithRepos(
  userRepo: FakeUserRepo,
  sessionRepo: FakeSessionRepo = new FakeSessionRepo(),
  crypto: typeof fakeCrypto = fakeCrypto,
) {
  return new AuthService(
    userRepo as any,
    sessionRepo as any,
    crypto as any,
    fakeAudit as any,
  );
}

// ── Configure helpers ─────────────────────────────────────────────────────────

function createComponentWithStub(
  sessionOpts: { authenticated?: boolean; rejectionReason?: string | null } = {},
  authOverrides: Record<string, any> = {},
) {
  const sessionStub = makeSessionStub(sessionOpts);
  const authStub = makeAuthStub(authOverrides);

  TestBed.configureTestingModule({
    imports: [LoginComponent],
    providers: [
      provideRouter([]),
      { provide: SessionService, useValue: sessionStub },
      { provide: AuthService, useValue: authStub },
    ],
  });

  const fixture = TestBed.createComponent(LoginComponent);
  return { component: fixture.componentInstance, sessionStub, authStub };
}

function createComponentWithRealAuth(
  userRepo: FakeUserRepo,
  crypto: typeof fakeCrypto,
  sessionOpts: { authenticated?: boolean } = {},
) {
  const sessionStub = {
    ...makeSessionStub(sessionOpts),
    // setSession is called after successful login — needs to be a plain method
    setSession: (_user: any, _session: any) => undefined,
  };
  const realAuth = makeRealAuthServiceWithRepos(userRepo, new FakeSessionRepo(), crypto);

  TestBed.configureTestingModule({
    imports: [LoginComponent],
    providers: [
      provideRouter([]),
      { provide: SessionService, useValue: sessionStub },
      { provide: AuthService, useValue: realAuth },
    ],
  });

  const fixture = TestBed.createComponent(LoginComponent);
  const component = fixture.componentInstance;

  // Spy on navigate so it doesn't try to actually navigate (no routes configured)
  const router = TestBed.inject(Router);
  vi.spyOn(router, 'navigate').mockResolvedValue(true);

  return { component, realAuth };
}

// ── Session rejection messages ────────────────────────────────────────────────

describe('LoginComponent — session rejection messages', () => {
  it('shows "session expired" message when rejection reason is expired', () => {
    const { component } = createComponentWithStub({ rejectionReason: 'expired' });
    component.ngOnInit();
    expect(component.sessionRejectionMessage()).toContain('expired');
  });

  it('shows "locked" message when rejection reason is locked', () => {
    const { component } = createComponentWithStub({ rejectionReason: 'locked' });
    component.ngOnInit();
    expect(component.sessionRejectionMessage()).toContain('locked');
  });

  it('shows "deactivated" message when rejection reason is deactivated', () => {
    const { component } = createComponentWithStub({ rejectionReason: 'deactivated' });
    component.ngOnInit();
    expect(component.sessionRejectionMessage()).toContain('deactivated');
  });

  it('shows "another session" message when rejection reason is superseded', () => {
    const { component } = createComponentWithStub({ rejectionReason: 'superseded' });
    component.ngOnInit();
    expect(component.sessionRejectionMessage()).toContain('another session');
  });

  it('shows no rejection message when reason is null', () => {
    const { component } = createComponentWithStub({ rejectionReason: null });
    component.ngOnInit();
    expect(component.sessionRejectionMessage()).toBeNull();
  });
});

// ── Already authenticated redirect ───────────────────────────────────────────

describe('LoginComponent — authenticated redirect', () => {
  it('navigates to /dashboard if already authenticated', () => {
    const { component } = createComponentWithStub({ authenticated: true });
    const router = TestBed.inject(Router);
    const navigateSpy = vi.spyOn(router, 'navigate').mockResolvedValue(true);
    component.ngOnInit();
    expect(navigateSpy).toHaveBeenCalledWith(['/dashboard']);
  });
});

// ── Form validation ──────────────────────────────────────────────────────────

describe('LoginComponent — form validation', () => {
  it('does not submit when form is invalid', async () => {
    const { component, authStub } = createComponentWithStub();
    // Leave form empty
    await component.onSubmit();
    expect(authStub.login).not.toHaveBeenCalled();
  });

  it('showError returns true for touched invalid fields', () => {
    const { component } = createComponentWithStub();
    component.form.get('username')!.markAsTouched();
    expect(component.showError('username')).toBe(true);
  });

  it('showError returns false for untouched fields', () => {
    const { component } = createComponentWithStub();
    expect(component.showError('username')).toBe(false);
  });
});

// ── Auth error handling (stub-based) ─────────────────────────────────────────

describe('LoginComponent — error handling (stub)', () => {
  it('shows error message on AuthenticationError', async () => {
    const { component, authStub } = createComponentWithStub();
    authStub.login.mockRejectedValue(new AuthenticationError('Invalid credentials'));
    component.form.patchValue({ username: 'alice', password: 'wrong' });
    await component.onSubmit();
    expect(component.errorMessage()).toBe('Invalid credentials');
    expect(component.submitting()).toBe(false);
  });

  it('shows lockout banner on LockoutError', async () => {
    const { component, authStub } = createComponentWithStub();
    const err = new LockoutError('2026-12-31T00:00:00Z');
    authStub.login.mockRejectedValue(err);
    component.form.patchValue({ username: 'alice', password: 'wrong' });
    await component.onSubmit();
    expect(component.lockoutUntil()).toBe('2026-12-31T00:00:00Z');
    expect(component.errorMessage()).toBeNull();
  });

  it('generates CAPTCHA on CaptchaRequiredError', async () => {
    const { component, authStub } = createComponentWithStub();
    authStub.login.mockRejectedValue(new CaptchaRequiredError());
    component.form.patchValue({ username: 'alice', password: 'wrong' });
    await component.onSubmit();
    expect(component.captcha()).not.toBeNull();
    expect(component.captcha()!.id).toBe('cap1');
    expect(component.errorMessage()).toContain('CAPTCHA');
  });

  it('shows generic error for unexpected errors', async () => {
    const { component, authStub } = createComponentWithStub();
    authStub.login.mockRejectedValue(new Error('Random failure'));
    component.form.patchValue({ username: 'alice', password: 'wrong' });
    await component.onSubmit();
    expect(component.errorMessage()).toContain('unexpected error');
  });
});

// ── Real AuthService scenario tests ──────────────────────────────────────────

describe('LoginComponent — real AuthService scenarios', () => {
  it('happy path: seeded user with fakehash logs in successfully', async () => {
    const userRepo = new FakeUserRepo();
    userRepo.seed([
      makeUser({
        id: 'u1', username: 'alice',
        // fakeCrypto.hashPassword always returns 'fakehash'; verifyPassword always returns true
        passwordHash: 'fakehash', passwordSalt: 'salt',
        failedAttempts: 0, lockoutUntil: null,
      }),
    ]);

    const { component } = createComponentWithRealAuth(userRepo, fakeCrypto);
    component.form.patchValue({ username: 'alice', password: 'anything' });
    await component.onSubmit();

    // real AuthService.login succeeded — no error
    expect(component.errorMessage()).toBeNull();
    expect(component.lockoutUntil()).toBeNull();
    expect(component.submitting()).toBe(false);
  });

  it('wrong password: failingCrypto.verifyPassword returns false → AuthenticationError', async () => {
    const userRepo = new FakeUserRepo();
    userRepo.seed([
      makeUser({
        id: 'u1', username: 'alice',
        passwordHash: 'fakehash', passwordSalt: 'salt',
        failedAttempts: 0, lockoutUntil: null,
      }),
    ]);

    const { component } = createComponentWithRealAuth(userRepo, failingCrypto);
    component.form.patchValue({ username: 'alice', password: 'wrongpass' });
    await component.onSubmit();

    // verifyPassword returns false → AuthenticationError → component shows error
    expect(component.errorMessage()).toBeTruthy();
  });

  it('lockout: user with future lockoutUntil → LockoutError shown in banner', async () => {
    const userRepo = new FakeUserRepo();
    const futureDate = new Date(Date.now() + 60 * 60 * 1000).toISOString();
    userRepo.seed([
      makeUser({
        id: 'u1', username: 'alice',
        passwordHash: 'fakehash', passwordSalt: 'salt',
        failedAttempts: 5,
        lockoutUntil: futureDate,
      }),
    ]);

    const { component } = createComponentWithRealAuth(userRepo, fakeCrypto);
    component.form.patchValue({ username: 'alice', password: 'anything' });
    await component.onSubmit();

    // Real AuthService detects lockout → LockoutError → component shows lockout banner
    expect(component.lockoutUntil()).toBe(futureDate);
    expect(component.errorMessage()).toBeNull();
  });

  it('captcha required: user with failedAttempts >= 3 → CaptchaRequiredError', async () => {
    const userRepo = new FakeUserRepo();
    userRepo.seed([
      makeUser({
        id: 'u1', username: 'alice',
        passwordHash: 'fakehash', passwordSalt: 'salt',
        failedAttempts: 3, lockoutUntil: null,
      }),
    ]);

    const { component } = createComponentWithRealAuth(userRepo, fakeCrypto);
    component.form.patchValue({ username: 'alice', password: 'anything' });
    await component.onSubmit();

    // failedAttempts >= captchaRequiredAfterFailures (3) → CaptchaRequiredError
    expect(component.errorMessage()).toContain('CAPTCHA');
  });
});
