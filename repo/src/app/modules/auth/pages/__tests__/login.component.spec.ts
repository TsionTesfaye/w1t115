/**
 * LoginComponent tests
 *
 * Tests cover: session rejection messages, form validation behavior,
 * error handling for various auth error types, and lockout/CAPTCHA states.
 */

import { describe, it, expect, beforeAll, afterEach, vi } from 'vitest';
import { TestBed } from '@angular/core/testing';
import { provideRouter, Router } from '@angular/router';
import { signal, computed } from '@angular/core';
import { LoginComponent } from '../login.component';
import { AuthService } from '../../../../core/services/auth.service';
import { SessionService } from '../../../../core/services/session.service';
import { AuthenticationError, LockoutError, CaptchaRequiredError } from '../../../../core/errors';

afterEach(() => {
  TestBed.resetTestingModule();
});

function makeMockSession(opts: { authenticated?: boolean; rejectionReason?: string | null } = {}) {
  return {
    isAuthenticated: computed(() => opts.authenticated ?? false),
    sessionRejectionReason: signal(opts.rejectionReason ?? null),
    setSession: vi.fn(),
  };
}

function makeMockAuth() {
  return {
    login: vi.fn(),
    generateCaptcha: vi.fn().mockReturnValue({ id: 'cap1', imageDataUrl: 'data:image/png;base64,abc', createdAt: Date.now(), expiresAt: Date.now() + 60000 }),
  };
}

function createComponent(sessionOpts: { authenticated?: boolean; rejectionReason?: string | null } = {}) {
  const mockSession = makeMockSession(sessionOpts);
  const mockAuth = makeMockAuth();

  TestBed.configureTestingModule({
    imports: [LoginComponent],
    providers: [
      provideRouter([]),
      { provide: SessionService, useValue: mockSession },
      { provide: AuthService, useValue: mockAuth },
    ],
  });

  const fixture = TestBed.createComponent(LoginComponent);
  const component = fixture.componentInstance;
  return { component, fixture, mockSession, mockAuth };
}

// ── Session rejection messages ────────────────────────────────────────────────

describe('LoginComponent — session rejection messages', () => {
  it('shows "session expired" message when rejection reason is expired', () => {
    const { component } = createComponent({ rejectionReason: 'expired' });
    component.ngOnInit();
    expect(component.sessionRejectionMessage()).toContain('expired');
  });

  it('shows "locked" message when rejection reason is locked', () => {
    const { component } = createComponent({ rejectionReason: 'locked' });
    component.ngOnInit();
    expect(component.sessionRejectionMessage()).toContain('locked');
  });

  it('shows "deactivated" message when rejection reason is deactivated', () => {
    const { component } = createComponent({ rejectionReason: 'deactivated' });
    component.ngOnInit();
    expect(component.sessionRejectionMessage()).toContain('deactivated');
  });

  it('shows "another session" message when rejection reason is superseded', () => {
    const { component } = createComponent({ rejectionReason: 'superseded' });
    component.ngOnInit();
    expect(component.sessionRejectionMessage()).toContain('another session');
  });

  it('shows no rejection message when reason is null', () => {
    const { component } = createComponent({ rejectionReason: null });
    component.ngOnInit();
    expect(component.sessionRejectionMessage()).toBeNull();
  });
});

// ── Already authenticated redirect ───────────────────────────────────────────

describe('LoginComponent — authenticated redirect', () => {
  it('navigates to /dashboard if already authenticated', () => {
    const { component } = createComponent({ authenticated: true });
    const router = TestBed.inject(Router);
    const navigateSpy = vi.spyOn(router, 'navigate').mockResolvedValue(true);
    component.ngOnInit();
    expect(navigateSpy).toHaveBeenCalledWith(['/dashboard']);
  });
});

// ── Form validation ──────────────────────────────────────────────────────────

describe('LoginComponent — form validation', () => {
  it('does not submit when form is invalid', async () => {
    const { component, mockAuth } = createComponent();
    // Leave form empty
    await component.onSubmit();
    expect(mockAuth.login).not.toHaveBeenCalled();
  });

  it('showError returns true for touched invalid fields', () => {
    const { component } = createComponent();
    component.form.get('username')!.markAsTouched();
    expect(component.showError('username')).toBe(true);
  });

  it('showError returns false for untouched fields', () => {
    const { component } = createComponent();
    expect(component.showError('username')).toBe(false);
  });
});

// ── Auth error handling ──────────────────────────────────────────────────────

describe('LoginComponent — error handling', () => {
  it('shows error message on AuthenticationError', async () => {
    const { component, mockAuth } = createComponent();
    mockAuth.login.mockRejectedValue(new AuthenticationError('Invalid credentials'));
    component.form.patchValue({ username: 'alice', password: 'wrong' });
    await component.onSubmit();
    expect(component.errorMessage()).toBe('Invalid credentials');
    expect(component.submitting()).toBe(false);
  });

  it('shows lockout banner on LockoutError', async () => {
    const { component, mockAuth } = createComponent();
    const err = new LockoutError('2026-12-31T00:00:00Z');
    mockAuth.login.mockRejectedValue(err);
    component.form.patchValue({ username: 'alice', password: 'wrong' });
    await component.onSubmit();
    expect(component.lockoutUntil()).toBe('2026-12-31T00:00:00Z');
    expect(component.errorMessage()).toBeNull();
  });

  it('generates CAPTCHA on CaptchaRequiredError', async () => {
    const { component, mockAuth } = createComponent();
    mockAuth.login.mockRejectedValue(new CaptchaRequiredError());
    component.form.patchValue({ username: 'alice', password: 'wrong' });
    await component.onSubmit();
    expect(component.captcha()).not.toBeNull();
    expect(component.captcha()!.id).toBe('cap1');
    expect(component.errorMessage()).toContain('CAPTCHA');
  });

  it('shows generic error for unexpected errors', async () => {
    const { component, mockAuth } = createComponent();
    mockAuth.login.mockRejectedValue(new Error('Random failure'));
    component.form.patchValue({ username: 'alice', password: 'wrong' });
    await component.onSubmit();
    expect(component.errorMessage()).toContain('unexpected error');
  });
});
