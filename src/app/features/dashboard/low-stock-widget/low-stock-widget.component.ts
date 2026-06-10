import { Component, ChangeDetectionStrategy, inject, signal, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Router } from '@angular/router';
import {
  GetLowStockAlertsUseCase,
  LowStockAlertDTO,
  LowStockAlertsResult,
} from '@core/application/use-cases/get-low-stock-alerts.use-case';
import { LowStockSettingsService } from '@core/application/services/low-stock-settings.service';

/**
 * Low Stock Widget Component
 *
 * Dashboard widget that displays low stock alerts summary.
 * Shows count of products below threshold with severity breakdown.
 * Clicking navigates to inventory page filtered by low stock.
 *
 * Uses OnPush change detection with signals for reactivity.
 */
@Component({
  selector: 'app-low-stock-widget',
  standalone: true,
  imports: [CommonModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div
      class="widget-container"
      [class.has-alerts]="totalCount() > 0"
      [class.no-alerts]="totalCount() === 0 && !loading()"
      data-testid="low-stock-widget"
    >
      <div class="widget-header">
        <h3>📦 Low Stock Alerts</h3>
        @if (loading()) {
          <span class="loading-indicator">Loading...</span>
        }
      </div>

      @if (!loading() && totalCount() === 0) {
        <div class="healthy-state" data-testid="healthy-state">
          <span class="healthy-icon">✅</span>
          <p>All products are well-stocked</p>
        </div>
      }

      @if (!loading() && totalCount() > 0) {
        <div class="alert-summary" data-testid="alert-summary">
          <div class="alert-count">
            <span class="count-number">{{ totalCount() }}</span>
            <span class="count-label">product{{ totalCount() > 1 ? 's' : '' }} need attention</span>
          </div>

          <div class="severity-breakdown">
            @if (criticalCount() > 0) {
              <div class="severity-item severity-critical" data-testid="critical-count">
                <span class="severity-dot"></span>
                <span>{{ criticalCount() }} critical (out of stock)</span>
              </div>
            }
            @if (warningCount() > 0) {
              <div class="severity-item severity-warning" data-testid="warning-count">
                <span class="severity-dot"></span>
                <span>{{ warningCount() }} warning (low stock)</span>
              </div>
            }
          </div>

          <!-- Top alerts preview -->
          @if (topAlerts().length > 0) {
            <div class="alerts-preview">
              @for (alert of topAlerts(); track alert.productId) {
                <div
                  class="alert-item"
                  [class.critical]="alert.severity === 'critical'"
                  [class.warning]="alert.severity === 'warning'"
                >
                  <span class="alert-name">{{ alert.productName }}</span>
                  <span class="alert-stock">{{ alert.currentStock }} units</span>
                </div>
              }
              @if (totalCount() > 3) {
                <div class="more-items">+{{ totalCount() - 3 }} more</div>
              }
            </div>
          }
        </div>

        <button
          class="btn-view-all"
          (click)="navigateToInventory()"
          data-testid="btn-view-inventory"
        >
          View in Inventory →
        </button>
      }
    </div>
  `,
  styles: [
    `
      .widget-container {
        padding: 1.5rem;
        background: white;
        border-radius: 12px;
        border: 1px solid #e5e7eb;
        transition: border-color 0.2s;
      }

      .widget-container.has-alerts {
        border-color: #f59e0b;
        border-width: 2px;
      }

      .widget-container.no-alerts {
        border-color: #86efac;
      }

      .widget-header {
        display: flex;
        justify-content: space-between;
        align-items: center;
        margin-bottom: 1rem;
      }

      .widget-header h3 {
        margin: 0;
        font-size: 1rem;
        font-weight: 600;
        color: #111827;
      }

      .loading-indicator {
        font-size: 0.75rem;
        color: #6b7280;
      }

      .healthy-state {
        display: flex;
        align-items: center;
        gap: 0.5rem;
        padding: 1rem;
        background: #f0fdf4;
        border-radius: 8px;
      }

      .healthy-icon {
        font-size: 1.25rem;
      }

      .healthy-state p {
        margin: 0;
        color: #166534;
        font-size: 0.875rem;
      }

      .alert-summary {
        display: flex;
        flex-direction: column;
        gap: 0.75rem;
      }

      .alert-count {
        display: flex;
        align-items: baseline;
        gap: 0.5rem;
      }

      .count-number {
        font-size: 2rem;
        font-weight: 700;
        color: #d97706;
      }

      .count-label {
        font-size: 0.875rem;
        color: #6b7280;
      }

      .severity-breakdown {
        display: flex;
        flex-direction: column;
        gap: 0.375rem;
      }

      .severity-item {
        display: flex;
        align-items: center;
        gap: 0.5rem;
        font-size: 0.8125rem;
      }

      .severity-dot {
        width: 8px;
        height: 8px;
        border-radius: 50%;
      }

      .severity-critical .severity-dot {
        background: #dc2626;
      }

      .severity-critical {
        color: #991b1b;
      }

      .severity-warning .severity-dot {
        background: #f59e0b;
      }

      .severity-warning {
        color: #92400e;
      }

      .alerts-preview {
        display: flex;
        flex-direction: column;
        gap: 0.375rem;
        margin-top: 0.5rem;
        padding-top: 0.75rem;
        border-top: 1px solid #f3f4f6;
      }

      .alert-item {
        display: flex;
        justify-content: space-between;
        align-items: center;
        padding: 0.375rem 0.625rem;
        border-radius: 6px;
        font-size: 0.8125rem;
      }

      .alert-item.critical {
        background: #fef2f2;
      }

      .alert-item.warning {
        background: #fffbeb;
      }

      .alert-name {
        font-weight: 500;
        color: #374151;
      }

      .alert-stock {
        font-weight: 600;
        color: #6b7280;
      }

      .more-items {
        font-size: 0.75rem;
        color: #9ca3af;
        text-align: center;
        padding: 0.25rem;
      }

      .btn-view-all {
        margin-top: 1rem;
        width: 100%;
        padding: 0.625rem;
        background: #fef3c7;
        color: #92400e;
        border: 1px solid #fcd34d;
        border-radius: 8px;
        font-size: 0.875rem;
        font-weight: 600;
        cursor: pointer;
        transition: background 0.15s;
      }

      .btn-view-all:hover {
        background: #fde68a;
      }
    `,
  ],
})
export class LowStockWidgetComponent implements OnInit {
  private readonly lowStockUseCase = inject(GetLowStockAlertsUseCase);
  private readonly settingsService = inject(LowStockSettingsService);
  private readonly router = inject(Router);

  readonly loading = signal(true);
  readonly totalCount = signal(0);
  readonly criticalCount = signal(0);
  readonly warningCount = signal(0);
  readonly topAlerts = signal<LowStockAlertDTO[]>([]);

  async ngOnInit(): Promise<void> {
    await this.loadAlerts();
  }

  async loadAlerts(): Promise<void> {
    this.loading.set(true);

    const threshold = await this.settingsService.loadThreshold();
    const result: LowStockAlertsResult = await this.lowStockUseCase.execute(threshold);

    this.totalCount.set(result.totalCount);
    this.criticalCount.set(result.criticalCount);
    this.warningCount.set(result.warningCount);
    this.topAlerts.set(result.alerts.slice(0, 3));

    this.loading.set(false);
  }

  navigateToInventory(): void {
    this.router.navigate(['/inventory'], { queryParams: { filter: 'low-stock' } });
  }
}
