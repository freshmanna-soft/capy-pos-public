import {
  Component,
  ChangeDetectionStrategy,
  inject,
  signal,
  computed,
  output,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { CartService } from '@core/application/services/cart.service';
import { ProcessCashPaymentUseCase } from '@core/application/use-cases/process-cash-payment.use-case';
import { ProcessCardPaymentUseCase } from '@core/application/use-cases/process-card-payment.use-case';
import { PersistTransactionUseCase } from '@core/application/use-cases/persist-transaction.use-case';
import { CircuitBreakerService } from '@core/infrastructure/resilience/circuit-breaker.service';
import { RetryService } from '@core/infrastructure/resilience/retry.service';

export type PaymentMethod = 'cash' | 'card' | 'mobile';

export interface PaymentResult {
  method: PaymentMethod;
  amount: number;
  change?: number;
  transactionId: string;
  timestamp: Date;
}

/**
 * Name of the circuit breaker that fronts the (simulated) card payment gateway.
 * Shared with the agent-monitor dashboard, which surfaces its state.
 */
const PAYMENT_GATEWAY = 'payment-gateway';

/**
 * Test card number that the simulated gateway always declines. Mirrors the
 * well-known Stripe "card declined" test PAN so the failure/retry path is
 * deterministically reproducible in demos and e2e tests.
 */
const DECLINED_TEST_CARD = '4000000000000002';

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
    <div
      class="checkout-overlay"
      data-testid="checkout-overlay"
      (click)="cancel()"
      (keydown.escape)="cancel()"
      role="dialog"
      aria-modal="true"
      tabindex="-1"
    >
      <div
        class="checkout-panel"
        (click)="$event.stopPropagation()"
        (keydown.escape)="$event.stopPropagation()"
        role="document"
        data-testid="checkout-panel"
      >
        <!-- Header -->
        <div class="checkout-header">
          <h2 class="checkout-title">Complete Payment</h2>
          <button class="close-btn" (click)="cancel()" aria-label="Close checkout">
            <svg fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path
                stroke-linecap="round"
                stroke-linejoin="round"
                stroke-width="2"
                d="M6 18L18 6M6 6l12 12"
              />
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
                data-testid="method-cash"
              >
                <span class="method-icon">💵</span>
                <span class="method-label">Cash</span>
              </button>
              <button
                class="method-card"
                [class.selected]="selectedMethod() === 'card'"
                (click)="selectMethod('card')"
                data-testid="method-card"
              >
                <span class="method-icon">💳</span>
                <span class="method-label">Card</span>
              </button>
              <button
                class="method-card"
                [class.selected]="selectedMethod() === 'mobile'"
                (click)="selectMethod('mobile')"
                data-testid="method-mobile"
              >
                <span class="method-icon">📱</span>
                <span class="method-label">Mobile</span>
              </button>
            </div>
            <button
              class="btn-proceed"
              [disabled]="!selectedMethod()"
              (click)="proceedToDetails()"
              data-testid="btn-proceed"
            >
              Continue
            </button>
          </div>
        }

        <!-- Step 2: Cash Payment -->
        @if (step() === 'cash') {
          <div class="cash-payment" data-testid="cash-payment">
            <h3 class="section-title">Cash Payment</h3>
            <div class="amount-display">
              <span class="amount-label">Amount Due</span>
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
              />
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
                  [attr.data-testid]="'quick-' + amount"
                >
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
                data-testid="btn-confirm-cash"
              >
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
              <span class="amount-label">Charging</span>
              <span class="amount-value">{{ cardPayment.amountToCharge() | currency }}</span>
            </div>
            @if (cardPayment.cardBrand() !== 'unknown') {
              <div class="card-brand-display" data-testid="card-brand">
                <span class="brand-badge">{{ cardPayment.cardBrand() | uppercase }}</span>
                @if (cardPayment.last4()) {
                  <span class="last4-display">•••• {{ cardPayment.last4() }}</span>
                }
              </div>
            }
            <div class="card-form">
              <div class="input-group">
                <label for="card-number" class="input-label">Card Number</label>
                <input
                  id="card-number"
                  type="text"
                  class="card-input"
                  [class.input-error]="cardPayment.fieldValidation().cardNumber.error"
                  [(ngModel)]="cardNumber"
                  (ngModelChange)="onCardNumberChange($event)"
                  placeholder="•••• •••• •••• ••••"
                  maxlength="19"
                  data-testid="card-number"
                />
                @if (cardPayment.fieldValidation().cardNumber.error) {
                  <span class="field-error" data-testid="card-number-error">
                    {{ cardPayment.fieldValidation().cardNumber.error }}
                  </span>
                }
              </div>
              <div class="card-row">
                <div class="input-group">
                  <label for="card-expiry" class="input-label">Expiry</label>
                  <input
                    id="card-expiry"
                    type="text"
                    class="card-input"
                    [class.input-error]="cardPayment.fieldValidation().expiry.error"
                    [(ngModel)]="cardExpiry"
                    (ngModelChange)="onCardExpiryChange($event)"
                    placeholder="MM/YY"
                    maxlength="5"
                    data-testid="card-expiry"
                  />
                  @if (cardPayment.fieldValidation().expiry.error) {
                    <span class="field-error" data-testid="card-expiry-error">
                      {{ cardPayment.fieldValidation().expiry.error }}
                    </span>
                  }
                </div>
                <div class="input-group">
                  <label for="card-cvv" class="input-label">CVV</label>
                  <input
                    id="card-cvv"
                    type="password"
                    class="card-input"
                    [class.input-error]="cardPayment.fieldValidation().cvv.error"
                    [(ngModel)]="cardCvv"
                    (ngModelChange)="onCardCvvChange($event)"
                    placeholder="•••"
                    maxlength="4"
                    data-testid="card-cvv"
                  />
                  @if (cardPayment.fieldValidation().cvv.error) {
                    <span class="field-error" data-testid="card-cvv-error">
                      {{ cardPayment.fieldValidation().cvv.error }}
                    </span>
                  }
                </div>
              </div>
            </div>
            <div class="action-buttons">
              <button class="btn-back" (click)="goBack()">Back</button>
              <button
                class="btn-confirm"
                [disabled]="!canConfirmCard()"
                (click)="confirmPayment()"
                data-testid="btn-confirm-card"
              >
                Pay {{ cardPayment.amountToCharge() | currency }}
              </button>
            </div>
          </div>
        }

        <!-- Step 2: Mobile Payment -->
        @if (step() === 'mobile') {
          <div class="mobile-payment" data-testid="mobile-payment">
            <h3 class="section-title">Mobile Payment</h3>
            <div class="amount-display">
              <span class="amount-label">Amount</span>
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
                data-testid="btn-confirm-mobile"
              >
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

        <!-- Retrying State (transient gateway failure) -->
        @if (step() === 'retrying') {
          <div class="processing" data-testid="payment-retrying">
            <div class="spinner"></div>
            <p class="processing-text">Payment failed — retrying…</p>
          </div>
        }

        <!-- Error State (gateway declined / circuit open) -->
        @if (step() === 'error') {
          <div class="payment-error" data-testid="payment-error">
            <div class="error-icon">⚠️</div>
            <p class="error-text">{{ errorMessage() }}</p>
            <div class="action-buttons">
              <button class="btn-back" (click)="cancel()" data-testid="btn-cancel-payment">
                Cancel
              </button>
              <button class="btn-confirm" (click)="retryPayment()" data-testid="btn-retry-payment">
                Try Again
              </button>
            </div>
          </div>
        }
      </div>
    </div>
  `,
  styles: [
    `
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

      .payment-methods,
      .cash-payment,
      .card-payment,
      .mobile-payment {
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

      .amount-input,
      .card-input {
        width: 100%;
        padding: 0.75rem 1rem;
        border: 2px solid #e5e7eb;
        border-radius: 8px;
        font-size: 1.125rem;
        outline: none;
        transition: border-color 0.15s;
        box-sizing: border-box;
      }

      .amount-input:focus,
      .card-input:focus {
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

      .btn-proceed,
      .btn-confirm {
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

      .btn-proceed:hover:not(:disabled),
      .btn-confirm:hover:not(:disabled) {
        background: #1d4ed8;
      }

      .btn-proceed:disabled,
      .btn-confirm:disabled {
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
        to {
          transform: rotate(360deg);
        }
      }

      .processing-text {
        font-size: 1rem;
        color: #6b7280;
        margin: 0;
      }

      .payment-error {
        display: flex;
        flex-direction: column;
        align-items: center;
        gap: 1rem;
        padding: 2.5rem 1.5rem 1.5rem;
        text-align: center;
      }

      .payment-error .error-icon {
        font-size: 2.5rem;
        line-height: 1;
      }

      .payment-error .error-text {
        font-size: 1rem;
        color: #b91c1c;
        font-weight: 600;
        margin: 0;
      }

      .payment-error .action-buttons {
        width: 100%;
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

      .field-error {
        display: block;
        font-size: 0.75rem;
        color: #dc2626;
        margin-top: 0.25rem;
        font-weight: 500;
      }

      .card-brand-display {
        display: flex;
        align-items: center;
        gap: 0.75rem;
        padding: 0.625rem 1rem;
        background: #eff6ff;
        border: 1px solid #bfdbfe;
        border-radius: 8px;
        margin-bottom: 1.25rem;
      }

      .brand-badge {
        font-size: 0.75rem;
        font-weight: 700;
        color: #1d4ed8;
        background: #dbeafe;
        padding: 0.25rem 0.5rem;
        border-radius: 4px;
        letter-spacing: 0.05em;
      }

      .last4-display {
        font-size: 0.875rem;
        color: #374151;
        font-family: monospace;
      }
    `,
  ],
})
export class CheckoutComponent {
  readonly cartService = inject(CartService);
  readonly cashPayment = inject(ProcessCashPaymentUseCase);
  readonly cardPayment = inject(ProcessCardPaymentUseCase);
  private readonly persistTransaction = inject(PersistTransactionUseCase);
  private readonly circuitBreaker = inject(CircuitBreakerService);
  private readonly retry = inject(RetryService);

  // Outputs
  readonly paymentComplete = output<PaymentResult>();
  readonly checkoutCancelled = output<void>();

  // State
  readonly step = signal<
    'select' | 'cash' | 'card' | 'mobile' | 'processing' | 'retrying' | 'error'
  >('select');
  readonly selectedMethod = signal<PaymentMethod | null>(null);
  readonly changeAmount = signal<number>(0);

  /** User-facing message shown in the 'error' step after a failed payment. */
  readonly errorMessage = signal<string>('');

  // Form fields
  cashTendered = 0;
  cardNumber = '';
  cardExpiry = '';
  cardCvv = '';

  /** True while a confirmed payment is being processed; blocks re-submission. */
  private isSubmitting = false;

  // Quick cash amounts (kept for backward compatibility)
  readonly quickAmounts = computed(() => {
    const total = this.cartService.total();
    const rounded = Math.ceil(total);
    return [rounded, rounded + 5, rounded + 10, rounded + 20].filter((a) => a >= total);
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

  /** Syncs card number input with use case */
  onCardNumberChange(value: string): void {
    this.cardPayment.setCardNumber(value);
  }

  /** Syncs card expiry input with use case */
  onCardExpiryChange(value: string): void {
    this.cardPayment.setExpiry(value);
  }

  /** Syncs card CVV input with use case */
  onCardCvvChange(value: string): void {
    this.cardPayment.setCvv(value);
  }

  canConfirmCard(): boolean {
    return this.cardPayment.validation().isValid;
  }

  confirmPayment(): void {
    // Re-entry guard: ignore repeat taps while a payment is already in flight.
    // Prevents double submission (and double charge) during the processing window.
    if (this.isSubmitting) {
      return;
    }

    const method = this.selectedMethod();
    if (!method) {
      return;
    }

    // Run the payment use-case exactly ONCE and reuse its result. Previously
    // execute() was called a second time inside the timeout, which minted a new
    // transactionId and ran the payment twice per confirmation.
    let transactionId: string;
    if (method === 'cash') {
      const cashResult = this.cashPayment.execute();
      if (!cashResult.success) {
        return;
      }
      transactionId = cashResult.transactionId;
    } else if (method === 'card') {
      const cardResult = this.cardPayment.execute();
      if (!cardResult.success) {
        return;
      }
      transactionId = cardResult.transactionId;
    } else {
      transactionId = this.generateTransactionId();
    }

    this.isSubmitting = true;
    this.step.set('processing');

    // Card payments are routed through the payment-gateway circuit breaker +
    // retry so transient gateway errors are retried and repeated hard declines
    // trip the breaker (surfaced on the agent-monitor dashboard). Cash and
    // mobile are local/offline and keep their original direct-confirm path.
    if (method === 'card') {
      void this.processCardPayment(transactionId);
      return;
    }

    // Simulate payment processing (cash / mobile)
    setTimeout(() => this.finalizePayment(method, transactionId), 1500);
  }

  /**
   * Drive a card payment through the resilience layer: the call is retried on
   * transient failure and, after enough failures, the shared 'payment-gateway'
   * circuit breaker opens and rejects fast. On approval the flow completes
   * exactly like a cash/mobile sale; on exhaustion it lands in the 'error' step.
   */
  private async processCardPayment(transactionId: string): Promise<void> {
    const declined = this.isDeclinedCard();
    let attempt = 0;

    try {
      await this.circuitBreaker.execute(
        PAYMENT_GATEWAY,
        () =>
          this.retry.execute(
            'card-payment',
            () => {
              attempt += 1;
              // Surface the retry to the cashier from the second attempt on.
              if (attempt > 1) {
                this.step.set('retrying');
              }
              return this.simulateGatewayCall(declined);
            },
            { maxAttempts: 3, initialDelay: 300, backoffMultiplier: 1.5 }
          ),
        // Short timeout keeps the demo responsive: an open breaker probes for
        // recovery a few seconds later rather than the production default.
        { failureThreshold: 5, timeout: 5000 }
      );
      this.finalizePayment('card', transactionId);
    } catch {
      // Release the use-case processing latch so a retry can execute cleanly.
      this.cardPayment.completeProcessing();
      this.step.set('error');
      this.errorMessage.set('Payment failed. Please try a different card or try again.');
      this.isSubmitting = false;
    }
  }

  /**
   * Simulated payment-gateway round-trip. Resolves for a normal card and
   * rejects for the well-known declined test PAN, after a small network-like
   * delay so the processing/retrying states are visible.
   */
  private simulateGatewayCall(declined: boolean): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      setTimeout(
        () => {
          if (declined) {
            reject(new Error('Card declined by issuer'));
          } else {
            resolve();
          }
        },
        declined ? 150 : 600
      );
    });
  }

  /** True when the entered card number is the deterministic declined test PAN. */
  private isDeclinedCard(): boolean {
    return this.cardNumber.replace(/\s+/g, '') === DECLINED_TEST_CARD;
  }

  /** From the 'error' step, return to the card form so the cashier can retry. */
  retryPayment(): void {
    this.errorMessage.set('');
    this.step.set('card');
  }

  /**
   * Completes a payment: persists the transaction, releases the use-cases, and
   * emits the result. Shared by the cash/mobile timeout path and the card
   * gateway path so completion behaviour stays identical across methods.
   */
  private finalizePayment(method: PaymentMethod, transactionId: string): void {
    const result: PaymentResult = {
      method,
      amount: this.cartService.total(),
      change: method === 'cash' ? this.cashPayment.changeAmount() : undefined,
      transactionId,
      timestamp: new Date(),
    };

    // Persist transaction to IndexedDB (fire-and-forget for offline-first)
    this.persistTransaction
      .execute({
        paymentMethod: method,
        transactionId,
        amountTendered: method === 'cash' ? this.cashTendered : undefined,
        changeGiven: method === 'cash' ? this.cashPayment.changeAmount() : undefined,
      })
      .catch(() => {
        // Persistence failure is non-blocking; transaction completes regardless
      });

    this.cashPayment.completeProcessing();
    this.cardPayment.completeProcessing();
    this.isSubmitting = false;
    this.paymentComplete.emit(result);
  }

  private generateTransactionId(): string {
    const timestamp = Date.now().toString(36);
    const random = Math.random().toString(36).substring(2, 8);
    return `TXN-${timestamp}-${random}`.toUpperCase();
  }
}
