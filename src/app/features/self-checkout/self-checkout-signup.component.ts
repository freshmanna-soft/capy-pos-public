import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';
import { CUSTOMER_AUTH_GATEWAY } from '@core/application/auth/ports/customer-auth-gateway.port';
import { CHECK_EMAIL_ROUTE, LANE_ROUTE } from './self-checkout-routes';
import { describeSignUpRefusal, SignUpRefusalCopy } from './self-checkout-signup-errors';

/**
 * SelfCheckoutSignUpComponent (Epic #261 item 16)
 *
 * The customer's own sign-up form, on the self-checkout lane.
 *
 * **A successful sign-up does not sign anyone in — and there is no session to
 * publish.** Item 3 established empirically (2026-09-11) that a freshly created
 * App ID account is `PENDING` and cannot complete a password grant: App ID
 * answers `403 "Pending user verification"`. So the relay's `201` carries an id
 * and an email and no token, and `CUSTOMER_AUTH_GATEWAY.signUp()` now returns a
 * `CustomerRegistrationDto` to match.
 *
 * That is a deliberate departure from #309's wording, which asked for
 * `CurrentCustomerService.setSession(session)` on success. There is nothing to
 * pass it. `signUp` used to satisfy its `Promise<CustomerSessionDto>` by
 * chasing the `201` with a password grant — the grant item 3 proved always
 * fails — so this form's success path was unreachable against any real tenant,
 * and the 403 arrived here wearing the wrong copy ("Invalid email or password"
 * classified as a password-policy refusal). The alternative, handing
 * `setSession` a session assembled locally, is worse than useless: it flips
 * `isAuthenticated()` to true for an account that cannot authenticate, arms the
 * expiry timer against a made-up `expiresAt`, and is exactly the invented
 * signed-in state #309 forbids two paragraphs later. So the gateway → service
 * split #309 is protecting is honoured by the one part of it that is real: this
 * form owns the error copy and adds no `signUp`/`authenticate` method to
 * `CurrentCustomerService`. The service is still what guards this route — the
 * customer identity providers sit on the parent `self-checkout` route so the
 * guard, the lane and this form share one instance (see `app.routes.ts`) — and
 * item 18's sign-in form is what will call `setSession`, with a real session.
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
   * Create the account, then send the customer to the interstitial.
   *
   * The email carried across is the one the *gateway* normalized and registered,
   * not the raw field value, so the interstitial names the inbox the
   * verification mail actually went to.
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
      const registration = await this.gateway.signUp({
        email: email ?? '',
        password: password ?? '',
      });
      await this.router.navigate([CHECK_EMAIL_ROUTE], {
        queryParams: { email: registration.email },
      });
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
