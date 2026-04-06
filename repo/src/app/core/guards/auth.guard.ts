import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';
import { SessionService } from '../services/session.service';

export const authGuard: CanActivateFn = async () => {
  const session = inject(SessionService);
  const router = inject(Router);
  if (session.isAuthenticated()) return true;
  const restored = await session.restoreSession();
  if (restored) return true;
  return router.createUrlTree(['/login']);
};
