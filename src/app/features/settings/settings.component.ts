import {
  Component,
  ChangeDetectionStrategy,
  inject,
  signal,
  computed,
  OnInit,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { LowStockSettingsService } from '@core/application/services/low-stock-settings.service';
import { ThemeService } from '@core/application/services/theme.service';
import { CurrentUserService } from '@core/application/auth/current-user.service';
import {
  PasskeyAlreadyEnrolledError,
  QUICK_AUTH_ADMIN_PORT,
  WeakPinError,
} from '@core/application/auth/ports/quick-auth-admin.port';
import {
  PasskeyCancelledError,
  PasskeyUnavailableError,
  QUICK_AUTH_GATEWAY,
} from '@core/application/auth/ports/quick-auth.port';
import { PasskeySummaryDto } from '@core/application/auth/dtos/quick-auth.dto';
import { MAX_PIN_LENGTH, MIN_PIN_LENGTH } from '@core/infrastructure/auth/webauthn/pin-policy';

/**
 * Settings Component
 *
 * Provides configuration UI for system preferences including:
 * - Appearance / dark mode (persisted to IndexedDB)
 * - Low stock threshold (persisted to IndexedDB)
 * - How the signed-in operator signs in on this device (passkey, PIN)
 *
 * Uses OnPush change detection with signals for reactivity.
 */
@Component({
  selector: 'app-settings',
  standalone: true,
  imports: [CommonModule, FormsModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="page-container" data-testid="settings-page">
      <div class="page-header">
        <h1>⚙️ Settings</h1>
        <p class="page-subtitle">Configure system preferences and thresholds</p>
      </div>

      <!-- Appearance Section -->
      <div class="settings-section" data-testid="appearance-settings">
        <div class="section-header">
          <h2>🎨 Appearance</h2>
          <p class="section-description">Customize how Capy-POS looks</p>
        </div>

        <div class="setting-card">
          <div class="setting-row">
            <div class="setting-info">
              <h3>Dark Mode</h3>
              <p>Use a darker colour palette that's easier on the eyes in low light.</p>
            </div>
            <button
              type="button"
              role="switch"
              class="theme-switch"
              [class.theme-switch--on]="isDark()"
              [attr.aria-checked]="isDark()"
              aria-label="Toggle dark mode"
              (click)="toggleDarkMode()"
              data-testid="btn-toggle-dark-mode"
            >
              <span class="theme-switch__track">
                <span class="theme-switch__thumb">{{ isDark() ? '🌙' : '☀️' }}</span>
              </span>
            </button>
          </div>
        </div>
      </div>

      <!-- Low Stock Threshold Section -->
      <div class="settings-section" data-testid="low-stock-settings">
        <div class="section-header">
          <h2>📦 Inventory Alerts</h2>
          <p class="section-description">Configure when products are flagged as low stock</p>
        </div>

        <div class="setting-card">
          <div class="setting-info">
            <h3>Low Stock Threshold</h3>
            <p>
              Products with stock at or below this number will trigger a low stock alert. Set to a
              higher value for critical items.
            </p>
          </div>
          <div class="setting-control">
            <div class="threshold-input-group">
              <button
                class="btn-adjust btn-decrease"
                (click)="decreaseThreshold()"
                [disabled]="thresholdInput() <= 1 || lowStockSettings.loading()"
                data-testid="btn-decrease-threshold"
                aria-label="Decrease threshold"
              >
                −
              </button>
              <input
                type="number"
                class="threshold-input"
                [ngModel]="thresholdInput()"
                (ngModelChange)="thresholdInput.set($event)"
                min="1"
                max="999"
                data-testid="input-threshold"
              />
              <button
                class="btn-adjust btn-increase"
                (click)="increaseThreshold()"
                [disabled]="thresholdInput() >= 999 || lowStockSettings.loading()"
                data-testid="btn-increase-threshold"
                aria-label="Increase threshold"
              >
                +
              </button>
              <span class="threshold-unit">units</span>
            </div>
            <button
              class="btn-save"
              (click)="saveThreshold()"
              [disabled]="
                lowStockSettings.loading() || thresholdInput() === lowStockSettings.threshold()
              "
              data-testid="btn-save-threshold"
            >
              {{ lowStockSettings.loading() ? 'Saving...' : 'Save' }}
            </button>
          </div>
        </div>

        <!-- Success/Error Messages -->
        @if (saveSuccess()) {
          <div class="message message-success" data-testid="save-success">
            ✅ Threshold saved successfully
          </div>
        }
        @if (saveError()) {
          <div class="message message-error" data-testid="save-error">❌ {{ saveError() }}</div>
        }
      </div>

      <!-- Sign-in on this device -->
      <div class="settings-section" data-testid="signin-settings">
        <div class="section-header">
          <h2>🔑 Signing in on this device</h2>
          <p class="section-description">
            Set up a faster way to start your shift. Your fingerprint or face never leaves this
            device — Capy-POS only stores a public key.
          </p>
        </div>

        @if (!signedIn()) {
          <div class="coming-soon-card" data-testid="signin-needs-session">
            <span class="coming-icon">🔒</span>
            <p>Sign in first to set up a passkey or a PIN.</p>
          </div>
        } @else {
          <div class="setting-card">
            <!-- Passkeys -->
            <div class="setting-info">
              <h3>Passkeys</h3>
              @if (!passkeySupported()) {
                <p data-testid="passkey-unsupported">
                  This device has no fingerprint or face reader available to the browser, so a PIN
                  is the quicker option here.
                </p>
              } @else {
                <p>One touch to sign in, with nothing to type or overhear.</p>
              }
            </div>

            @if (passkeySupported()) {
              @if (passkeys().length > 0) {
                <ul class="passkey-list" data-testid="passkey-list">
                  @for (passkey of passkeys(); track passkey.credentialId) {
                    <li class="passkey-row">
                      <span class="passkey-label">{{ passkey.label }}</span>
                      <span class="passkey-meta">
                        @if (passkey.lastUsedAt) {
                          Last used {{ passkey.lastUsedAt | date: 'mediumDate' }}
                        } @else if (passkey.createdAt) {
                          Added {{ passkey.createdAt | date: 'mediumDate' }}
                        } @else {
                          Added earlier
                        }
                      </span>
                      <button
                        type="button"
                        class="btn-remove"
                        (click)="removePasskey(passkey.credentialId)"
                        [disabled]="busy()"
                        [attr.data-testid]="'btn-remove-passkey'"
                        [attr.aria-label]="'Remove passkey ' + passkey.label"
                      >
                        Remove
                      </button>
                    </li>
                  }
                </ul>
              }

              <div class="setting-control">
                <input
                  type="text"
                  class="threshold-input passkey-name"
                  [ngModel]="newPasskeyLabel()"
                  (ngModelChange)="newPasskeyLabel.set($event)"
                  placeholder="Name this device"
                  aria-label="Name for this passkey"
                  data-testid="input-passkey-label"
                />
                <button
                  type="button"
                  class="btn-save"
                  (click)="addPasskey()"
                  [disabled]="busy()"
                  data-testid="btn-add-passkey"
                >
                  {{ enrolling() ? 'Waiting for you…' : 'Add this device' }}
                </button>
              </div>
            }
          </div>

          <!-- PIN -->
          <div class="setting-card">
            <div class="setting-info">
              <h3>Till PIN</h3>
              <p>
                A {{ minPinLength }}–{{ maxPinLength }} digit fallback for a device with no reader.
                Weaker than a passkey — someone can watch you type it.
              </p>
            </div>

            <div class="setting-control">
              <input
                type="password"
                inputmode="numeric"
                autocomplete="new-password"
                class="threshold-input"
                [ngModel]="newPin()"
                (ngModelChange)="newPin.set($event)"
                placeholder="New PIN"
                aria-label="New till PIN"
                data-testid="input-new-pin"
              />
              <button
                type="button"
                class="btn-save"
                (click)="savePin()"
                [disabled]="busy()"
                data-testid="btn-save-pin"
              >
                {{ hasPin() ? 'Change PIN' : 'Set PIN' }}
              </button>
              @if (hasPin()) {
                <button
                  type="button"
                  class="btn-remove"
                  (click)="removePin()"
                  [disabled]="busy()"
                  data-testid="btn-clear-pin"
                >
                  Remove PIN
                </button>
              }
            </div>
          </div>

          @if (signinMessage()) {
            <div class="message message-success" data-testid="signin-success">
              ✅ {{ signinMessage() }}
            </div>
          }
          @if (signinError()) {
            <div class="message message-error" data-testid="signin-error">
              ❌ {{ signinError() }}
            </div>
          }
        }
      </div>

      <!-- Future Settings Placeholder -->
      <div class="settings-section">
        <div class="section-header">
          <h2>🏪 Store Information</h2>
          <p class="section-description">Store name, address, and contact details</p>
        </div>
        <div class="coming-soon-card">
          <span class="coming-icon">🚧</span>
          <p>Coming in a future sprint</p>
        </div>
      </div>

      <div class="settings-section">
        <div class="section-header">
          <h2>💰 Tax Configuration</h2>
          <p class="section-description">Tax rates and calculation rules</p>
        </div>
        <div class="coming-soon-card">
          <span class="coming-icon">🚧</span>
          <p>Coming in a future sprint</p>
        </div>
      </div>
    </div>
  `,
  styles: [
    `
      .page-container {
        padding: 2rem;
        max-width: 800px;
        margin: 0 auto;
      }

      .page-header h1 {
        font-size: 1.75rem;
        font-weight: 700;
        color: #111827;
        margin: 0;
      }

      .page-subtitle {
        color: #6b7280;
        margin: 0.25rem 0 0;
      }

      .settings-section {
        margin-top: 2rem;
      }

      .section-header h2 {
        font-size: 1.25rem;
        font-weight: 600;
        color: #111827;
        margin: 0;
      }

      .section-description {
        color: #6b7280;
        font-size: 0.875rem;
        margin: 0.25rem 0 0;
      }

      .setting-card {
        margin-top: 1rem;
        padding: 1.5rem;
        background: white;
        border-radius: 12px;
        border: 1px solid #e5e7eb;
      }

      .setting-info h3 {
        font-size: 1rem;
        font-weight: 600;
        color: #374151;
        margin: 0 0 0.25rem;
      }

      .setting-info p {
        color: #6b7280;
        font-size: 0.875rem;
        margin: 0;
        line-height: 1.5;
      }

      .setting-control {
        display: flex;
        align-items: center;
        gap: 1rem;
        margin-top: 1rem;
      }

      .threshold-input-group {
        display: flex;
        align-items: center;
        gap: 0.5rem;
      }

      .threshold-input {
        width: 80px;
        padding: 0.5rem 0.75rem;
        border: 2px solid #e5e7eb;
        border-radius: 8px;
        font-size: 1.125rem;
        font-weight: 600;
        text-align: center;
        outline: none;
        transition: border-color 0.15s;
      }

      .threshold-input:focus {
        border-color: #2563eb;
      }

      .threshold-unit {
        font-size: 0.875rem;
        color: #6b7280;
      }

      .btn-adjust {
        width: 36px;
        height: 36px;
        border: 2px solid #e5e7eb;
        border-radius: 8px;
        background: white;
        font-size: 1.25rem;
        font-weight: 700;
        cursor: pointer;
        display: flex;
        align-items: center;
        justify-content: center;
        transition: all 0.15s;
      }

      .btn-increase:hover:not(:disabled) {
        background: #dcfce7;
        border-color: #16a34a;
        color: #16a34a;
      }

      .btn-decrease:hover:not(:disabled) {
        background: #fee2e2;
        border-color: #dc2626;
        color: #dc2626;
      }

      .btn-adjust:disabled {
        opacity: 0.3;
        cursor: not-allowed;
      }

      .btn-save {
        padding: 0.5rem 1.25rem;
        background: #2563eb;
        color: white;
        border: none;
        border-radius: 8px;
        font-size: 0.875rem;
        font-weight: 600;
        cursor: pointer;
        transition: background 0.15s;
      }

      .btn-save:hover:not(:disabled) {
        background: #1d4ed8;
      }

      .btn-save:disabled {
        opacity: 0.5;
        cursor: not-allowed;
      }

      .message {
        margin-top: 1rem;
        padding: 0.75rem 1rem;
        border-radius: 8px;
        font-size: 0.875rem;
      }

      .message-success {
        background: #dcfce7;
        color: #166534;
        border: 1px solid #86efac;
      }

      .message-error {
        background: #fee2e2;
        color: #991b1b;
        border: 1px solid #fca5a5;
      }

      .coming-soon-card {
        margin-top: 1rem;
        display: flex;
        align-items: center;
        gap: 0.75rem;
        padding: 1.5rem;
        background: white;
        border-radius: 12px;
        border: 2px dashed #d1d5db;
      }

      .coming-icon {
        font-size: 1.5rem;
      }

      .coming-soon-card p {
        color: #6b7280;
        margin: 0;
      }

      .setting-row {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 1rem;
      }

      /* Toggle switch */
      .theme-switch {
        flex-shrink: 0;
        background: transparent;
        border: none;
        padding: 0;
        cursor: pointer;
      }

      .theme-switch__track {
        display: flex;
        align-items: center;
        width: 56px;
        height: 30px;
        padding: 3px;
        border-radius: 9999px;
        background: #d1d5db;
        transition: background 0.2s ease;
      }

      .theme-switch--on .theme-switch__track {
        background: #2563eb;
      }

      .theme-switch__thumb {
        width: 24px;
        height: 24px;
        border-radius: 9999px;
        background: white;
        display: flex;
        align-items: center;
        justify-content: center;
        font-size: 0.875rem;
        transition: transform 0.2s ease;
      }

      .theme-switch--on .theme-switch__thumb {
        transform: translateX(26px);
      }

      .theme-switch:focus-visible .theme-switch__track {
        outline: 2px solid #2563eb;
        outline-offset: 2px;
      }

      /* --- Sign-in on this device -------------------------------------- */

      .passkey-list {
        list-style: none;
        margin: 0 0 1rem;
        padding: 0;
        display: flex;
        flex-direction: column;
        gap: 0.5rem;
      }

      .passkey-row {
        display: flex;
        align-items: center;
        gap: 0.75rem;
        padding: 0.625rem 0.75rem;
        background: #f9fafb;
        border: 1px solid #e5e7eb;
        border-radius: 8px;
      }

      .passkey-label {
        font-weight: 600;
        color: #111827;
      }

      .passkey-meta {
        flex: 1;
        font-size: 0.8125rem;
        color: #6b7280;
      }

      .passkey-name {
        min-width: 12rem;
      }

      .btn-remove {
        padding: 0.5rem 0.875rem;
        background: none;
        border: 1px solid #fca5a5;
        border-radius: 8px;
        color: #b91c1c;
        font-size: 0.875rem;
        font-weight: 600;
        cursor: pointer;
      }

      .btn-remove:hover:not(:disabled) {
        background: #fef2f2;
      }

      .btn-remove:disabled {
        opacity: 0.5;
        cursor: not-allowed;
      }

      :host-context(html.dark) .passkey-row {
        background: #111827;
        border-color: #374151;
      }

      :host-context(html.dark) .passkey-label {
        color: #e5e7eb;
      }

      @media (max-width: 640px) {
        .page-container {
          padding: 1rem;
        }
        .setting-control {
          flex-direction: column;
          align-items: flex-start;
        }
      }

      /* Dark mode — driven by ThemeService toggling the .dark class on html */
      :host-context(html.dark) .page-header h1,
      :host-context(html.dark) .section-header h2 {
        color: #f9fafb;
      }

      :host-context(html.dark) .page-subtitle,
      :host-context(html.dark) .section-description,
      :host-context(html.dark) .setting-info p,
      :host-context(html.dark) .threshold-unit,
      :host-context(html.dark) .coming-soon-card p {
        color: #9ca3af;
      }

      :host-context(html.dark) .setting-info h3 {
        color: #e5e7eb;
      }

      :host-context(html.dark) .setting-card {
        background: #1f2937;
        border-color: #374151;
      }

      :host-context(html.dark) .coming-soon-card {
        background: #1f2937;
        border-color: #4b5563;
      }

      :host-context(html.dark) .threshold-input,
      :host-context(html.dark) .btn-adjust {
        background: #374151;
        border-color: #4b5563;
        color: #f9fafb;
      }

      :host-context(html.dark) .theme-switch__track {
        background: #4b5563;
      }

      :host-context(html.dark) .theme-switch--on .theme-switch__track {
        background: #2563eb;
      }
    `,
  ],
})
export class SettingsComponent implements OnInit {
  private readonly quickAuthAdmin = inject(QUICK_AUTH_ADMIN_PORT);
  private readonly quickAuth = inject(QUICK_AUTH_GATEWAY);
  private readonly currentUser = inject(CurrentUserService);

  readonly minPinLength = MIN_PIN_LENGTH;
  readonly maxPinLength = MAX_PIN_LENGTH;

  readonly passkeys = signal<PasskeySummaryDto[]>([]);
  readonly passkeySupported = signal(false);
  readonly hasPin = signal(false);
  readonly newPasskeyLabel = signal('');
  readonly newPin = signal('');
  readonly enrolling = signal(false);
  readonly savingPin = signal(false);
  readonly signinMessage = signal<string | null>(null);
  readonly signinError = signal<string | null>(null);

  /** Nothing here can be set up for nobody — see QuickAuthAdminPort. */
  readonly signedIn = computed(() => this.currentUser.operatorId() !== null);
  readonly busy = computed(() => this.enrolling() || this.savingPin());

  readonly lowStockSettings = inject(LowStockSettingsService);
  private readonly themeService = inject(ThemeService);

  readonly thresholdInput = signal(10);
  readonly saveSuccess = signal(false);
  readonly saveError = signal<string | null>(null);

  /** Whether dark mode is currently active */
  readonly isDark = computed(() => this.themeService.theme() === 'dark');

  /** Toggle between light and dark mode (persisted to IndexedDB) */
  async toggleDarkMode(): Promise<void> {
    await this.themeService.toggleTheme();
  }

  async ngOnInit(): Promise<void> {
    const threshold = await this.lowStockSettings.loadThreshold();
    this.thresholdInput.set(threshold);
    await this.loadSignInMethods();
  }

  // ─── Sign-in on this device ────────────────────────────────────────────────

  /**
   * Read what the signed-in operator has already set up here.
   *
   * Failures are swallowed to a console warning rather than shown: this is one
   * section of a settings page, and a red banner about it would sit above the theme
   * toggle and the stock threshold, both of which are working fine.
   */
  private async loadSignInMethods(): Promise<void> {
    const operatorId = this.currentUser.operatorId();
    if (!operatorId) {
      return;
    }
    try {
      const [capabilities, passkeys] = await Promise.all([
        this.quickAuth.capabilities(),
        this.quickAuthAdmin.listPasskeys(operatorId),
      ]);
      this.passkeySupported.set(capabilities.passkeySupported);
      this.passkeys.set(passkeys);
      // Whether *this* operator has a PIN, not whether anyone does: the button has to
      // say "Set" or "Change", and the remove button must not offer to clear a PIN
      // belonging to somebody else.
      const operators = await this.quickAuth.listPinOperators();
      this.hasPin.set(operators.some((entry) => entry.operatorId === operatorId));
    } catch (error) {
      console.warn('[Settings] Could not read sign-in methods:', error);
    }
  }

  async addPasskey(): Promise<void> {
    const operatorId = this.currentUser.operatorId();
    if (!operatorId || this.busy()) {
      return;
    }
    this.clearSignInMessages();
    this.enrolling.set(true);
    try {
      const label = this.newPasskeyLabel().trim();
      const created = await this.quickAuthAdmin.enrollPasskey(operatorId, label);
      this.passkeys.update((current) => [...current, created]);
      this.newPasskeyLabel.set('');
      this.signinMessage.set(`${created.label} can now sign you in.`);
    } catch (error) {
      // Cancelling an OS prompt is not an error worth reporting — the operator
      // decided not to, and the page already shows what they have.
      if (!(error instanceof PasskeyCancelledError)) {
        this.signinError.set(this.describeSignInError(error));
      }
    } finally {
      this.enrolling.set(false);
    }
  }

  /**
   * Forget a passkey.
   *
   * Deliberately worded as "this till will no longer accept it": the credential
   * itself lives in the operating system's keychain and is the operator's to delete
   * there. Claiming to have removed something we cannot reach would be a lie.
   */
  async removePasskey(credentialId: string): Promise<void> {
    if (this.busy()) {
      return;
    }
    this.clearSignInMessages();
    try {
      await this.quickAuthAdmin.revokePasskey(credentialId);
      this.passkeys.update((current) =>
        current.filter((entry) => entry.credentialId !== credentialId)
      );
      this.signinMessage.set('This till will no longer accept that passkey.');
    } catch (error) {
      this.signinError.set(this.describeSignInError(error));
    }
  }

  async savePin(): Promise<void> {
    const operatorId = this.currentUser.operatorId();
    if (!operatorId || this.busy()) {
      return;
    }
    this.clearSignInMessages();
    this.savingPin.set(true);
    try {
      await this.quickAuthAdmin.setPin(operatorId, this.newPin());
      this.hasPin.set(true);
      this.signinMessage.set('PIN saved.');
    } catch (error) {
      this.signinError.set(this.describeSignInError(error));
    } finally {
      // Cleared whatever happened: a rejected PIN is retyped, and an accepted one
      // must not sit in an input where the next person can reveal it.
      this.newPin.set('');
      this.savingPin.set(false);
    }
  }

  async removePin(): Promise<void> {
    const operatorId = this.currentUser.operatorId();
    if (!operatorId || this.busy()) {
      return;
    }
    this.clearSignInMessages();
    try {
      await this.quickAuthAdmin.clearPin(operatorId);
      this.hasPin.set(false);
      this.newPin.set('');
      this.signinMessage.set('PIN removed.');
    } catch (error) {
      this.signinError.set(this.describeSignInError(error));
    }
  }

  private clearSignInMessages(): void {
    this.signinMessage.set(null);
    this.signinError.set(null);
  }

  /**
   * Wording for a failure, each pointing at a different next step.
   *
   * A weak PIN carries its own explanation from the domain rule that rejected it,
   * which is the only place that knows *which* rule was broken.
   */
  private describeSignInError(error: unknown): string {
    if (error instanceof WeakPinError) {
      return error.message;
    }
    if (error instanceof PasskeyAlreadyEnrolledError) {
      return 'This device already has a passkey for you.';
    }
    if (error instanceof PasskeyUnavailableError) {
      return 'This device cannot add a passkey. Set a PIN instead.';
    }
    return 'That did not work. Please try again.';
  }

  increaseThreshold(): void {
    if (this.thresholdInput() < 999) {
      this.thresholdInput.update((v) => v + 1);
    }
  }

  decreaseThreshold(): void {
    if (this.thresholdInput() > 1) {
      this.thresholdInput.update((v) => v - 1);
    }
  }

  async saveThreshold(): Promise<void> {
    this.saveSuccess.set(false);
    this.saveError.set(null);

    try {
      await this.lowStockSettings.saveThreshold(this.thresholdInput());
      this.saveSuccess.set(true);
      setTimeout(() => this.saveSuccess.set(false), 3000);
    } catch (err) {
      this.saveError.set(err instanceof Error ? err.message : 'Failed to save threshold');
    }
  }
}
