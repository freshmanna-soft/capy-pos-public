import { inject } from '@angular/core';
import { CanActivateFn } from '@angular/router';
import { CurrentCustomerService } from '@core/application/auth/current-customer.service';

/**
 * Restores the customer session before any child route decides whether the
 * visitor belongs on a guest-only screen.
 *
 * This guard lives on the componentless `/self-checkout` parent. Angular runs
 * parent guards before child guards, so a direct visit to sign-up or sign-in
 * cannot mistake a persisted customer session for an anonymous visitor.
 * Authentication remains optional: a missing, expired, or unreadable session
 * never blocks the lane.
 */
export const customerSessionHydrationGuard: CanActivateFn = async () => {
  const currentCustomer = inject(CurrentCustomerService);

  try {
    await currentCustomer.hydrate();
  } catch (error) {
    console.warn('Customer session hydration failed (continuing anonymously):', error);
  }

  return true;
};
