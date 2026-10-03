import {
  Component,
  ChangeDetectionStrategy,
  ElementRef,
  Injector,
  afterNextRender,
  inject,
  input,
  signal,
  computed,
  output,
  viewChild,
  OnDestroy,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { CartService } from '@core/application/services/cart.service';
import { ProcessCashPaymentUseCase } from '@core/application/use-cases/process-cash-payment.use-case';
import { ProcessCardPaymentUseCase } from '@core/application/use-cases/process-card-payment.use-case';
import { PersistTransactionUseCase } from '@core/application/use-cases/persist-transaction.use-case';
import { CircuitBreakerService } from '@core/infrastructure/resilience/circuit-breaker.service';
import { RetryService } from '@core/infrastructure/resilience/retry.service';
import {
  PaymentMethod,
  PaymentResult,
  StaffPaymentMethod,
} from '@core/application/dtos/payment.dto';
import {
  MERCADOPAGO_PAYMENT_PORT,
  type MercadoPagoPaymentResult,
} from '@core/application/ports/mercadopago.port';
import { PAYPAL_PAYMENT_PORT } from '@core/application/ports/paypal.port';

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
    <!--
      Fullscreen payment panel — no modal scrim, slides in from the right on
      desktop, fills screen on mobile. The onsen palette keeps it on-brand.
      The overlay wrapper still traps keyboard focus (Escape / click-outside).
    -->
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
        <!-- ── Header ──────────────────────────────────────────────────── -->
        <div class="co-header">
          <button class="co-back-btn" (click)="cancel()" aria-label="Close checkout">
            <svg width="20" height="20" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path
                stroke-linecap="round"
                stroke-linejoin="round"
                stroke-width="2"
                d="M10 19l-7-7m0 0l7-7m-7 7h18"
              />
            </svg>
          </button>
          <span class="co-title">Checkout</span>
        </div>

        <!-- ── Order total strip ───────────────────────────────────────── -->
        <div class="co-total-strip" data-testid="checkout-total-strip">
          <div class="co-total-row">
            <span class="co-total-label">Subtotal</span>
            <span class="co-total-value-sm">{{ cartService.subtotal() | currency }}</span>
          </div>
          <div class="co-total-row">
            <span class="co-total-label"
              >Tax ({{ (cartService.taxRate() * 100).toFixed(1) }}%)</span
            >
            <span class="co-total-value-sm">{{ cartService.tax() | currency }}</span>
          </div>
          <div class="co-total-row co-total-row--grand">
            <span class="co-grand-label">Total</span>
            <span class="co-grand-value" data-testid="checkout-total">{{
              cartService.total() | currency
            }}</span>
          </div>
        </div>

        <!-- ── Step 1 — method selection ─────────────────────────────── -->
        @if (step() === 'select') {
          <div class="co-body" data-testid="payment-methods">
            <!-- MercadoPago — primary row (when enabled) -->
            @if (mercadopagoAvailable()) {
              <button
                class="co-method-row co-method-row--mp"
                (click)="selectAndProceed('mercadopago')"
                data-testid="method-mercadopago"
              >
                <span class="co-method-logo">
                  <svg width="28" height="28" viewBox="0 0 48 48" fill="none">
                    <circle cx="24" cy="24" r="24" fill="#009EE3" />
                    <path
                      d="M10 24c0-7.732 6.268-14 14-14s14 6.268 14 14-6.268 14-14 14S10 31.732 10 24z"
                      fill="#fff"
                      fill-opacity=".18"
                    />
                    <path
                      d="M18.5 27.5l3.5-7 3.5 5 2.5-3.5 2.5 5.5"
                      stroke="#fff"
                      stroke-width="2.2"
                      stroke-linecap="round"
                      stroke-linejoin="round"
                    />
                  </svg>
                </span>
                <span class="co-method-info">
                  <span class="co-method-name">MercadoPago</span>
                  <span class="co-method-hint">Pay with your MP account or QR</span>
                </span>
                <svg
                  class="co-chevron"
                  width="16"
                  height="16"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path
                    stroke-linecap="round"
                    stroke-linejoin="round"
                    stroke-width="2"
                    d="M9 5l7 7-7 7"
                  />
                </svg>
              </button>
            }

            <!-- PayPal — primary row (when enabled) -->
            @if (paypalAvailable()) {
              <button
                class="co-method-row co-method-row--paypal"
                (click)="selectAndProceed('paypal')"
                data-testid="method-paypal"
              >
                <span class="co-method-logo">
                  <svg width="28" height="28" viewBox="0 0 48 48" fill="none">
                    <rect width="48" height="48" rx="24" fill="#003087" />
                    <path
                      d="M19 30h-3l3-14h5.5c2.5 0 4.5 1 4 3.5-.5 2.5-2.5 3.5-5 3.5H21l-2 7z"
                      fill="#009cde"
                    />
                    <path
                      d="M23 30h-3l2-9h5c2 0 3.5.8 3 3-.5 2.2-2 3-4 3h-1.5L23 30z"
                      fill="#fff"
                    />
                  </svg>
                </span>
                <span class="co-method-info">
                  <span class="co-method-name">PayPal</span>
                  <span class="co-method-hint">Pay with your PayPal account</span>
                </span>
                <svg
                  class="co-chevron"
                  width="16"
                  height="16"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path
                    stroke-linecap="round"
                    stroke-linejoin="round"
                    stroke-width="2"
                    d="M9 5l7 7-7 7"
                  />
                </svg>
              </button>
            }

            <!-- Cash / Card / Mobile — staff methods (hidden in kiosk mode) -->
            @if (showCashCard()) {
              <div
                class="co-staff-divider"
                [class.has-digital]="mercadopagoAvailable() || paypalAvailable()"
              >
                <span>{{
                  mercadopagoAvailable() || paypalAvailable()
                    ? 'Or pay another way'
                    : 'Choose payment method'
                }}</span>
              </div>
              <div class="co-staff-grid">
                <button
                  class="co-staff-card"
                  [class.selected]="selectedMethod() === 'cash'"
                  (click)="selectMethod('cash')"
                  data-testid="method-cash"
                >
                  <svg width="24" height="24" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <rect x="2" y="6" width="20" height="12" rx="2" stroke-width="1.8" />
                    <circle cx="12" cy="12" r="3" stroke-width="1.8" />
                    <path d="M6 12h.01M18 12h.01" stroke-width="2.2" stroke-linecap="round" />
                  </svg>
                  <span>Cash</span>
                </button>
                <button
                  class="co-staff-card"
                  [class.selected]="selectedMethod() === 'card'"
                  (click)="selectMethod('card')"
                  data-testid="method-card"
                >
                  <svg width="24" height="24" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <rect x="2" y="5" width="20" height="14" rx="2" stroke-width="1.8" />
                    <path d="M2 10h20" stroke-width="1.8" />
                    <path d="M6 15h4" stroke-width="1.8" stroke-linecap="round" />
                  </svg>
                  <span>Card</span>
                </button>
                <button
                  class="co-staff-card"
                  [class.selected]="selectedMethod() === 'mobile'"
                  (click)="selectMethod('mobile')"
                  data-testid="method-mobile"
                >
                  <svg width="24" height="24" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <rect x="7" y="2" width="10" height="20" rx="2" stroke-width="1.8" />
                    <circle cx="12" cy="18" r=".8" fill="currentColor" />
                  </svg>
                  <span>Mobile</span>
                </button>
              </div>
              <button
                class="co-btn-proceed"
                [disabled]="!selectedMethod()"
                (click)="proceedToDetails()"
                data-testid="btn-proceed"
              >
                Continue
              </button>
            }
          </div>
        }

        <!-- ── Step 2 — Cash ──────────────────────────────────────────── -->
        @if (step() === 'cash') {
          <div class="co-body" data-testid="cash-payment">
            <div class="co-amount-hero">
              <span class="co-amount-hero-label">Amount Due</span>
              <span class="co-amount-hero-value">{{ cashPayment.amountDue() | currency }}</span>
            </div>
            <div class="co-input-group">
              <label for="cash-tendered" class="co-label">Amount Tendered</label>
              <input
                id="cash-tendered"
                type="number"
                class="co-input"
                [class.co-input--error]="cashPayment.validation().error"
                [min]="cashPayment.amountDue()"
                step="0.01"
                [(ngModel)]="cashTendered"
                (ngModelChange)="onCashAmountChange($event)"
                data-testid="cash-tendered"
                placeholder="0.00"
              />
            </div>
            @if (cashPayment.validation().error) {
              <div class="co-error-row" data-testid="cash-error">
                <span>{{ cashPayment.validation().error }}</span>
              </div>
            }
            @if (cashPayment.validation().isValid && cashTendered > 0) {
              <div class="co-change-row" data-testid="change-amount">
                <span class="co-change-label">Change Due</span>
                <span class="co-change-value">{{ cashPayment.changeAmount() | currency }}</span>
              </div>
            }
            <div class="co-quick-grid">
              @for (amount of cashPayment.quickAmounts(); track amount) {
                <button
                  class="co-quick-btn"
                  (click)="setCashAmount(amount)"
                  [attr.data-testid]="'quick-' + amount"
                >
                  {{ amount === cashPayment.amountDue() ? 'Exact' : (amount | currency) }}
                </button>
              }
            </div>
            <div class="co-actions">
              <button class="co-btn-back" (click)="goBack()">Back</button>
              <button
                class="co-btn-confirm"
                [disabled]="!cashPayment.validation().isValid"
                (click)="confirmPayment()"
                data-testid="btn-confirm-cash"
              >
                Confirm Payment
              </button>
            </div>
          </div>
        }

        <!-- ── Step 2 — Card ──────────────────────────────────────────── -->
        @if (step() === 'card') {
          <div class="co-body" data-testid="card-payment">
            <div class="co-amount-hero">
              <span class="co-amount-hero-label">Charging</span>
              <span class="co-amount-hero-value">{{
                cardPayment.amountToCharge() | currency
              }}</span>
            </div>
            @if (cardPayment.cardBrand() !== 'unknown') {
              <div class="co-card-brand" data-testid="card-brand">
                <span class="co-brand-badge">{{ cardPayment.cardBrand() | uppercase }}</span>
                @if (cardPayment.last4()) {
                  <span class="co-last4">•••• {{ cardPayment.last4() }}</span>
                }
              </div>
            }
            <div class="co-card-form">
              <div class="co-input-group">
                <label for="card-number" class="co-label">Card Number</label>
                <input
                  id="card-number"
                  type="text"
                  class="co-input"
                  [class.co-input--error]="cardPayment.fieldValidation().cardNumber.error"
                  [(ngModel)]="cardNumber"
                  (ngModelChange)="onCardNumberChange($event)"
                  placeholder="•••• •••• •••• ••••"
                  maxlength="19"
                  data-testid="card-number"
                />
                @if (cardPayment.fieldValidation().cardNumber.error) {
                  <span class="co-field-error" data-testid="card-number-error">
                    {{ cardPayment.fieldValidation().cardNumber.error }}
                  </span>
                }
              </div>
              <div class="co-card-row">
                <div class="co-input-group">
                  <label for="card-expiry" class="co-label">Expiry</label>
                  <input
                    id="card-expiry"
                    type="text"
                    class="co-input"
                    [class.co-input--error]="cardPayment.fieldValidation().expiry.error"
                    [(ngModel)]="cardExpiry"
                    (ngModelChange)="onCardExpiryChange($event)"
                    placeholder="MM/YY"
                    maxlength="5"
                    data-testid="card-expiry"
                  />
                  @if (cardPayment.fieldValidation().expiry.error) {
                    <span class="co-field-error" data-testid="card-expiry-error">
                      {{ cardPayment.fieldValidation().expiry.error }}
                    </span>
                  }
                </div>
                <div class="co-input-group">
                  <label for="card-cvv" class="co-label">CVV</label>
                  <input
                    id="card-cvv"
                    type="password"
                    class="co-input"
                    [class.co-input--error]="cardPayment.fieldValidation().cvv.error"
                    [(ngModel)]="cardCvv"
                    (ngModelChange)="onCardCvvChange($event)"
                    placeholder="•••"
                    maxlength="4"
                    data-testid="card-cvv"
                  />
                  @if (cardPayment.fieldValidation().cvv.error) {
                    <span class="co-field-error" data-testid="card-cvv-error">
                      {{ cardPayment.fieldValidation().cvv.error }}
                    </span>
                  }
                </div>
              </div>
            </div>
            <div class="co-actions">
              <button class="co-btn-back" (click)="goBack()">Back</button>
              <button
                class="co-btn-confirm"
                [disabled]="!canConfirmCard()"
                (click)="confirmPayment()"
                data-testid="btn-confirm-card"
              >
                Pay {{ cardPayment.amountToCharge() | currency }}
              </button>
            </div>
          </div>
        }

        <!-- ── Step 2 — MP Wallet Brick ───────────────────────────────── -->
        @if (step() === 'mercadopago-wallet') {
          <div class="co-body" data-testid="mercadopago-wallet-payment">
            <div class="co-mp-header">
              <svg width="32" height="32" viewBox="0 0 48 48" fill="none">
                <circle cx="24" cy="24" r="24" fill="#009EE3" />
                <path
                  d="M18.5 27.5l3.5-7 3.5 5 2.5-3.5 2.5 5.5"
                  stroke="#fff"
                  stroke-width="2.2"
                  stroke-linecap="round"
                  stroke-linejoin="round"
                />
              </svg>
              <span class="co-mp-brand">MercadoPago</span>
              <span class="co-mp-amount">{{ cartService.total() | currency }}</span>
            </div>
            @if (!mpWalletPolling()) {
              <div id="mp-wallet-brick-container" data-testid="mp-wallet-brick-container"></div>
              <button
                class="co-text-link"
                (click)="mpMode.set('card'); goBack(); confirmPayment()"
                data-testid="btn-mp-use-card"
              >
                Pay with a card instead
              </button>
              <div class="co-actions">
                <button class="co-btn-back" (click)="goBack()">Back</button>
                <button
                  class="co-btn-back"
                  (click)="cancelMercadopagoPayment()"
                  data-testid="btn-mp-cancel"
                >
                  Cancel payment
                </button>
              </div>
            } @else {
              <div
                class="co-waiting"
                data-testid="mp-wallet-waiting"
                role="status"
                aria-live="polite"
              >
                <div class="co-spinner" aria-hidden="true"></div>
                <p class="co-waiting-title">Waiting for confirmation…</p>
                <p class="co-waiting-hint">
                  Complete payment in the Mercado Pago tab that opened, or cancel here.
                </p>
              </div>
              <div class="co-actions co-actions--single">
                <button
                  class="co-btn-back"
                  (click)="cancelMercadopagoPayment()"
                  data-testid="btn-mp-cancel"
                >
                  Cancel payment
                </button>
              </div>
            }
          </div>
        }

        <!-- ── MP — cancelling at the gateway ─────────────────────────── -->
        @if (step() === 'mercadopago-cancelling') {
          <div
            class="co-body co-body--centered"
            data-testid="mp-cancelling"
            role="status"
            aria-live="polite"
          >
            <div class="co-spinner co-spinner--lg" aria-hidden="true"></div>
            <p class="co-state-text">Cancelling payment…</p>
            <div class="co-actions">
              <button class="co-btn-back" disabled>Try again</button>
              <button class="co-btn-back" disabled>Back to cart</button>
            </div>
          </div>
        }

        <!-- ── MP — payment cancelled ─────────────────────────────────── -->
        @if (step() === 'mercadopago-cancelled') {
          <div class="co-body co-body--centered" data-testid="mp-cancelled">
            <div class="co-cancelled-icon" aria-hidden="true">
              <svg width="40" height="40" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <circle cx="12" cy="12" r="10" stroke-width="1.8" />
                <path d="M15 9l-6 6M9 9l6 6" stroke-width="2" stroke-linecap="round" />
              </svg>
            </div>
            <h3 #mpCancelledHeading class="co-cancelled-title" tabindex="-1">Payment cancelled</h3>
            <p class="co-cancelled-body" role="status">
              You weren't charged. Your cart is still here.
            </p>
            @if (mpCancelUnconfirmed()) {
              <p class="co-notice" role="alert" data-testid="mp-cancel-unconfirmed">
                We couldn't confirm the cancellation with Mercado Pago. If you were charged, ask a
                cashier.
              </p>
            }
            <div class="co-actions">
              <button
                class="co-btn-back"
                (click)="backToCartAfterCancel()"
                data-testid="btn-mp-back-to-cart"
              >
                Back to cart
              </button>
              <button
                class="co-btn-confirm"
                (click)="tryAgainAfterCancel()"
                data-testid="btn-mp-try-again"
              >
                Try again
              </button>
            </div>
          </div>
        }

        <!-- ── Step 2 — MP Card Brick ─────────────────────────────────── -->
        @if (step() === 'mercadopago') {
          <div class="co-body" data-testid="mercadopago-payment">
            <div class="co-mp-header">
              <svg width="32" height="32" viewBox="0 0 48 48" fill="none">
                <circle cx="24" cy="24" r="24" fill="#009EE3" />
                <path
                  d="M18.5 27.5l3.5-7 3.5 5 2.5-3.5 2.5 5.5"
                  stroke="#fff"
                  stroke-width="2.2"
                  stroke-linecap="round"
                  stroke-linejoin="round"
                />
              </svg>
              <span class="co-mp-brand">MercadoPago — Card</span>
              <span class="co-mp-amount">{{ cartService.total() | currency }}</span>
            </div>
            <div id="mp-card-brick-container" data-testid="mp-brick-container"></div>
            <button
              class="co-text-link"
              (click)="mpMode.set('wallet'); goBack(); confirmPayment()"
              data-testid="btn-mp-use-wallet"
            >
              Pay with MercadoPago account instead
            </button>
            <div class="co-actions">
              <button class="co-btn-back" (click)="goBack()">Back</button>
              <button
                class="co-btn-back"
                (click)="cancelMercadopagoPayment()"
                data-testid="btn-mp-cancel"
              >
                Cancel payment
              </button>
            </div>
          </div>
        }

        <!-- ── Step 2 — PayPal ────────────────────────────────────────── -->
        @if (step() === 'paypal') {
          <div class="co-body" data-testid="paypal-payment">
            <div class="co-amount-hero">
              <span class="co-amount-hero-label">Amount</span>
              <span class="co-amount-hero-value">{{ cartService.total() | currency }}</span>
            </div>
            <div id="paypal-btn-container" data-testid="paypal-btn-container"></div>
            <div class="co-actions co-actions--single">
              <button class="co-btn-back" (click)="goBack()">Back</button>
            </div>
          </div>
        }

        <!-- ── Step 2 — Mobile ────────────────────────────────────────── -->
        @if (step() === 'mobile') {
          <div class="co-body" data-testid="mobile-payment">
            <div class="co-amount-hero">
              <span class="co-amount-hero-label">Amount</span>
              <span class="co-amount-hero-value">{{ cartService.total() | currency }}</span>
            </div>
            <div class="co-qr-area">
              <div class="co-qr-box" data-testid="qr-code">
                <svg width="40" height="40" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <rect x="3" y="3" width="7" height="7" rx="1" stroke-width="1.8" />
                  <rect x="14" y="3" width="7" height="7" rx="1" stroke-width="1.8" />
                  <rect x="3" y="14" width="7" height="7" rx="1" stroke-width="1.8" />
                  <path
                    d="M14 14h.01M14 17h3M17 14v3M20 17v3M20 14h.01"
                    stroke-width="1.8"
                    stroke-linecap="round"
                  />
                </svg>
                <p class="co-qr-text">Scan QR code or tap to pay</p>
              </div>
            </div>
            <div class="co-actions">
              <button class="co-btn-back" (click)="goBack()">Back</button>
              <button
                class="co-btn-confirm"
                (click)="confirmPayment()"
                data-testid="btn-confirm-mobile"
              >
                Confirm Received
              </button>
            </div>
          </div>
        }

        <!-- ── Processing ─────────────────────────────────────────────── -->
        @if (step() === 'processing') {
          <div class="co-body co-body--centered" data-testid="processing">
            <div class="co-spinner co-spinner--lg"></div>
            <p class="co-state-text">Processing payment…</p>
          </div>
        }

        <!-- ── Retrying ───────────────────────────────────────────────── -->
        @if (step() === 'retrying') {
          <div class="co-body co-body--centered" data-testid="payment-retrying">
            <div class="co-spinner co-spinner--lg"></div>
            <p class="co-state-text">Payment failed — retrying…</p>
          </div>
        }

        <!-- ── Error ──────────────────────────────────────────────────── -->
        @if (step() === 'error') {
          <div class="co-body co-body--centered" data-testid="payment-error">
            <div class="co-error-icon">
              <svg width="40" height="40" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <circle cx="12" cy="12" r="10" stroke-width="1.8" />
                <path d="M12 8v4M12 16h.01" stroke-width="2" stroke-linecap="round" />
              </svg>
            </div>
            <p class="co-error-msg">{{ errorMessage() }}</p>
            <div class="co-actions">
              <button class="co-btn-back" (click)="cancel()" data-testid="btn-cancel-payment">
                Cancel
              </button>
              <button
                class="co-btn-confirm"
                (click)="retryPayment()"
                data-testid="btn-retry-payment"
              >
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
      /* ── Layout shell ─────────────────────────────────────────────── */
      .checkout-overlay {
        position: fixed;
        inset: 0;
        /* Subtle dark veil — much lighter than the old 50% black */
        background: rgba(20, 16, 14, 0.6);
        display: flex;
        align-items: stretch;
        justify-content: flex-end;
        z-index: 1000;
      }

      .checkout-panel {
        background: #1f3a38; /* onsen-water */
        color: #e8dccb; /* steam */
        width: 100%;
        max-width: 440px;
        height: 100%;
        display: flex;
        flex-direction: column;
        overflow: hidden;
        /* Slide-in from right */
        animation: slideIn 0.22s cubic-bezier(0.16, 1, 0.3, 1);
      }

      @keyframes slideIn {
        from {
          transform: translateX(100%);
        }
        to {
          transform: translateX(0);
        }
      }

      /* Full-screen on mobile */
      @media (max-width: 639px) {
        .checkout-overlay {
          align-items: flex-end;
          justify-content: center;
        }
        .checkout-panel {
          max-width: 100%;
          height: 96dvh;
          border-radius: 20px 20px 0 0;
          animation: slideUp 0.22s cubic-bezier(0.16, 1, 0.3, 1);
        }
        @keyframes slideUp {
          from {
            transform: translateY(100%);
          }
          to {
            transform: translateY(0);
          }
        }
      }

      /* ── Header ───────────────────────────────────────────────────── */
      .co-header {
        display: flex;
        align-items: center;
        gap: 0.75rem;
        padding: 1.25rem 1.25rem 1rem;
        border-bottom: 1px solid rgba(232, 220, 203, 0.1);
        flex-shrink: 0;
      }

      .co-back-btn {
        display: flex;
        align-items: center;
        justify-content: center;
        width: 36px;
        height: 36px;
        border-radius: 10px;
        border: none;
        background: rgba(232, 220, 203, 0.08);
        color: #e8dccb;
        cursor: pointer;
        transition: background 0.15s;
        flex-shrink: 0;
      }
      .co-back-btn:hover {
        background: rgba(232, 220, 203, 0.15);
      }

      .co-title {
        font-size: 1.0625rem;
        font-weight: 700;
        color: #e8dccb;
        letter-spacing: -0.01em;
      }

      /* ── Total strip ──────────────────────────────────────────────── */
      .co-total-strip {
        padding: 1rem 1.25rem;
        background: rgba(20, 16, 14, 0.35);
        border-bottom: 1px solid rgba(232, 220, 203, 0.08);
        flex-shrink: 0;
      }

      .co-total-row {
        display: flex;
        justify-content: space-between;
        align-items: baseline;
        padding: 0.2rem 0;
      }

      .co-total-label {
        font-size: 0.8rem;
        color: rgba(232, 220, 203, 0.55);
      }
      .co-total-value-sm {
        font-size: 0.8rem;
        color: rgba(232, 220, 203, 0.7);
        font-variant-numeric: tabular-nums;
      }

      .co-total-row--grand {
        margin-top: 0.5rem;
        padding-top: 0.5rem;
        border-top: 1px solid rgba(232, 220, 203, 0.12);
      }
      .co-grand-label {
        font-size: 0.9375rem;
        font-weight: 700;
        color: #e8dccb;
      }
      .co-grand-value {
        font-size: 1.375rem;
        font-weight: 800;
        color: #f0b429;
        font-variant-numeric: tabular-nums;
        letter-spacing: -0.02em;
      }

      /* ── Scrollable body ──────────────────────────────────────────── */
      .co-body {
        flex: 1;
        overflow-y: auto;
        padding: 1.25rem;
        display: flex;
        flex-direction: column;
        gap: 0.75rem;
      }

      .co-body--centered {
        align-items: center;
        justify-content: center;
        gap: 1rem;
        text-align: center;
      }

      /* ── Digital payment rows (MP / PayPal) ───────────────────────── */
      .co-method-row {
        display: flex;
        align-items: center;
        gap: 1rem;
        width: 100%;
        padding: 1rem 1.125rem;
        border-radius: 14px;
        border: 1.5px solid rgba(232, 220, 203, 0.12);
        background: rgba(232, 220, 203, 0.05);
        color: #e8dccb;
        cursor: pointer;
        transition:
          background 0.15s,
          border-color 0.15s;
        text-align: left;
      }
      .co-method-row:hover {
        background: rgba(232, 220, 203, 0.1);
        border-color: rgba(232, 220, 203, 0.22);
      }
      .co-method-row--mp:hover {
        border-color: #009ee3;
      }
      .co-method-row--paypal:hover {
        border-color: #009cde;
      }

      .co-method-logo {
        flex-shrink: 0;
        line-height: 0;
      }
      .co-method-info {
        flex: 1;
        display: flex;
        flex-direction: column;
        gap: 0.125rem;
      }
      .co-method-name {
        font-size: 0.9375rem;
        font-weight: 700;
      }
      .co-method-hint {
        font-size: 0.75rem;
        color: rgba(232, 220, 203, 0.5);
      }
      .co-chevron {
        color: rgba(232, 220, 203, 0.35);
        flex-shrink: 0;
      }

      /* ── Staff method divider ─────────────────────────────────────── */
      .co-staff-divider {
        display: flex;
        align-items: center;
        gap: 0.75rem;
        color: rgba(232, 220, 203, 0.4);
        font-size: 0.75rem;
        font-weight: 500;
        letter-spacing: 0.04em;
        text-transform: uppercase;
      }
      .co-staff-divider::before,
      .co-staff-divider::after {
        content: '';
        flex: 1;
        height: 1px;
        background: rgba(232, 220, 203, 0.12);
      }
      .co-staff-divider:not(.has-digital) {
        margin-top: 0;
      }

      /* ── Staff method 3-up grid ───────────────────────────────────── */
      .co-staff-grid {
        display: grid;
        grid-template-columns: repeat(3, 1fr);
        gap: 0.625rem;
      }

      .co-staff-card {
        display: flex;
        flex-direction: column;
        align-items: center;
        gap: 0.5rem;
        padding: 1rem 0.5rem;
        border-radius: 12px;
        border: 1.5px solid rgba(232, 220, 203, 0.12);
        background: rgba(232, 220, 203, 0.04);
        color: rgba(232, 220, 203, 0.65);
        font-size: 0.8125rem;
        font-weight: 600;
        cursor: pointer;
        transition: all 0.15s;
      }
      .co-staff-card:hover {
        border-color: rgba(240, 180, 41, 0.5);
        color: #e8dccb;
        background: rgba(240, 180, 41, 0.07);
      }
      .co-staff-card.selected {
        border-color: #f0b429;
        color: #e8dccb;
        background: rgba(240, 180, 41, 0.12);
      }

      /* ── Amount hero (non-digital steps) ─────────────────────────── */
      .co-amount-hero {
        display: flex;
        justify-content: space-between;
        align-items: center;
        padding: 0.875rem 1rem;
        background: rgba(20, 16, 14, 0.35);
        border-radius: 12px;
        border: 1px solid rgba(240, 180, 41, 0.2);
      }
      .co-amount-hero-label {
        font-size: 0.8125rem;
        color: rgba(232, 220, 203, 0.55);
      }
      .co-amount-hero-value {
        font-size: 1.5rem;
        font-weight: 800;
        color: #f0b429;
        font-variant-numeric: tabular-nums;
      }

      /* ── Inputs ───────────────────────────────────────────────────── */
      .co-input-group {
        display: flex;
        flex-direction: column;
        gap: 0.375rem;
      }

      .co-label {
        font-size: 0.8rem;
        font-weight: 500;
        color: rgba(232, 220, 203, 0.6);
      }

      .co-input {
        width: 100%;
        padding: 0.75rem 1rem;
        background: rgba(20, 16, 14, 0.4);
        border: 1.5px solid rgba(232, 220, 203, 0.14);
        border-radius: 10px;
        color: #e8dccb;
        font-size: 1.0625rem;
        outline: none;
        transition: border-color 0.15s;
        box-sizing: border-box;
      }
      .co-input::placeholder {
        color: rgba(232, 220, 203, 0.3);
      }
      .co-input:focus {
        border-color: #f0b429;
        box-shadow: 0 0 0 3px rgba(240, 180, 41, 0.12);
      }
      .co-input--error {
        border-color: #c4553c;
      }
      .co-input--error:focus {
        border-color: #c4553c;
        box-shadow: 0 0 0 3px rgba(196, 85, 60, 0.15);
      }

      .co-field-error {
        font-size: 0.75rem;
        color: #c4553c;
        font-weight: 500;
      }

      /* ── Error / change rows ──────────────────────────────────────── */
      .co-error-row {
        display: flex;
        align-items: center;
        padding: 0.625rem 0.875rem;
        background: rgba(196, 85, 60, 0.12);
        border: 1px solid rgba(196, 85, 60, 0.3);
        border-radius: 10px;
        font-size: 0.8125rem;
        color: #e87a65;
        font-weight: 500;
      }

      .co-change-row {
        display: flex;
        justify-content: space-between;
        align-items: center;
        padding: 0.75rem 1rem;
        background: rgba(78, 140, 122, 0.15);
        border: 1px solid rgba(78, 140, 122, 0.3);
        border-radius: 10px;
      }
      .co-change-label {
        font-size: 0.875rem;
        color: rgba(232, 220, 203, 0.6);
      }
      .co-change-value {
        font-size: 1.25rem;
        font-weight: 700;
        color: #4e8c7a;
      }

      /* ── Quick-amount chips ───────────────────────────────────────── */
      .co-quick-grid {
        display: grid;
        grid-template-columns: repeat(4, 1fr);
        gap: 0.5rem;
      }

      .co-quick-btn {
        padding: 0.625rem 0.375rem;
        border: 1.5px solid rgba(232, 220, 203, 0.12);
        border-radius: 8px;
        background: rgba(232, 220, 203, 0.04);
        color: rgba(232, 220, 203, 0.75);
        font-size: 0.8125rem;
        font-weight: 600;
        cursor: pointer;
        transition: all 0.12s;
        text-align: center;
      }
      .co-quick-btn:hover {
        border-color: #f0b429;
        color: #e8dccb;
        background: rgba(240, 180, 41, 0.08);
      }

      /* ── Card form ────────────────────────────────────────────────── */
      .co-card-form {
        display: flex;
        flex-direction: column;
        gap: 0;
      }
      .co-card-row {
        display: grid;
        grid-template-columns: 1fr 1fr;
        gap: 0.75rem;
      }

      .co-card-brand {
        display: flex;
        align-items: center;
        gap: 0.75rem;
        padding: 0.5rem 0.875rem;
        background: rgba(78, 140, 122, 0.1);
        border: 1px solid rgba(78, 140, 122, 0.25);
        border-radius: 8px;
      }
      .co-brand-badge {
        font-size: 0.7rem;
        font-weight: 700;
        color: #4e8c7a;
        background: rgba(78, 140, 122, 0.2);
        padding: 0.2rem 0.5rem;
        border-radius: 4px;
        letter-spacing: 0.06em;
      }
      .co-last4 {
        font-size: 0.875rem;
        color: rgba(232, 220, 203, 0.6);
        font-family: ui-monospace, monospace;
      }

      /* ── MP inline header ─────────────────────────────────────────── */
      .co-mp-header {
        display: flex;
        align-items: center;
        gap: 0.75rem;
        padding: 0.875rem 1rem;
        background: rgba(0, 158, 227, 0.08);
        border: 1px solid rgba(0, 158, 227, 0.2);
        border-radius: 12px;
      }
      .co-mp-brand {
        flex: 1;
        font-size: 0.9375rem;
        font-weight: 700;
        color: #e8dccb;
      }
      .co-mp-amount {
        font-size: 1rem;
        font-weight: 700;
        color: #f0b429;
        font-variant-numeric: tabular-nums;
      }

      #mp-card-brick-container,
      #mp-wallet-brick-container {
        min-height: 280px;
        border-radius: 10px;
        overflow: hidden;
      }

      /* ── QR placeholder ───────────────────────────────────────────── */
      .co-qr-area {
        display: flex;
        justify-content: center;
      }
      .co-qr-box {
        display: flex;
        flex-direction: column;
        align-items: center;
        gap: 0.875rem;
        padding: 2rem 1.5rem;
        border: 2px dashed rgba(232, 220, 203, 0.18);
        border-radius: 16px;
        width: 200px;
        color: rgba(232, 220, 203, 0.4);
      }
      .co-qr-text {
        font-size: 0.8125rem;
        text-align: center;
        margin: 0;
      }

      /* ── Waiting / polling state ──────────────────────────────────── */
      .co-waiting {
        display: flex;
        flex-direction: column;
        align-items: center;
        gap: 0.875rem;
        padding: 2.5rem 1rem;
        text-align: center;
      }
      .co-waiting-title {
        font-size: 1rem;
        font-weight: 600;
        color: #e8dccb;
        margin: 0;
      }
      .co-waiting-hint {
        font-size: 0.825rem;
        color: rgba(232, 220, 203, 0.5);
        margin: 0;
      }

      /* ── Spinner ──────────────────────────────────────────────────── */
      .co-spinner {
        width: 36px;
        height: 36px;
        border: 3px solid rgba(232, 220, 203, 0.12);
        border-top-color: #f0b429;
        border-radius: 50%;
        animation: spin 0.75s linear infinite;
        flex-shrink: 0;
      }
      .co-spinner--lg {
        width: 48px;
        height: 48px;
        border-width: 4px;
      }

      @keyframes spin {
        to {
          transform: rotate(360deg);
        }
      }

      .co-state-text {
        font-size: 0.9375rem;
        color: rgba(232, 220, 203, 0.6);
        margin: 0;
      }

      /* ── MP payment cancelled ─────────────────────────────────────── */
      .co-cancelled-icon {
        color: rgba(232, 220, 203, 0.55);
      }
      .co-cancelled-title {
        font-size: 1.125rem;
        font-weight: 700;
        color: #e8dccb;
        margin: 0;
        outline: none;
      }
      .co-cancelled-body {
        font-size: 0.9375rem;
        color: rgba(232, 220, 203, 0.7);
        margin: 0;
        max-width: 30ch;
        line-height: 1.5;
      }
      .co-notice {
        font-size: 0.8125rem;
        color: #f0b429;
        background: rgba(240, 180, 41, 0.1);
        border: 1px solid rgba(240, 180, 41, 0.3);
        border-radius: 10px;
        padding: 0.625rem 0.875rem;
        margin: 0;
        max-width: 34ch;
        line-height: 1.45;
      }
      .co-btn-back:disabled {
        opacity: 0.35;
        cursor: not-allowed;
      }

      /* ── Error state ──────────────────────────────────────────────── */
      .co-error-icon {
        color: #c4553c;
      }
      .co-error-msg {
        font-size: 0.9375rem;
        font-weight: 600;
        color: #e87a65;
        margin: 0;
        max-width: 28ch;
        line-height: 1.5;
      }

      /* ── Action buttons ───────────────────────────────────────────── */
      .co-actions {
        display: flex;
        gap: 0.75rem;
        margin-top: auto;
        padding-top: 0.5rem;
      }

      .co-actions--single {
        justify-content: flex-start;
      }

      .co-btn-back {
        flex: 1;
        padding: 0.875rem;
        border-radius: 12px;
        border: 1.5px solid rgba(232, 220, 203, 0.18);
        background: transparent;
        color: rgba(232, 220, 203, 0.7);
        font-size: 0.875rem;
        font-weight: 600;
        cursor: pointer;
        transition: all 0.15s;
      }
      .co-btn-back:hover {
        background: rgba(232, 220, 203, 0.07);
        color: #e8dccb;
      }

      .co-btn-proceed,
      .co-btn-confirm {
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
      .co-btn-proceed {
        flex: 1;
      }

      .co-btn-proceed:hover:not(:disabled),
      .co-btn-confirm:hover:not(:disabled) {
        background: #f5c24a;
        transform: translateY(-1px);
        box-shadow: 0 4px 12px rgba(240, 180, 41, 0.3);
      }
      .co-btn-proceed:active:not(:disabled),
      .co-btn-confirm:active:not(:disabled) {
        transform: translateY(0);
        box-shadow: none;
      }
      .co-btn-proceed:disabled,
      .co-btn-confirm:disabled {
        opacity: 0.35;
        cursor: not-allowed;
        transform: none;
        box-shadow: none;
      }

      /* ── Text link (MP mode toggle) ───────────────────────────────── */
      .co-text-link {
        background: none;
        border: none;
        color: #009ee3;
        font-size: 0.8125rem;
        cursor: pointer;
        text-decoration: underline;
        text-underline-offset: 2px;
        padding: 0;
        align-self: center;
      }
      .co-text-link:hover {
        color: #33b5e8;
      }

      /* ── Proceed button (full-width at bottom of select step) ─────── */
      .co-btn-proceed {
        width: 100%;
        flex: unset;
        margin-top: 0.25rem;
      }
    `,
  ],
})
export class CheckoutComponent implements OnDestroy {
  readonly cartService = inject(CartService);
  readonly cashPayment = inject(ProcessCashPaymentUseCase);
  readonly cardPayment = inject(ProcessCardPaymentUseCase);
  readonly mercadopago = inject(MERCADOPAGO_PAYMENT_PORT);
  readonly paypal = inject(PAYPAL_PAYMENT_PORT);
  private readonly persistTransaction = inject(PersistTransactionUseCase);
  private readonly circuitBreaker = inject(CircuitBreakerService);
  private readonly retry = inject(RetryService);
  private readonly injector = inject(Injector);

  /**
   * When true the checkout is running in kiosk (self-checkout) mode.
   * In kiosk mode only digital payment methods (MercadoPago, PayPal) are shown;
   * cash and card entry are hidden because an unattended terminal cannot handle
   * physical tender or manual card input.
   */
  readonly kioskMode = input<boolean>(false);

  /**
   * Terminal overrides are resolved by KioskSettingsService before the kiosk
   * shell opens checkout. The payment adapters remain build-time providers, so
   * the shell passes the resolved availability for kiosk terminals explicitly.
   */
  readonly mercadopagoEnabled = input<boolean | undefined>(undefined);
  readonly paypalEnabled = input<boolean | undefined>(undefined);

  readonly mercadopagoAvailable = computed(
    () => this.mercadopagoEnabled() ?? this.mercadopago.isEnabled()
  );
  readonly paypalAvailable = computed(() => this.paypalEnabled() ?? this.paypal.isEnabled());

  // Derived: in kiosk mode with no digital methods available, operator must be shown instead.
  readonly showCashCard = computed(
    () => !this.kioskMode() || (!this.mercadopagoAvailable() && !this.paypalAvailable())
  );

  // Outputs
  readonly paymentComplete = output<PaymentResult>();
  readonly checkoutCancelled = output<void>();

  // State
  readonly step = signal<
    | 'select'
    | 'cash'
    | 'card'
    | 'mobile'
    | 'mercadopago'
    | 'mercadopago-wallet'
    | 'mercadopago-cancelling'
    | 'mercadopago-cancelled'
    | 'paypal'
    | 'processing'
    | 'retrying'
    | 'error'
  >('select');
  readonly selectedMethod = signal<PaymentMethod | null>(null);
  readonly changeAmount = signal<number>(0);

  /**
   * True while the Wallet Brick's polling loop is running (buyer clicked Pay
   * and we're waiting for MP to confirm). Drives the "waiting" overlay in the
   * mercadopago-wallet step so the Brick container isn't destroyed mid-poll.
   */
  readonly mpWalletPolling = signal<boolean>(false);

  /**
   * True on the "Payment cancelled" screen when the gateway could not confirm
   * the cancel. The sale is still not finalized; the notice just tells the
   * customer who to ask if money did leave their account.
   */
  readonly mpCancelUnconfirmed = signal<boolean>(false);

  private readonly mpCancelledHeading = viewChild<ElementRef<HTMLElement>>('mpCancelledHeading');

  /**
   * Generation of the current MercadoPago attempt. Every async MP result
   * carries the generation it started under and is dropped unless it still
   * matches; settling, Back, closing and destroy all move it on. That is what
   * stops a late `approved` — after the customer cancelled, went back, or
   * closed checkout — from finalizing a sale nobody is looking at.
   */
  private mpGeneration = 0;
  /** Transaction id of the in-flight MP attempt, for a cancel that turns out approved. */
  private mpTransactionId = '';

  /** User-facing message shown in the 'error' step after a failed payment. */
  readonly errorMessage = signal<string>('');

  /**
   * MercadoPago sub-mode: 'card' = Card Payment Brick (enter card in iframe);
   * 'wallet' = Wallet Brick (pay from existing MercadoPago account, QR / link).
   * 'wallet' is the primary/recommended mode.
   */
  readonly mpMode = signal<'card' | 'wallet'>('wallet');

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

  selectMethod(method: StaffPaymentMethod): void {
    this.selectedMethod.set(method);
  }

  /** Select a method and immediately proceed — used by MP and PayPal buttons
   *  so the Brick renders on the first click, with no extra Continue step. */
  selectAndProceed(method: PaymentMethod): void {
    this.selectedMethod.set(method);
    this.proceedToDetails();
  }

  proceedToDetails(): void {
    const method = this.selectedMethod();
    if (!method) return;

    if (method === 'cash') {
      this.cashPayment.reset();
    }

    // MercadoPago / PayPal: skip the intermediate step and go straight to
    // rendering the widget. The container div becomes visible when
    // step === 'mercadopago' / 'paypal', which the process method sets internally.
    if (method === 'mercadopago' || method === 'paypal') {
      this.confirmPayment();
      return;
    }

    this.step.set(method);
  }

  goBack(): void {
    this.mpGeneration++;
    this.mercadopago.destroy();
    this.paypal.destroy();
    this.mpWalletPolling.set(false);
    this.step.set('select');
    this.cashPayment.reset();
    this.cashTendered = 0;
  }

  ngOnDestroy(): void {
    this.mpGeneration++;
    this.mercadopago.destroy();
    this.paypal.destroy();
  }

  cancel(): void {
    // Closing checkout (header close, Escape, backdrop) while Mercado Pago
    // holds an open payment goes through the same gateway cancel as the
    // button: the customer may already be paying in the MP tab, so the sale
    // either lands (approved) or is cancelled on screen — never silently dropped.
    if (this.isMercadopagoInFlight()) {
      void this.cancelMercadopagoPayment();
      return;
    }
    if (this.step() === 'mercadopago-cancelling') return;
    this.mpGeneration++;
    this.mercadopago.destroy();
    this.paypal.destroy();
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

    // Zero-amount guard: MercadoPago (and PayPal) reject preferences with a
    // non-positive amount. Catch it here before the SDK call so the error
    // message is actionable ("add items or check product prices") rather than
    // a raw upstream "A positive amount is required."
    const total = this.cartService.total();
    if (total <= 0) {
      this.step.set('error');
      this.errorMessage.set(
        'The order total is $0.00. Add items or check that product prices are set correctly.'
      );
      this.isSubmitting = false;
      return;
    }

    // Run the payment use-case exactly ONCE and reuse its result. Previously
    // execute() was called a second time inside the timeout, which minted a new
    // transactionId and ran the payment twice per confirmation.
    const transactionId = this.resolveTransactionId(method);
    if (transactionId === null) {
      return; // use-case validation failed (e.g. cash amount too low)
    }

    this.isSubmitting = true;

    // MercadoPago / PayPal: the SDK drives its own UI — do NOT set step to
    // 'processing' here because that hides the container div the widget renders into.
    if (method === 'mercadopago') {
      if (this.mpMode() === 'wallet') {
        void this.processMercadopagoWalletPayment(transactionId);
      } else {
        void this.processMercadopagoPayment(transactionId);
      }
      return;
    }

    if (method === 'paypal') {
      void this.processPaypalPayment(transactionId);
      return;
    }

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
   * Resolve a transaction ID for the given payment method.
   *
   * For cash and card the use-case's `execute()` is responsible for validation
   * (e.g. sufficient cash tendered, valid card fields) and minting the ID, so
   * this method runs it and returns `null` on failure — `confirmPayment()` bails
   * out without setting `isSubmitting`, letting the UI stay interactive.
   * All other methods (mercadopago, paypal, mobile) generate a fresh ID here
   * because their validation and submission are handled by the respective SDK /
   * async process methods that follow.
   */
  private resolveTransactionId(method: PaymentMethod): string | null {
    if (method === 'cash') {
      const result = this.cashPayment.execute();
      return result.success ? result.transactionId : null;
    }
    if (method === 'card') {
      const result = this.cardPayment.execute();
      return result.success ? result.transactionId : null;
    }
    return this.generateTransactionId();
  }

  /**
   * Drive a card payment through the resilience layer: the call is retried on
   * transient failure and, after enough failures, the shared 'payment-gateway'
   * circuit breaker opens and rejects fast. On approval the flow completes
   * exactly like a cash/mobile sale; on exhaustion it lands in the 'error' step.
   */
  private async processCardPayment(transactionId: string): Promise<void> {
    const declined = this.isDeclinedCard();

    try {
      await this.circuitBreaker.execute(
        PAYMENT_GATEWAY,
        () =>
          this.retry.execute('card-payment', () => this.simulateGatewayCall(declined), {
            maxAttempts: 3,
            initialDelay: 300,
            backoffMultiplier: 1.5,
            // Surface the retry to the cashier as soon as the gateway is retried.
            onRetry: () => this.step.set('retrying'),
          }),
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

  /**
   * Mounts the MercadoPago **Wallet Brick** — the buyer pays from their
   * existing MercadoPago account (QR / link). This is the primary mode.
   */
  private async processMercadopagoWalletPayment(transactionId: string): Promise<void> {
    const generation = this.beginMercadopagoAttempt(transactionId);
    this.step.set('mercadopago-wallet');
    this.mpWalletPolling.set(false);
    this.isSubmitting = false;

    try {
      // Callbacks let the adapter flip the UI the moment the buyer clicks Pay
      // (waiting) or the moment it starts a cancel on its own — the buyer came
      // back from MP without paying, or the wait timed out (cancelling).
      const result = await this.mercadopago.createWalletBrick(
        this.cartService.total(),
        'mp-wallet-brick-container',
        () => {
          if (generation === this.mpGeneration) this.mpWalletPolling.set(true);
        },
        () => {
          if (generation === this.mpGeneration) this.step.set('mercadopago-cancelling');
        }
      );
      this.settleMercadopago(
        generation,
        result,
        'MercadoPago payment was not completed. Please try again.'
      );
    } catch (err) {
      if (!this.consumeMercadopagoGeneration(generation)) return;
      this.mpWalletPolling.set(false);
      this.mercadopago.destroy();
      this.step.set('error');
      const message = err instanceof Error ? err.message : 'MercadoPago Wallet payment failed.';
      this.errorMessage.set(message);
      this.isSubmitting = false;
    }
  }

  /**
   * "Cancel payment" — from the wallet step (before or while waiting), the
   * card Brick step, or by closing checkout mid-payment. Shows "Cancelling…"
   * while the adapter makes the cancel real at the gateway, then lands on
   * "Payment cancelled" — or on the receipt, if the gateway says the
   * customer had already paid.
   */
  async cancelMercadopagoPayment(): Promise<void> {
    if (!this.isMercadopagoInFlight()) return;
    const generation = this.mpGeneration;
    this.mpWalletPolling.set(false);
    this.step.set('mercadopago-cancelling');
    const result = await this.mercadopago.cancelPayment();
    // The attempt's own promise settles with this same result; whichever
    // arrives first wins and the other is dropped by the generation check.
    this.settleMercadopago(generation, result, 'MercadoPago payment was not completed.');
  }

  /** "Try again" on the cancelled screen: pick a method again; MP gets a fresh preference. */
  tryAgainAfterCancel(): void {
    this.mpCancelUnconfirmed.set(false);
    this.goBack();
  }

  /** "Back to cart" on the cancelled screen: close checkout, cart intact. */
  backToCartAfterCancel(): void {
    this.mpCancelUnconfirmed.set(false);
    this.cancel();
  }

  private isMercadopagoInFlight(): boolean {
    const step = this.step();
    return step === 'mercadopago-wallet' || step === 'mercadopago';
  }

  private beginMercadopagoAttempt(transactionId: string): number {
    this.mpTransactionId = transactionId;
    this.mpCancelUnconfirmed.set(false);
    return ++this.mpGeneration;
  }

  /** True (and the generation moves on) only for the first result of the current attempt. */
  private consumeMercadopagoGeneration(generation: number): boolean {
    if (generation !== this.mpGeneration) return false;
    this.mpGeneration++;
    return true;
  }

  /** One place every MP outcome lands, so wallet, card and cancel agree. */
  private settleMercadopago(
    generation: number,
    result: MercadoPagoPaymentResult,
    notCompletedMessage: string
  ): void {
    if (!this.consumeMercadopagoGeneration(generation)) return;
    this.mpWalletPolling.set(false);

    if (result.status === 'approved' || result.status === 'pending') {
      // Pending is acceptable — treat as complete and let the backend confirm.
      this.isSubmitting = true;
      this.step.set('processing');
      this.finalizePayment('mercadopago', this.mpTransactionId);
      return;
    }

    this.isSubmitting = false;
    if (result.status === 'cancelled') {
      this.mpCancelUnconfirmed.set(result.cancellationConfirmed === false);
      this.step.set('mercadopago-cancelled');
      // Move focus to the heading so screen readers announce the new state
      // and keyboard users are not left on a button that no longer exists.
      afterNextRender(() => this.mpCancelledHeading()?.nativeElement.focus(), {
        injector: this.injector,
      });
      return;
    }

    this.step.set('error');
    this.errorMessage.set(notCompletedMessage);
  }

  /**
   * Mounts the MercadoPago **Card Payment Brick** — the buyer types card
   * details into the MP iframe. Optional fallback when the buyer does not
   * have a MercadoPago account.
   */
  private async processMercadopagoPayment(transactionId: string): Promise<void> {
    const generation = this.beginMercadopagoAttempt(transactionId);
    // Render the brick — the container div must be in the DOM, so we go back
    // to the mercadopago step first (processing hides it).
    this.step.set('mercadopago');
    this.isSubmitting = false; // allow the brick's own submit button

    try {
      const result = await this.mercadopago.createAndRender(
        this.cartService.total(),
        'mp-card-brick-container'
      );
      this.settleMercadopago(
        generation,
        result,
        'MercadoPago payment was not approved. Please try again.'
      );
    } catch {
      if (!this.consumeMercadopagoGeneration(generation)) return;
      this.mercadopago.destroy();
      this.step.set('error');
      this.errorMessage.set('MercadoPago payment failed. Please try again.');
      this.isSubmitting = false;
    }
  }

  /**
   * Renders the PayPal Buttons widget inside the dedicated container and waits
   * for the buyer to approve or cancel.
   *
   * The widget drives its own UI; step stays 'paypal' so the container div
   * remains in the DOM while the widget is active.
   */
  private async processPaypalPayment(transactionId: string): Promise<void> {
    this.step.set('paypal');
    this.isSubmitting = false; // allow the PayPal widget's own buttons

    try {
      const result = await this.paypal.createAndRender(
        this.cartService.total(),
        'paypal-btn-container'
      );

      if (result.status === 'completed') {
        this.isSubmitting = true;
        this.step.set('processing');
        this.finalizePayment('paypal', transactionId);
      } else if (result.status === 'pending') {
        // Treat pending as complete; backend will confirm capture.
        this.isSubmitting = true;
        this.step.set('processing');
        this.finalizePayment('paypal', transactionId);
      } else {
        // Buyer cancelled.
        this.step.set('error');
        this.errorMessage.set('PayPal payment was cancelled. Please try again.');
        this.isSubmitting = false;
      }
    } catch {
      this.paypal.destroy();
      this.step.set('error');
      this.errorMessage.set('PayPal payment failed. Please try again.');
      this.isSubmitting = false;
    }
  }

  /** From the 'error' step, return to the correct form so the cashier can retry. */
  retryPayment(): void {
    this.errorMessage.set('');
    const method = this.selectedMethod();
    if (method === 'mercadopago') {
      if (this.mpMode() === 'wallet') {
        void this.processMercadopagoWalletPayment(this.generateTransactionId());
      } else {
        this.step.set('mercadopago');
        void this.processMercadopagoPayment(this.generateTransactionId());
      }
    } else if (method === 'paypal') {
      this.step.set('paypal');
      void this.processPaypalPayment(this.generateTransactionId());
    } else {
      this.step.set('card');
    }
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
