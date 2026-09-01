import { Injectable, effect, inject } from '@angular/core';
import { Router } from '@angular/router';
import { CurrentUserService } from '@core/application/auth/current-user.service';

/**
 * SessionExpiryNavigatorService
 *
 * Turns a session that has just expired into an actual redirect, while a tab
 * is open. Without this, `authGuard` only re-checks on the *next* navigation —
 * `CurrentUserService.logout()`'s own expiry timer (or a 401 caught by
 * `sessionExpiryInterceptor`) clears the session correctly, but a person
 * sitting on an already-activated route sees nothing change until they try to
 * navigate somewhere else.
 *
 * Registered once via `provideAppInitializer` in `app.config.ts` — injecting
 * it is what constructs it, which is what registers the effect below, the
 * same pattern `SyncSessionCredentialService` already uses for the same
 * reason (an effect with no component to own it needs an explicit place to
 * start living).
 */
@Injectable({ providedIn: 'root' })
export class SessionExpiryNavigatorService {
  private readonly currentUser = inject(CurrentUserService);
  private readonly router = inject(Router);
  private wasAuthenticated = this.currentUser.isAuthenticated();

  constructor() {
    effect(() => {
      const authenticated = this.currentUser.isAuthenticated();
      const reason = this.currentUser.logoutReason();
      const justExpired = this.wasAuthenticated && !authenticated && reason === 'expired';
      this.wasAuthenticated = authenticated;

      if (justExpired) {
        void this.router.navigate(['/login'], { queryParams: { reason: 'expired' } });
      }
    });
  }
}
