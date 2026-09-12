import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { Router } from '@angular/router';
import { LANE_ROUTE } from './self-checkout-signup.component';

/**
 * SelfCheckoutCheckEmailComponent — placeholder for Epic #261 item 17 (#311).
 *
 * The sign-up form has to land somewhere: item 3 proved a freshly created
 * account is `PENDING` and cannot complete a password grant, so the only honest
 * destination after a `201` is "we sent you a verification email". Item 17 owns
 * that screen. This stands in for it so the flow terminates on a real route
 * rather than inventing a signed-in state, and so `route-smoke` has something to
 * assert — item 17 replaces the body, not the route.
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
        Your account has been created. Open the verification link we emailed you before signing in —
        you can keep shopping in the meantime.
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

  protected backToLane(): void {
    void this.router.navigate([LANE_ROUTE]);
  }
}
