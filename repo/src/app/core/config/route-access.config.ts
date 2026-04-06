import { UserRole } from '../enums';

/**
 * Describes one route's role-access policy and its optional nav presence.
 */
export interface RouteAccess {
  /** Router path segment — no leading slash, no trailing slash, no params. */
  path: string;
  /**
   * UserRoles whose activeRole value grants access to this route.
   * Every entry must match a real UserRole enum value.
   */
  roles: UserRole[];
  /** Sidebar label.  Empty string = not shown in nav. */
  navLabel: string;
  /** Sidebar icon character.  Empty string = not shown in nav. */
  navIcon: string;
}

/**
 * All five roles — used for routes open to every authenticated user.
 * Defined once here so it cannot drift between route config and nav config.
 */
export const ALL_AUTHENTICATED_ROLES: UserRole[] = [
  UserRole.Candidate,
  UserRole.Employer,
  UserRole.HRCoordinator,
  UserRole.Interviewer,
  UserRole.Administrator,
];

/**
 * SINGLE SOURCE OF TRUTH for route-level role access + sidebar navigation.
 *
 * Rules:
 *  - `roles` must list every UserRole that may access the route while that role
 *    is the user's activeRole.
 *  - The router (canActivate roleGuard + route.data.roles) and the app-shell
 *    sidebar both read from this table.  Change it here to change access everywhere.
 *  - Keep entries in sidebar display order.
 *  - Non-nav routes go at the bottom with empty navLabel/navIcon.
 */
export const ROUTE_ACCESS: RouteAccess[] = [
  {
    path: 'dashboard',
    roles: [...ALL_AUTHENTICATED_ROLES],
    navLabel: 'Dashboard',
    navIcon: '⊞',
  },
  {
    path: 'jobs',
    roles: [UserRole.Candidate, UserRole.Employer, UserRole.HRCoordinator, UserRole.Administrator],
    navLabel: 'Jobs',
    navIcon: '💼',
  },
  {
    path: 'applications',
    roles: [UserRole.Candidate, UserRole.Employer, UserRole.HRCoordinator, UserRole.Administrator],
    navLabel: 'Applications',
    navIcon: '📋',
  },
  {
    path: 'interviews',
    roles: [...ALL_AUTHENTICATED_ROLES],
    navLabel: 'Interviews',
    navIcon: '🗓',
  },
  {
    path: 'message-center',
    roles: [...ALL_AUTHENTICATED_ROLES],
    navLabel: 'Messages',
    navIcon: '💬',
  },
  {
    path: 'notifications',
    roles: [...ALL_AUTHENTICATED_ROLES],
    navLabel: 'Notifications',
    navIcon: '🔔',
  },
  {
    path: 'documents',
    roles: [UserRole.Candidate, UserRole.Employer, UserRole.HRCoordinator, UserRole.Administrator],
    navLabel: 'Documents',
    navIcon: '📄',
  },
  {
    path: 'content',
    roles: [UserRole.Employer, UserRole.HRCoordinator, UserRole.Administrator],
    navLabel: 'Content',
    navIcon: '📢',
  },
  {
    path: 'moderation',
    roles: [UserRole.HRCoordinator, UserRole.Administrator],
    navLabel: 'Moderation',
    navIcon: '🛡',
  },
  {
    path: 'governance',
    roles: [UserRole.HRCoordinator, UserRole.Administrator],
    navLabel: 'Governance',
    navIcon: '📊',
  },
  {
    path: 'integration',
    roles: [UserRole.Administrator],
    navLabel: 'Integration',
    navIcon: '🔌',
  },
  {
    path: 'admin',
    roles: [UserRole.Administrator],
    navLabel: 'Admin',
    navIcon: '⚙',
  },
  // ── Non-nav routes ────────────────────────────────────────────────────────
  {
    path: 'application-packet',
    roles: [UserRole.Candidate],
    navLabel: '',
    navIcon: '',
  },
  {
    path: 'jobs/:jobId',
    roles: [UserRole.Candidate, UserRole.Employer, UserRole.HRCoordinator, UserRole.Administrator],
    navLabel: '',
    navIcon: '',
  },
  {
    path: 'applications/:applicationId',
    roles: [UserRole.Candidate, UserRole.Employer, UserRole.HRCoordinator, UserRole.Administrator],
    navLabel: '',
    navIcon: '',
  },
  {
    path: 'interviews/:interviewId',
    roles: [...ALL_AUTHENTICATED_ROLES],
    navLabel: '',
    navIcon: '',
  },
];

/**
 * Retrieve the access config for a given path.
 * Throws at startup if the path is not registered — catches mis-spellings early.
 */
export function getRouteAccess(path: string): RouteAccess {
  const entry = ROUTE_ACCESS.find(r => r.path === path);
  if (!entry) {
    throw new Error(`[RouteAccess] No config entry found for path: "${path}"`);
  }
  return entry;
}

/**
 * Entries that should appear in the sidebar navigation (navLabel non-empty).
 * Exported so app-shell can filter without re-filtering the full table.
 */
export const NAV_ROUTE_ACCESS: RouteAccess[] = ROUTE_ACCESS.filter(r => r.navLabel !== '');
