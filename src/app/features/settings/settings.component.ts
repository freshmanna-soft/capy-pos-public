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

/**
 * Settings Component
 *
 * Provides configuration UI for system preferences including:
 * - Appearance / dark mode (persisted to IndexedDB)
 * - Low stock threshold (persisted to IndexedDB)
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
