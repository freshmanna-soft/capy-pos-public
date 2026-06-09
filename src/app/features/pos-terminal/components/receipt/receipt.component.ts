import { Component, ChangeDetectionStrategy, EventEmitter, Input, Output } from '@angular/core';
import { CommonModule } from '@angular/common';
import { PaymentResult } from '@features/pos-terminal/components/checkout/checkout.component';
import { CartItem } from '@core/application/services/cart.service.interface';

export interface ReceiptData {
  payment: PaymentResult;
  items: CartItem[];
  subtotal: number;
  tax: number;
  taxRate: number;
  total: number;
}

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
    <div class="receipt-overlay" data-testid="receipt-overlay">
      <div class="receipt-panel" data-testid="receipt-panel">
        <!-- Success Header -->
        <div class="receipt-header">
          <div class="success-icon">✅</div>
          <h2 class="receipt-title">Payment Successful!</h2>
          <p class="receipt-subtitle">Transaction completed</p>
        </div>

        <!-- Receipt Content -->
        <div class="receipt-body">
          <!-- Store Info -->
          <div class="store-info">
            <span class="store-name">🦫 Capy-POS</span>
            <span class="store-date">{{ data.payment.timestamp | date: 'medium' }}</span>
          </div>

          <div class="divider"></div>

          <!-- Transaction ID -->
          <div class="transaction-id">
            <span class="id-label">Transaction</span>
            <span class="id-value" data-testid="transaction-id">{{
              data.payment.transactionId
            }}</span>
          </div>

          <div class="divider"></div>

          <!-- Items -->
          <div class="receipt-items">
            @for (item of data.items; track item.product.id) {
              <div class="receipt-item">
                <div class="item-info">
                  <span class="item-name">{{ item.product.name }}</span>
                  <span class="item-qty">x{{ item.quantity }}</span>
                </div>
                <span class="item-price">{{ item.product.price * item.quantity | currency }}</span>
              </div>
            }
          </div>

          <div class="divider"></div>

          <!-- Totals -->
          <div class="receipt-totals">
            <div class="total-row">
              <span>Subtotal</span>
              <span>{{ data.subtotal | currency }}</span>
            </div>
            <div class="total-row">
              <span>Tax ({{ (data.taxRate * 100).toFixed(1) }}%)</span>
              <span>{{ data.tax | currency }}</span>
            </div>
            <div class="total-row grand-total">
              <span>Total</span>
              <span data-testid="receipt-total">{{ data.total | currency }}</span>
            </div>
          </div>

          <div class="divider"></div>

          <!-- Payment Info -->
          <div class="payment-info">
            <div class="payment-row">
              <span>Payment Method</span>
              <span class="payment-method" data-testid="receipt-method">
                {{ getMethodLabel(data.payment.method) }}
              </span>
            </div>
            <div class="payment-row">
              <span>Amount Paid</span>
              <span>{{ data.payment.amount | currency }}</span>
            </div>
            @if (data.payment.change !== undefined && data.payment.change! > 0) {
              <div class="payment-row change">
                <span>Change</span>
                <span data-testid="receipt-change">{{ data.payment.change! | currency }}</span>
              </div>
            }
          </div>
        </div>

        <!-- Actions -->
        <div class="receipt-actions">
          <button class="btn-print" (click)="printReceipt.emit()" data-testid="btn-print">
            🖨️ Print Receipt
          </button>
          <button class="btn-new" (click)="newTransaction.emit()" data-testid="btn-new-transaction">
            ➕ New Transaction
          </button>
        </div>
      </div>
    </div>
  `,
  styles: [
    `
      .receipt-overlay {
        position: fixed;
        inset: 0;
        background: rgba(0, 0, 0, 0.5);
        display: flex;
        align-items: center;
        justify-content: center;
        z-index: 1000;
        padding: 1rem;
      }

      .receipt-panel {
        background: white;
        border-radius: 16px;
        width: 100%;
        max-width: 400px;
        max-height: 90vh;
        overflow-y: auto;
        box-shadow: 0 25px 50px rgba(0, 0, 0, 0.25);
      }

      .receipt-header {
        text-align: center;
        padding: 2rem 1.5rem 1.5rem;
        background: linear-gradient(135deg, #ecfdf5 0%, #f0fdf4 100%);
        border-radius: 16px 16px 0 0;
      }

      .success-icon {
        font-size: 3rem;
        margin-bottom: 0.75rem;
      }

      .receipt-title {
        font-size: 1.25rem;
        font-weight: 700;
        color: #065f46;
        margin: 0;
      }

      .receipt-subtitle {
        font-size: 0.875rem;
        color: #6b7280;
        margin: 0.25rem 0 0;
      }

      .receipt-body {
        padding: 1.5rem;
      }

      .store-info {
        display: flex;
        justify-content: space-between;
        align-items: center;
      }

      .store-name {
        font-weight: 600;
        font-size: 0.9375rem;
      }

      .store-date {
        font-size: 0.75rem;
        color: #6b7280;
      }

      .transaction-id {
        display: flex;
        justify-content: space-between;
        align-items: center;
      }

      .id-label {
        font-size: 0.8125rem;
        color: #6b7280;
      }

      .id-value {
        font-size: 0.75rem;
        font-family: 'JetBrains Mono', monospace;
        color: #374151;
        background: #f3f4f6;
        padding: 0.25rem 0.5rem;
        border-radius: 4px;
      }

      .divider {
        height: 1px;
        background: #e5e7eb;
        margin: 1rem 0;
      }

      .receipt-items {
        display: flex;
        flex-direction: column;
        gap: 0.5rem;
      }

      .receipt-item {
        display: flex;
        justify-content: space-between;
        align-items: center;
      }

      .item-info {
        display: flex;
        align-items: center;
        gap: 0.5rem;
      }

      .item-name {
        font-size: 0.875rem;
        color: #374151;
      }

      .item-qty {
        font-size: 0.75rem;
        color: #6b7280;
        background: #f3f4f6;
        padding: 0.125rem 0.375rem;
        border-radius: 4px;
      }

      .item-price {
        font-size: 0.875rem;
        font-weight: 500;
        color: #111827;
        font-family: 'JetBrains Mono', monospace;
      }

      .receipt-totals {
        display: flex;
        flex-direction: column;
        gap: 0.375rem;
      }

      .total-row {
        display: flex;
        justify-content: space-between;
        font-size: 0.875rem;
        color: #6b7280;
      }

      .total-row.grand-total {
        font-size: 1.125rem;
        font-weight: 700;
        color: #111827;
        padding-top: 0.5rem;
        border-top: 1px dashed #d1d5db;
        margin-top: 0.25rem;
      }

      .payment-info {
        display: flex;
        flex-direction: column;
        gap: 0.375rem;
      }

      .payment-row {
        display: flex;
        justify-content: space-between;
        font-size: 0.8125rem;
        color: #6b7280;
      }

      .payment-method {
        font-weight: 600;
        color: #2563eb;
        text-transform: capitalize;
      }

      .payment-row.change {
        color: #059669;
        font-weight: 600;
      }

      .receipt-actions {
        display: flex;
        gap: 0.75rem;
        padding: 1.5rem;
        border-top: 1px solid #e5e7eb;
      }

      .btn-print {
        flex: 1;
        padding: 0.875rem;
        border: 2px solid #e5e7eb;
        border-radius: 8px;
        background: white;
        font-size: 0.875rem;
        font-weight: 600;
        cursor: pointer;
        color: #374151;
        transition: all 0.15s;
      }

      .btn-print:hover {
        background: #f9fafb;
        border-color: #d1d5db;
      }

      .btn-new {
        flex: 1;
        padding: 0.875rem;
        border: none;
        border-radius: 8px;
        background: #2563eb;
        color: white;
        font-size: 0.875rem;
        font-weight: 600;
        cursor: pointer;
        transition: all 0.15s;
      }

      .btn-new:hover {
        background: #1d4ed8;
      }
    `,
  ],
})
export class ReceiptComponent {
  @Input() data!: ReceiptData;

  @Output() printReceipt = new EventEmitter<void>();
  @Output() newTransaction = new EventEmitter<void>();

  getMethodLabel(method: string): string {
    const labels: Record<string, string> = {
      cash: '💵 Cash',
      card: '💳 Card',
      mobile: '📱 Mobile',
    };
    return labels[method] || method;
  }
}
