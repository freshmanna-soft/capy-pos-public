import { Component, ChangeDetectionStrategy, inject } from '@angular/core';

import { CalculateCartTotalsUseCase } from '@core/application/use-cases/calculate-cart-totals.use-case';

/**
 * Cart Totals Component
 *
 * Standalone presentation component that displays the cart total breakdown:
 * - Subtotal (sum of all item prices × quantities)
 * - Discount (if applied, with label)
 * - Tax (calculated on taxable amount)
 * - Total amount due
 *
 * Uses CalculateCartTotalsUseCase for all calculations.
 * Reactively updates via Angular Signals when cart state changes.
 *
 * Sprint 1 - Issue #5: Cart Total Calculation
 *
 * @example
 * ```html
 * <app-cart-totals />
 * ```
 */
@Component({
  selector: 'app-cart-totals',
  standalone: true,
  imports: [],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (!totalsUseCase.totals().isEmpty) {
      <div class="cart-totals" data-testid="cart-totals">
        <!-- Subtotal -->
        <div class="totals-row" data-testid="totals-subtotal">
          <span class="totals-label">Subtotal</span>
          <span class="totals-value">
            {{ formatCurrency(totalsUseCase.totals().subtotal) }}
          </span>
        </div>

        <!-- Discount (shown only when applied) -->
        @if (totalsUseCase.totals().discountAmount > 0) {
          <div class="totals-row discount-row" data-testid="totals-discount">
            <span class="totals-label discount-label">
              {{ totalsUseCase.totals().discountLabel || 'Discount' }}
            </span>
            <span class="totals-value discount-value">
              -{{ formatCurrency(totalsUseCase.totals().discountAmount) }}
            </span>
          </div>
        }

        <!-- Tax -->
        <div class="totals-row" data-testid="totals-tax">
          <span class="totals-label">
            Tax ({{ (totalsUseCase.totals().taxRate * 100).toFixed(1) }}%)
          </span>
          <span class="totals-value">
            {{ formatCurrency(totalsUseCase.totals().taxAmount) }}
          </span>
        </div>

        <!-- Divider -->
        <div class="totals-divider"></div>

        <!-- Total (announced to assistive tech when it changes) -->
        <div
          class="totals-row total-row"
          data-testid="totals-total"
          aria-live="polite"
          aria-atomic="true"
        >
          <span class="totals-label">Total</span>
          <span class="totals-value total-value">
            {{ formatCurrency(totalsUseCase.totals().total) }}
          </span>
        </div>

        <!-- Item count -->
        <div class="totals-row item-count-row" data-testid="totals-item-count">
          <span class="totals-label">Items in cart</span>
          <span class="totals-value">{{ totalsUseCase.totals().itemCount }}</span>
        </div>
      </div>
    }
  `,
  styles: [
    `
      .cart-totals {
        padding: 1rem 1.5rem;
        background: #f9fafb;
        border-top: 2px solid #e5e7eb;
        border-radius: 0 0 8px 8px;
      }

      .totals-row {
        display: flex;
        justify-content: space-between;
        align-items: center;
        padding: 0.5rem 0;
        font-size: 0.875rem;
      }

      .totals-label {
        color: #6b7280;
        font-weight: 500;
      }

      .totals-value {
        color: #111827;
        font-weight: 600;
      }

      .discount-row {
        background: #ecfdf5;
        margin: 0.25rem -0.5rem;
        padding: 0.5rem;
        border-radius: 4px;
      }

      .discount-label {
        color: #059669;
      }

      .discount-value {
        color: #059669;
        font-weight: 700;
      }

      .totals-divider {
        height: 1px;
        background: #d1d5db;
        margin: 0.5rem 0;
      }

      .total-row {
        padding: 0.75rem 0;
        font-size: 1.125rem;
      }

      .total-row .totals-label {
        color: #111827;
        font-weight: 700;
      }

      .total-value {
        font-size: 1.25rem;
        font-weight: 800;
        color: #667eea;
      }

      .item-count-row {
        font-size: 0.75rem;
        padding-top: 0.25rem;
      }

      .item-count-row .totals-label,
      .item-count-row .totals-value {
        color: #9ca3af;
        font-weight: 400;
      }
    `,
  ],
})
export class CartTotalsComponent {
  readonly totalsUseCase = inject(CalculateCartTotalsUseCase);

  /**
   * Formats a number as USD currency string
   */
  formatCurrency(amount: number): string {
    return '$' + amount.toFixed(2);
  }
}
