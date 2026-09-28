import { Component, ChangeDetectionStrategy, input, output } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ReceiptData } from '@core/application/dtos/receipt.dto';

export type { ReceiptData } from '@core/application/dtos/receipt.dto';

/**
 * Receipt Component
 *
 * Displays a transaction receipt after successful payment.
 * Supports print and new transaction actions.
 *
 * @example
 * ```html
 * <app-receipt
 *   [data]="receiptData"
 *   (newTransaction)="startNew()"
 *   (printReceipt)="print()" />
 * ```
 */
@Component({
  selector: 'app-receipt',
  standalone: true,
  imports: [CommonModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <!--
      Receipt panel — fullscreen on mobile/kiosk, right-panel on desktop.
      Matches the checkout panel aesthetic: onsen-water background, steam text,
      yuzu accent. No modal scrim — host controls visibility.
    -->
    <div class="receipt-overlay" data-testid="receipt-overlay">
      <div class="receipt-panel" data-testid="receipt-panel">
        <!-- ── Success header ──────────────────────────────────────────── -->
        <div class="rc-header receipt-header" data-testid="payment-success">
          <div class="rc-check">
            <svg width="36" height="36" fill="none" viewBox="0 0 24 24">
              <circle cx="12" cy="12" r="12" fill="#4e8c7a" fill-opacity=".18" />
              <path
                d="M7 12.5l3.5 3.5 6.5-7"
                stroke="#4e8c7a"
                stroke-width="2.2"
                stroke-linecap="round"
                stroke-linejoin="round"
              />
            </svg>
          </div>
          <div>
            <h2 class="rc-title">Payment Successful!</h2>
            <p class="rc-subtitle">{{ data().storeName }}</p>
          </div>
          <span class="rc-total-badge" data-testid="receipt-total">
            {{ data().total | currency: data().currency }}
          </span>
        </div>

        <!-- ── Scrollable body ─────────────────────────────────────────── -->
        <div class="rc-body">
          <!-- Store meta -->
          <div class="rc-meta-row">
            <span class="rc-meta-label">Date</span>
            <span class="rc-meta-value">{{ data().payment.timestamp | date: 'medium' }}</span>
          </div>
          @if (data().storeAddress) {
            <div class="rc-meta-row">
              <span class="rc-meta-label">Address</span>
              <span class="rc-meta-value">{{ data().storeAddress }}</span>
            </div>
          }
          <div class="rc-meta-row">
            <span class="rc-meta-label">Transaction</span>
            <span class="rc-tx-id" data-testid="transaction-id">{{
              data().payment.transactionId
            }}</span>
          </div>

          <div class="rc-divider"></div>

          <!-- Line items -->
          <div class="rc-items">
            @for (item of data().items; track item.productId) {
              <div class="rc-item">
                <span class="rc-item-name">{{ item.productName }}</span>
                <span class="rc-item-qty">×{{ item.quantity }}</span>
                <span class="rc-item-price">{{ item.subtotal | currency: data().currency }}</span>
              </div>
            }
          </div>

          <div class="rc-divider"></div>

          <!-- Totals -->
          <div class="rc-totals">
            <div class="rc-total-row">
              <span>Subtotal</span>
              <span>{{ data().subtotal | currency: data().currency }}</span>
            </div>
            <div class="rc-total-row">
              <span>Tax ({{ (data().taxRate * 100).toFixed(1) }}%)</span>
              <span>{{ data().tax | currency: data().currency }}</span>
            </div>
            <div class="rc-total-row rc-total-row--grand">
              <span>Total</span>
              <span>{{ data().total | currency: data().currency }}</span>
            </div>
          </div>

          <div class="rc-divider"></div>

          <!-- Payment info -->
          <div class="rc-payment">
            <div class="rc-total-row">
              <span>Method</span>
              <span class="rc-method-badge" data-testid="receipt-method">
                {{ getMethodLabel(data().payment.method) }}
              </span>
            </div>
            <div class="rc-total-row">
              <span>Amount paid</span>
              <span>{{ data().payment.amount | currency: data().currency }}</span>
            </div>
            @if (data().payment.change !== undefined && data().payment.change! > 0) {
              <div class="rc-total-row rc-total-row--change">
                <span>Change</span>
                <span data-testid="receipt-change">{{
                  data().payment.change! | currency: data().currency
                }}</span>
              </div>
            }
          </div>
        </div>

        <!-- ── Actions ─────────────────────────────────────────────────── -->
        <div class="rc-actions">
          <button class="rc-btn-secondary" (click)="printReceipt.emit()" data-testid="btn-print">
            <svg width="16" height="16" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path
                d="M6 9V2h12v7M6 18H4a2 2 0 01-2-2v-5a2 2 0 012-2h16a2 2 0 012 2v5a2 2 0 01-2 2h-2"
                stroke-width="1.8"
                stroke-linecap="round"
                stroke-linejoin="round"
              />
              <rect x="6" y="14" width="12" height="8" rx="1" stroke-width="1.8" />
            </svg>
            Print
          </button>
          <button
            class="rc-btn-primary"
            (click)="newTransaction.emit()"
            data-testid="btn-new-transaction"
          >
            New transaction
          </button>
        </div>
      </div>
    </div>
  `,
  styles: [
    `
      /* ── Shell ────────────────────────────────────────────────────── */
      .receipt-overlay {
        position: fixed;
        inset: 0;
        background: rgba(20, 16, 14, 0.6);
        display: flex;
        align-items: stretch;
        justify-content: flex-end;
        z-index: 1000;
      }

      .receipt-panel {
        background: #1f3a38;
        color: #e8dccb;
        width: 100%;
        max-width: 440px;
        height: 100%;
        display: flex;
        flex-direction: column;
        overflow: hidden;
        animation: rcSlideIn 0.22s cubic-bezier(0.16, 1, 0.3, 1);
      }

      @keyframes rcSlideIn {
        from {
          transform: translateX(100%);
        }
        to {
          transform: translateX(0);
        }
      }

      @media (max-width: 639px) {
        .receipt-overlay {
          align-items: flex-end;
          justify-content: center;
        }
        .receipt-panel {
          max-width: 100%;
          height: 96dvh;
          border-radius: 20px 20px 0 0;
          animation: rcSlideUp 0.22s cubic-bezier(0.16, 1, 0.3, 1);
        }
        @keyframes rcSlideUp {
          from {
            transform: translateY(100%);
          }
          to {
            transform: translateY(0);
          }
        }
      }

      /* ── Success header ───────────────────────────────────────────── */
      .rc-header {
        display: flex;
        align-items: center;
        gap: 0.875rem;
        padding: 1.25rem;
        background: rgba(20, 16, 14, 0.35);
        border-bottom: 1px solid rgba(232, 220, 203, 0.08);
        flex-shrink: 0;
      }

      .rc-check {
        flex-shrink: 0;
        line-height: 0;
      }

      .rc-title {
        font-size: 1rem;
        font-weight: 700;
        color: #e8dccb;
        margin: 0;
        line-height: 1.2;
      }

      .rc-subtitle {
        font-size: 0.75rem;
        color: rgba(232, 220, 203, 0.5);
        margin: 0.125rem 0 0;
      }

      .rc-total-badge {
        margin-left: auto;
        font-size: 1.375rem;
        font-weight: 800;
        color: #f0b429;
        font-variant-numeric: tabular-nums;
        letter-spacing: -0.02em;
        flex-shrink: 0;
      }

      /* ── Scrollable body ──────────────────────────────────────────── */
      .rc-body {
        flex: 1;
        overflow-y: auto;
        padding: 1.25rem;
        display: flex;
        flex-direction: column;
        gap: 0.25rem;
      }

      /* ── Meta rows ────────────────────────────────────────────────── */
      .rc-meta-row {
        display: flex;
        justify-content: space-between;
        align-items: baseline;
        padding: 0.3rem 0;
        gap: 1rem;
      }
      .rc-meta-label {
        font-size: 0.75rem;
        color: rgba(232, 220, 203, 0.45);
        flex-shrink: 0;
      }
      .rc-meta-value {
        font-size: 0.8125rem;
        color: rgba(232, 220, 203, 0.75);
        text-align: right;
      }
      .rc-tx-id {
        font-size: 0.7rem;
        font-family: ui-monospace, monospace;
        color: rgba(232, 220, 203, 0.5);
        text-align: right;
        word-break: break-all;
      }

      .rc-divider {
        height: 1px;
        background: rgba(232, 220, 203, 0.08);
        margin: 0.625rem 0;
      }

      /* ── Line items ───────────────────────────────────────────────── */
      .rc-items {
        display: flex;
        flex-direction: column;
        gap: 0.5rem;
      }

      .rc-item {
        display: flex;
        align-items: center;
        gap: 0.5rem;
      }
      .rc-item-name {
        flex: 1;
        font-size: 0.875rem;
        color: #e8dccb;
      }
      .rc-item-qty {
        font-size: 0.75rem;
        color: rgba(232, 220, 203, 0.4);
        background: rgba(232, 220, 203, 0.07);
        padding: 0.1rem 0.375rem;
        border-radius: 4px;
        font-variant-numeric: tabular-nums;
      }
      .rc-item-price {
        font-size: 0.875rem;
        font-weight: 600;
        color: #e8dccb;
        font-variant-numeric: tabular-nums;
        font-family: ui-monospace, monospace;
        min-width: 4.5rem;
        text-align: right;
      }

      /* ── Totals & payment rows ────────────────────────────────────── */
      .rc-totals,
      .rc-payment {
        display: flex;
        flex-direction: column;
        gap: 0.375rem;
      }

      .rc-total-row {
        display: flex;
        justify-content: space-between;
        align-items: center;
        font-size: 0.8125rem;
        color: rgba(232, 220, 203, 0.6);
        padding: 0.15rem 0;
      }
      .rc-total-row--grand {
        font-size: 0.9375rem;
        font-weight: 700;
        color: #e8dccb;
        padding-top: 0.5rem;
        margin-top: 0.25rem;
        border-top: 1px solid rgba(232, 220, 203, 0.12);
      }
      .rc-total-row--grand span:last-child {
        color: #f0b429;
        font-variant-numeric: tabular-nums;
      }
      .rc-total-row--change span:last-child {
        color: #4e8c7a;
        font-weight: 600;
      }

      .rc-method-badge {
        font-size: 0.75rem;
        font-weight: 600;
        background: rgba(78, 140, 122, 0.18);
        color: #4e8c7a;
        padding: 0.2rem 0.5rem;
        border-radius: 5px;
        letter-spacing: 0.02em;
      }

      /* ── Actions ──────────────────────────────────────────────────── */
      .rc-actions {
        display: flex;
        gap: 0.75rem;
        padding: 1rem 1.25rem;
        border-top: 1px solid rgba(232, 220, 203, 0.08);
        flex-shrink: 0;
      }

      .rc-btn-secondary {
        display: flex;
        align-items: center;
        gap: 0.5rem;
        flex: 1;
        padding: 0.875rem;
        border-radius: 12px;
        border: 1.5px solid rgba(232, 220, 203, 0.18);
        background: transparent;
        color: rgba(232, 220, 203, 0.7);
        font-size: 0.875rem;
        font-weight: 600;
        cursor: pointer;
        justify-content: center;
        transition: all 0.15s;
      }
      .rc-btn-secondary:hover {
        background: rgba(232, 220, 203, 0.07);
        color: #e8dccb;
      }

      .rc-btn-primary {
        flex: 2;
        padding: 0.875rem;
        border-radius: 12px;
        border: none;
        background: #f0b429;
        color: #14100e;
        font-size: 0.9375rem;
        font-weight: 700;
        cursor: pointer;
        transition: all 0.15s;
        letter-spacing: -0.01em;
      }
      .rc-btn-primary:hover {
        background: #f5c24a;
        transform: translateY(-1px);
        box-shadow: 0 4px 12px rgba(240, 180, 41, 0.3);
      }
      .rc-btn-primary:active {
        transform: translateY(0);
        box-shadow: none;
      }
    `,
  ],
})
export class ReceiptComponent {
  readonly data = input.required<ReceiptData>();

  readonly printReceipt = output<void>();
  readonly newTransaction = output<void>();

  getMethodLabel(method: string): string {
    const labels: Record<string, string> = {
      cash: '💵 Cash',
      card: '💳 Card',
      mobile: '📱 Mobile',
      paypal: 'PayPal',
      mercadopago: 'MercadoPago',
    };
    return labels[method] ?? method;
  }
}
