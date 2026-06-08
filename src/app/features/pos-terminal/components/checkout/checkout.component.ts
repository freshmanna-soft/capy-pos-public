import { Component, ChangeDetectionStrategy, inject, signal, computed, output } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { CartService } from '../../../../core/application/services/cart.service';
import { ProcessCashPaymentUseCase } from '../../../../core/application/use-cases/process-cash-payment.use-case';

export type PaymentMethod = 'cash' | 'card' | 'mobile';

export interface PaymentResult {
  method: PaymentMethod;
  amount: number;
  change?: number;
  transactionId: string;
  timestamp: Date;
}

/**
 * Checkout Component
 * 
 * Handles the payment flow for completing a sale.
 * Supports cash, card, and mobile payment methods.
 * 
 * Flow: Select Method → Enter Details → Confirm → Receipt
 * 
 * @example
 * ```html
 * <app-checkout 
 *   (paymentComplete)="onPaymentComplete($event)"
 *   (checkoutCancelled)="onCancel()" />
 * ```
 */
@Component({
  selector: 'app-checkout',
  standalone: true,
  imports: [CommonModule, FormsModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="checkout-overlay" data-testid="checkout-overlay" (click)="cancel()">
      <div class="checkout-panel" (click)="$event.stopPropagation()" data-testid="checkout-panel">
        <!-- Header -->
        <div class="checkout-header">
          <h2 class="checkout-title">Complete Payment</h2>
          <button class="close-btn" (click)="cancel()" aria-label="Close checkout">
            <svg fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12"/>
            </svg>
          </button>
        </div>

        <!-- Order Summary -->
        <div class="order-summary">
          <div class="summary-row">
            <span>Subtotal</span>
            <span>{{ cartService.subtotal() | currency }}</span>
          </div>
          <div class="summary-row">
            <span>Tax ({{ (cartService.taxRate() * 100).toFixed(1) }}%)</span>
            <span>{{ cartService.tax() | currency }}</span>
          </div>
          <div class="summary-row total">
            <span>Total</span>
            <span data-testid="checkout-total">{{ cartService.total() | currency }}</span>
          </div>
        </div>

        <!-- Step 1: Payment Method Selection -->
        @if (step() === 'select') {
          <div class="payment-methods" data-testid="payment-methods">
            <h3 class="section-title">Select Payment Method</h3>
            <div class="method-grid">
              <button 
                class="method-card"
                [class.selected]="selectedMethod() === 'cash'"
                (click)="selectMethod('cash')"
                data-testid="method-cash">
                <span class="method-icon">💵</span>
                <span class="method-label">Cash</span>
              </button>
              <button 
                class="method-card"
                [class.selected]="selectedMethod() === 'card'"
                (click)="selectMethod('card')"
                data-testid="method-card">
                <span class="method-icon">💳</span>
                <span class="method-label">Card</span>
              </button>
              <button 
                class="method-card"
                [class.selected]="selectedMethod() === 'mobile'"
                (click)="selectMethod('mobile')"
                data-testid="method-mobile">
                <span class="method-icon">📱</span>
                <span class="method-label">Mobile</span>
              </button>
            </div>
            <button 
              class="btn-proceed"
              [disabled]="!selectedMethod()"
              (click)="proceedToDetails()"
              data-testid="btn-proceed">
              Continue
            </button>
          </div>
        }

        <!-- Step 2: Cash Payment -->
        @if (step() === 'cash') {
          <div class="cash-payment" data-testid="cash-payment">
            <h3 class="section-title">Cash Payment</h3>
            <div class="amount-display">
              <label class="amount-label">Amount Due</label>
              <span class="amount-value">{{ cashPayment.amountDue() | currency }}</span>
            </div>
            <div class="input-group">
              <label for="cash-tendered" class="input-label">Amount Tendered</label>
              <input 
                id="cash-tendered"
                type="number"
                class="amount-input"
                [class.input-error]="cashPayment.validation().error"
                [min]="cashPayment.amountDue()"
                step="0.01"
                [(ngModel)]="cashTendered"
                (ngModelChange)="onCashAmountChange($event)"
                data-testid="cash-tendered"
                placeholder="0.00"
                autofocus />
            </div>
            @if (cashPayment.validation().error) {
              <div class="error-display" data-testid="cash-error">
                <span class="error-icon">⚠️</span>
                <span class="error-text">{{ cashPayment.validation().error }}</span>
              </div>
            }
            @if (cashPayment.validation().isValid && cashTendered > 0) {
              <div class="change-display" data-testid="change-amount">
                <span class="change-label">Change Due</span>
                <span class="change-value">{{ cashPayment.changeAmount() | currency }}</span>
              </div>
            }
            <div class="quick-amounts">
              @for (amount of cashPayment.quickAmounts(); track amount) {
                <button 
                  class="quick-btn"
                  (click)="setCashAmount(amount)"
                  [attr.data-testid]="'quick-' + amount">
                  @if (amount === cashPayment.amountDue()) {
                    Exact
                  } @else {
                    {{ amount | currency }}
                  }
                </button>
              }
            </div>
            <div class="action-buttons">
              <button class="btn-back" (click)="goBack()">Back</button>
              <button 
                class="btn-confirm"
                [disabled]="!cashPayment.validation().isValid"
                (click)="confirmPayment()"
                data-testid="btn-confirm-cash">
                Confirm Payment
              </button>
            </div>
          </div>
        }

        <!-- Step 2: Card Payment -->
        @if (step() === 'card') {
          <div class="card-payment" data-testid="card-payment">
            <h3 class="section-title">Card Payment</h3>
            <div class="amount-display">
              <label class="amount-label">Charging</label>
              <span class="amount-value">{{ cartService.total() | currency }}</span>
            </div>
            <div class="card-form">
              <div class="input-group">
                <label for="card-number" class="input-label">Card Number</label>
                <input 
                  id="card-number"
                  type="text"
                  class="card-input"
                  [(ngModel)]="cardNumber"
                  placeholder="•••• •••• •••• ••••"
                  maxlength="19"
                  data-testid="card-number"
                  autofocus />
              </div>
              <div class="card-row">
                <div class="input-group">
                  <label for="card-expiry" class="input-label">Expiry</label>
                  <input 
                    id="card-expiry"
                    type="text"
                    class="card-input"
                    [(ngModel)]="cardExpiry"
                    placeholder="MM/YY"
                    maxlength="5"
                    data-testid="card-expiry" />
                </div>
                <div class="input-group">
                  <label for="card-cvv" class="input-label">CVV</label>
                  <input 
                    id="card-cvv"
                    type="password"
                    class="card-input"
                    [(ngModel)]="cardCvv"
                    placeholder="•••"
                    maxlength="4"
                    data-testid="card-cvv" />
                </div>
              </div>
            </div>
            <div class="action-buttons">
              <button class="btn-back" (click)="goBack()">Back</button>
              <button 
                class="btn-confirm"
                [disabled]="!canConfirmCard()"
                (click)="confirmPayment()"
                data-testid="btn-confirm-card">
                Pay {{ cartService.total() | currency }}
              </button>
            </div>
          </div>
        }

        <!-- Step 2: Mobile Payment -->
        @if (step() === 'mobile') {
          <div class="mobile-payment" data-testid="mobile-payment">
            <h3 class="section-title">Mobile Payment</h3>
            <div class="amount-display">
              <label class="amount-label">Amount</label>
              <span class="amount-value">{{ cartService.total() | currency }}</span>
            </div>
            <div class="qr-placeholder">
              <div class="qr-code" data-testid="qr-code">
                <span class="qr-icon">📲</span>
                <p class="qr-text">Scan QR code or tap to pay</p>
              </div>
            </div>
            <div class="action-buttons">
              <button class="btn-back" (click)="goBack()">Back</button>
              <button 
                class="btn-confirm"
                (click)="confirmPayment()"
                data-testid="btn-confirm-mobile">
                Confirm Received
              </button>
            </div>
          </div>
        }

        <!-- Processing State -->
        @if (step() === 'processing') {
          <div class="processing" data-testid="processing">
            <div class="spinner"></div>
            <p class="processing-text">Processing payment...</p>
          </div>
        }
      </div>
    </div>
  `,
  styles: [`
    .checkout-overlay {
      position: fixed;
      inset: 0;
      background: rgba(0, 0, 0, 0.5);
      display: flex;
      align-items: center;
      justify-content: center;
      z-index: 1000;
      padding: 1rem;
    }

    .checkout-panel {
      background: white;
      border-radius: 16px;
      width: 100%;
      max-width: 480px;
      max-height: 90vh;
      overflow-y: auto;
      box-shadow: 0 25px 50px rgba(0, 0, 0, 0.25);
    }

    .checkout-header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      padding: 1.5rem;
      border-bottom: 1px solid #e5e7eb;
    }

    .checkout-title {
      font-size: 1.25rem;
      font-weight: 700;
      margin: 0;
      color: #111827;
    }

    .close-btn {
      background: none;
      border: none;
      color: #6b7280;
      cursor: pointer;
      padding: 0.5rem;
      border-radius: 8px;
    }

    .close-btn:hover {
      background: #f3f4f6;
      color: #111827;
    }

    .close-btn svg {
      width: 1.25rem;
      height: 1.25rem;
    }

    .order-summary {
      padding: 1.25rem 1.5rem;
      background: #f9fafb;
      border-bottom: 1px solid #e5e7eb;
    }

    .summary-row {
      display: flex;
      justify-content: space-between;
      padding: 0.375rem 0;
      font-size: 0.875rem;
      color: #6b7280;
    }

    .summary-row.total {
      font-size: 1.125rem;
      font-weight: 700;
      color: #111827;
      padding-top: 0.75rem;
      border-top: 1px solid #e5e7eb;
      margin-top: 0.5rem;
    }

    .section-title {
      font-size: 1rem;
      font-weight: 600;
      margin: 0 0 1rem;
      color: #374151;
    }

    .payment-methods, .cash-payment, .card-payment, .mobile-payment {
      padding: 1.5rem;
    }

    .method-grid {
      display: grid;
      grid-template-columns: repeat(3, 1fr);
      gap: 0.75rem;
      margin-bottom: 1.5rem;
    }

    .method-card {
      display: flex;
      flex-direction: column;
      align-items: center;
      gap: 0.5rem;
      padding: 1.25rem 0.75rem;
      border: 2px solid #e5e7eb;
      border-radius: 12px;
      background: white;
      cursor: pointer;
      transition: all 0.15s;
    }

    .method-card:hover {
      border-color: #2563eb;
      background: #eff6ff;
    }

    .method-card.selected {
      border-color: #2563eb;
      background: #eff6ff;
      box-shadow: 0 0 0 3px rgba(37, 99, 235, 0.1);
    }

    .method-icon {
      font-size: 2rem;
    }

    .method-label {
      font-size: 0.875rem;
      font-weight: 600;
      color: #374151;
    }

    .amount-display {
      display: flex;
      justify-content: space-between;
      align-items: center;
      padding: 1rem;
      background: #f0fdf4;
      border-radius: 8px;
      margin-bottom: 1.25rem;
    }

    .amount-label {
      font-size: 0.875rem;
      color: #6b7280;
    }

    .amount-value {
      font-size: 1.5rem;
      font-weight: 700;
      color: #16a34a;
    }

    .input-group {
      margin-bottom: 1rem;
    }

    .input-label {
      display: block;
      font-size: 0.8125rem;
      font-weight: 500;
      color: #374151;
      margin-bottom: 0.375rem;
    }

    .amount-input, .card-input {
      width: 100%;
      padding: 0.75rem 1rem;
      border: 2px solid #e5e7eb;
      border-radius: 8px;
      font-size: 1.125rem;
      outline: none;
      transition: border-color 0.15s;
      box-sizing: border-box;
    }

    .amount-input:focus, .card-input:focus {
      border-color: #2563eb;
      box-shadow: 0 0 0 3px rgba(37, 99, 235, 0.1);
    }

    .change-display {
      display: flex;
      justify-content: space-between;
      align-items: center;
      padding: 0.75rem 1rem;
      background: #ecfdf5;
      border: 1px solid #a7f3d0;
      border-radius: 8px;
      margin-bottom: 1rem;
    }

    .change-label {
      font-size: 0.875rem;
      color: #065f46;
    }

    .change-value {
      font-size: 1.25rem;
      font-weight: 700;
      color: #059669;
    }

    .quick-amounts {
      display: grid;
      grid-template-columns: repeat(4, 1fr);
      gap: 0.5rem;
      margin-bottom: 1.5rem;
    }

    .quick-btn {
      padding: 0.625rem;
      border: 1px solid #d1d5db;
      border-radius: 6px;
      background: white;
      font-size: 0.8125rem;
      font-weight: 500;
      cursor: pointer;
      transition: all 0.15s;
    }

    .quick-btn:hover {
      background: #eff6ff;
      border-color: #2563eb;
    }

    .card-row {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 1rem;
    }

    .qr-placeholder {
      display: flex;
      justify-content: center;
      margin-bottom: 1.5rem;
    }

    .qr-code {
      display: flex;
      flex-direction: column;
      align-items: center;
      gap: 0.75rem;
      padding: 2rem;
      border: 2px dashed #d1d5db;
      border-radius: 12px;
      width: 200px;
    }

    .qr-icon {
      font-size: 3rem;
    }

    .qr-text {
      font-size: 0.8125rem;
      color: #6b7280;
      text-align: center;
      margin: 0;
    }

    .action-buttons {
      display: flex;
      gap: 0.75rem;
      margin-top: 1rem;
    }

    .btn-back {
      flex: 1;
      padding: 0.875rem;
      border: 2px solid #e5e7eb;
      border-radius: 8px;
      background: white;
      font-size: 0.875rem;
      font-weight: 600;
      cursor: pointer;
      color: #374151;
    }

    .btn-back:hover {
      background: #f9fafb;
    }

    .btn-proceed, .btn-confirm {
      flex: 2;
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

    .btn-proceed {
      width: 100%;
    }

    .btn-proceed:hover:not(:disabled), .btn-confirm:hover:not(:disabled) {
      background: #1d4ed8;
    }

    .btn-proceed:disabled, .btn-confirm:disabled {
      opacity: 0.5;
      cursor: not-allowed;
    }

    .processing {
      display: flex;
      flex-direction: column;
      align-items: center;
      gap: 1rem;
      padding: 3rem 1.5rem;
    }

    .spinner {
      width: 48px;
      height: 48px;
      border: 4px solid #e5e7eb;
      border-top-color: #2563eb;
      border-radius: 50%;
      animation: spin 0.8s linear infinite;
    }

    @keyframes spin {
      to { transform: rotate(360deg); }
    }

    .processing-text {
      font-size: 1rem;
      color: #6b7280;
      margin: 0;
    }

    .input-error {
      border-color: #ef4444;
    }

    .input-error:focus {
      border-color: #ef4444;
      box-shadow: 0 0 0 3px rgba(239, 68, 68, 0.1);
    }

    .error-display {
      display: flex;
      align-items: center;
      gap: 0.5rem;
      padding: 0.625rem 0.875rem;
      background: #fef2f2;
      border: 1px solid #fecaca;
      border-radius: 8px;
      margin-bottom: 1rem;
    }

    .error-icon {
      font-size: 1rem;
      flex-shrink: 0;
    }

    .error-text {
      font-size: 0.8125rem;
      color: #dc2626;
      font-weight: 500;
    }
  `]
})
export class CheckoutComponent {
  readonly cartService = inject(CartService);
  readonly cashPayment = inject(ProcessCashPaymentUseCase);

  // Outputs
  readonly paymentComplete = output<PaymentResult>();
  readonly checkoutCancelled = output<void>();

  // State
  readonly step = signal<'select' | 'cash' | 'card' | 'mobile' | 'processing'>('select');
  readonly selectedMethod = signal<PaymentMethod | null>(null);
  readonly changeAmount = signal<number>(0);

  // Form fields
  cashTendered = 0;
  cardNumber = '';
  cardExpiry = '';
  cardCvv = '';

  // Quick cash amounts (kept for backward compatibility)
  readonly quickAmounts = computed(() => {
    const total = this.cartService.total();
    const rounded = Math.ceil(total);
    return [rounded, rounded + 5, rounded + 10, rounded + 20].filter(a => a >= total);
  });

  selectMethod(method: PaymentMethod): void {
    this.selectedMethod.set(method);
  }

  proceedToDetails(): void {
    const method = this.selectedMethod();
    if (method) {
      if (method === 'cash') {
        this.cashPayment.reset();
      }
      this.step.set(method);
    }
  }

  goBack(): void {
    this.step.set('select');
    this.cashPayment.reset();
    this.cashTendered = 0;
  }

  cancel(): void {
    this.cashPayment.reset();
    this.checkoutCancelled.emit();
  }

  /** Handles cash amount input changes - syncs with use case */
  onCashAmountChange(amount: number): void {
    this.cashPayment.setAmountTendered(amount || 0);
    this.calculateChange();
  }

  setCashAmount(amount: number): void {
    this.cashTendered = amount;
    this.cashPayment.setAmountTendered(amount);
    this.calculateChange();
  }

  calculateChange(): void {
    const change = this.cashTendered - this.cartService.total();
    this.changeAmount.set(Math.max(0, change));
  }

  canConfirmCash(): boolean {
    return this.cashPayment.validation().isValid;
  }

  canConfirmCard(): boolean {
    return this.cardNumber.length >= 15 && 
           this.cardExpiry.length === 5 && 
           this.cardCvv.length >= 3;
  }

  confirmPayment(): void {
    if (this.selectedMethod() === 'cash') {
      const cashResult = this.cashPayment.execute();
      if (!cashResult.success) {
        return; // Don't proceed if validation fails
      }
    }

    this.step.set('processing');

    // Simulate payment processing
    setTimeout(() => {
      const result: PaymentResult = {
        method: this.selectedMethod()!,
        amount: this.cartService.total(),
        change: this.selectedMethod() === 'cash' ? this.cashPayment.changeAmount() : undefined,
        transactionId: this.selectedMethod() === 'cash'
          ? this.cashPayment.execute().transactionId
          : this.generateTransactionId(),
        timestamp: new Date(),
      };

      this.cashPayment.completeProcessing();
      this.paymentComplete.emit(result);
    }, 1500);
  }

  private generateTransactionId(): string {
    const timestamp = Date.now().toString(36);
    const random = Math.random().toString(36).substring(2, 8);
    return `TXN-${timestamp}-${random}`.toUpperCase();
  }
}
