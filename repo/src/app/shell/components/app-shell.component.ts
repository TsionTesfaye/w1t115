import { Component, computed, inject, signal, effect } from '@angular/core';
import { RouterOutlet, RouterLink, RouterLinkActive, Router } from '@angular/router';
import { CommonModule } from '@angular/common';
import { SessionService } from '../../core/services/session.service';
import { UserRole } from '../../core/enums';
import { NAV_ROUTE_ACCESS } from '../../core/config/route-access.config';

@Component({
  selector: 'app-shell',
  standalone: true,
  imports: [CommonModule, RouterOutlet, RouterLink, RouterLinkActive],
  template: `
    @if (session.isAuthenticated()) {
      <div class="shell" [class.nav-open]="navOpen()">

        <!-- Mobile header bar -->
        <header class="mobile-header" role="banner">
          <button
            class="hamburger"
            type="button"
            [attr.aria-expanded]="navOpen()"
            aria-controls="sidebar-nav"
            aria-label="Toggle navigation menu"
            (click)="toggleNav()"
          >
            <span class="ham-line"></span>
            <span class="ham-line"></span>
            <span class="ham-line"></span>
          </button>
          <span class="mobile-brand">TalentBridge</span>
          <span class="mobile-role-badge">{{ formatRole(session.activeRole() ?? '') }}</span>
        </header>

        <!-- Sidebar overlay (mobile) -->
        @if (navOpen()) {
          <div
            class="sidebar-overlay"
            aria-hidden="true"
            (click)="closeNav()"
          ></div>
        }

        <!-- Sidebar -->
        <nav
          id="sidebar-nav"
          class="sidebar"
          role="navigation"
          aria-label="Main navigation"
        >
          <!-- Brand + user info -->
          <div class="sidebar-header">
            <div class="brand-row">
              <span class="brand">TalentBridge</span>
            </div>
            <div class="user-info">
              <span class="user-name" [attr.aria-label]="'Signed in as ' + (session.currentUser()?.displayName ?? '')">
                {{ session.currentUser()?.displayName }}
              </span>
              <span
                class="role-badge"
                [attr.data-role]="session.activeRole()"
                [attr.aria-label]="'Active role: ' + formatRole(session.activeRole() ?? '')"
              >
                {{ formatRole(session.activeRole() ?? '') }}
              </span>
            </div>
          </div>

          <!-- Role switcher -->
          @if (session.userRoles().length > 1) {
            <div class="role-switcher" role="group" aria-label="Switch active role">
              <label for="role-select" class="role-switcher-label">Active role</label>
              <select
                id="role-select"
                class="role-select"
                [value]="session.activeRole()"
                (change)="onRoleChange($event)"
                aria-label="Select your active role"
              >
                @for (role of session.userRoles(); track role) {
                  <option [value]="role">{{ formatRole(role) }}</option>
                }
              </select>
            </div>
          }

          <!-- Nav items -->
          <ul class="nav-list" role="list">
            @for (item of filteredNav(); track item.path) {
              <li role="listitem">
                <a
                  [routerLink]="'/' + item.path"
                  routerLinkActive="active"
                  class="nav-link"
                  [attr.aria-label]="item.navLabel"
                  (click)="closeNav()"
                >
                  <span class="nav-icon" aria-hidden="true">{{ item.navIcon }}</span>
                  <span class="nav-label">{{ item.navLabel }}</span>
                </a>
              </li>
            }
          </ul>

          <!-- Logout -->
          <div class="sidebar-footer">
            <button
              type="button"
              class="logout-btn"
              (click)="onLogout()"
              aria-label="Sign out of TalentBridge"
            >
              Sign Out
            </button>
          </div>
        </nav>

        <!-- Main content -->
        <main class="main-content" id="main-content" role="main" tabindex="-1">
          <router-outlet />
        </main>
      </div>
    } @else {
      <!-- Unauthenticated: render only the router outlet (login page) -->
      <router-outlet />
    }
  `,
  styles: [`
    /* Shell layout */
    .shell {
      display: flex;
      min-height: 100vh;
      position: relative;
    }

    /* Sidebar */
    .sidebar {
      width: 240px;
      background: #1a1a2e;
      color: #e0e0e0;
      display: flex;
      flex-direction: column;
      flex-shrink: 0;
      position: sticky;
      top: 0;
      height: 100vh;
      overflow-y: auto;
    }
    .sidebar-header {
      padding: 1.25rem 1rem 1rem;
      border-bottom: 1px solid #2a2a4a;
    }
    .brand-row { margin-bottom: 0.6rem; }
    .brand { font-size: 1.15rem; font-weight: 700; color: #fff; letter-spacing: -0.3px; }
    .user-info { display: flex; flex-direction: column; gap: 0.2rem; }
    .user-name { font-size: 0.85rem; color: #b0b0d0; }
    .role-badge {
      display: inline-block;
      padding: 0.15rem 0.5rem;
      border-radius: 10px;
      font-size: 0.72rem;
      font-weight: 600;
      text-transform: uppercase;
      letter-spacing: 0.04em;
      background: #2a2a5a;
      color: #8080e0;
      width: fit-content;
    }
    .role-badge[data-role="administrator"] { background: #2a1a1a; color: #ff8888; }
    .role-badge[data-role="hr_coordinator"] { background: #1a2a1a; color: #88cc88; }
    .role-badge[data-role="employer"] { background: #1a2a2a; color: #88cccc; }
    .role-badge[data-role="interviewer"] { background: #2a2a1a; color: #cccc88; }

    /* Role switcher */
    .role-switcher {
      padding: 0.6rem 1rem;
      border-bottom: 1px solid #2a2a4a;
    }
    .role-switcher-label {
      display: block;
      font-size: 0.72rem;
      color: #7070a0;
      text-transform: uppercase;
      letter-spacing: 0.06em;
      margin-bottom: 0.3rem;
    }
    .role-select {
      width: 100%;
      padding: 0.35rem 0.5rem;
      border-radius: 4px;
      border: 1px solid #3a3a5a;
      background: #2a2a4a;
      color: #e0e0e0;
      font-size: 0.85rem;
      cursor: pointer;
    }
    .role-select:focus {
      outline: 2px solid #6060ff;
      outline-offset: 1px;
    }

    /* Nav list */
    .nav-list {
      list-style: none;
      padding: 0.5rem 0;
      margin: 0;
      flex: 1;
    }
    .nav-link {
      display: flex;
      align-items: center;
      gap: 0.6rem;
      padding: 0.55rem 1rem;
      color: #b0b0d0;
      text-decoration: none;
      font-size: 0.88rem;
      border-left: 3px solid transparent;
      transition: background 0.15s, color 0.15s;
    }
    .nav-link:hover {
      background: #252540;
      color: #e0e0ff;
    }
    .nav-link.active {
      background: #252545;
      color: #fff;
      border-left-color: #6060ff;
    }
    .nav-link:focus-visible {
      outline: 2px solid #6060ff;
      outline-offset: -2px;
    }
    .nav-icon { font-size: 1rem; flex-shrink: 0; line-height: 1; }
    .nav-label { flex: 1; }

    /* Sidebar footer */
    .sidebar-footer {
      padding: 0.75rem 1rem;
      border-top: 1px solid #2a2a4a;
    }
    .logout-btn {
      width: 100%;
      padding: 0.5rem;
      border: 1px solid #4a4a6a;
      background: transparent;
      color: #9090c0;
      cursor: pointer;
      border-radius: 4px;
      font-size: 0.88rem;
      transition: background 0.15s, color 0.15s;
    }
    .logout-btn:hover { background: #2a2a4a; color: #e0e0e0; }
    .logout-btn:focus-visible { outline: 2px solid #6060ff; }

    /* Main content */
    .main-content {
      flex: 1;
      padding: 1.5rem;
      background: #f5f5fa;
      overflow-y: auto;
      min-height: 100vh;
    }
    .main-content:focus { outline: none; }

    /* Mobile */
    .mobile-header {
      display: none;
      align-items: center;
      gap: 0.75rem;
      padding: 0.75rem 1rem;
      background: #1a1a2e;
      color: #e0e0e0;
      position: sticky;
      top: 0;
      z-index: 100;
    }
    .mobile-brand { flex: 1; font-weight: 700; font-size: 1.05rem; color: #fff; }
    .mobile-role-badge {
      font-size: 0.75rem;
      background: #2a2a5a;
      color: #8080e0;
      padding: 0.15rem 0.5rem;
      border-radius: 10px;
      text-transform: capitalize;
    }
    .hamburger {
      background: none;
      border: none;
      cursor: pointer;
      padding: 0.25rem;
      display: flex;
      flex-direction: column;
      gap: 4px;
    }
    .ham-line {
      display: block;
      width: 20px;
      height: 2px;
      background: #e0e0e0;
      border-radius: 2px;
    }
    .hamburger:focus-visible { outline: 2px solid #6060ff; border-radius: 2px; }
    .sidebar-overlay {
      display: none;
      position: fixed;
      inset: 0;
      background: rgba(0,0,0,0.45);
      z-index: 98;
    }

    @media (max-width: 768px) {
      .shell { flex-direction: column; }
      .mobile-header { display: flex; }
      .sidebar {
        position: fixed;
        top: 0; left: 0;
        height: 100vh;
        width: 260px;
        z-index: 99;
        transform: translateX(-100%);
        visibility: hidden;
        transition: transform 0.25s ease, visibility 0.25s;
      }
      .nav-open .sidebar { transform: translateX(0); visibility: visible; }
      .nav-open .sidebar-overlay { display: block; }
      .main-content { padding: 1rem; min-height: calc(100vh - 50px); }
    }
  `],
})
export class AppShellComponent {
  readonly session = inject(SessionService);
  private readonly router = inject(Router);

  readonly navOpen = signal(false);

  /**
   * Sidebar nav entries filtered to those the current activeRole can access.
   * Derived directly from ROUTE_ACCESS — the single source of truth.
   */
  readonly filteredNav = computed(() => {
    const role = this.session.activeRole();
    if (!role) return [];
    return NAV_ROUTE_ACCESS.filter(entry => entry.roles.includes(role));
  });

  constructor() {
    /**
     * Role-change guard: if the user switches to a role that cannot access the
     * current route, navigate to /dashboard immediately.
     *
     * Uses NAV_ROUTE_ACCESS (same source as filteredNav) so the check is
     * always consistent with what is visible in the sidebar.
     */
    effect(() => {
      const role = this.session.activeRole();
      if (!role || !this.session.initialized()) return;
      const currentPath = this.router.url.split('?')[0].replace(/^\//, '');
      const routeEntry = NAV_ROUTE_ACCESS.find(r => r.path === currentPath);
      if (routeEntry && !routeEntry.roles.includes(role)) {
        this.router.navigate(['/dashboard']);
      }
    });
  }

  formatRole(role: string): string {
    return role.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
  }

  onRoleChange(event: Event): void {
    this.session.switchRole((event.target as HTMLSelectElement).value as UserRole);
    this.closeNav();
  }

  async onLogout(): Promise<void> {
    await this.session.logout();
    this.router.navigate(['/login']);
  }

  toggleNav(): void { this.navOpen.update(v => !v); }
  closeNav(): void { this.navOpen.set(false); }
}
