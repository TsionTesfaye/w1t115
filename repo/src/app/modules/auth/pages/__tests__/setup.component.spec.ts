import { describe, it, expect, afterEach, vi } from 'vitest';
import { TestBed } from '@angular/core/testing';
import { provideRouter, Router } from '@angular/router';
import { signal, computed } from '@angular/core';
import { SetupComponent } from '../setup.component';
import { AuthService } from '../../../../core/services/auth.service';
import { UserRepository } from '../../../../core/repositories';
import { UserRole } from '../../../../core/enums';
import { ConflictError } from '../../../../core/errors';

afterEach(() => {
  vi.restoreAllMocks();
  TestBed.resetTestingModule();
});

function makeAuthMock() {
  return { register: vi.fn().mockResolvedValue(undefined) };
}

function makeUserRepo(users: { roles: string[] }[] = []) {
  return { getAll: vi.fn().mockResolvedValue(users) };
}

function createComponent(users: { roles: string[] }[] = []) {
  const authMock = makeAuthMock();
  const userRepoMock = makeUserRepo(users);

  TestBed.configureTestingModule({
    imports: [SetupComponent],
    providers: [
      provideRouter([]),
      { provide: AuthService, useValue: authMock },
      { provide: UserRepository, useValue: userRepoMock },
    ],
  });

  const fixture = TestBed.createComponent(SetupComponent);
  const component = fixture.componentInstance;
  return { component, fixture, authMock, userRepoMock };
}

// ── ngOnInit redirect ─────────────────────────────────────────────────────────

describe('SetupComponent — ngOnInit redirect', () => {
  it('redirects to /login when an administrator account already exists', async () => {
    const adminUser = { roles: [UserRole.Administrator] };
    const { component } = createComponent([adminUser]);
    const router = TestBed.inject(Router);
    const navigateSpy = vi.spyOn(router, 'navigate').mockResolvedValue(true);

    await component.ngOnInit();

    expect(navigateSpy).toHaveBeenCalledWith(['/login']);
  });

  it('does not redirect when no administrator exists', async () => {
    const { component } = createComponent([{ roles: [UserRole.Candidate] }]);
    const router = TestBed.inject(Router);
    const navigateSpy = vi.spyOn(router, 'navigate').mockResolvedValue(true);

    await component.ngOnInit();

    expect(navigateSpy).not.toHaveBeenCalled();
  });

  it('does not redirect when user list is empty', async () => {
    const { component } = createComponent([]);
    const router = TestBed.inject(Router);
    const navigateSpy = vi.spyOn(router, 'navigate').mockResolvedValue(true);

    await component.ngOnInit();

    expect(navigateSpy).not.toHaveBeenCalled();
  });

  it('allows form to render even when userRepo.getAll throws', async () => {
    const { component, userRepoMock } = createComponent();
    userRepoMock.getAll.mockRejectedValue(new Error('IDB unavailable'));
    const router = TestBed.inject(Router);
    const navigateSpy = vi.spyOn(router, 'navigate').mockResolvedValue(true);

    await component.ngOnInit();

    expect(navigateSpy).not.toHaveBeenCalled();
    expect(component.form).toBeDefined();
  });
});

// ── showError ─────────────────────────────────────────────────────────────────

describe('SetupComponent — form validation (showError)', () => {
  it('returns false for untouched fields', () => {
    const { component } = createComponent();
    expect(component.showError('displayName')).toBe(false);
    expect(component.showError('username')).toBe(false);
    expect(component.showError('password')).toBe(false);
  });

  it('returns true for touched-and-empty required fields', () => {
    const { component } = createComponent();
    component.form.get('displayName')!.markAsTouched();
    component.form.get('username')!.markAsTouched();
    expect(component.showError('displayName')).toBe(true);
    expect(component.showError('username')).toBe(true);
  });

  it('returns true for a dirty invalid field', () => {
    const { component } = createComponent();
    const pw = component.form.get('password')!;
    pw.setValue('weak');
    pw.markAsDirty();
    expect(component.showError('password')).toBe(true);
  });

  it('returns false once a field has a valid value', () => {
    const { component } = createComponent();
    const pw = component.form.get('password')!;
    pw.setValue('ValidPass1!');
    pw.markAsDirty();
    expect(component.showError('password')).toBe(false);
  });
});

// ── passwordStrength validator ─────────────────────────────────────────────────

describe('SetupComponent — password strength rules', () => {
  function testPassword(value: string, expectedError: string | null) {
    const { component } = createComponent();
    const pw = component.form.get('password')!;
    pw.setValue(value);
    if (expectedError === null) {
      expect(pw.errors).toBeNull();
    } else {
      expect(pw.errors).toHaveProperty(expectedError);
    }
    TestBed.resetTestingModule();
  }

  it('rejects passwords shorter than 10 characters', () => testPassword('Ab1!', 'tooShort'));
  it('rejects passwords without an uppercase letter', () => testPassword('alllower1!z', 'noUppercase'));
  it('rejects passwords without a digit', () => testPassword('AllUpperNoDig!', 'noDigit'));
  it('rejects passwords without a symbol', () => testPassword('ValidPass12', 'noSymbol'));
  it('accepts a fully compliant password', () => testPassword('ValidPass1!', null));
});

// ── onSubmit ──────────────────────────────────────────────────────────────────

describe('SetupComponent — onSubmit', () => {
  it('does not call auth.register when form is invalid', async () => {
    const { component, authMock } = createComponent();

    await component.onSubmit();

    expect(authMock.register).not.toHaveBeenCalled();
  });

  it('calls auth.register with correct args on valid submit', async () => {
    const { component, authMock } = createComponent();
    component.form.setValue({
      displayName: 'Alice Admin',
      username: 'alice',
      password: 'ValidPass1!',
    });

    const router = TestBed.inject(Router);
    vi.spyOn(router, 'navigate').mockResolvedValue(true);

    await component.onSubmit();

    expect(authMock.register).toHaveBeenCalledWith(
      'alice', 'ValidPass1!', 'Alice Admin', 'default-org', 'alice',
      [UserRole.Administrator],
    );
    expect(component.successMessage()).toContain('created');
  });

  it('shows error message when auth.register throws', async () => {
    const { component, authMock } = createComponent();
    component.form.setValue({
      displayName: 'Alice Admin',
      username: 'alice',
      password: 'ValidPass1!',
    });
    authMock.register.mockRejectedValue(new ConflictError('Username taken'));

    await component.onSubmit();

    expect(component.errorMessage()).toBe('Username taken');
    expect(component.isSubmitting()).toBe(false);
  });

  it('sets isSubmitting back to false after a failed submit', async () => {
    const { component, authMock } = createComponent();
    component.form.setValue({
      displayName: 'Bob',
      username: 'bob123',
      password: 'ValidPass1!',
    });
    authMock.register.mockRejectedValue(new Error('Unexpected error'));

    await component.onSubmit();

    expect(component.isSubmitting()).toBe(false);
  });

  it('clears errorMessage before each submit attempt', async () => {
    const { component, authMock } = createComponent();
    component.form.setValue({
      displayName: 'Carol',
      username: 'carol',
      password: 'ValidPass1!',
    });
    authMock.register
      .mockRejectedValueOnce(new Error('First failure'))
      .mockResolvedValue(undefined);

    await component.onSubmit();
    expect(component.errorMessage()).toBe('First failure');

    const router = TestBed.inject(Router);
    vi.spyOn(router, 'navigate').mockResolvedValue(true);
    await component.onSubmit();

    expect(component.errorMessage()).toBeNull();
    expect(component.successMessage()).toBeTruthy();
  });
});
