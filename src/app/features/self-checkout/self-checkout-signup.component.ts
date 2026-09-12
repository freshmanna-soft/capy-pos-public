import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';
import { CurrentCustomerService } from '@core/application/auth/current-customer.service';
import { CUSTOMER_AUTH_GATEWAY } from '@core/application/auth/ports/customer-auth-gateway.port';
import { describeSignUpRefusal, SignUpRefusalCopy } from './self-checkout-signup-errors';

/** Where a created-but-unverified account is sent (Epic #261 item 17, issue #311). */
export const CHECK_EMAIL_ROUTE = '/self-checkout/check-email';

/** The lane itself — the "keep shopping without an account" destination. */
export const LANE_ROUTE = '/self-checkout';

/**
 * SelfCheckoutSignUpComponent (Epic #261 item 16)
 *
 * The customer's own sign-up form, on the self-checkout lane.
 *
 * **It calls the gateway, then tells the service.** `CUSTOMER_AUTH_GATEWAY` is
 * injected and `signUp()` called here; `CurrentCustomerService.setSession()` is
 * called after it resolves so the service's `session`/`isAuthenticated` signals
 * update. That split is the one `LoginComponent` already uses with
 * `CurrentUserService.setSession()`, and `setSession`'s own doc comment names
 * this form as its caller — the point being that the error handling below stays
 * out of the service. No `signUp`/`authenticate` method is added to the service.
 *
 * **A successful sign-up does not sign anyone in.** Item 3 established
 * empirically (2026-09-11) that a freshly created App ID account is `PENDING`
 * and cannot complete a password grant — App ID answers
 * `403 "Pending user verification"` — so the relay's `201` carries an id and an
 * email and no token. This screen therefore never shows a signed-in state: on
 * success it routes to the "check your email" interstitial and says nothing
 * about a session existing.
 *
 * **Registration is optional, and this screen has to say so.** Per the
 * 2026-09-11 product decision (options 1+3) an account is never required to
 * scan or to pay, which is why `/self-checkout` carries no guard. This form is a
 * side path reached *from* the lane, so "continue without an account" is a
 * first-class action here, sitting alongside the submit rather than buried under
 * it. A customer who cannot shop until they register is the exact failure that
 * decision exists to avoid.
 *
 * Styled with the lane's `ONSEN` tokens (`self-checkout-palette.ts` mirrors them
 * into `tailwind.config.js`); `/clerk`'s canvas mascot is deliberately not here.
 */
@Component({
  selector: 'app-self-checkout-signup',
  standalone: true,
  imports: [ReactiveFormsModule, RouterLink],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './self-checkout-signup.component.html',
})
export class SelfCheckoutSignUpComponent {
  private readonly gateway = inject(CUSTOMER_AUTH_GATEWAY);
  private readonly currentCustomer = inject(CurrentCustomerService);
  private readonly router = inject(Router);
  private readonly fb = inject(FormBuilder);

  readonly form = this.fb.group({
    email: ['', [Validators.required, Validators.email]],
    password: ['', [Validators.required, Validators.minLength(8)]],
  });

  protected readonly submitting = signal(false);

  /** The refusal being shown, or null when nothing has failed yet. */
  protected readonly refusal = signal<SignUpRefusalCopy | null>(null);

  /** Whether to offer the sign-in link — only the duplicate-address refusal does. */
  protected readonly offerSignIn = computed(() => this.refusal()?.alreadyRegistered === true);

  /**
   * Create the account.
   *
   * The tail is deliberately "publish the session, then navigate to the
   * interstitial": `setSession` is what keeps the service's signals current for
   * anything downstream, and the interstitial is what the customer sees, because
   * the account cannot be used until it is verified.
   */
  protected async submit(): Promise<void> {
    if (this.form.invalid || this.submitting()) {
      this.form.markAllAsTouched();
      return;
    }

    const { email, password } = this.form.getRawValue();
    this.submitting.set(true);
    this.refusal.set(null);

    try {
      const session = await this.gateway.signUp({ email: email ?? '', password: password ?? '' });
      this.currentCustomer.setSession(session);
      await this.router.navigate([CHECK_EMAIL_ROUTE], { queryParams: { email: email ?? '' } });
    } catch (error) {
      this.refusal.set(describeSignUpRefusal(error));
    } finally {
      this.submitting.set(false);
    }
  }

  /** Back to the lane, with no account — the equally-prominent way out. */
  protected continueWithoutAccount(): void {
    void this.router.navigate([LANE_ROUTE]);
  }
}
