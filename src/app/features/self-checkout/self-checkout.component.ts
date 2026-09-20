import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { Router } from '@angular/router';
import { PAY_ROUTE, SIGN_IN_ROUTE, SIGN_UP_ROUTE } from './self-checkout-routes';
import { CurrentCustomerService } from '@core/application/auth/current-customer.service';
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
 *
 * **The route family owns its own cart.** `CartService` and `PosFacade` are
 * provided by the componentless `/self-checkout` parent rather than this lane
 * component. That keeps the customer basket isolated from the root staff till,
 * while letting it survive when the lane component is destroyed during a side
 * trip to sign-up, sign-in or check-email. Leaving the parent route destroys the
 * scoped basket, so an abandoned customer sale cannot become the cashier's next
 * sale.
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
  protected readonly currentCustomer = inject(CurrentCustomerService);

  protected readonly title = SELF_CHECKOUT_TITLE;

  /**
   * The way back to the till.
   *
   * Present even in the shell: without it a customer or a passing operator who
   * opens the lane on a shared terminal has no exit but the browser chrome,
   * which a kiosk build does not show.
   */
  /**
   * The side path to the sign-up form (epic #261 item 16).
   *
   * A `Router.navigate` rather than a `routerLink`, so the shell keeps needing no
   * `ActivatedRoute` — the lane is smoked and unit-tested outside a router
   * context, and a link would make every one of those specs need one.
   */
  protected goToSignUp(): void {
    void this.router.navigate([SIGN_UP_ROUTE]);
  }

  protected goToSignIn(): void {
    void this.router.navigate([SIGN_IN_ROUTE]);
  }

  protected goToPay(): void {
    void this.router.navigate([PAY_ROUTE]);
  }

  protected async signOut(): Promise<void> {
    await this.currentCustomer.logout();
  }

  protected exit(): void {
    void this.router.navigate(['/pos']);
  }
}
