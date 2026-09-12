import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { AbstractControl, FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { Router } from '@angular/router';
import { CUSTOMER_AUTH_GATEWAY } from '@core/application/auth/ports/customer-auth-gateway.port';
import { customerEmailValidator, MAX_EMAIL_LENGTH } from './customer-email.validator';
import { PendingRegistrationStore } from './pending-registration.store';
import { CHECK_EMAIL_ROUTE, LANE_ROUTE } from './self-checkout-routes';
import { describeSignUpRefusal, SignUpRefusalCopy } from './self-checkout-signup-errors';

/**
 * Our own floor, and the only password rule this form states before a submit. The
 * tenant's real policy is a console setting no client can read (see the relay's
 * `customer-signup-validate.ts`), so anything beyond this arrives as the 400's
 * detail.
 */
const MIN_PASSWORD_LENGTH = 8;

/**
 * Mirrors the relay's `MAX_PASSWORD_LENGTH`, for the same reason
 * {@link customerEmailValidator} mirrors its `EMAIL_PATTERN`: a bound the client
 * does not know about is a submit that comes back a permanent refusal with nothing
 * to say about which field. A maximum only — the minimum above is ours, the
 * tenant's is the tenant's.
 */
const MAX_PASSWORD_LENGTH = 256;

/** The id of the refusal banner, so a named field can point a screen reader at it. */
const REFUSAL_ID = 'signup-refusal';

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
 * **An invalid field says why, and says it where a screen reader will find it.**
 * The form is `novalidate`, so the browser's own bubbles are off and nothing else
 * speaks for a mistyped address: without {@link emailError}/{@link passwordError}
 * a bad email produced a submit that did nothing at all, silently, which is
 * WCAG 3.3.1 (Error Identification) failed outright and — on a lane where the
 * shopper is standing at a counter with people behind them — the moment they give
 * up and walk away from the account. The text renders beside the field *and* is
 * bound through `aria-invalid`/`aria-describedby`, because a red outline alone is
 * a perfectly valid-looking field to anyone not looking at it. A refusal that
 * comes back from the *relay* marks its field the same way (see
 * {@link describedBy}) — an address the store would not accept is as much an item
 * in error as one this form's own rule caught, and it used to be announced as
 * neither.
 *
 * **The client's rules are the relay's rules.** `Validators.email` accepts
 * `jane@gmail` and the relay's `EMAIL_PATTERN` refuses it, so a missing TLD — one
 * of the two typos actually made at a kiosk — cost a round trip and came back a
 * permanent refusal dressed as a transient one. Both of this form's bounds now
 * mirror the relay's (`customer-email.validator.ts`, {@link MAX_PASSWORD_LENGTH}),
 * so nothing leaves here that is refused on shape; `describeSignUpRefusal` keeps
 * its own copy for those refusals as the second line of defence, since a rule
 * mirrored in two deployables is a rule that can drift.
 *
 * Styled with the lane's `ONSEN` tokens (`self-checkout-palette.ts` mirrors them
 * into `tailwind.config.js`); `/clerk`'s canvas mascot is deliberately not here.
 */
@Component({
  selector: 'app-self-checkout-signup',
  standalone: true,
  imports: [ReactiveFormsModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './self-checkout-signup.component.html',
})
export class SelfCheckoutSignUpComponent {
  private readonly gateway = inject(CUSTOMER_AUTH_GATEWAY);
  private readonly router = inject(Router);
  private readonly fb = inject(FormBuilder);
  private readonly pending = inject(PendingRegistrationStore);

  /**
   * `customerEmailValidator` rather than `Validators.email`: Angular's accepts
   * `jane@gmail`, the relay does not, and the gap was a permanent refusal wearing
   * transient copy (see the validator's own note). Both bounds mirror the relay's
   * so no submit can be refused on a rule this form never mentioned.
   */
  readonly form = this.fb.group({
    email: ['', [Validators.required, customerEmailValidator]],
    password: [
      '',
      [
        Validators.required,
        Validators.minLength(MIN_PASSWORD_LENGTH),
        Validators.maxLength(MAX_PASSWORD_LENGTH),
      ],
    ],
  });

  protected readonly submitting = signal(false);

  /** The refusal being shown, or null when nothing has failed yet. */
  protected readonly refusal = signal<SignUpRefusalCopy | null>(null);

  /**
   * Whether the refusal on screen blames this field.
   *
   * This is what became of the "Try signing in" link the duplicate refusal used to
   * offer. The link pointed at `/self-checkout`, and no sign-in form exists there
   * or anywhere else yet — Epic #261 item 18 is unbuilt — so the most common
   * refusal handed the shopper an action that led back to the lane and lost what
   * they had typed. The copy still tells them the address is taken and to try
   * signing in, which is the part #309 asked for and the part that is true; the
   * refusal now marks the field it blames instead of navigating somewhere that
   * cannot help. When item 18 lands, the link belongs here again, pointed at a
   * route that answers.
   */
  protected refusalNames(field: 'email' | 'password'): boolean {
    return this.refusal()?.field === field;
  }

  /**
   * The ids describing a field: its own validation message, the refusal banner, or
   * both — and null rather than an empty string, because `aria-describedby=""` is
   * a dangling reference.
   *
   * A refusal is about a field the customer typed something into, so both messages
   * can legitimately be on screen at once (a mistyped address that was also
   * refused, once corrected in a way our rule accepts and the relay's does not).
   */
  protected describedBy(field: 'email' | 'password'): string | null {
    const ids: string[] = [];
    if (field === 'email' ? this.emailError() : this.passwordError()) {
      ids.push(`signup-${field}-error`);
    }
    if (this.refusalNames(field)) {
      ids.push(REFUSAL_ID);
    }
    return ids.length > 0 ? ids.join(' ') : null;
  }

  /** Whether the field is in error at all — from either source. */
  protected fieldInvalid(field: 'email' | 'password'): boolean {
    const own = field === 'email' ? this.emailError() : this.passwordError();
    return own !== null || this.refusalNames(field);
  }

  /**
   * Why the email field is refused, or null while there is nothing to say.
   *
   * Gated on `touched`, which is what {@link submit}'s `markAllAsTouched()` sets
   * and what a blur sets on the way out of a field — so the message arrives when
   * the customer has finished with the field or has asked to submit, never while
   * they are still typing the first character of a valid address.
   *
   * A method rather than a `computed`: the source of truth is the control's own
   * validity, which is not a signal. Every path that can change it — typing,
   * blurring, submitting — is a DOM event from this template, which marks this
   * `OnPush` view dirty, so the text appears and clears without a subscription.
   */
  protected emailError(): string | null {
    const email = this.form.controls.email;
    if (!this.shouldReport(email)) {
      return null;
    }
    if (email.hasError('required')) {
      return 'Enter your email address.';
    }
    return email.hasError('emailTooLong')
      ? `Use an address of ${MAX_EMAIL_LENGTH} characters or fewer.`
      : 'That does not look like an email address — check for a typo.';
  }

  /**
   * Why the password is refused, or null.
   *
   * Only ever states *our* minimum. The tenant's real policy is a console setting
   * this app cannot read (see the relay's `customer-signup-validate.ts` on why it
   * refuses to copy it), so what it demands beyond 8 characters arrives as the
   * `400`'s detail after a submit — never guessed at here.
   */
  protected passwordError(): string | null {
    const password = this.form.controls.password;
    if (!this.shouldReport(password)) {
      return null;
    }
    if (password.hasError('required')) {
      return 'Choose a password.';
    }
    return password.hasError('maxlength')
      ? `Use ${MAX_PASSWORD_LENGTH} characters or fewer.`
      : `Use at least ${MIN_PASSWORD_LENGTH} characters.`;
  }

  private shouldReport(control: AbstractControl): boolean {
    return control.invalid && control.touched;
  }

  /**
   * Create the account, then send the customer to the interstitial.
   *
   * The address handed across is the one the *gateway* normalized and registered,
   * not the raw field value, so the interstitial names the inbox the verification
   * mail actually went to — and it travels through
   * {@link PendingRegistrationStore}, in memory, not as a query param. A
   * `queryParams: { email }` wrote the shopper's address into the address bar and
   * the session history of a terminal the next shopper walks up to; router `state`
   * only moves it from the URL into `history.state`, where a reload or a back
   * navigation still hands it over. The store dies with the route subtree and
   * forgets the address as the interstitial reads it.
   */
  protected async submit(): Promise<void> {
    if (this.form.invalid || this.submitting()) {
      // Load-bearing, not habit: `touched` is what {@link emailError} and
      // {@link passwordError} read, so this line is the difference between a
      // submit that names both problems and one that does nothing visible at all.
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
      this.pending.remember(registration.email);
      await this.router.navigate([CHECK_EMAIL_ROUTE]);
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
