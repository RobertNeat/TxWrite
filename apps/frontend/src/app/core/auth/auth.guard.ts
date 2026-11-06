import { inject } from '@angular/core';
import { Router, type CanActivateFn } from '@angular/router';
import { AuthService } from './auth.service.js';

export const authGuard: CanActivateFn = async () => {
  const auth = inject(AuthService);
  const router = inject(Router);
  await auth.ready;
  if (auth.isAuthenticated()) {
    return true;
  }
  return router.createUrlTree(['/']);
};
