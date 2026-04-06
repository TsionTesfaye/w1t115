import { Injectable, signal, computed } from '@angular/core';
import { User, Session } from '../models';
import { UserRole } from '../enums';
import { AuthService, SessionRejectionReason } from './auth.service';
import { BROADCAST_CHANNELS } from '../constants';

const SESSION_STORAGE_KEY = 'tb_active_session_id';
const ACTIVE_ROLE_KEY = 'tb_active_role';

@Injectable({ providedIn: 'root' })
export class SessionService {
  private readonly _currentUser = signal<User | null>(null);
  private readonly _currentSession = signal<Session | null>(null);
  private readonly _activeRole = signal<UserRole | null>(null);
  /**
   * True once the first restoreSession() call has completed (whether it
   * succeeded or not).  Components and effects gate on this to avoid acting
   * on transient unauthenticated state during app startup.
   */
  private readonly _initialized = signal(false);
  /**
   * Reason the most recent session was rejected, if any.
   * Set when restoreSession() finds an expired, locked, or deactivated session.
   * Cleared on successful login (setSession) or voluntary logout.
   * Displayed by the login page to explain why the user was sent there.
   */
  private readonly _sessionRejectionReason = signal<SessionRejectionReason | null>(null);

  readonly currentUser = this._currentUser.asReadonly();
  readonly currentSession = this._currentSession.asReadonly();
  readonly activeRole = this._activeRole.asReadonly();
  readonly initialized = this._initialized.asReadonly();
  readonly sessionRejectionReason = this._sessionRejectionReason.asReadonly();
  readonly isAuthenticated = computed(() => this._currentUser() !== null && this._currentSession() !== null);
  readonly organizationId = computed(() => this._currentUser()?.organizationId ?? null);
  readonly userId = computed(() => this._currentUser()?.id ?? null);
  readonly userRoles = computed(() => (this._currentUser()?.roles ?? []) as UserRole[]);

  /**
   * In-flight promise deduplication for restoreSession().
   *
   * Prevents concurrent callers (e.g. App.ngOnInit + authGuard) from each
   * issuing a separate validateSession() call to IndexedDB on the same
   * session ID.  The first caller creates the promise; subsequent concurrent
   * callers receive the same promise reference.
   */
  private _restoreInFlight: Promise<boolean> | null = null;

  private sessionChannel: BroadcastChannel | null = null;

  constructor(private readonly authService: AuthService) {
    this.initBroadcastChannel();
  }

  private initBroadcastChannel(): void {
    if (typeof BroadcastChannel === 'undefined') return;
    this.sessionChannel = new BroadcastChannel(BROADCAST_CHANNELS.SESSION);
    this.sessionChannel.onmessage = (event) => {
      if (event.data.type === 'logout') {
        /**
         * Another tab logged out (or a new user logged in and forced this tab
         * out).  Clear our local session; the App effect watching
         * isAuthenticated() will navigate to /login.
         *
         * We deliberately do NOT handle 'session_update' here — syncing a new
         * session from another tab risks adopting a different user's identity
         * when localStorage is shared (cross-user contamination).  New logins
         * broadcast 'logout' to force all other tabs out safely.
         */
        this._sessionRejectionReason.set('superseded');
        this.clearLocalSession();
      }
    };
  }

  /**
   * Called immediately after a successful login.
   *
   * Session isolation guarantee: broadcasts 'logout' to ALL other tabs before
   * writing the new session to localStorage.  This ensures no other tab can
   * silently adopt a different user's session via a session_update message.
   *
   * Sets the active role to the first role by default; persists session ID and
   * initial role to localStorage for cross-reload restoration.
   */
  setSession(user: User, session: Session): void {
    // Force all other tabs to log out before we write our session to localStorage.
    // This prevents a different-user tab from adopting our session via restore.
    this.sessionChannel?.postMessage({ type: 'logout' });

    const defaultRole = (user.roles[0] as UserRole) ?? null;
    this._currentUser.set(user);
    this._currentSession.set(session);
    this._activeRole.set(defaultRole);
    this._initialized.set(true);
    this._sessionRejectionReason.set(null);
    localStorage.setItem(SESSION_STORAGE_KEY, session.id);
    if (defaultRole) localStorage.setItem(ACTIVE_ROLE_KEY, defaultRole);
  }

  /**
   * Switch the active role.  Only allowed if the user actually holds the role.
   * Persists the new choice to localStorage so it survives page reloads.
   */
  switchRole(role: UserRole): void {
    const user = this._currentUser();
    if (!user || !user.roles.includes(role)) {
      throw new Error(`User does not have role: ${role}`);
    }
    this._activeRole.set(role);
    localStorage.setItem(ACTIVE_ROLE_KEY, role);
  }

  hasRole(role: UserRole): boolean {
    return this._currentUser()?.roles.includes(role) ?? false;
  }

  hasAnyRole(roles: UserRole[]): boolean {
    const userRoles = this._currentUser()?.roles ?? [];
    return roles.some(r => userRoles.includes(r));
  }

  async logout(): Promise<void> {
    const session = this._currentSession();
    const user = this._currentUser();
    if (session && user) {
      await this.authService.logout(session.id, user.id, user.organizationId);
    }
    this._sessionRejectionReason.set(null);
    this.clearLocalSession();
    this.sessionChannel?.postMessage({ type: 'logout' });
  }

  /**
   * Restore a session from localStorage.
   *
   * Single-flight: concurrent callers share the same in-flight Promise so
   * only one validateSession() call reaches IndexedDB per restore cycle.
   *
   * On success: restores the saved activeRole (falls back to roles[0] if the
   * saved role is no longer valid for the user).  Clears any prior rejection
   * reason.
   *
   * On failure: persists the rejection reason so the login page can explain
   * why the user was redirected.
   *
   * Always sets _initialized = true so callers can gate on readiness.
   */
  async restoreSession(): Promise<boolean> {
    if (this._restoreInFlight) {
      return this._restoreInFlight;
    }
    this._restoreInFlight = this._executeRestore();
    try {
      return await this._restoreInFlight;
    } finally {
      this._restoreInFlight = null;
    }
  }

  private async _executeRestore(): Promise<boolean> {
    try {
      const sessionId = localStorage.getItem(SESSION_STORAGE_KEY);
      if (!sessionId) return false;

      const result = await this.authService.validateSession(sessionId);
      if (!result.valid) {
        this._sessionRejectionReason.set(result.reason);
        this.clearLocalSession();
        return false;
      }

      // Resolve the active role: prefer the saved role if still valid.
      const savedRole = localStorage.getItem(ACTIVE_ROLE_KEY) as UserRole | null;
      const userRoles = result.user.roles as UserRole[];
      const activeRole = savedRole && userRoles.includes(savedRole)
        ? savedRole
        : (userRoles[0] ?? null);

      this._currentUser.set(result.user);
      this._currentSession.set(result.session);
      this._activeRole.set(activeRole);
      this._sessionRejectionReason.set(null);
      if (activeRole) localStorage.setItem(ACTIVE_ROLE_KEY, activeRole);
      return true;
    } finally {
      this._initialized.set(true);
    }
  }

  /** Throw a structured error if the caller is not authenticated. */
  requireAuth(): { userId: string; organizationId: string; roles: UserRole[]; activeRole: UserRole } {
    const user = this._currentUser();
    const role = this._activeRole();
    if (!user || !role) throw new Error('Authentication required');
    return {
      userId: user.id,
      organizationId: user.organizationId,
      roles: user.roles as UserRole[],
      activeRole: role,
    };
  }

  private clearLocalSession(): void {
    this._currentUser.set(null);
    this._currentSession.set(null);
    this._activeRole.set(null);
    localStorage.removeItem(SESSION_STORAGE_KEY);
    localStorage.removeItem(ACTIVE_ROLE_KEY);
  }
}
