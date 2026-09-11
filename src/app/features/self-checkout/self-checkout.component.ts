import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { Router } from '@angular/router';
import { SELF_CHECKOUT_TITLE } from './self-checkout-palette';
import { SelfCheckoutScanComponent } from './self-checkout-scan.component';

/**
 * SelfCheckoutComponent
 *
 * The customer-facing lane: a full-screen takeover, registered as its own
 * top-level route the same way `/clerk` is rather than as a child of `/pos`.
 * A nested child route would inherit the terminal's staff chrome and staff
 * guard, and this screen is the one place in the app a non-operator touches.
 *
 * Like `/clerk` it renders `fixed inset-0` over the app navigation on purpose:
 * this is a mode, not a screen you glance at, and a nav bar pointing at
 * Inventory or Reports in front of a customer is an invitation to wander into
 * staff screens.
 *
 * The shell owns the takeover and the way out; the scan-to-cart panel inside it is
 * its own component so the lane's hardware lifecycle and cart mechanics do not
 * live in the chrome. The lane is deliberately unguarded for now — the staff
 * `authGuard` is the wrong gate here, and real customer-session gating arrives
 * with the `CUSTOMER_AUTH_GATEWAY` adapter. Sign-up, sign-in and the pay step are
 * separate items and land inside this shell.
 */
@Component({
  selector: 'app-self-checkout',
  standalone: true,
  imports: [SelfCheckoutScanComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './self-checkout.component.html',
})
export class SelfCheckoutComponent {
  private readonly router = inject(Router);

  protected readonly title = SELF_CHECKOUT_TITLE;

  /**
   * The way back to the till.
   *
   * Present even in the shell: without it a customer or a passing operator who
   * opens the lane on a shared terminal has no exit but the browser chrome,
   * which a kiosk build does not show.
   */
  protected exit(): void {
    void this.router.navigate(['/pos']);
  }
}
