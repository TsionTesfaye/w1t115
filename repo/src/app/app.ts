import { Component, inject, OnInit, effect } from '@angular/core';
import { Router } from '@angular/router';
import { AppShellComponent } from './shell/components/app-shell.component';
import { SessionService } from './core/services/session.service';
import { SchedulerService } from './core/services/scheduler.service';
import { GovernanceService } from './core/services/governance.service';
import { UserRepository } from './core/repositories';
import { UserRole } from './core/enums';

@Component({
  selector: 'app-root',
  standalone: true,
  imports: [AppShellComponent],
  templateUrl: './app.html',
})
export class App implements OnInit {
  protected readonly session = inject(SessionService);
  private readonly scheduler = inject(SchedulerService);
  private readonly governance = inject(GovernanceService);
  private readonly userRepo = inject(UserRepository);
  private readonly router = inject(Router);

  constructor() {
    /**
     * Cross-tab logout / session invalidation effect.
     *
     * Fires whenever `isAuthenticated` or `initialized` changes.
     * Once the app has finished its startup restore, any drop to
     * unauthenticated state (own logout, cross-tab logout, session expiry)
     * redirects to /login.
     */
    effect(() => {
      if (this.session.initialized() && !this.session.isAuthenticated()) {
        // Avoid redundant navigation if already on the login page.
        if (!this.router.url.startsWith('/login')) {
          this.router.navigate(['/login']);
        }
      }
    });
  }

  async ngOnInit(): Promise<void> {
    // Restore session before anything else so guards have correct state.
    await this.session.restoreSession();

    // On first run (no admin users exist) redirect to the setup wizard.
    await this.checkFirstRun();

    // Start scheduler leader election.
    this.scheduler.start();

    // Seed static governance data (idempotent).
    await this.governance.seedMetrics();
    await this.governance.seedDataDictionary();
  }

  /**
   * Checks whether any Administrator account exists.
   * If none is found and the user is not already on /setup, redirects there
   * so that the first operator can create an admin account securely via the UI
   * instead of relying on a hardcoded bootstrap credential.
   */
  private async checkFirstRun(): Promise<void> {
    try {
      const users = await this.userRepo.getAll();
      const hasAdmin = users.some(u => (u.roles as string[]).includes(UserRole.Administrator));
      if (!hasAdmin && !this.router.url.startsWith('/setup')) {
        await this.router.navigate(['/setup']);
      }
    } catch {
      // Non-fatal: if IDB is unavailable during startup, fall through normally.
    }
  }
}
