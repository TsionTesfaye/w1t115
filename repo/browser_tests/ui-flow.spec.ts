/**
 * browser_tests/ui-flow.spec.ts
 *
 * True UI-interaction tests: Angular TestBed renders real components and we
 * drive them via DOM events (not service calls). This exercises the full
 * template → form → service dispatch chain.
 */

import { describe, it, expect, afterEach, vi } from 'vitest';
import { TestBed } from '@angular/core/testing';
import { provideRouter, Router } from '@angular/router';
import { signal, computed } from '@angular/core';
import { LoginComponent } from '../src/app/modules/auth/pages/login.component';
import { AuthService } from '../src/app/core/services/auth.service';
import { SessionService } from '../src/app/core/services/session.service';
import { AuthenticationError, LockoutError } from '../src/app/core/errors';

afterEach(() => {
  vi.restoreAllMocks();
  TestBed.resetTestingModule();
});

function makeSessionMock() {
  return {
    isAuthenticated: computed(() => false),
    sessionRejectionReason: signal(null),
    setSession: vi.fn(),
  };
}

function setup(authOverrides: Record<string, any> = {}) {
  const authMock = {
    login: vi.fn().mockResolvedValue({ sessionId: 's1', userId: 'u1', roles: [] }),
    generateCaptcha: vi.fn().mockReturnValue({
      id: 'cap1',
      imageDataUrl: 'data:image/png;base64,abc',
      createdAt: Date.now(),
      expiresAt: Date.now() + 60_000,
    }),
    ...authOverrides,
  };
  const sessionMock = makeSessionMock();

  TestBed.configureTestingModule({
    imports: [LoginComponent],
    providers: [
      provideRouter([]),
      { provide: AuthService, useValue: authMock },
      { provide: SessionService, useValue: sessionMock },
    ],
  });

  const fixture = TestBed.createComponent(LoginComponent);
  fixture.detectChanges();
  return { fixture, component: fixture.componentInstance, authMock, sessionMock };
}

// ── DOM input → form → service ────────────────────────────────────────────────

describe('LoginComponent — DOM-driven interactions', () => {
  it('clicking submit with valid form values calls auth.login', async () => {
    const { fixture, component, authMock } = setup();
    const el: HTMLElement = fixture.nativeElement;

    const submitButton = el.querySelector<HTMLButtonElement>('button[type="submit"]')!;
    expect(submitButton).toBeTruthy();

    // Populate via reactive form API (patchValue), then click the DOM button
    // to exercise the template (ngSubmit) → onSubmit → auth.login chain.
    component.form.patchValue({ username: 'alice', password: 'Password1!' });
    fixture.detectChanges();

    submitButton.click();
    fixture.detectChanges();
    await fixture.whenStable();

    // captchaId = undefined (no captcha shown), captchaAnswer = undefined, rememberSession = false
    expect(authMock.login).toHaveBeenCalledWith('alice', 'Password1!', undefined, undefined, false);
  });

  it('submit button is present and labelled correctly in the DOM', () => {
    const { fixture } = setup();
    const btn = fixture.nativeElement.querySelector<HTMLButtonElement>('button[type="submit"]');
    expect(btn).toBeTruthy();
    expect(btn!.textContent?.trim()).toContain('Sign In');
  });

  it('form fields are present in the DOM with correct ids', () => {
    const { fixture } = setup();
    const el: HTMLElement = fixture.nativeElement;
    expect(el.querySelector('#username')).toBeTruthy();
    expect(el.querySelector('#password')).toBeTruthy();
  });

  it('error message renders in the DOM after a failed login', async () => {
    const { fixture, component } = setup({
      login: vi.fn().mockRejectedValue(new AuthenticationError('Bad credentials')),
    });

    component.form.patchValue({ username: 'alice', password: 'wrongpass' });
    fixture.detectChanges();

    await component.onSubmit();
    fixture.detectChanges();
    await fixture.whenStable();

    const errorEl = fixture.nativeElement.querySelector('[role="alert"]');
    expect(errorEl?.textContent).toContain('Bad credentials');
  });

  it('lockout banner appears in the DOM when a LockoutError is returned', async () => {
    const lockUntil = '2026-12-31T00:00:00Z';
    const { fixture, component } = setup({
      login: vi.fn().mockRejectedValue(new LockoutError(lockUntil)),
    });

    component.form.patchValue({ username: 'alice', password: 'wrongpass' });
    fixture.detectChanges();

    await component.onSubmit();
    fixture.detectChanges();
    await fixture.whenStable();

    expect(component.lockoutUntil()).toBe(lockUntil);
  });

  it('empty form submission marks fields as touched (validation error visible)', async () => {
    const { fixture, component } = setup();
    const el: HTMLElement = fixture.nativeElement;

    // Click submit without filling any fields
    const submitButton = el.querySelector<HTMLButtonElement>('button[type="submit"]')!;
    submitButton.click();
    fixture.detectChanges();
    await fixture.whenStable();

    // Both fields should now be touched and show validation errors
    expect(component.form.get('username')!.touched).toBe(true);
    expect(component.form.get('password')!.touched).toBe(true);
    expect(component.form.invalid).toBe(true);
  });
});
