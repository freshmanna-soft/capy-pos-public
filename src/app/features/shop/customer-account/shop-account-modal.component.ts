import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  Injector,
  afterNextRender,
  computed,
  inject,
  output,
  signal,
} from '@angular/core';
import { AbstractControl, FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { CurrentCustomerService } from '@core/application/auth/current-customer.service';
import { CUSTOMER_AUTH_GATEWAY } from '@core/application/auth/ports/customer-auth-gateway.port';
import { customerEmailValidator, MAX_EMAIL_LENGTH } from './customer-email.validator';
import { describeSignInRefusal, type SignInRefusalCopy } from './sign-in-errors';
import { describeSignUpRefusal, type SignUpRefusalCopy } from './sign-up-errors';

/**
 * Which form the modal is showing while nobody is signed in. The signed-in
 * panel is not one of these: it is derived from `CurrentCustomerService`, so a
 * session that expires (or a sign-out elsewhere) flips the modal back without
 * this component having to notice.
 */
export const ACCOUNT_VIEW = {
  SIGN_IN: 'sign-in',
  SIGN_UP: 'sign-up',
  CHECK_EMAIL: 'check-email',
} as const;
export type AccountView = (typeof ACCOUNT_VIEW)[keyof typeof ACCOUNT_VIEW];

/**
 * The relay forwards passwords to App ID, whose Cloud Directory policy is the
 * real rule; 8 is the floor the old self-checkout form enforced so an obviously
 * short password is refused before a request is spent on it. The max mirrors
 * the relay's `MAX_PASSWORD_LENGTH` transport bound.
 */
export const MIN_PASSWORD_LENGTH = 8;
export const MAX_PASSWORD_LENGTH = 256;

type Field = 'email' | 'password';

/**
 * ShopAccountModalComponent — the /shop "Account" dialog.
 *
 * Replaces the modal that "signed in" by looking an email up in the device's
 * own Dexie customer table: no password, no server, and a "Create account" that
 * wrote a row only this browser could ever see. This one is a real login against
 * the App ID customer application, through `CUSTOMER_AUTH_GATEWAY`:
 *
 * - **Sign in** — password grant via the relay; the verified session goes into
 *   `CurrentCustomerService` (persisted by the adapter in sessionStorage, so it
 *   survives a reload of this tab and dies with it).
 * - **Create account** — the relay's sign-up route. A new App ID account is
 *   `PENDING` until its email is confirmed, so success is a "check your email"
 *   state, never a signed-in one (see `CustomerRegistrationDto`).
 * - **Signed in** — shows the verified email from the token and a sign-out.
 *
 * Both injectables are route-scoped on `/shop` (app.routes.ts) and NOT root —
 * a customer identity must not be resolvable where staff authorization runs.
 *
 * Deliberately offers no "Staff login" link: customers tapping it were stranded
 * on /login, and staff have their own entry points.
 */
@Component({
  selector: 'app-shop-account-modal',
  standalone: true,
  imports: [ReactiveFormsModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div
      class="fixed inset-0 z-[1300] flex items-end sm:items-center justify-center bg-black/60 p-4"
      role="presentation"
      (click)="close()"
      data-testid="shop-account-backdrop"
    >
      <div
        class="relative w-full max-w-sm max-h-[90vh] overflow-y-auto bg-onsen-water rounded-3xl shadow-2xl p-8 flex flex-col gap-6"
        role="dialog"
        aria-modal="true"
        aria-labelledby="shop-account-title"
        (click)="$event.stopPropagation()"
        (keydown)="onKeydown($event)"
        data-testid="shop-account-modal"
      >
        <button
          type="button"
          class="absolute top-4 right-4 w-10 h-10 rounded-full bg-onsen-surface/60 text-steam/80 hover:text-steam flex items-center justify-center focus:outline-none focus-visible:ring-2 focus-visible:ring-yuzu/60"
          (click)="close()"
          aria-label="Close"
          data-testid="shop-account-close"
        >
          ✕
        </button>

        @if (session(); as current) {
          <!-- ── Signed in ─────────────────────────────────────────────── -->
          <h2
            id="shop-account-title"
            class="font-display text-2xl font-bold text-steam text-center"
          >
            Your Account
          </h2>
          <div class="flex flex-col gap-1 text-center" data-testid="shop-account-signed-in">
            <p class="text-kelp/70 text-sm">Signed in as</p>
            <p class="text-steam font-semibold break-all" data-testid="shop-account-email">
              {{ current.email || 'your account' }}
            </p>
          </div>
          <p class="text-kelp/70 text-xs text-center">
            Purchases from this phone aren’t linked to your account yet.
          </p>
          <button
            type="button"
            data-autofocus
            class="w-full min-h-[56px] rounded-xl border-2 border-onsen-surface text-steam font-display text-lg font-semibold active:bg-onsen-surface/40 disabled:opacity-60 focus:outline-none focus-visible:ring-2 focus-visible:ring-yuzu/60"
            [disabled]="submitting()"
            (click)="signOut()"
            data-testid="shop-sign-out"
          >
            {{ submitting() ? 'Signing out…' : 'Sign out' }}
          </button>
        } @else if (view() === views.CHECK_EMAIL) {
          <!-- ── Check your email ──────────────────────────────────────── -->
          <h2
            id="shop-account-title"
            class="font-display text-2xl font-bold text-steam text-center"
          >
            Check your email
          </h2>
          <p class="text-kelp text-sm text-center" role="status" data-testid="shop-check-email">
            Your account has been created. Open the verification link we emailed to
            <span
              class="font-semibold text-steam break-all"
              data-testid="shop-check-email-address"
              >{{ registeredEmail() }}</span
            >, then sign in. You can keep shopping in the meantime.
          </p>
          <button
            type="button"
            data-autofocus
            class="w-full min-h-[56px] rounded-xl bg-yuzu text-onsen-deep font-display text-lg font-bold active:scale-95 focus:outline-none focus-visible:ring-2 focus-visible:ring-steam/60"
            (click)="showView(views.SIGN_IN)"
            data-testid="shop-check-email-sign-in"
          >
            Already verified? Sign in
          </button>
        } @else {
          <!-- ── Sign in / create account ──────────────────────────────── -->
          <h2
            id="shop-account-title"
            class="font-display text-2xl font-bold text-steam text-center"
          >
            {{ view() === views.SIGN_UP ? 'Create an account' : 'Sign in' }}
          </h2>

          @if (notice(); as message) {
            <p
              class="text-kelp text-sm text-center"
              role="status"
              data-testid="shop-account-notice"
            >
              {{ message }}
            </p>
          }

          <form
            [formGroup]="form"
            (ngSubmit)="submit()"
            class="flex flex-col gap-4"
            novalidate
            data-testid="shop-account-form"
          >
            <div class="flex flex-col gap-2">
              <label for="shop-account-email" class="text-steam/80 text-sm font-medium"
                >Email address</label
              >
              <input
                id="shop-account-email"
                type="email"
                formControlName="email"
                data-autofocus
                placeholder="you@example.com"
                autocomplete="email"
                aria-required="true"
                [attr.aria-invalid]="fieldInvalid('email') ? 'true' : null"
                [attr.aria-describedby]="describedBy('email')"
                class="min-h-[56px] rounded-xl bg-onsen-deep border border-onsen-surface/60 text-steam placeholder-kelp/60 px-4 text-base focus:outline-none focus:ring-2 focus:ring-yuzu/60"
                [class.border-red-400]="fieldInvalid('email')"
                data-testid="shop-auth-email"
              />
              @if (emailError(); as problem) {
                <p id="shop-account-email-error" class="text-red-400 text-sm">{{ problem }}</p>
              }
            </div>

            <div class="flex flex-col gap-2">
              <label for="shop-account-password" class="text-steam/80 text-sm font-medium"
                >Password</label
              >
              <input
                id="shop-account-password"
                type="password"
                formControlName="password"
                [attr.autocomplete]="view() === views.SIGN_UP ? 'new-password' : 'current-password'"
                aria-required="true"
                [attr.aria-invalid]="fieldInvalid('password') ? 'true' : null"
                [attr.aria-describedby]="describedBy('password')"
                class="min-h-[56px] rounded-xl bg-onsen-deep border border-onsen-surface/60 text-steam placeholder-kelp/60 px-4 text-base focus:outline-none focus:ring-2 focus:ring-yuzu/60"
                [class.border-red-400]="fieldInvalid('password')"
                data-testid="shop-auth-password"
              />
              @if (passwordError(); as problem) {
                <p id="shop-account-password-error" class="text-red-400 text-sm">
                  {{ problem }}
                </p>
              } @else if (view() === views.SIGN_UP) {
                <p class="text-kelp/70 text-xs">At least {{ minPasswordLength }} characters.</p>
              }
            </div>

            <!-- Always in the DOM so screen readers announce changes to it. -->
            <div id="shop-account-refusal" aria-live="assertive" aria-atomic="true">
              @if (refusalMessage(); as message) {
                <div
                  class="rounded-xl border border-red-400/50 bg-red-400/10 px-4 py-3 text-sm text-steam"
                  data-testid="shop-auth-error"
                >
                  <p>{{ message }}</p>
                  @if (refusalDetail(); as detail) {
                    <p class="mt-1 text-kelp" data-testid="shop-auth-error-detail">{{ detail }}</p>
                  }
                </div>
              }
            </div>

            <button
              type="submit"
              class="w-full min-h-[56px] rounded-xl bg-yuzu text-onsen-deep font-display text-lg font-bold active:scale-95 disabled:opacity-60 focus:outline-none focus-visible:ring-2 focus-visible:ring-steam/60"
              [disabled]="submitting()"
              [attr.aria-busy]="submitting() ? 'true' : null"
              data-testid="shop-account-submit"
            >
              @if (view() === views.SIGN_UP) {
                {{ submitting() ? 'Creating account…' : 'Create account' }}
              } @else {
                {{ submitting() ? 'Signing in…' : 'Sign in' }}
              }
            </button>
          </form>

          <div class="border-t border-onsen-surface/40 pt-4 text-center">
            @if (view() === views.SIGN_UP) {
              <button
                type="button"
                class="text-yuzu text-sm font-semibold underline underline-offset-4 disabled:opacity-60 focus:outline-none focus-visible:ring-2 focus-visible:ring-yuzu/60"
                [disabled]="submitting()"
                (click)="showView(views.SIGN_IN)"
                data-testid="shop-show-sign-in"
              >
                Already have an account? Sign in
              </button>
            } @else {
              <button
                type="button"
                class="text-yuzu text-sm font-semibold underline underline-offset-4 disabled:opacity-60 focus:outline-none focus-visible:ring-2 focus-visible:ring-yuzu/60"
                [disabled]="submitting()"
                (click)="showView(views.SIGN_UP)"
                data-testid="shop-show-sign-up"
              >
                New here? Create an account
              </button>
            }
          </div>
          <p class="text-kelp/70 text-xs text-center">
            An account is optional — you can shop and pay without one.
          </p>
        }
      </div>
    </div>
  `,
})
export class ShopAccountModalComponent {
  private readonly gateway = inject(CUSTOMER_AUTH_GATEWAY);
  private readonly currentCustomer = inject(CurrentCustomerService);
  private readonly fb = inject(FormBuilder);
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);
  private readonly injector = inject(Injector);

  /** Emitted when the customer dismisses the dialog (✕, backdrop, Escape). */
  readonly closed = output<void>();

  protected readonly views = ACCOUNT_VIEW;
  protected readonly minPasswordLength = MIN_PASSWORD_LENGTH;

  /** The verified session, or null. Drives the signed-in panel. */
  readonly session = this.currentCustomer.session;

  readonly view = signal<AccountView>(ACCOUNT_VIEW.SIGN_IN);
  readonly submitting = signal(false);
  readonly signInRefusal = signal<SignInRefusalCopy | null>(null);
  readonly signUpRefusal = signal<SignUpRefusalCopy | null>(null);
  /** The address the relay registered — the normalized one, so it names the right inbox. */
  readonly registeredEmail = signal<string | null>(null);
  private readonly _notice = signal<string | null>(null);

  /**
   * An informational line above the form. An expiry is reported here rather
   * than as an error: nothing the customer typed was wrong.
   */
  readonly notice = computed(
    () =>
      this._notice() ??
      (this.currentCustomer.logoutReason() === 'expired'
        ? 'Your session expired. Sign in again to continue.'
        : null)
  );

  readonly form = this.fb.nonNullable.group({
    email: ['', [Validators.required, customerEmailValidator]],
    password: ['', [Validators.required]],
  });

  readonly refusalMessage = computed(
    () => this.signInRefusal()?.message ?? this.signUpRefusal()?.message ?? null
  );
  readonly refusalDetail = computed(() => this.signUpRefusal()?.detail ?? null);

  constructor() {
    this.focusFirst();
  }

  // ── Actions ───────────────────────────────────────────────────────────────

  close(): void {
    this.closed.emit();
  }

  showView(view: AccountView): void {
    this.view.set(view);
    this.clearRefusals();
    this._notice.set(null);
    this.form.controls.password.reset('');
    // Sign-up has rules sign-in must not enforce: a returning customer whose
    // old password is 6 characters still has to be able to type it.
    this.form.controls.password.setValidators(
      view === ACCOUNT_VIEW.SIGN_UP
        ? [
            Validators.required,
            Validators.minLength(MIN_PASSWORD_LENGTH),
            Validators.maxLength(MAX_PASSWORD_LENGTH),
          ]
        : [Validators.required]
    );
    this.form.controls.password.updateValueAndValidity();
    if (view === ACCOUNT_VIEW.SIGN_IN && this.registeredEmail()) {
      this.form.controls.email.setValue(this.registeredEmail() ?? '');
    }
    this.form.markAsUntouched();
    this.focusFirst();
  }

  async submit(): Promise<void> {
    if (this.submitting()) return;
    if (this.form.invalid) {
      // `touched` is what the field-error getters read, so this is what makes
      // an empty submit say something rather than nothing.
      this.form.markAllAsTouched();
      return;
    }
    if (this.view() === ACCOUNT_VIEW.SIGN_UP) {
      await this.signUp();
    } else {
      await this.signIn();
    }
  }

  async signOut(): Promise<void> {
    if (this.submitting()) return;
    this.submitting.set(true);
    try {
      await this.currentCustomer.logout('manual');
    } finally {
      this.submitting.set(false);
    }
    this.form.reset();
    this.registeredEmail.set(null);
    this.view.set(ACCOUNT_VIEW.SIGN_IN);
    this._notice.set('You have signed out.');
    this.focusFirst();
  }

  /** Escape closes; Tab is kept inside the dialog while it is open. */
  onKeydown(event: KeyboardEvent): void {
    if (event.key === 'Escape') {
      event.preventDefault();
      this.close();
      return;
    }
    if (event.key === 'Tab') {
      this.trapTab(event);
    }
  }

  // ── Field errors (read by the template) ───────────────────────────────────

  emailError(): string | null {
    const email = this.form.controls.email;
    if (!this.shouldReport(email)) return null;
    if (email.hasError('required')) return 'Enter your email address.';
    return email.hasError('emailTooLong')
      ? `Use an address of ${MAX_EMAIL_LENGTH} characters or fewer.`
      : 'That does not look like an email address — check for a typo.';
  }

  passwordError(): string | null {
    const password = this.form.controls.password;
    if (!this.shouldReport(password)) return null;
    if (password.hasError('required')) {
      return this.view() === ACCOUNT_VIEW.SIGN_UP ? 'Choose a password.' : 'Enter your password.';
    }
    return password.hasError('maxlength')
      ? `Use ${MAX_PASSWORD_LENGTH} characters or fewer.`
      : `Use at least ${MIN_PASSWORD_LENGTH} characters.`;
  }

  fieldInvalid(field: Field): boolean {
    const own = field === 'email' ? this.emailError() : this.passwordError();
    return own !== null || this.refusedField() === field;
  }

  describedBy(field: Field): string | null {
    const ids: string[] = [];
    if (field === 'email' ? this.emailError() : this.passwordError()) {
      ids.push(`shop-account-${field}-error`);
    }
    if (this.refusedField() === field) ids.push('shop-account-refusal');
    return ids.length > 0 ? ids.join(' ') : null;
  }

  // ── Internals ─────────────────────────────────────────────────────────────

  private async signIn(): Promise<void> {
    const { email, password } = this.form.getRawValue();
    this.begin();
    try {
      const session = await this.gateway.authenticate({ email, password });
      this.currentCustomer.setSession(session);
      // The template swaps to the signed-in panel off the session signal; the
      // password must not linger in a form control after that.
      this.form.reset();
      this.focusFirst();
    } catch (error) {
      this.signInRefusal.set(describeSignInRefusal(error));
    } finally {
      this.submitting.set(false);
    }
  }

  private async signUp(): Promise<void> {
    const { email, password } = this.form.getRawValue();
    this.begin();
    try {
      const registration = await this.gateway.signUp({ email, password });
      this.registeredEmail.set(registration.email);
      this.form.controls.password.reset('');
      this.view.set(ACCOUNT_VIEW.CHECK_EMAIL);
      this.focusFirst();
    } catch (error) {
      this.signUpRefusal.set(describeSignUpRefusal(error));
    } finally {
      this.submitting.set(false);
    }
  }

  private begin(): void {
    this.submitting.set(true);
    this.clearRefusals();
    this._notice.set(null);
  }

  private clearRefusals(): void {
    this.signInRefusal.set(null);
    this.signUpRefusal.set(null);
  }

  private refusedField(): Field | null {
    return this.signInRefusal()?.field ?? this.signUpRefusal()?.field ?? null;
  }

  private shouldReport(control: AbstractControl): boolean {
    return control.invalid && control.touched;
  }

  /** Move focus to the view's first control once it has rendered. */
  private focusFirst(): void {
    afterNextRender(
      () => this.host.nativeElement.querySelector<HTMLElement>('[data-autofocus]')?.focus(),
      { injector: this.injector }
    );
  }

  private trapTab(event: KeyboardEvent): void {
    const focusable = Array.from(
      this.host.nativeElement.querySelectorAll<HTMLElement>(
        'button:not([disabled]), input:not([disabled]), a[href], [tabindex]:not([tabindex="-1"])'
      )
    );
    if (focusable.length === 0) return;
    const first = focusable[0];
    const last = focusable.at(-1)!;
    const active = document.activeElement;
    if (event.shiftKey && active === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && active === last) {
      event.preventDefault();
      first.focus();
    }
  }
}
