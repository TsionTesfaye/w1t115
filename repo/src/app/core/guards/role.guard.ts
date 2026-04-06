import { inject } from '@angular/core';
import { CanActivateFn, ActivatedRouteSnapshot, Router } from '@angular/router';
import { SessionService } from '../services/session.service';
import { UserRole } from '../enums';

/**
 * Enforces that the user's ACTIVE ROLE is in the required roles for the route.
 *
 * Correctness guarantee: uses session.activeRole() exclusively, not the full
 * roles[] array.  This means a user with [Candidate, Employer] whose activeRole
 * is Candidate cannot access Employer-only routes — they must first switch roles.
 *
 * The guard runs on every navigation, so a role switch that lands the user on an
 * inaccessible page will be caught on the next outbound navigation; the AppShell
 * also navigates proactively when it detects a role/route mismatch.
 */
export const roleGuard: CanActivateFn = (route: ActivatedRouteSnapshot) => {
  const session = inject(SessionService);
  const router = inject(Router);

  const requiredRoles = route.data?.['roles'] as UserRole[] | undefined;
  if (!requiredRoles || requiredRoles.length === 0) return true;

  if (!session.isAuthenticated()) return router.createUrlTree(['/login']);

  const activeRole = session.activeRole();
  if (!activeRole) return router.createUrlTree(['/login']);

  if (requiredRoles.includes(activeRole)) return true;
  return router.createUrlTree(['/dashboard']);
};
