import {
  Component,
  ChangeDetectionStrategy,
  OnInit,
  computed,
  inject,
  signal,
} from '@angular/core';
import { Router } from '@angular/router';
import { ReactiveFormsModule, FormBuilder, Validators } from '@angular/forms';
import { AUTH_GATEWAY } from '@core/application/auth/ports/auth-gateway.port';
import {
  InvalidPinError,
  OperatorInactiveError,
  PasskeyCancelledError,
  PasskeyUnavailableError,
  PasskeyVerificationError,
  QUICK_AUTH_GATEWAY,
} from '@core/application/auth/ports/quick-auth.port';
import {
  QuickAuthCapabilitiesDto,
  QuickSignInOperatorDto,
} from '@core/application/auth/dtos/quick-auth.dto';
import { CurrentUserService } from '@core/application/auth/current-user.service';
import { InvalidCredentialsError } from '@core/infrastructure/auth/local-credential-auth.adapter';
import { MAX_PIN_LENGTH, MIN_PIN_LENGTH } from '@core/infrastructure/auth/webauthn/pin-policy';

/**
 * LoginComponent
 *
 * Three ways in, offered in the order a till actually needs them.
 *
 * A passkey first, when the device has a sensor and somebody has enrolled on it:
 * one touch, nothing typed, and nothing for the customer in the queue to read over
 * a shoulder. A PIN second, for a till whose browser has no platform
 * authenticator. The password last — it still works, and it is the only way to sign
 * in on a device for the first time, which is what makes it the thing every other
 * route is bootstrapped from rather than a legacy path.
 *
 * The quick options are hidden rather than disabled when they cannot work. A
 * greyed-out "Touch ID" button on a desktop with no sensor invites the cashier to
 * keep pressing it; an absent one tells them to use the form below.
 */
@Component({
  selector: 'app-login',
  standalone: true,
  imports: [ReactiveFormsModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="login-page" role="main">
      <div class="login-card">
        <div class="login-header">
          <h1 class="login-title">Capy POS</h1>
          <p class="login-subtitle">Sign in to continue</p>
        </div>

        <!-- Quick sign-in: passkey and PIN. Absent when neither can work here. -->
        @if (showPasskey() || showPin()) {
          <div class="quick-signin" data-testid="quick-signin">
            @if (showPasskey()) {
              <button
                type="button"
                class="btn-passkey"
                (click)="signInWithPasskey()"
                [disabled]="busy()"
                data-testid="btn-passkey"
              >
                {{ passkeyBusy() ? 'Waiting for you…' : 'Sign in with this device' }}
              </button>
              <p class="quick-hint">Touch ID, Windows Hello or your fingerprint reader.</p>
            }

            @if (showPin() && !pinMode()) {
              <button
                type="button"
                class="btn-quiet"
                (click)="openPinPad()"
                [disabled]="busy()"
                data-testid="btn-use-pin"
              >
                Use a PIN instead
              </button>
            }

            @if (pinMode()) {
              <div class="pin-pad" data-testid="pin-pad">
                <label class="field-label" for="pin-operator">Who are you?</label>
                <select
                  id="pin-operator"
                  class="field-input"
                  [value]="selectedOperatorId() ?? ''"
                  (change)="selectOperator($event)"
                  data-testid="select-pin-operator"
                >
                  @for (operator of pinOperators(); track operator.operatorId) {
                    <option [value]="operator.operatorId">{{ operator.displayName }}</option>
                  }
                </select>

                <div
                  class="pin-display"
                  data-testid="pin-display"
                  aria-live="polite"
                  [attr.aria-label]="pin().length + ' of ' + maxPinLength + ' digits entered'"
                >
                  @for (dot of pinDots(); track $index) {
                    <span class="pin-dot" [class.pin-dot--filled]="dot"></span>
                  }
                </div>

                <div class="keypad">
                  @for (digit of keypad; track digit) {
                    <button
                      type="button"
                      class="key"
                      (click)="pressDigit(digit)"
                      [disabled]="busy()"
                      [attr.data-testid]="'key-' + digit"
                      [attr.aria-label]="digit"
                    >
                      {{ digit }}
                    </button>
                  }
                  <button
                    type="button"
                    class="key key--quiet"
                    (click)="backspace()"
                    [disabled]="busy() || pin().length === 0"
                    data-testid="key-backspace"
                    aria-label="Delete last digit"
                  >
                    ←
                  </button>
                  <button
                    type="button"
                    class="key key--go"
                    (click)="submitPin()"
                    [disabled]="busy() || !pinComplete()"
                    data-testid="btn-pin-submit"
                  >
                    Go
                  </button>
                </div>

                <button
                  type="button"
                  class="btn-quiet"
                  (click)="closePinPad()"
                  data-testid="btn-cancel-pin"
                >
                  Cancel
                </button>
              </div>
            }
          </div>

          <div class="divider"><span>or</span></div>
        }

        <form
          [formGroup]="form"
          (ngSubmit)="submit()"
          novalidate
          aria-label="Login form"
          class="login-form"
        >
          <!-- Email field -->
          <div class="form-field">
            <label for="email" class="field-label">Email address</label>
            <input
              id="email"
              type="email"
              formControlName="email"
              class="field-input"
              [class.field-input--error]="showEmailError()"
              autocomplete="username"
              aria-required="true"
              [attr.aria-invalid]="showEmailError() ? 'true' : null"
              aria-describedby="email-error"
              data-testid="input-email"
            />
            @if (showEmailError()) {
              <span id="email-error" class="field-error" role="alert" data-testid="email-error">
                Please enter a valid email address.
              </span>
            }
          </div>

          <!-- Password field -->
          <div class="form-field">
            <label for="password" class="field-label">Password</label>
            <input
              id="password"
              type="password"
              formControlName="password"
              class="field-input"
              [class.field-input--error]="showPasswordError()"
              autocomplete="current-password"
              aria-required="true"
              [attr.aria-invalid]="showPasswordError() ? 'true' : null"
              aria-describedby="password-error"
              data-testid="input-password"
            />
            @if (showPasswordError()) {
              <span
                id="password-error"
                class="field-error"
                role="alert"
                data-testid="password-error"
              >
                Password is required.
              </span>
            }
          </div>

          <!-- Server-side error region -->
          @if (authError()) {
            <div class="auth-error" role="alert" aria-live="assertive" data-testid="auth-error">
              {{ authError() }}
            </div>
          }

          <!-- Submit -->
          <button
            type="submit"
            class="btn-login"
            [disabled]="loading() || form.invalid"
            data-testid="btn-login"
            aria-label="Sign in"
          >
            {{ loading() ? 'Signing in…' : 'Sign in' }}
          </button>
        </form>
      </div>
    </div>
  `,
  styles: [
    `
      .login-page {
        min-height: 100vh;
        display: flex;
        align-items: center;
        justify-content: center;
        background: #f3f4f6;
        padding: 1rem;
      }

      .login-card {
        width: 100%;
        max-width: 400px;
        background: #fff;
        border-radius: 16px;
        padding: 2rem;
        box-shadow: 0 4px 24px rgba(0, 0, 0, 0.08);
      }

      .login-header {
        text-align: center;
        margin-bottom: 2rem;
      }

      .login-title {
        font-size: 1.75rem;
        font-weight: 700;
        color: #111827;
        margin: 0 0 0.25rem;
      }

      .login-subtitle {
        color: #6b7280;
        margin: 0;
        font-size: 0.9375rem;
      }

      .login-form {
        display: flex;
        flex-direction: column;
        gap: 1.25rem;
      }

      .form-field {
        display: flex;
        flex-direction: column;
        gap: 0.375rem;
      }

      .field-label {
        font-size: 0.875rem;
        font-weight: 600;
        color: #374151;
      }

      .field-input {
        padding: 0.625rem 0.875rem;
        border: 2px solid #e5e7eb;
        border-radius: 8px;
        font-size: 1rem;
        color: #111827;
        outline: none;
        transition: border-color 0.15s;
      }

      .field-input:focus {
        border-color: #2563eb;
      }

      .field-input--error {
        border-color: #dc2626;
      }

      .field-error {
        font-size: 0.8125rem;
        color: #dc2626;
      }

      .auth-error {
        padding: 0.75rem 1rem;
        background: #fef2f2;
        border: 1px solid #fca5a5;
        border-radius: 8px;
        font-size: 0.875rem;
        color: #991b1b;
      }

      .btn-login {
        width: 100%;
        padding: 0.75rem;
        background: #2563eb;
        color: #fff;
        border: none;
        border-radius: 8px;
        font-size: 1rem;
        font-weight: 600;
        cursor: pointer;
        transition: background 0.15s;
      }

      .btn-login:hover:not(:disabled) {
        background: #1d4ed8;
      }

      .btn-login:disabled {
        opacity: 0.5;
        cursor: not-allowed;
      }

      /* --- Quick sign-in ------------------------------------------------- */

      .quick-signin {
        display: flex;
        flex-direction: column;
        gap: 0.75rem;
      }

      .btn-passkey {
        width: 100%;
        padding: 0.875rem;
        background: #111827;
        color: #fff;
        border: none;
        border-radius: 8px;
        font-size: 1rem;
        font-weight: 600;
        cursor: pointer;
      }

      .btn-passkey:hover:not(:disabled) {
        background: #1f2937;
      }

      .btn-passkey:disabled {
        opacity: 0.6;
        cursor: progress;
      }

      .quick-hint {
        margin: 0;
        font-size: 0.8125rem;
        color: #6b7280;
        text-align: center;
      }

      .btn-quiet {
        background: none;
        border: none;
        color: #2563eb;
        font-size: 0.875rem;
        font-weight: 600;
        cursor: pointer;
        padding: 0.375rem;
      }

      .divider {
        display: flex;
        align-items: center;
        text-align: center;
        color: #9ca3af;
        font-size: 0.8125rem;
        margin: 1.5rem 0;
      }

      .divider::before,
      .divider::after {
        content: '';
        flex: 1;
        border-bottom: 1px solid #e5e7eb;
      }

      .divider span {
        padding: 0 0.75rem;
      }

      /* --- PIN pad -------------------------------------------------------- */

      .pin-pad {
        display: flex;
        flex-direction: column;
        gap: 0.75rem;
      }

      .pin-display {
        display: flex;
        justify-content: center;
        gap: 0.625rem;
        min-height: 1.25rem;
      }

      .pin-dot {
        width: 0.75rem;
        height: 0.75rem;
        border-radius: 50%;
        border: 2px solid #d1d5db;
      }

      .pin-dot--filled {
        background: #111827;
        border-color: #111827;
      }

      .keypad {
        display: grid;
        grid-template-columns: repeat(3, 1fr);
        gap: 0.5rem;
      }

      .key {
        /* Generous, because this is pressed with a thumb while holding something. */
        padding: 1rem 0;
        font-size: 1.25rem;
        font-weight: 600;
        color: #111827;
        background: #f9fafb;
        border: 2px solid #e5e7eb;
        border-radius: 8px;
        cursor: pointer;
      }

      .key:active:not(:disabled) {
        background: #e5e7eb;
      }

      .key:disabled {
        opacity: 0.4;
        cursor: not-allowed;
      }

      .key--go {
        background: #2563eb;
        border-color: #2563eb;
        color: #fff;
      }

      @media (max-width: 480px) {
        .login-card {
          padding: 1.25rem;
        }
      }
    `,
  ],
})
export class LoginComponent implements OnInit {
  private readonly gateway = inject(AUTH_GATEWAY);
  private readonly quickAuth = inject(QUICK_AUTH_GATEWAY);
  private readonly currentUser = inject(CurrentUserService);
  private readonly router = inject(Router);
  private readonly fb = inject(FormBuilder);

  readonly form = this.fb.group({
    email: ['', [Validators.required, Validators.email]],
    password: ['', Validators.required],
  });

  readonly loading = signal(false);
  readonly authError = signal<string | null>(null);

  /** Driven by the submit attempt — avoids non-signal form state in computed. */
  readonly showEmailError = signal(false);
  readonly showPasswordError = signal(false);

  readonly keypad = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '0'];
  readonly maxPinLength = MAX_PIN_LENGTH;

  private readonly capabilities = signal<QuickAuthCapabilitiesDto | null>(null);
  readonly pinOperators = signal<QuickSignInOperatorDto[]>([]);
  readonly selectedOperatorId = signal<string | null>(null);
  readonly pin = signal('');
  readonly pinMode = signal(false);
  readonly passkeyBusy = signal(false);

  /**
   * Offered only when it can succeed: a sensor exists *and* somebody has enrolled
   * on this device. Support alone would open an OS prompt with nothing to pick.
   */
  readonly showPasskey = computed(
    () =>
      this.capabilities()?.passkeySupported === true &&
      this.capabilities()?.passkeyEnrolledHere === true
  );
  readonly showPin = computed(() => this.capabilities()?.pinAvailable === true);

  /** Any sign-in in flight — the whole card locks, so two cannot race. */
  readonly busy = computed(() => this.loading() || this.passkeyBusy());

  readonly pinComplete = computed(() => this.pin().length >= MIN_PIN_LENGTH);

  /** One dot per digit typed, plus empties up to the minimum, for feedback. */
  readonly pinDots = computed(() => {
    const entered = this.pin().length;
    const slots = Math.max(MIN_PIN_LENGTH, entered);
    return Array.from({ length: slots }, (_, index) => index < entered);
  });

  async ngOnInit(): Promise<void> {
    await this.probeQuickAuth();
  }

  /**
   * Ask the device what it can do.
   *
   * Failure here is deliberately silent: the quick options stay hidden and the
   * password form — which is always present — carries on working. An error banner
   * about a capability probe would be noise in front of somebody who just wants to
   * start their shift.
   */
  private async probeQuickAuth(): Promise<void> {
    try {
      const capabilities = await this.quickAuth.capabilities();
      this.capabilities.set(capabilities);
      if (capabilities.pinAvailable) {
        const operators = await this.quickAuth.listPinOperators();
        this.pinOperators.set(operators);
        this.selectedOperatorId.set(operators[0]?.operatorId ?? null);
      }
    } catch (error) {
      console.warn('[Login] Could not probe quick sign-in:', error);
      this.capabilities.set(null);
    }
  }

  async signInWithPasskey(): Promise<void> {
    if (this.busy()) {
      return;
    }
    this.authError.set(null);
    this.passkeyBusy.set(true);
    try {
      const session = await this.quickAuth.signInWithPasskey();
      await this.completeSignIn(session);
    } catch (error) {
      // A dismissed prompt is not a failure. Saying "authentication failed" to
      // somebody who changed their mind teaches them to distrust a working screen.
      if (error instanceof PasskeyCancelledError) {
        return;
      }
      this.authError.set(this.describe(error));
      if (error instanceof PasskeyUnavailableError) {
        // Whatever we believed about this device was wrong; stop offering it.
        this.capabilities.update((current) =>
          current ? { ...current, passkeySupported: false } : current
        );
      }
    } finally {
      this.passkeyBusy.set(false);
    }
  }

  openPinPad(): void {
    this.authError.set(null);
    this.pin.set('');
    this.pinMode.set(true);
  }

  closePinPad(): void {
    this.pinMode.set(false);
    this.pin.set('');
    this.authError.set(null);
  }

  selectOperator(event: Event): void {
    this.selectedOperatorId.set((event.target as HTMLSelectElement).value);
    // A different person is typing now, so whatever was entered is not their PIN.
    this.pin.set('');
    this.authError.set(null);
  }

  pressDigit(digit: string): void {
    if (this.pin().length >= MAX_PIN_LENGTH) {
      return;
    }
    this.authError.set(null);
    this.pin.update((current) => current + digit);
  }

  backspace(): void {
    this.pin.update((current) => current.slice(0, -1));
  }

  async submitPin(): Promise<void> {
    const operatorId = this.selectedOperatorId();
    if (this.busy() || !operatorId || !this.pinComplete()) {
      return;
    }
    this.authError.set(null);
    this.loading.set(true);
    try {
      const session = await this.quickAuth.signInWithPin(operatorId, this.pin());
      await this.completeSignIn(session);
    } catch (error) {
      this.authError.set(this.describe(error));
      // Cleared either way: a half-remembered PIN is retyped from the start, and
      // leaving the digits up would let the next person keep guessing from them.
      this.pin.set('');
    } finally {
      this.loading.set(false);
    }
  }

  async submit(): Promise<void> {
    // Mark fields to show validation state
    this.form.markAllAsTouched();
    this.showEmailError.set(!!this.form.get('email')?.invalid);
    this.showPasswordError.set(!!this.form.get('password')?.invalid);

    if (this.form.invalid || this.loading()) return;

    this.authError.set(null);
    this.loading.set(true);

    try {
      const { email, password } = this.form.getRawValue() as {
        email: string;
        password: string;
      };
      const session = await this.gateway.authenticate({ email, password });
      // Populate the in-memory principal so guards & directives react immediately
      this.currentUser.setSession(session);
      await this.router.navigate(['/pos']);
    } catch (err) {
      if (err instanceof InvalidCredentialsError) {
        this.authError.set('Invalid email or password. Please try again.');
      } else {
        this.authError.set('An unexpected error occurred. Please try again.');
      }
    } finally {
      this.loading.set(false);
    }
  }

  /** Shared tail of every route in: publish the principal, then navigate. */
  private async completeSignIn(
    session: Parameters<CurrentUserService['setSession']>[0]
  ): Promise<void> {
    this.currentUser.setSession(session);
    await this.router.navigate(['/pos']);
  }

  /**
   * Wording for a failure.
   *
   * Each of these leads somewhere different — try again, use the form, fetch a
   * manager — which is why they are not collapsed into one "sign-in failed".
   */
  private describe(error: unknown): string {
    if (error instanceof InvalidPinError) {
      return 'That PIN is not right. Try again.';
    }
    if (error instanceof OperatorInactiveError) {
      return 'That account is no longer active. Ask a manager.';
    }
    if (error instanceof PasskeyUnavailableError) {
      return 'This device cannot use a passkey. Sign in with your password below.';
    }
    if (error instanceof PasskeyVerificationError) {
      return error.message;
    }
    return 'An unexpected error occurred. Please try again.';
  }
}
