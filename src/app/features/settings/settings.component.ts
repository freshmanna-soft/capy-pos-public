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
import { Router } from '@angular/router';
import { Permission } from '@core/domain/auth';
import { LowStockSettingsService } from '@core/application/services/low-stock-settings.service';
import {
  KioskSettingsService,
  StoreRecord,
  TerminalRecord,
  LatLng,
} from '@core/application/services/kiosk-settings.service';
import { TerminalMode } from '@core/domain/auth/terminal-id.value-object';
import { FenceMapComponent } from '@shared/ui/fence-map/fence-map.component';
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
import { environment } from '../../../environments/environment';

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
  imports: [CommonModule, FormsModule, FenceMapComponent],
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

      <!-- ── Org → Store → Terminal ────────────────────────────────────────── -->
      <div class="settings-section" data-testid="store-info-settings">
        <div class="section-header">
          <h2>🏪 Organisations, Stores &amp; Terminals</h2>
          <p class="section-description">
            Define the hierarchy that gives every kiosk its store context. Each terminal shows its
            store name, address and phone to the customer.
          </p>
        </div>

        <!-- Active-terminal banner + launch button -->
        <div class="active-terminal-banner" data-testid="active-terminal-banner">
          <span class="atb-label">This device is running as</span>
          <strong class="atb-id">{{ kioskSettings.terminalId() }}</strong>
          <span class="atb-store">{{ kioskSettings.storeName() || 'Unnamed store' }}</span>
          @if (canUseKiosk()) {
            <button class="btn-launch-kiosk" (click)="launchKiosk()" data-testid="btn-launch-kiosk">
              🏧 Open Kiosk Terminal
            </button>
          }
        </div>

        <!-- ── Org list ─────────────────────────────────────────────────── -->
        @for (org of kioskSettings.orgs(); track org.orgId) {
          <div class="entity-card" [attr.data-testid]="'org-card-' + org.orgId">
            <!-- Org header row -->
            <div class="entity-header">
              <div class="entity-icon">🏢</div>
              <div class="entity-title-area">
                <input
                  class="entity-name-input"
                  type="text"
                  placeholder="Organisation name"
                  [value]="org.name"
                  (change)="updateOrgName(org, $any($event.target).value)"
                  [attr.data-testid]="'input-org-name-' + org.orgId"
                />
                <code class="entity-id-badge">{{ org.orgId }}</code>
              </div>
              <button
                class="btn-icon btn-danger"
                title="Delete organisation"
                (click)="confirmDeleteOrg(org.orgId)"
                [attr.data-testid]="'btn-delete-org-' + org.orgId"
              >
                ✕
              </button>
            </div>

            <!-- ── Store list under this org ─────────────────────────── -->
            @for (store of storesForOrg(org.orgId); track store.storeId) {
              <div class="store-card" [attr.data-testid]="'store-card-' + store.storeId">
                <!-- Store header row -->
                <div class="entity-header entity-header--store">
                  <div class="entity-icon">🏬</div>
                  <div class="entity-title-area">
                    <input
                      class="entity-name-input"
                      type="text"
                      placeholder="Store name"
                      [value]="store.name"
                      (change)="updateStoreName(store, $any($event.target).value)"
                      [attr.data-testid]="'input-store-name-' + store.storeId"
                    />
                    <code class="entity-id-badge">{{ store.storeId }}</code>
                  </div>
                  <button
                    class="btn-icon btn-danger"
                    title="Delete store"
                    (click)="confirmDeleteStore(store.storeId)"
                    [attr.data-testid]="'btn-delete-store-' + store.storeId"
                  >
                    ✕
                  </button>
                </div>

                <!-- Store contact fields -->
                <div class="store-contact-grid">
                  <input
                    class="store-input"
                    type="text"
                    placeholder="Street address"
                    [value]="store.address"
                    (change)="updateStoreAddress(store, $any($event.target).value)"
                    [attr.data-testid]="'input-address-' + store.storeId"
                  />
                  <input
                    class="store-input"
                    type="tel"
                    placeholder="Support phone"
                    [value]="store.phone"
                    (change)="updateStorePhone(store, $any($event.target).value)"
                    [attr.data-testid]="'input-phone-' + store.storeId"
                  />
                </div>

                <!-- ── Geofence polygon map ────────────────────────────── -->
                <div class="fence-section" [attr.data-testid]="'fence-section-' + store.storeId">
                  <button
                    type="button"
                    class="fence-toggle"
                    (click)="toggleFenceMap(store.storeId)"
                    [attr.data-testid]="'btn-toggle-fence-' + store.storeId"
                  >
                    <span>🗺️ Geofence polygon</span>
                    @if (store.fencePolygon.length >= 3) {
                      <span class="fence-badge fence-badge--on">● Active</span>
                    } @else {
                      <span class="fence-badge">Not configured</span>
                    }
                    <span class="fence-toggle-caret">{{
                      fenceMapOpen(store.storeId) ? '▲' : '▼'
                    }}</span>
                  </button>

                  @if (fenceMapOpen(store.storeId)) {
                    <app-fence-map
                      [initialPolygon]="store.fencePolygon"
                      (polygonChange)="saveFencePolygon(store, $event)"
                      [attr.data-testid]="'fence-map-' + store.storeId"
                    />
                  }
                </div>

                <!-- ── Terminal list under this store ─────────────────── -->
                @for (terminal of terminalsForStore(store.storeId); track terminal.terminalId) {
                  <div
                    class="terminal-row"
                    [class.terminal-row--active]="
                      kioskSettings.activeTerminalId() === terminal.terminalId
                    "
                    [attr.data-testid]="'terminal-row-' + terminal.terminalId"
                  >
                    <div class="terminal-left">
                      <span
                        class="terminal-mode-badge"
                        [class.terminal-mode-badge--kiosk]="terminal.mode === 'kiosk'"
                      >
                        {{ terminal.mode === 'kiosk' ? '🏧' : '🧑‍💼' }}
                      </span>
                      <div>
                        <input
                          class="terminal-label-input"
                          type="text"
                          placeholder="Terminal label"
                          [value]="terminal.label"
                          (change)="updateTerminalLabel(terminal, $any($event.target).value)"
                          [attr.data-testid]="'input-label-' + terminal.terminalId"
                        />
                        <code class="entity-id-badge entity-id-badge--sm">{{
                          terminal.terminalId
                        }}</code>
                      </div>
                    </div>

                    <div class="terminal-right">
                      <!-- Mode selector -->
                      <div class="mode-toggle mode-toggle--sm" role="group">
                        <button
                          class="mode-btn mode-btn--sm"
                          [class.mode-btn--active]="terminal.mode === 'operator'"
                          (click)="setTerminalMode(terminal, 'operator')"
                        >
                          Op
                        </button>
                        <button
                          class="mode-btn mode-btn--sm"
                          [class.mode-btn--active]="terminal.mode === 'kiosk'"
                          (click)="setTerminalMode(terminal, 'kiosk')"
                        >
                          Kiosk
                        </button>
                      </div>
                      <!-- "Use this terminal" button -->
                      @if (kioskSettings.activeTerminalId() !== terminal.terminalId) {
                        <button
                          class="btn-use"
                          (click)="activateTerminal(terminal.terminalId)"
                          [attr.data-testid]="'btn-activate-' + terminal.terminalId"
                        >
                          Use this terminal
                        </button>
                      } @else {
                        <span class="terminal-active-chip">● Active</span>
                      }
                      <!-- Payment overrides -->
                      <div class="payment-overrides">
                        <label class="override-label"
                          >MP
                          <select
                            class="override-select"
                            [value]="
                              terminal.mercadopagoEnabled === null
                                ? 'auto'
                                : terminal.mercadopagoEnabled
                                  ? 'on'
                                  : 'off'
                            "
                            (change)="setMpOverride(terminal, $any($event.target).value)"
                            [attr.data-testid]="'mp-override-' + terminal.terminalId"
                          >
                            <option value="auto">Auto</option>
                            <option value="on">On</option>
                            <option value="off">Off</option>
                          </select>
                        </label>
                        <label class="override-label"
                          >PayPal
                          <select
                            class="override-select"
                            [value]="
                              terminal.paypalEnabled === null
                                ? 'auto'
                                : terminal.paypalEnabled
                                  ? 'on'
                                  : 'off'
                            "
                            (change)="setPaypalOverride(terminal, $any($event.target).value)"
                            [attr.data-testid]="'paypal-override-' + terminal.terminalId"
                          >
                            <option value="auto">Auto</option>
                            <option value="on">On</option>
                            <option value="off">Off</option>
                          </select>
                        </label>
                      </div>
                      <!-- Device token section (kiosk mode only) -->
                      @if (terminal.mode === 'kiosk') {
                        <div class="device-token-row">
                          @if (terminal.deviceToken) {
                            <span
                              class="device-token-chip"
                              [attr.data-testid]="'device-token-chip-' + terminal.terminalId"
                              title="{{ terminal.deviceToken }}"
                              >🔑 Token set</span
                            >
                          } @else {
                            <span class="device-token-chip device-token-chip--missing"
                              >⚠️ No token</span
                            >
                          }
                          <button
                            class="btn-token"
                            [disabled]="tokenBusy(terminal.terminalId)"
                            (click)="generateDeviceToken(terminal)"
                            [attr.data-testid]="'btn-generate-token-' + terminal.terminalId"
                          >
                            {{
                              tokenBusy(terminal.terminalId)
                                ? 'Generating…'
                                : terminal.deviceToken
                                  ? 'Regenerate'
                                  : 'Generate token'
                            }}
                          </button>
                          @if (tokenError(terminal.terminalId)) {
                            <span
                              class="device-token-error"
                              [attr.data-testid]="'token-error-' + terminal.terminalId"
                              >{{ tokenError(terminal.terminalId) }}</span
                            >
                          }
                        </div>
                      }
                      <button
                        class="btn-icon btn-danger"
                        title="Delete terminal"
                        (click)="confirmDeleteTerminal(terminal.terminalId)"
                        [attr.data-testid]="'btn-delete-terminal-' + terminal.terminalId"
                      >
                        ✕
                      </button>
                    </div>
                  </div>
                }

                <!-- Add terminal -->
                <button
                  class="btn-add btn-add--terminal"
                  (click)="addTerminal(store.storeId)"
                  [attr.data-testid]="'btn-add-terminal-' + store.storeId"
                >
                  + Add terminal
                </button>
              </div>
            }

            <!-- Add store under this org -->
            <button
              class="btn-add btn-add--store"
              (click)="addStore(org.orgId)"
              [attr.data-testid]="'btn-add-store-' + org.orgId"
            >
              + Add store
            </button>
          </div>
        }

        <!-- Add org -->
        <button class="btn-add btn-add--org" (click)="addOrg()" data-testid="btn-add-org">
          + Add organisation
        </button>

        @if (hierarchySaved()) {
          <div class="message message-success" data-testid="hierarchy-saved">✓ Saved.</div>
        }
      </div>

      <!-- Tax Configuration (still coming soon) -->
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

      /* ── Org / Store / Terminal hierarchy ─────────────────────────────── */

      .active-terminal-banner {
        display: flex;
        align-items: center;
        gap: 0.625rem;
        margin-top: 1rem;
        padding: 0.625rem 1rem;
        background: #eff6ff;
        border: 1px solid #bfdbfe;
        border-radius: 8px;
        font-size: 0.8125rem;
      }
      .atb-label {
        color: #3b82f6;
      }
      .atb-id {
        color: #1d4ed8;
        font-family: monospace;
      }
      .atb-store {
        color: #374151;
        margin-left: auto;
      }
      .btn-launch-kiosk {
        margin-left: 0.75rem;
        padding: 0.25rem 0.75rem;
        font-size: 0.75rem;
        font-weight: 600;
        background: #1d4ed8;
        color: white;
        border: none;
        border-radius: 6px;
        cursor: pointer;
        white-space: nowrap;
        flex-shrink: 0;
      }
      .btn-launch-kiosk:hover {
        background: #1e40af;
      }

      .entity-card {
        margin-top: 1rem;
        padding: 1rem;
        background: white;
        border: 1px solid #e5e7eb;
        border-radius: 12px;
      }
      .store-card {
        margin-top: 0.75rem;
        padding: 0.75rem 1rem;
        background: #f9fafb;
        border: 1px solid #e5e7eb;
        border-radius: 8px;
      }

      .entity-header {
        display: flex;
        align-items: center;
        gap: 0.75rem;
      }
      .entity-header--store {
        gap: 0.5rem;
      }

      .entity-icon {
        font-size: 1.25rem;
        flex-shrink: 0;
      }

      .entity-title-area {
        flex: 1;
        display: flex;
        flex-direction: column;
        gap: 0.25rem;
      }

      .entity-name-input,
      .terminal-label-input {
        width: 100%;
        padding: 0.375rem 0.625rem;
        border: 1px solid #d1d5db;
        border-radius: 6px;
        font-size: 0.9375rem;
        font-weight: 600;
        outline: none;
        background: white;
      }
      .entity-name-input:focus,
      .terminal-label-input:focus {
        border-color: #2563eb;
      }
      .terminal-label-input {
        font-size: 0.875rem;
        font-weight: 500;
      }

      .entity-id-badge {
        font-family: monospace;
        font-size: 0.7rem;
        color: #6b7280;
        background: #f3f4f6;
        padding: 0.1rem 0.375rem;
        border-radius: 4px;
        width: fit-content;
      }
      .entity-id-badge--sm {
        font-size: 0.65rem;
      }

      .store-contact-grid {
        display: grid;
        grid-template-columns: 1fr 1fr;
        gap: 0.5rem;
        margin-top: 0.5rem;
      }

      .store-input {
        padding: 0.375rem 0.625rem;
        border: 1px solid #d1d5db;
        border-radius: 6px;
        font-size: 0.875rem;
        outline: none;
        width: 100%;
        box-sizing: border-box;
      }
      .store-input:focus {
        border-color: #2563eb;
      }

      /* Terminal row */
      .terminal-row {
        display: flex;
        align-items: flex-start;
        gap: 0.75rem;
        margin-top: 0.5rem;
        padding: 0.625rem 0.75rem;
        background: white;
        border: 1px solid #e5e7eb;
        border-radius: 6px;
      }
      .terminal-row--active {
        border-color: #3b82f6;
        background: #eff6ff;
      }
      .terminal-left {
        display: flex;
        align-items: flex-start;
        gap: 0.5rem;
        flex: 1;
        min-width: 0;
      }
      .terminal-right {
        display: flex;
        align-items: center;
        gap: 0.5rem;
        flex-wrap: wrap;
        justify-content: flex-end;
      }

      .terminal-mode-badge {
        font-size: 1.25rem;
        flex-shrink: 0;
        margin-top: 0.125rem;
      }

      .mode-toggle {
        display: flex;
        border: 1px solid #d1d5db;
        border-radius: 6px;
        overflow: hidden;
      }
      .mode-toggle--sm {
      }
      .mode-btn {
        padding: 0.375rem 0.875rem;
        background: white;
        border: none;
        font-size: 0.875rem;
        font-weight: 500;
        cursor: pointer;
        transition:
          background 0.15s,
          color 0.15s;
      }
      .mode-btn--sm {
        padding: 0.25rem 0.5rem;
        font-size: 0.75rem;
      }
      .mode-btn--active {
        background: #2563eb;
        color: white;
        font-weight: 600;
      }
      .mode-btn:not(.mode-btn--active):hover {
        background: #f3f4f6;
      }

      .terminal-active-chip {
        font-size: 0.75rem;
        font-weight: 600;
        color: #16a34a;
        background: #dcfce7;
        padding: 0.2rem 0.5rem;
        border-radius: 9999px;
        white-space: nowrap;
      }

      .btn-use {
        padding: 0.25rem 0.625rem;
        font-size: 0.75rem;
        font-weight: 600;
        background: none;
        border: 1px solid #2563eb;
        color: #2563eb;
        border-radius: 6px;
        cursor: pointer;
        white-space: nowrap;
      }
      .btn-use:hover {
        background: #eff6ff;
      }

      .payment-overrides {
        display: flex;
        gap: 0.5rem;
        flex-wrap: wrap;
      }
      .override-label {
        display: flex;
        align-items: center;
        gap: 0.25rem;
        font-size: 0.75rem;
        font-weight: 500;
        color: #374151;
      }
      .override-select {
        padding: 0.15rem 0.25rem;
        font-size: 0.75rem;
        border: 1px solid #d1d5db;
        border-radius: 4px;
        background: white;
        cursor: pointer;
      }

      .btn-icon {
        width: 28px;
        height: 28px;
        border-radius: 6px;
        border: 1px solid transparent;
        background: none;
        font-size: 0.75rem;
        cursor: pointer;
        display: flex;
        align-items: center;
        justify-content: center;
        flex-shrink: 0;
      }
      .btn-danger {
        border-color: #fca5a5;
        color: #b91c1c;
      }
      .btn-danger:hover {
        background: #fef2f2;
      }

      .device-token-row {
        display: flex;
        align-items: center;
        gap: 0.375rem;
        flex-wrap: wrap;
        margin-top: 0.125rem;
      }
      .device-token-chip {
        font-size: 0.7rem;
        font-weight: 500;
        padding: 0.1rem 0.4rem;
        border-radius: 4px;
        background: #dcfce7;
        color: #166534;
        white-space: nowrap;
      }
      .device-token-chip--missing {
        background: #fef9c3;
        color: #854d0e;
      }
      .btn-token {
        padding: 0.2rem 0.5rem;
        font-size: 0.7rem;
        font-weight: 600;
        background: none;
        border: 1px solid #7c3aed;
        color: #7c3aed;
        border-radius: 4px;
        cursor: pointer;
        white-space: nowrap;
      }
      .btn-token:hover:not(:disabled) {
        background: #f5f3ff;
      }
      .btn-token:disabled {
        opacity: 0.5;
        cursor: wait;
      }
      .device-token-error {
        font-size: 0.7rem;
        color: #b91c1c;
      }

      .btn-add {
        display: block;
        width: 100%;
        margin-top: 0.5rem;
        padding: 0.5rem;
        background: none;
        border: 1px dashed #d1d5db;
        border-radius: 6px;
        font-size: 0.8125rem;
        font-weight: 600;
        color: #6b7280;
        cursor: pointer;
        text-align: left;
        transition:
          border-color 0.15s,
          color 0.15s;
      }
      .btn-add:hover {
        border-color: #2563eb;
        color: #2563eb;
      }
      .btn-add--org {
        margin-top: 1rem;
        border-radius: 8px;
      }
      .btn-add--store {
        border-radius: 6px;
      }
      .btn-add--terminal {
        font-size: 0.75rem;
      }

      /* Dark mode additions */
      :host-context(html.dark) .entity-card {
        background: #1f2937;
        border-color: #374151;
      }
      :host-context(html.dark) .store-card {
        background: #111827;
        border-color: #374151;
      }
      :host-context(html.dark) .terminal-row {
        background: #1f2937;
        border-color: #374151;
      }
      :host-context(html.dark) .terminal-row--active {
        background: #1e3a5f;
        border-color: #3b82f6;
      }
      :host-context(html.dark) .entity-name-input,
      :host-context(html.dark) .terminal-label-input,
      :host-context(html.dark) .store-input,
      :host-context(html.dark) .override-select {
        background: #374151;
        border-color: #4b5563;
        color: #f9fafb;
      }
      :host-context(html.dark) .entity-id-badge {
        background: #374151;
        color: #9ca3af;
      }
      :host-context(html.dark) .active-terminal-banner {
        background: #1e3a5f;
        border-color: #1d4ed8;
      }
      :host-context(html.dark) .btn-add {
        border-color: #4b5563;
        color: #9ca3af;
      }
      :host-context(html.dark) .mode-btn:not(.mode-btn--active) {
        background: #374151;
        color: #d1d5db;
      }

      /* ── Fence section ──────────────────────────────────────────────── */
      .fence-section {
        margin-top: 0.625rem;
        border: 1px solid #e5e7eb;
        border-radius: 8px;
        overflow: hidden;
      }
      .fence-toggle {
        display: flex;
        align-items: center;
        gap: 0.5rem;
        width: 100%;
        padding: 0.5rem 0.75rem;
        background: white;
        border: none;
        cursor: pointer;
        font-size: 0.8125rem;
        font-weight: 600;
        color: #374151;
        text-align: left;
        transition: background 0.15s;
      }
      .fence-toggle:hover {
        background: #f9fafb;
      }
      .fence-toggle-caret {
        margin-left: auto;
        font-size: 0.65rem;
        color: #9ca3af;
      }
      .fence-badge {
        font-size: 0.7rem;
        font-weight: 600;
        padding: 0.1rem 0.4rem;
        border-radius: 9999px;
        background: #f3f4f6;
        color: #6b7280;
      }
      .fence-badge--on {
        background: #dcfce7;
        color: #166534;
      }

      :host-context(html.dark) .fence-section {
        border-color: #374151;
      }
      :host-context(html.dark) .fence-toggle {
        background: #1f2937;
        color: #e5e7eb;
      }
      :host-context(html.dark) .fence-toggle:hover {
        background: #111827;
      }
    `,
  ],
})
export class SettingsComponent implements OnInit {
  private readonly quickAuthAdmin = inject(QUICK_AUTH_ADMIN_PORT);
  private readonly quickAuth = inject(QUICK_AUTH_GATEWAY);
  private readonly currentUser = inject(CurrentUserService);
  private readonly router = inject(Router);

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
  /** True when the current operator holds USE_KIOSK — gates the launch button. */
  readonly canUseKiosk = computed(() => this.currentUser.hasPermission(Permission.USE_KIOSK));

  readonly lowStockSettings = inject(LowStockSettingsService);
  readonly kioskSettings = inject(KioskSettingsService);
  private readonly themeService = inject(ThemeService);

  readonly thresholdInput = signal(10);
  readonly saveSuccess = signal(false);
  readonly saveError = signal<string | null>(null);
  readonly hierarchySaved = signal(false);

  /** Per-terminal busy state for device-token generation. Key = terminalId. */
  private readonly _tokenBusy = signal<Record<string, boolean>>({});
  /** Per-terminal error message for device-token generation. Key = terminalId. */
  private readonly _tokenError = signal<Record<string, string>>({});

  tokenBusy(terminalId: string): boolean {
    return this._tokenBusy()[terminalId] ?? false;
  }
  tokenError(terminalId: string): string | null {
    return this._tokenError()[terminalId] ?? null;
  }

  /** Set of store IDs whose fence map panel is currently expanded. */
  private readonly _openFenceMaps = signal<Set<string>>(new Set());

  /** Returns true when the fence map panel for `storeId` is open. */
  fenceMapOpen(storeId: string): boolean {
    return this._openFenceMaps().has(storeId);
  }

  /** Toggle the fence map panel for a given store. */
  toggleFenceMap(storeId: string): void {
    this._openFenceMaps.update((s) => {
      const next = new Set(s);
      if (next.has(storeId)) {
        next.delete(storeId);
      } else {
        next.add(storeId);
      }
      return next;
    });
  }

  /** Whether dark mode is currently active */
  readonly isDark = computed(() => this.themeService.theme() === 'dark');

  /** Toggle between light and dark mode (persisted to IndexedDB) */
  async toggleDarkMode(): Promise<void> {
    await this.themeService.toggleTheme();
  }

  async ngOnInit(): Promise<void> {
    const threshold = await this.lowStockSettings.loadThreshold();
    this.thresholdInput.set(threshold);
    await this.kioskSettings.load();
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

  // ── Hierarchy helpers ─────────────────────────────────────────────────────

  storesForOrg(orgId: string) {
    return this.kioskSettings.stores().filter((s) => s.orgId === orgId);
  }

  terminalsForStore(storeId: string) {
    return this.kioskSettings.terminals().filter((t) => t.storeId === storeId);
  }

  private _flash(): void {
    this.hierarchySaved.set(true);
    setTimeout(() => this.hierarchySaved.set(false), 2000);
  }

  // ── Org actions ──────────────────────────────────────────────────────────

  async addOrg(): Promise<void> {
    const orgId = `org-${Date.now()}`;
    await this.kioskSettings.saveOrg({ orgId, name: '' });
    this._flash();
  }

  async updateOrgName(org: { orgId: string; name: string }, name: string): Promise<void> {
    await this.kioskSettings.saveOrg({ ...org, name: name.trim() });
    this._flash();
  }

  async confirmDeleteOrg(orgId: string): Promise<void> {
    if (!confirm('Delete this organisation and all its stores and terminals?')) return;
    await this.kioskSettings.deleteOrg(orgId);
  }

  // ── Store actions ─────────────────────────────────────────────────────────

  async addStore(orgId: string): Promise<void> {
    const storeId = this.kioskSettings.nextStoreId(orgId, `store-${Date.now()}`);
    await this.kioskSettings.saveStore({
      orgId,
      storeId,
      name: '',
      address: '',
      phone: '',
      fencePolygon: [],
    });
    this._flash();
  }

  async updateStoreName(store: StoreRecord, name: string): Promise<void> {
    await this.kioskSettings.saveStore({ ...store, name: name.trim() });
    this._flash();
  }

  async updateStoreAddress(store: StoreRecord, address: string): Promise<void> {
    await this.kioskSettings.saveStore({ ...store, address: address.trim() });
    this._flash();
  }

  async updateStorePhone(store: StoreRecord, phone: string): Promise<void> {
    await this.kioskSettings.saveStore({ ...store, phone: phone.trim() });
    this._flash();
  }

  /** Persist the polygon drawn in the fence map editor for a store. */
  async saveFencePolygon(store: StoreRecord, polygon: LatLng[]): Promise<void> {
    await this.kioskSettings.saveStore({ ...store, fencePolygon: polygon });
    this._flash();
  }

  async confirmDeleteStore(storeId: string): Promise<void> {
    if (!confirm('Delete this store and all its terminals?')) return;
    await this.kioskSettings.deleteStore(storeId);
  }

  // ── Terminal actions ──────────────────────────────────────────────────────

  async addTerminal(storeId: string): Promise<void> {
    const terminalId = this.kioskSettings.nextTerminalId(storeId, `terminal-${Date.now()}`);
    const orgId = storeId.split('/')[0];
    await this.kioskSettings.saveTerminal({
      orgId,
      storeId,
      terminalId,
      label: 'New terminal',
      mode: TerminalMode.OPERATOR,
      mercadopagoEnabled: null,
      paypalEnabled: null,
      fenceEnabled: false,
      fenceLat: null,
      fenceLng: null,
      fenceRadiusMeters: 200,
    });
    this._flash();
  }

  async updateTerminalLabel(terminal: TerminalRecord, label: string): Promise<void> {
    await this.kioskSettings.saveTerminal({ ...terminal, label: label.trim() });
    this._flash();
  }

  async setTerminalMode(terminal: TerminalRecord, mode: TerminalMode): Promise<void> {
    await this.kioskSettings.saveTerminal({ ...terminal, mode });
    this._flash();
  }

  async setMpOverride(terminal: TerminalRecord, value: string): Promise<void> {
    const override = value === 'auto' ? null : value === 'on';
    await this.kioskSettings.saveTerminal({ ...terminal, mercadopagoEnabled: override });
    this._flash();
  }

  async setPaypalOverride(terminal: TerminalRecord, value: string): Promise<void> {
    const override = value === 'auto' ? null : value === 'on';
    await this.kioskSettings.saveTerminal({ ...terminal, paypalEnabled: override });
    this._flash();
  }

  async activateTerminal(terminalId: string): Promise<void> {
    await this.kioskSettings.setActiveTerminal(terminalId);
    this._flash();
  }

  async confirmDeleteTerminal(terminalId: string): Promise<void> {
    if (!confirm('Delete this terminal?')) return;
    await this.kioskSettings.deleteTerminal(terminalId);
  }

  /**
   * Call `POST /api/kiosk-device-token` with the staff JWT and save the returned
   * token to the terminal record in Dexie.
   *
   * Requires the operator to be signed in (staff JWT on session).
   */
  async generateDeviceToken(terminal: TerminalRecord): Promise<void> {
    const accessToken = this.currentUser.session()?.accessToken;
    if (!accessToken) {
      this._tokenError.update((e) => ({ ...e, [terminal.terminalId]: 'Not signed in' }));
      return;
    }

    this._tokenBusy.update((b) => ({ ...b, [terminal.terminalId]: true }));
    this._tokenError.update((e) => ({ ...e, [terminal.terminalId]: '' }));

    try {
      const response = await fetch(`${environment.apiUrl}/kiosk-device-token`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${accessToken}`,
        },
        body: JSON.stringify({ terminalId: terminal.terminalId }),
      });

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }

      const { token } = (await response.json()) as { token: string };
      await this.kioskSettings.saveTerminal({ ...terminal, deviceToken: token });
      this._flash();
    } catch (err) {
      this._tokenError.update((e) => ({
        ...e,
        [terminal.terminalId]: err instanceof Error ? err.message : 'Failed',
      }));
    } finally {
      this._tokenBusy.update((b) => ({ ...b, [terminal.terminalId]: false }));
    }
  }
  /** Navigate to the kiosk splash screen for this terminal. */
  launchKiosk(): void {
    void this.router.navigate(['/kiosk']);
  }
}
