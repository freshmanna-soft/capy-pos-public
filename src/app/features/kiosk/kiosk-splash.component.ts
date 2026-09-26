import {
  Component,
  ChangeDetectionStrategy,
  OnDestroy,
  OnInit,
  inject,
  signal,
  computed,
} from '@angular/core';
import { Router } from '@angular/router';
import { FormsModule } from '@angular/forms';
import { CustomerBuilder } from '@core/domain/entities/customer.builder';
import { CustomerStatus, CustomerTier } from '@core/domain/entities/customer.entity';
import { CUSTOMER_REPOSITORY } from '@core/infrastructure/factories/repository.factory';
import { AUTH_GATEWAY } from '@core/application/auth/ports/auth-gateway.port';
import { KioskCustomerService } from '@features/kiosk/kiosk-customer.service';
import { KioskSettingsService } from '@core/application/services/kiosk-settings.service';
import { GeofencingService } from '@core/application/services/geofencing.service';
import { environment } from '../../../environments/environment';

/**
 * KioskSplashComponent
 *
 * Full-screen customer-facing landing page shown at /kiosk.
 * Three entry points:
 *  1. Start shopping (anonymous) → /kiosk/shop
 *  2. Register / Sign in (inline modal, UI-only shell)
 *  3. Staff Login (bottom-right button) → /login
 *
 * Idle timeout: 30 s of no interaction resets back to this splash.
 */
@Component({
  selector: 'app-kiosk-splash',
  standalone: true,
  imports: [FormsModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <!-- Full-screen backdrop -->
    <div
      class="relative min-h-screen bg-onsen-deep flex flex-col items-center justify-center overflow-hidden select-none"
      (click)="resetIdleTimer()"
      (keydown)="resetIdleTimer()"
      role="main"
      aria-label="Kiosk welcome screen"
    >
      <!-- Ambient gradient rings -->
      <div class="pointer-events-none absolute inset-0 overflow-hidden" aria-hidden="true">
        <div
          class="absolute -top-48 -left-48 w-[600px] h-[600px] rounded-full bg-onsen-water/20 blur-3xl"
        ></div>
        <div
          class="absolute -bottom-48 -right-48 w-[600px] h-[600px] rounded-full bg-kelp/20 blur-3xl"
        ></div>
      </div>

      <!-- Main content card -->
      <div
        class="relative z-10 flex flex-col items-center gap-10 px-8 py-12 max-w-lg w-full text-center"
      >
        <!-- Store logo / capybara SVG -->
        <div class="flex flex-col items-center gap-4">
          <div
            class="w-24 h-24 rounded-3xl bg-onsen-water flex items-center justify-center shadow-2xl"
          >
            <svg
              class="w-16 h-16"
              viewBox="0 0 24 24"
              fill="none"
              xmlns="http://www.w3.org/2000/svg"
              aria-hidden="true"
            >
              <path
                d="M12 2C12 2 9.5 4.5 9.5 7C9.5 8.5 10.5 9.5 12 9.5C13.5 9.5 14.5 8.5 14.5 7C14.5 4.5 12 2 12 2Z"
                fill="#EC4899"
              />
              <path
                d="M7.5 5C7.5 5 5 6.5 5 8.5C5 9.8 6 10.8 7.5 10.5C9 10.2 9.5 9 9 7.5C8.5 6 7.5 5 7.5 5Z"
                fill="#F472B6"
              />
              <path
                d="M16.5 5C16.5 5 19 6.5 19 8.5C19 9.8 18 10.8 16.5 10.5C15 10.2 14.5 9 15 7.5C15.5 6 16.5 5 16.5 5Z"
                fill="#F472B6"
              />
              <path
                d="M5 9C5 9 3 11 3.5 13C4 15 5.5 14.5 6.5 13.5C7.5 12.5 7 11 6.5 10C6 9 5 9 5 9Z"
                fill="#FB923C"
              />
              <path
                d="M19 9C19 9 21 11 20.5 13C20 15 18.5 14.5 17.5 13.5C16.5 12.5 17 11 17.5 10C18 9 19 9 19 9Z"
                fill="#FB923C"
              />
              <path
                d="M12 10C11 10 10 10.5 10 12C10 14 11 16 11.5 18C11.8 19.5 12 22 12 22C12 22 12.2 19.5 12.5 18C13 16 14 14 14 12C14 10.5 13 10 12 10Z"
                fill="#22C55E"
              />
            </svg>
          </div>
          <div>
            <h1 class="font-display text-4xl font-bold text-steam tracking-tight">
              {{ kioskSettings.storeName() || 'Capy Shop' }}
            </h1>
            @if (kioskSettings.orgName()) {
              <p class="mt-1 text-kelp/60 text-sm font-medium tracking-wide uppercase">
                {{ kioskSettings.orgName() }}
              </p>
            }
            <p class="mt-1 text-kelp text-lg font-medium">Your self-checkout experience</p>
            @if (kioskSettings.storeAddress()) {
              <p class="mt-1 text-kelp/60 text-xs font-medium">
                📍 {{ kioskSettings.storeAddress() }}
              </p>
            }
            @if (kioskSettings.storePhone()) {
              <p class="mt-0.5 text-kelp/60 text-xs font-medium">
                📞 {{ kioskSettings.storePhone() }}
              </p>
            }
          </div>
        </div>

        <!-- Location unavailable — store picker (shown when ≥2 stores and GPS denied) -->
        @if (showStorePicker()) {
          <div class="w-full flex flex-col items-center gap-4" data-testid="kiosk-store-picker">
            <div class="flex flex-col items-center gap-1 text-center">
              <span class="text-3xl" aria-hidden="true">🏪</span>
              <p class="text-steam font-display text-lg font-bold">Which store are you in?</p>
              <p class="text-kelp/70 text-xs leading-relaxed">
                Location access was unavailable. Tap your store to continue.
              </p>
            </div>
            @for (store of kioskSettings.stores(); track store.storeId) {
              <button
                class="w-full px-5 py-4 rounded-2xl border border-onsen-surface/60 bg-onsen-surface/20
                       text-left flex flex-col gap-0.5 active:bg-onsen-surface/50 transition-colors
                       focus:outline-none focus-visible:ring-2 focus-visible:ring-yuzu/60"
                (click)="pickStore(store.storeId)"
                [attr.data-testid]="'kiosk-store-pick-' + store.storeId"
              >
                <span class="text-steam font-semibold text-sm">{{
                  store.name || store.storeId
                }}</span>
                @if (store.address) {
                  <span class="text-kelp/60 text-xs">📍 {{ store.address }}</span>
                }
              </button>
            }
          </div>
        }

        <!-- Geofence blocked state -->
        @if (fenceBlocked()) {
          <div
            class="w-full rounded-2xl bg-tsuba/20 border border-tsuba/50 px-6 py-5 flex flex-col items-center gap-3 text-center"
            role="alert"
            data-testid="kiosk-fence-blocked"
          >
            <span class="text-4xl" aria-hidden="true">📍</span>
            <p class="text-steam font-display text-xl font-bold">Shopping not available here</p>
            <p class="text-kelp text-sm leading-relaxed">
              This self-checkout is only available inside
              @if (kioskSettings.storeName()) {
                <strong class="text-steam">{{ kioskSettings.storeName() }}</strong
                >.
              } @else {
                the store.
              }
              Please use a till inside or ask a staff member for help.
            </p>
            <button
              class="mt-1 px-5 py-2 rounded-xl border border-onsen-surface/70 text-kelp text-sm font-semibold hover:text-steam hover:bg-onsen-surface/40 transition-colors focus:outline-none"
              (click)="retryFenceCheck()"
              [disabled]="fenceChecking()"
              data-testid="kiosk-retry-fence"
            >
              {{ fenceChecking() ? '⏳ Checking location…' : '🔄 Try again' }}
            </button>
          </div>
        }

        @if (!fenceBlocked() && !showStorePicker()) {
          <!-- Primary CTA -->
          <button
            class="w-full min-h-[72px] rounded-2xl bg-yuzu text-onsen-deep font-display text-2xl font-bold shadow-lg shadow-yuzu/30 active:scale-95 transition-transform duration-150 focus:outline-none focus-visible:ring-4 focus-visible:ring-yuzu/60 disabled:opacity-50 disabled:cursor-not-allowed"
            (click)="startShopping()"
            [disabled]="fenceChecking()"
            aria-label="Start shopping"
            data-testid="kiosk-start-shopping"
          >
            @if (fenceChecking()) {
              ⏳ Checking location…
            } @else {
              🛒 Start Shopping
            }
          </button>

          <!-- Secondary CTA -->
          <button
            class="w-full min-h-[64px] rounded-2xl border-2 border-onsen-surface bg-transparent text-steam font-display text-xl font-semibold active:bg-onsen-surface/40 transition-colors duration-150 focus:outline-none focus-visible:ring-4 focus-visible:ring-steam/40"
            (click)="showAuthModal.set(true)"
            aria-label="Register or sign in to your account"
            data-testid="kiosk-sign-in"
          >
            👤 Register / Sign In
          </button>
        }
      </div>

      <!-- Staff Login — small, tucked in bottom-right -->
      <button
        class="absolute bottom-6 right-6 px-4 py-2 rounded-lg text-kelp/70 text-sm font-medium hover:text-steam hover:bg-onsen-surface/40 transition-colors duration-150 focus:outline-none focus-visible:ring-2 focus-visible:ring-kelp/60"
        (click)="goToStaffLogin()"
        aria-label="Staff login"
        data-testid="kiosk-staff-login"
      >
        🔒 Staff Login
      </button>

      <!-- Idle hint -->
      @if (idleCountdown() <= 10 && idleCountdown() > 0) {
        <div
          class="absolute bottom-6 left-1/2 -translate-x-1/2 px-4 py-2 rounded-xl bg-onsen-surface/80 text-steam text-sm font-medium"
          aria-live="polite"
          data-testid="kiosk-idle-hint"
        >
          Resetting in {{ idleCountdown() }}s…
        </div>
      }
    </div>

    <!-- Register / Sign In modal -->
    @if (showAuthModal()) {
      <div
        class="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-6"
        role="dialog"
        aria-modal="true"
        aria-label="Customer account"
        (click)="showAuthModal.set(false)"
        (keydown.escape)="showAuthModal.set(false)"
      >
        <div
          class="relative w-full max-w-sm bg-onsen-water rounded-3xl shadow-2xl p-8 flex flex-col gap-6"
          tabindex="0"
          (click)="$event.stopPropagation()"
          (keydown)="$event.stopPropagation()"
        >
          <!-- Close -->
          <button
            class="absolute top-4 right-4 w-10 h-10 rounded-full bg-onsen-surface/60 text-steam/80 hover:text-steam flex items-center justify-center focus:outline-none focus-visible:ring-2 focus-visible:ring-steam/60"
            (click)="showAuthModal.set(false)"
            aria-label="Close"
          >
            ✕
          </button>

          <h2 class="font-display text-2xl font-bold text-steam text-center">Your Account</h2>

          <!-- Email field -->
          <div class="flex flex-col gap-2">
            <label for="kiosk-email" class="text-steam/80 text-sm font-medium">Email address</label>
            <input
              id="kiosk-email"
              type="email"
              [(ngModel)]="authEmail"
              placeholder="you@example.com"
              class="min-h-[56px] rounded-xl bg-onsen-deep border border-onsen-surface/60 text-steam placeholder-kelp/60 px-4 text-base focus:outline-none focus:ring-2 focus:ring-yuzu/60"
              autocomplete="email"
              data-testid="kiosk-auth-email"
              (keydown.enter)="handleSignIn()"
            />
          </div>

          <!-- Error / success feedback -->
          @if (authError()) {
            <p class="text-red-400 text-sm text-center" role="alert" data-testid="kiosk-auth-error">
              {{ authError() }}
            </p>
          }
          @if (authResetSent()) {
            <p
              class="text-green-400 text-sm text-center font-medium"
              role="status"
              data-testid="kiosk-auth-reset-sent"
            >
              ✓ Reset link sent — check your email.
            </p>
          }

          @if (!forgotPasswordMode()) {
            <div class="flex flex-col gap-3">
              <button
                class="w-full min-h-[56px] rounded-xl bg-yuzu text-onsen-deep font-display text-lg font-bold active:scale-95 transition-transform duration-150 focus:outline-none focus-visible:ring-4 focus-visible:ring-yuzu/60 disabled:opacity-50 disabled:cursor-not-allowed"
                [disabled]="authBusy()"
                (click)="handleSignIn()"
                aria-label="Sign in"
                data-testid="kiosk-sign-in-submit"
              >
                {{ authBusy() ? 'Signing in…' : 'Sign In' }}
              </button>
              <button
                class="w-full min-h-[56px] rounded-xl border-2 border-onsen-surface text-steam font-display text-lg font-semibold active:bg-onsen-surface/40 transition-colors duration-150 focus:outline-none focus-visible:ring-4 focus-visible:ring-steam/40 disabled:opacity-50 disabled:cursor-not-allowed"
                [disabled]="authBusy()"
                (click)="handleCreateAccount()"
                aria-label="Create new account"
                data-testid="kiosk-create-account"
              >
                {{ authBusy() ? 'Creating…' : 'Create Account' }}
              </button>
            </div>

            @if (canResetPassword) {
              <button
                class="text-kelp/70 text-sm text-center underline underline-offset-2 hover:text-steam transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-steam/40"
                (click)="forgotPasswordMode.set(true); authError.set('')"
                data-testid="kiosk-forgot-password-link"
              >
                Forgot password?
              </button>
            }
          } @else {
            <!-- Forgot-password sub-form -->
            <p class="text-steam/70 text-sm text-center -mt-2">
              Enter your email and we'll send a reset link.
            </p>
            <button
              class="w-full min-h-[56px] rounded-xl bg-yuzu text-onsen-deep font-display text-lg font-bold active:scale-95 transition-transform duration-150 focus:outline-none focus-visible:ring-4 focus-visible:ring-yuzu/60 disabled:opacity-50 disabled:cursor-not-allowed"
              [disabled]="authBusy()"
              (click)="handleForgotPassword()"
              data-testid="kiosk-forgot-password-submit"
            >
              {{ authBusy() ? 'Sending…' : 'Send reset link' }}
            </button>
            <button
              class="text-kelp/70 text-sm text-center underline underline-offset-2 hover:text-steam transition-colors focus:outline-none"
              (click)="forgotPasswordMode.set(false); authError.set('')"
              data-testid="kiosk-forgot-password-cancel"
            >
              ← Back to sign in
            </button>
          }

          <p class="text-kelp/70 text-xs text-center leading-relaxed">
            A customer account lets you earn loyalty points and track your orders.
          </p>
        </div>
      </div>
    }
  `,
})
export class KioskSplashComponent implements OnInit, OnDestroy {
  private static readonly SHOP_ROUTE = '/kiosk/shop';

  private readonly router = inject(Router);
  private readonly customerRepo = inject(CUSTOMER_REPOSITORY);
  private readonly kioskCustomer = inject(KioskCustomerService);
  private readonly authGateway = inject(AUTH_GATEWAY);
  readonly kioskSettings = inject(KioskSettingsService);
  private readonly geofencing = inject(GeofencingService);

  /** Only show "Forgot password?" when App ID is the active provider. */
  readonly canResetPassword = environment.appId.enabled && this.authGateway.supportsPasswordReset;

  readonly showAuthModal = signal(false);
  readonly idleCountdown = signal(0);
  readonly authBusy = signal(false);
  readonly authError = signal('');
  readonly forgotPasswordMode = signal(false);
  /** True after a password-reset email was sent successfully. */
  readonly authResetSent = signal(false);

  /** True while a geofence position fix is in progress. */
  readonly fenceChecking = signal(false);
  /**
   * True when the device is confirmed outside the store fence.
   * Starts false so the CTAs are visible immediately when there is no fence.
   */
  readonly fenceBlocked = signal(false);

  /**
   * Show the store picker when:
   *  - There are ≥2 stores to choose from, AND
   *  - The fence check returned 'disabled' due to a location error (not because
   *    no fence is configured — we distinguish via `geofencing.errorMessage()`).
   *
   * This lets a customer who denied location (or whose browser doesn't support
   * GPS) self-attest which store they're in so checkout can proceed.
   */
  readonly showStorePicker = computed(
    () =>
      this.kioskSettings.stores().length >= 2 &&
      this.kioskSettings.hasFencePolygon() &&
      this.geofencing.errorMessage().length > 0 &&
      !this.fenceChecking() &&
      !this.fenceBlocked()
  );

  authEmail = '';

  private readonly idleTimeoutMs = 30_000;
  private readonly countdownIntervalMs = 1_000;
  private idleTimer: ReturnType<typeof setTimeout> | null = null;
  private countdownStartTimer: ReturnType<typeof setTimeout> | null = null;
  private countdownTimer: ReturnType<typeof setInterval> | null = null;
  private idleStarted = false;

  constructor() {
    this.startIdleTimer();
  }

  async ngOnInit(): Promise<void> {
    await this.kioskSettings.load();
    // Run a fence check after settings load so we know immediately whether
    // a polygon is configured and whether the device is inside it.
    await this.runFenceCheck();
  }

  ngOnDestroy(): void {
    this.clearTimers();
    this.geofencing.reset();
  }

  /**
   * Runs the geofence check and updates `fenceBlocked`.
   * If no fence is configured the check resolves to `'disabled'` and the
   * button is never blocked.
   */
  private async runFenceCheck(): Promise<void> {
    if (!this.kioskSettings.hasFencePolygon()) {
      // No polygon configured — never block.
      return;
    }
    this.fenceChecking.set(true);
    try {
      const status = await this.geofencing.checkFence();
      this.fenceBlocked.set(status === 'outside');
    } finally {
      this.fenceChecking.set(false);
    }
  }

  /** Called by the "Try again" button in the blocked state. */
  async retryFenceCheck(): Promise<void> {
    this.fenceBlocked.set(false);
    this.geofencing.reset();
    await this.runFenceCheck();
  }

  /**
   * Customer tapped a store from the picker — they self-attest their location.
   * Switch the active terminal to the first terminal of the chosen store and
   * navigate straight to the shop (fence check is skipped since location is
   * unavailable anyway).
   */
  async pickStore(storeId: string): Promise<void> {
    const terminal = this.kioskSettings.terminals().find((t) => t.storeId === storeId);
    if (terminal) {
      await this.kioskSettings.setActiveTerminal(terminal.terminalId);
    }
    void this.router.navigate([KioskSplashComponent.SHOP_ROUTE]);
  }

  /**
   * Navigate into the shop only after confirming the device is inside (or
   * fence is disabled).  Runs a fresh check to guard against someone walking
   * outside after the splash loaded.
   */
  async startShopping(): Promise<void> {
    if (this.kioskSettings.hasFencePolygon()) {
      this.fenceChecking.set(true);
      try {
        this.geofencing.reset();
        const status = await this.geofencing.checkFence();
        if (status === 'outside') {
          this.fenceBlocked.set(true);
          return;
        }
      } finally {
        this.fenceChecking.set(false);
      }
    }
    void this.router.navigate([KioskSplashComponent.SHOP_ROUTE]);
  }

  goToStaffLogin(): void {
    void this.router.navigate(['/login']);
  }

  /** Called by any interaction to reset the idle timeout. */
  resetIdleTimer(): void {
    this.clearTimers();
    this.idleCountdown.set(0);
    this.startIdleTimer();
  }

  async handleSignIn(): Promise<void> {
    const email = this.authEmail.trim().toLowerCase();
    if (!email) {
      this.authError.set('Please enter your email address.');
      return;
    }

    this.authBusy.set(true);
    this.authError.set('');
    try {
      const customer = await this.customerRepo.findByEmail(email);
      if (!customer) {
        this.authError.set('No account found. Tap "Create Account" to register.');
        return;
      }
      this.kioskCustomer.set(customer);
      this.showAuthModal.set(false);
      void this.router.navigate([KioskSplashComponent.SHOP_ROUTE]);
    } catch {
      this.authError.set('Something went wrong. Please try again.');
    } finally {
      this.authBusy.set(false);
    }
  }

  async handleCreateAccount(): Promise<void> {
    const email = this.authEmail.trim().toLowerCase();
    if (!email) {
      this.authError.set('Please enter your email address.');
      return;
    }
    if (!email.includes('@')) {
      this.authError.set('Please enter a valid email address.');
      return;
    }

    this.authBusy.set(true);
    this.authError.set('');
    try {
      const existing = await this.customerRepo.findByEmail(email);
      if (existing) {
        // Already registered — sign them in directly.
        this.kioskCustomer.set(existing);
        this.showAuthModal.set(false);
        void this.router.navigate([KioskSplashComponent.SHOP_ROUTE]);
        return;
      }

      const newCustomer = new CustomerBuilder()
        .withEmail(email)
        .withName(email.split('@')[0]) // best-effort display name from email prefix
        // Phone is intentionally empty: the kiosk registration form only asks for
        // an email address. Customer.validate() treats phone as optional so this
        // is valid — no "phone is required" error will be thrown.
        .withPhone('')
        .withStatus(CustomerStatus.ACTIVE)
        .withTier(CustomerTier.BRONZE)
        .build();

      const created = await this.customerRepo.create(newCustomer);
      this.kioskCustomer.set(created);
      this.showAuthModal.set(false);
      void this.router.navigate([KioskSplashComponent.SHOP_ROUTE]);
    } catch (err) {
      console.error('[KioskSplash] create account failed:', err);
      this.authError.set('Could not create account. Please try again.');
    } finally {
      this.authBusy.set(false);
    }
  }

  async handleForgotPassword(): Promise<void> {
    const email = this.authEmail.trim().toLowerCase();
    if (!email) {
      this.authError.set('Please enter your email address.');
      return;
    }
    if (!email.includes('@')) {
      this.authError.set('Please enter a valid email address.');
      return;
    }

    this.authBusy.set(true);
    this.authError.set('');
    try {
      await this.authGateway.requestPasswordReset(email);
      // Always show the same message — relay never reveals whether the address existed.
      this.authError.set('');
      this.forgotPasswordMode.set(false);
      // Reuse the error slot for success — green tint via a separate signal.
      this.authResetSent.set(true);
    } catch {
      this.authError.set('Could not send reset email. Please try again.');
    } finally {
      this.authBusy.set(false);
    }
  }

  private startIdleTimer(): void {
    this.idleTimer = setTimeout(() => {
      this.resetToSplash();
    }, this.idleTimeoutMs);

    // Start the visible countdown 10 s before the reset.
    const countdownStartMs = this.idleTimeoutMs - 10_000;
    this.countdownStartTimer = setTimeout(() => {
      this.countdownStartTimer = null;
      if (this.idleStarted) return;
      this.idleStarted = true;
      let remaining = 10;
      this.idleCountdown.set(remaining);
      this.countdownTimer = setInterval(() => {
        remaining -= 1;
        this.idleCountdown.set(remaining);
        if (remaining <= 0) {
          this.clearCountdownTimer();
        }
      }, this.countdownIntervalMs);
    }, countdownStartMs);
  }

  private resetToSplash(): void {
    this.clearTimers();
    this.idleCountdown.set(0);
    this.showAuthModal.set(false);
    this.authEmail = '';
    this.authError.set('');
    this.authResetSent.set(false);
    this.forgotPasswordMode.set(false);
    this.idleStarted = false;
    this.startIdleTimer();
  }

  private clearTimers(): void {
    if (this.idleTimer !== null) {
      clearTimeout(this.idleTimer);
      this.idleTimer = null;
    }
    if (this.countdownStartTimer !== null) {
      clearTimeout(this.countdownStartTimer);
      this.countdownStartTimer = null;
    }
    this.clearCountdownTimer();
    this.idleStarted = false;
  }

  private clearCountdownTimer(): void {
    if (this.countdownTimer !== null) {
      clearInterval(this.countdownTimer);
      this.countdownTimer = null;
    }
  }
}
