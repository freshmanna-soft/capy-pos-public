import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { Router } from '@angular/router';
import { PendingRegistrationStore } from './pending-registration.store';
import { LANE_ROUTE } from './self-checkout-routes';

/**
 * SelfCheckoutCheckEmailComponent — placeholder for Epic #261 item 17 (#311).
 *
 * The sign-up form has to land somewhere: item 3 proved a freshly created
 * account is `PENDING` and cannot complete a password grant, so the only honest
 * destination after a `201` is "we sent you a verification email". Item 17 owns
 * that screen. This stands in for it so the flow terminates on a real route
 * rather than inventing a signed-in state, and so `route-smoke` has something to
 * assert — item 17 replaces the body, not the route.
 *
 * It does read the registration, though, because the alternative was worse than
 * incomplete: the form used to pass the address as `queryParams: { email }` and
 * this screen injected only `Router`, so a shopper's address sat in the address
 * bar and history of a shared terminal and named nothing. The address now arrives
 * through {@link PendingRegistrationStore} — one instance, shared via the
 * `self-checkout` parent route's injector — and is taken exactly once, so the
 * inbox is named for the customer who just signed up and for nobody standing at
 * the terminal afterwards. When it is absent (a reload, or someone opening this
 * URL directly) the copy simply does not name an inbox; it never guesses one.
 */
@Component({
  selector: 'app-self-checkout-check-email',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div
      class="fixed inset-0 z-[60] flex flex-col items-center justify-center gap-4 bg-onsen-deep px-6 text-center text-steam"
      data-testid="self-checkout-check-email"
    >
      <h1 class="text-2xl font-semibold tracking-tight">Check your email</h1>
      <p class="max-w-sm text-sm text-kelp">
        @if (email) {
          Your account has been created. Open the verification link we emailed to
          <span class="font-semibold text-steam" data-testid="check-email-address">{{
            email
          }}</span>
          before signing in — you can keep shopping in the meantime.
        } @else {
          Your account has been created. Open the verification link we emailed you before signing in
          — you can keep shopping in the meantime.
        }
      </p>
      <button
        type="button"
        (click)="backToLane()"
        class="rounded-xl border border-yuzu/60 px-4 py-3 font-semibold text-yuzu focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-yuzu"
        data-testid="check-email-back-to-lane"
      >
        Back to checkout
      </button>
    </div>
  `,
})
export class SelfCheckoutCheckEmailComponent {
  private readonly router = inject(Router);

  /**
   * The inbox to name, or null when this screen was reached without a
   * registration in flight.
   *
   * Taken once, here, rather than read from the store in the template: the store
   * clears on read, and a template that read it directly would clear it on the
   * first change-detection pass and then render nothing on the next.
   */
  protected readonly email = inject(PendingRegistrationStore).take();

  protected backToLane(): void {
    void this.router.navigate([LANE_ROUTE]);
  }
}
