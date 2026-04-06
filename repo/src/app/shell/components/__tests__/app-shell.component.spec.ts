/**
 * AppShellComponent tests
 *
 * Tests cover: role-based navigation filtering, formatRole helper,
 * and cross-tab logout via BroadcastChannel.
 */

import { describe, it, expect, beforeAll, afterEach, vi } from 'vitest';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { signal, computed } from '@angular/core';
import { AppShellComponent } from '../app-shell.component';
import { SessionService } from '../../../core/services/session.service';
import { UserRole } from '../../../core/enums';
import { NAV_ROUTE_ACCESS } from '../../../core/config/route-access.config';

afterEach(() => {
  TestBed.resetTestingModule();
});

function makeMockSession(role: UserRole | null, opts: { authenticated?: boolean; roles?: UserRole[] } = {}) {
  return {
    isAuthenticated: computed(() => opts.authenticated ?? true),
    activeRole: signal(role),
    currentUser: signal({ displayName: 'Test User' }),
    userRoles: computed(() => opts.roles ?? (role ? [role] : [])),
    initialized: signal(true),
    switchRole: vi.fn(),
    logout: vi.fn().mockResolvedValue(undefined),
    sessionRejectionReason: signal(null),
  };
}

function createComponent(role: UserRole | null, opts: { authenticated?: boolean; roles?: UserRole[] } = {}) {
  const mockSession = makeMockSession(role, opts);

  TestBed.configureTestingModule({
    imports: [AppShellComponent],
    providers: [
      provideRouter([]),
      { provide: SessionService, useValue: mockSession },
    ],
  });

  const fixture = TestBed.createComponent(AppShellComponent);
  const component = fixture.componentInstance;
  return { component, fixture, mockSession };
}

// ── Role-based nav filtering ─────────────────────────────────────────────────

describe('AppShellComponent — filteredNav', () => {
  it('returns only nav items accessible by Candidate role', () => {
    const { component } = createComponent(UserRole.Candidate);
    const nav = component.filteredNav();
    const labels = nav.map(n => n.navLabel);
    expect(labels).toContain('Dashboard');
    expect(labels).toContain('Jobs');
    expect(labels).toContain('Applications');
    expect(labels).toContain('Interviews');
    expect(labels).toContain('Documents');
    expect(labels).not.toContain('Admin');
    expect(labels).not.toContain('Moderation');
    expect(labels).not.toContain('Governance');
    expect(labels).not.toContain('Integration');
    expect(labels).not.toContain('Content');
  });

  it('returns all nav items for Administrator role', () => {
    const { component } = createComponent(UserRole.Administrator);
    const nav = component.filteredNav();
    // Administrator should see all nav items
    expect(nav.length).toBe(NAV_ROUTE_ACCESS.length);
  });

  it('returns Interviewer-restricted nav items', () => {
    const { component } = createComponent(UserRole.Interviewer);
    const nav = component.filteredNav();
    const labels = nav.map(n => n.navLabel);
    expect(labels).toContain('Dashboard');
    expect(labels).toContain('Interviews');
    expect(labels).toContain('Messages');
    expect(labels).toContain('Notifications');
    expect(labels).not.toContain('Jobs');
    expect(labels).not.toContain('Applications');
    expect(labels).not.toContain('Documents');
    expect(labels).not.toContain('Admin');
  });

  it('returns empty array when no active role', () => {
    const { component } = createComponent(null);
    expect(component.filteredNav()).toEqual([]);
  });
});

// ── formatRole ───────────────────────────────────────────────────────────────

describe('AppShellComponent — formatRole', () => {
  it('converts hr_coordinator to Hr Coordinator', () => {
    const { component } = createComponent(UserRole.Candidate);
    expect(component.formatRole('hr_coordinator')).toBe('Hr Coordinator');
  });

  it('capitalizes single-word roles', () => {
    const { component } = createComponent(UserRole.Candidate);
    expect(component.formatRole('candidate')).toBe('Candidate');
  });
});

// ── Cross-tab logout ─────────────────────────────────────────────────────────

describe('AppShellComponent — cross-tab behavior', () => {
  it('nav shows no items when session becomes unauthenticated', () => {
    const { component, mockSession } = createComponent(UserRole.Candidate);
    expect(component.filteredNav().length).toBeGreaterThan(0);

    // Simulate cross-tab logout: activeRole becomes null
    mockSession.activeRole.set(null);
    expect(component.filteredNav()).toEqual([]);
  });
});
