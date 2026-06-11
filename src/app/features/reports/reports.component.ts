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
  templateUrl: './reports.component.html',
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
