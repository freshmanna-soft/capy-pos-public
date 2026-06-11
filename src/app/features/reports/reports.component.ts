import { Component, ChangeDetectionStrategy, inject, signal, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterLink } from '@angular/router';
import { GetDailySalesReportUseCase } from '@core/application/use-cases/get-daily-sales-report.use-case';

/**
 * Date filter preset options
 */
type DatePreset = 'today' | 'yesterday' | 'custom';

/**
 * Reports Component
 *
 * Displays daily sales reporting with:
 * - Total revenue, transaction count, average transaction value
 * - Payment method breakdown (cash vs card)
 * - Date filter (today, yesterday, custom range)
 *
 * Story: [S3-4] Daily Sales Reporting
 */
@Component({
  selector: 'app-reports',
  standalone: true,
  imports: [CommonModule, RouterLink],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="min-h-screen bg-gray-50 p-6" data-testid="reports-page">
      <!-- Header -->
      <div class="flex items-center justify-between mb-6">
        <div>
          <h1 class="text-2xl font-bold text-gray-900">📊 Daily Sales Report</h1>
          <p class="text-sm text-gray-500 mt-1">Track your business performance</p>
        </div>
        <a
          routerLink="/pos"
          data-testid="back-to-pos"
          class="text-blue-600 hover:text-blue-800 text-sm font-medium"
        >
          ← Back to POS
        </a>
      </div>

      <!-- Date Filter -->
      <div class="bg-white rounded-lg shadow-sm border p-4 mb-6" data-testid="date-filter">
        <div class="flex items-center gap-3 flex-wrap">
          <span class="text-sm font-medium text-gray-700">Period:</span>
          <button
            (click)="selectPreset('today')"
            [class]="
              activePreset() === 'today'
                ? 'bg-blue-600 text-white'
                : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
            "
            class="px-3 py-1.5 rounded-md text-sm font-medium transition-colors"
            data-testid="btn-today"
          >
            Today
          </button>
          <button
            (click)="selectPreset('yesterday')"
            [class]="
              activePreset() === 'yesterday'
                ? 'bg-blue-600 text-white'
                : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
            "
            class="px-3 py-1.5 rounded-md text-sm font-medium transition-colors"
            data-testid="btn-yesterday"
          >
            Yesterday
          </button>
          <button
            (click)="selectPreset('custom')"
            [class]="
              activePreset() === 'custom'
                ? 'bg-blue-600 text-white'
                : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
            "
            class="px-3 py-1.5 rounded-md text-sm font-medium transition-colors"
            data-testid="btn-custom"
          >
            Custom
          </button>

          @if (activePreset() === 'custom') {
            <div class="flex items-center gap-2 ml-2">
              <input
                type="date"
                [value]="customStartDate()"
                (change)="onCustomStartChange($event)"
                class="border rounded px-2 py-1 text-sm"
                data-testid="input-start-date"
              />
              <span class="text-gray-400">to</span>
              <input
                type="date"
                [value]="customEndDate()"
                (change)="onCustomEndChange($event)"
                class="border rounded px-2 py-1 text-sm"
                data-testid="input-end-date"
              />
              <button
                (click)="applyCustomRange()"
                class="bg-blue-600 text-white px-3 py-1 rounded text-sm hover:bg-blue-700"
                data-testid="btn-apply-custom"
              >
                Apply
              </button>
            </div>
          }
        </div>
      </div>

      <!-- Loading State -->
      @if (useCase.loading()) {
        <div class="flex justify-center py-12" data-testid="loading-indicator">
          <div class="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600"></div>
        </div>
      }

      <!-- Error State -->
      @if (useCase.error()) {
        <div
          class="bg-red-50 border border-red-200 rounded-lg p-4 mb-6"
          data-testid="error-message"
        >
          <p class="text-red-700">{{ useCase.error() }}</p>
          <button
            (click)="refresh()"
            class="text-red-600 underline text-sm mt-2"
            data-testid="btn-retry"
          >
            Retry
          </button>
        </div>
      }

      <!-- Report Cards -->
      @if (useCase.result() && !useCase.loading()) {
        <div class="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6" data-testid="summary-cards">
          <!-- Total Revenue -->
          <div class="bg-white rounded-lg shadow-sm border p-5" data-testid="card-revenue">
            <div class="flex items-center justify-between">
              <div>
                <p class="text-sm font-medium text-gray-500">Total Revenue</p>
                <p class="text-2xl font-bold text-gray-900 mt-1" data-testid="value-revenue">
                  {{ formatCurrency(useCase.result()!.totalRevenue) }}
                </p>
              </div>
              <div class="text-3xl">💰</div>
            </div>
          </div>

          <!-- Transaction Count -->
          <div class="bg-white rounded-lg shadow-sm border p-5" data-testid="card-transactions">
            <div class="flex items-center justify-between">
              <div>
                <p class="text-sm font-medium text-gray-500">Transactions</p>
                <p class="text-2xl font-bold text-gray-900 mt-1" data-testid="value-transactions">
                  {{ useCase.result()!.transactionCount }}
                </p>
              </div>
              <div class="text-3xl">🧾</div>
            </div>
          </div>

          <!-- Average Value -->
          <div class="bg-white rounded-lg shadow-sm border p-5" data-testid="card-average">
            <div class="flex items-center justify-between">
              <div>
                <p class="text-sm font-medium text-gray-500">Average Value</p>
                <p class="text-2xl font-bold text-gray-900 mt-1" data-testid="value-average">
                  {{ formatCurrency(useCase.result()!.averageTransactionValue) }}
                </p>
              </div>
              <div class="text-3xl">📈</div>
            </div>
          </div>
        </div>

        <!-- Payment Breakdown -->
        <div class="bg-white rounded-lg shadow-sm border p-5" data-testid="payment-breakdown">
          <h2 class="text-lg font-semibold text-gray-900 mb-4">Payment Method Breakdown</h2>
          <div class="grid grid-cols-1 md:grid-cols-3 gap-4">
            <!-- Cash -->
            <div
              class="flex items-center justify-between p-4 bg-green-50 rounded-lg"
              data-testid="breakdown-cash"
            >
              <div class="flex items-center gap-3">
                <span class="text-2xl">💵</span>
                <div>
                  <p class="font-medium text-gray-900">Cash</p>
                  <p class="text-sm text-gray-500" data-testid="cash-count">
                    {{ useCase.result()!.paymentBreakdown.cashCount }} transactions
                  </p>
                </div>
              </div>
              <p class="text-lg font-bold text-green-700" data-testid="cash-total">
                {{ formatCurrency(useCase.result()!.paymentBreakdown.cash) }}
              </p>
            </div>

            <!-- Card -->
            <div
              class="flex items-center justify-between p-4 bg-blue-50 rounded-lg"
              data-testid="breakdown-card"
            >
              <div class="flex items-center gap-3">
                <span class="text-2xl">💳</span>
                <div>
                  <p class="font-medium text-gray-900">Card</p>
                  <p class="text-sm text-gray-500" data-testid="card-count">
                    {{ useCase.result()!.paymentBreakdown.cardCount }} transactions
                  </p>
                </div>
              </div>
              <p class="text-lg font-bold text-blue-700" data-testid="card-total">
                {{ formatCurrency(useCase.result()!.paymentBreakdown.card) }}
              </p>
            </div>

            <!-- Mobile -->
            <div
              class="flex items-center justify-between p-4 bg-violet-50 rounded-lg"
              data-testid="breakdown-mobile"
            >
              <div class="flex items-center gap-3">
                <span class="text-2xl">📱</span>
                <div>
                  <p class="font-medium text-gray-900">Mobile</p>
                  <p class="text-sm text-gray-500" data-testid="mobile-count">
                    {{ useCase.result()!.paymentBreakdown.mobileCount }} transactions
                  </p>
                </div>
              </div>
              <p class="text-lg font-bold text-violet-700" data-testid="mobile-total">
                {{ formatCurrency(useCase.result()!.paymentBreakdown.mobile) }}
              </p>
            </div>
          </div>
        </div>

        <!-- Empty State -->
        @if (useCase.result()!.transactionCount === 0) {
          <div class="text-center py-8 text-gray-500" data-testid="empty-state">
            <p class="text-4xl mb-2">📭</p>
            <p class="font-medium">No transactions for this period</p>
            <p class="text-sm mt-1">Try selecting a different date range</p>
          </div>
        }
      }
    </div>
  `,
})
export class ReportsComponent implements OnInit {
  readonly useCase = inject(GetDailySalesReportUseCase);

  /** Active date preset */
  readonly activePreset = signal<DatePreset>('today');

  /** Custom date range inputs */
  readonly customStartDate = signal<string>(this.formatDateInput(new Date()));
  readonly customEndDate = signal<string>(this.formatDateInput(new Date()));

  ngOnInit(): void {
    this.loadReport();
  }

  /**
   * Select a date preset and load the report
   */
  selectPreset(preset: DatePreset): void {
    this.activePreset.set(preset);
    if (preset !== 'custom') {
      this.loadReport();
    }
  }

  /**
   * Handle custom start date change
   */
  onCustomStartChange(event: Event): void {
    const input = event.target as HTMLInputElement;
    this.customStartDate.set(input.value);
  }

  /**
   * Handle custom end date change
   */
  onCustomEndChange(event: Event): void {
    const input = event.target as HTMLInputElement;
    this.customEndDate.set(input.value);
  }

  /**
   * Apply custom date range
   */
  applyCustomRange(): void {
    this.loadReport();
  }

  /**
   * Refresh the current report
   */
  refresh(): void {
    this.loadReport();
  }

  /**
   * Format a number as currency
   */
  formatCurrency(value: number): string {
    return `$${value.toFixed(2)}`;
  }

  /**
   * Load the report based on current date selection
   */
  private loadReport(): void {
    const { startDate, endDate } = this.getDateRange();
    this.useCase.execute({ startDate, endDate });
  }

  /**
   * Get the date range based on the active preset
   */
  private getDateRange(): { startDate: Date; endDate: Date } {
    const preset = this.activePreset();

    if (preset === 'today') {
      return this.getTodayRange();
    } else if (preset === 'yesterday') {
      return this.getYesterdayRange();
    } else {
      return this.getCustomRange();
    }
  }

  private getTodayRange(): { startDate: Date; endDate: Date } {
    const now = new Date();
    const startDate = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0, 0);
    const endDate = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59, 999);
    return { startDate, endDate };
  }

  private getYesterdayRange(): { startDate: Date; endDate: Date } {
    const now = new Date();
    const startDate = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1, 0, 0, 0, 0);
    const endDate = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1, 23, 59, 59, 999);
    return { startDate, endDate };
  }

  private getCustomRange(): { startDate: Date; endDate: Date } {
    const startDate = new Date(this.customStartDate() + 'T00:00:00');
    const endDate = new Date(this.customEndDate() + 'T23:59:59.999');
    return { startDate, endDate };
  }

  private formatDateInput(date: Date): string {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  }
}
