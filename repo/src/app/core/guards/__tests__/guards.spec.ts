/**
 * Route guard tests — authGuard and roleGuard.
 *
 * Guards use Angular's inject() — we test them via TestBed.runInInjectionContext()
 * which sets up the Angular DI environment without a full application bootstrap.
 */

import { describe, it, expect, afterEach } from 'vitest';
import { TestBed } from '@angular/core/testing';
import { provideRouter, Router, ActivatedRouteSnapshot, RouterStateSnapshot, UrlTree } from '@angular/router';
import { routes } from '../../../app.routes';
import { signal, computed } from '@angular/core';
import { authGuard } from '../auth.guard';
import { roleGuard } from '../role.guard';
import { SessionService } from '../../services/session.service';
import { UserRole } from '../../enums';

afterEach(() => {
  TestBed.resetTestingModule();
});

// ── Mock SessionService factory ───────────────────────────────────────────────

function makeMockSession(opts: {
  authenticated?: boolean;
  activeRole?: UserRole | null;
  roles?: UserRole[];
}) {
  const authenticated = opts.authenticated ?? false;
  const activeRole = opts.activeRole ?? null;
  const roles = opts.roles ?? [];

  return {
    isAuthenticated: computed(() => authenticated),
    activeRole: signal(activeRole),
    userRoles: computed(() => roles),
    initialized: signal(true),
    hasAnyRole: (rs: UserRole[]) => roles.some(r => rs.includes(r)),
    restoreSession: async () => {
      return authenticated;
    },
  };
}

function makeRoute(data: Record<string, unknown> = {}): ActivatedRouteSnapshot {
  return { data } as unknown as ActivatedRouteSnapshot;
}

const fakeState = {} as RouterStateSnapshot;

// ── authGuard ─────────────────────────────────────────────────────────────────

describe('authGuard', () => {
  it('returns true when already authenticated', async () => {
    TestBed.configureTestingModule({ providers: [provideRouter([])] });
    const mockSession = makeMockSession({ authenticated: true, activeRole: UserRole.Candidate });
    TestBed.overrideProvider(SessionService, { useValue: mockSession });
    const result = await TestBed.runInInjectionContext(() => authGuard(makeRoute(), fakeState));
    expect(result).toBe(true);
  });

  it('returns UrlTree(/login) when not authenticated and restore fails', async () => {
    TestBed.configureTestingModule({ providers: [provideRouter([])] });
    const mockSession = makeMockSession({ authenticated: false });
    TestBed.overrideProvider(SessionService, { useValue: mockSession });
    const result = await TestBed.runInInjectionContext(() => authGuard(makeRoute(), fakeState));
    expect(result).toBeInstanceOf(UrlTree);
    const url = TestBed.inject(Router).serializeUrl(result as UrlTree);
    expect(url).toBe('/login');
  });

  it('returns true when not initially authenticated but restoreSession succeeds', async () => {
    TestBed.configureTestingModule({ providers: [provideRouter([])] });
    let authState = false;
    const mockSession = {
      isAuthenticated: computed(() => authState),
      activeRole: signal(UserRole.Candidate),
      initialized: signal(false),
      restoreSession: async () => { authState = true; return true; },
    };
    TestBed.overrideProvider(SessionService, { useValue: mockSession });
    const result = await TestBed.runInInjectionContext(() => authGuard(makeRoute(), fakeState));
    expect(result).toBe(true);
  });
});

// ── roleGuard ─────────────────────────────────────────────────────────────────

describe('roleGuard', () => {
  it('returns true when no roles are required', () => {
    TestBed.configureTestingModule({ providers: [provideRouter([])] });
    const mockSession = makeMockSession({ authenticated: true, activeRole: UserRole.Candidate });
    TestBed.overrideProvider(SessionService, { useValue: mockSession });
    const result = TestBed.runInInjectionContext(() => roleGuard(makeRoute({}), fakeState));
    expect(result).toBe(true);
  });

  it('returns true when activeRole matches required roles', () => {
    TestBed.configureTestingModule({ providers: [provideRouter([])] });
    const mockSession = makeMockSession({ authenticated: true, activeRole: UserRole.HRCoordinator });
    TestBed.overrideProvider(SessionService, { useValue: mockSession });
    const route = makeRoute({ roles: [UserRole.HRCoordinator, UserRole.Administrator] });
    const result = TestBed.runInInjectionContext(() => roleGuard(route, fakeState));
    expect(result).toBe(true);
  });

  it('returns UrlTree(/dashboard) when activeRole is NOT in required roles', () => {
    TestBed.configureTestingModule({ providers: [provideRouter([])] });
    const mockSession = makeMockSession({ authenticated: true, activeRole: UserRole.Candidate });
    TestBed.overrideProvider(SessionService, { useValue: mockSession });
    // Route requires Employer or HR — Candidate activeRole must be rejected.
    const route = makeRoute({ roles: [UserRole.Employer, UserRole.HRCoordinator] });
    const result = TestBed.runInInjectionContext(() => roleGuard(route, fakeState));
    expect(result).toBeInstanceOf(UrlTree);
    const url = TestBed.inject(Router).serializeUrl(result as UrlTree);
    expect(url).toBe('/dashboard');
  });

  it('uses activeRole — not full roles[] — to determine access', () => {
    TestBed.configureTestingModule({ providers: [provideRouter([])] });
    // User has Employer in their roles[] but activeRole is Candidate.
    // They must NOT get access to Employer-only routes.
    const mockSession = makeMockSession({
      authenticated: true,
      activeRole: UserRole.Candidate,
      roles: [UserRole.Candidate, UserRole.Employer],
    });
    TestBed.overrideProvider(SessionService, { useValue: mockSession });
    const route = makeRoute({ roles: [UserRole.Employer] });
    const result = TestBed.runInInjectionContext(() => roleGuard(route, fakeState));
    expect(result).toBeInstanceOf(UrlTree);
    const url = TestBed.inject(Router).serializeUrl(result as UrlTree);
    expect(url).toBe('/dashboard');
  });

  it('returns UrlTree(/login) when not authenticated', () => {
    TestBed.configureTestingModule({ providers: [provideRouter([])] });
    const mockSession = makeMockSession({ authenticated: false });
    TestBed.overrideProvider(SessionService, { useValue: mockSession });
    const route = makeRoute({ roles: [UserRole.Administrator] });
    const result = TestBed.runInInjectionContext(() => roleGuard(route, fakeState));
    expect(result).toBeInstanceOf(UrlTree);
    const url = TestBed.inject(Router).serializeUrl(result as UrlTree);
    expect(url).toBe('/login');
  });

  it('returns UrlTree(/login) when authenticated but activeRole is null', () => {
    TestBed.configureTestingModule({ providers: [provideRouter([])] });
    const mockSession = makeMockSession({ authenticated: true, activeRole: null });
    TestBed.overrideProvider(SessionService, { useValue: mockSession });
    const route = makeRoute({ roles: [UserRole.Administrator] });
    const result = TestBed.runInInjectionContext(() => roleGuard(route, fakeState));
    expect(result).toBeInstanceOf(UrlTree);
    const url = TestBed.inject(Router).serializeUrl(result as UrlTree);
    expect(url).toBe('/login');
  });
});

// ── roleGuard — additional coverage ──────────────────────────────────────────

describe('roleGuard — session rejection paths', () => {
  it('redirects to /login when session is locked (authenticated=false after restore fails)', async () => {
    TestBed.configureTestingModule({ providers: [provideRouter([])] });
    // Simulate a locked session: restore fails, user stays unauthenticated
    const mockSession = makeMockSession({ authenticated: false });
    TestBed.overrideProvider(SessionService, { useValue: mockSession });
    const route = makeRoute({ roles: [UserRole.Administrator] });
    const result = TestBed.runInInjectionContext(() => roleGuard(route, fakeState));
    expect(result).toBeInstanceOf(UrlTree);
    const url = TestBed.inject(Router).serializeUrl(result as UrlTree);
    expect(url).toBe('/login');
  });

  it('redirects to /dashboard when authenticated but role changed away from required role', () => {
    TestBed.configureTestingModule({ providers: [provideRouter([])] });
    // User switched from HRCoordinator to Candidate; now tries to access moderation
    const mockSession = makeMockSession({
      authenticated: true,
      activeRole: UserRole.Candidate,
      roles: [UserRole.Candidate, UserRole.HRCoordinator],
    });
    TestBed.overrideProvider(SessionService, { useValue: mockSession });
    const route = makeRoute({ roles: [UserRole.HRCoordinator, UserRole.Administrator] });
    const result = TestBed.runInInjectionContext(() => roleGuard(route, fakeState));
    expect(result).toBeInstanceOf(UrlTree);
    const url = TestBed.inject(Router).serializeUrl(result as UrlTree);
    expect(url).toBe('/dashboard');
  });

  it('allows access to ALL_AUTHENTICATED_ROLES route for any valid activeRole', () => {
    for (const role of [UserRole.Candidate, UserRole.Employer, UserRole.HRCoordinator, UserRole.Interviewer, UserRole.Administrator]) {
      TestBed.configureTestingModule({ providers: [provideRouter([])] });
      const mockSession = makeMockSession({ authenticated: true, activeRole: role });
      TestBed.overrideProvider(SessionService, { useValue: mockSession });
      const route = makeRoute({ roles: [UserRole.Candidate, UserRole.Employer, UserRole.HRCoordinator, UserRole.Interviewer, UserRole.Administrator] });
      const result = TestBed.runInInjectionContext(() => roleGuard(route, fakeState));
      expect(result).toBe(true);
      TestBed.resetTestingModule();
    }
  });
});

// ── Route fallback configuration ──────────────────────────────────────────────

describe('route fallback configuration', () => {
  it("empty path '' redirects to 'dashboard' with pathMatch 'full'", () => {
    const emptyRoute = routes.find(r => r.path === '');
    expect(emptyRoute).toBeDefined();
    expect(emptyRoute!.redirectTo).toBe('dashboard');
    expect(emptyRoute!.pathMatch).toBe('full');
  });

  it("wildcard path '**' redirects to 'dashboard'", () => {
    const wildcardRoute = routes.find(r => r.path === '**');
    expect(wildcardRoute).toBeDefined();
    expect(wildcardRoute!.redirectTo).toBe('dashboard');
  });

  it("'**' route is declared after '' so it acts as a catch-all", () => {
    const emptyIdx    = routes.findIndex(r => r.path === '');
    const wildcardIdx = routes.findIndex(r => r.path === '**');
    expect(emptyIdx).toBeGreaterThanOrEqual(0);
    expect(wildcardIdx).toBeGreaterThan(emptyIdx);
  });

  it("public routes 'login' and 'setup' have no canActivate guards", () => {
    const loginRoute = routes.find(r => r.path === 'login');
    const setupRoute = routes.find(r => r.path === 'setup');
    expect(loginRoute?.canActivate).toBeUndefined();
    expect(setupRoute?.canActivate).toBeUndefined();
  });

  it("every authenticated route declares both authGuard and roleGuard", () => {
    const protectedPaths = [
      'dashboard', 'jobs', 'applications', 'interviews',
      'admin', 'documents', 'notifications',
    ];
    for (const path of protectedPaths) {
      const route = routes.find(r => r.path === path);
      expect(route, `route '${path}' not found`).toBeDefined();
      expect(route!.canActivate?.length, `route '${path}' missing guards`).toBeGreaterThanOrEqual(2);
    }
  });
});
