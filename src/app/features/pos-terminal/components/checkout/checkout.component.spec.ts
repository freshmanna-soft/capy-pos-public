import { ComponentFixture, TestBed } from '@angular/core/testing';
import { CheckoutComponent } from '@features/pos-terminal/components/checkout/checkout.component';
import { PaymentResult } from '@core/application/dtos/payment.dto';
import { CartService } from '@core/application/services/cart.service';
import { ProcessCashPaymentUseCase } from '@core/application/use-cases/process-cash-payment.use-case';
import { ProcessCardPaymentUseCase } from '@core/application/use-cases/process-card-payment.use-case';
import { PersistTransactionUseCase } from '@core/application/use-cases/persist-transaction.use-case';
import { CalculateCartTotalsUseCase } from '@core/application/use-cases/calculate-cart-totals.use-case';
import { CircuitBreakerService } from '@core/infrastructure/resilience/circuit-breaker.service';
import { RetryService } from '@core/infrastructure/resilience/retry.service';
import { signal } from '@angular/core';
import {
  MERCADOPAGO_PAYMENT_PORT,
  type MercadoPagoPaymentResult,
} from '@core/application/ports/mercadopago.port';
import { PAYPAL_PAYMENT_PORT } from '@core/application/ports/paypal.port';

/**
 * Unit Tests for CheckoutComponent
 *
 * Covers Sprint 2 Stories:
 * - S2-1: Payment Method Selection UI
 * - S2-2: Cash Payment Flow
 * - S2-3: Card Payment Flow
 * - S2-5: Transaction Completion
 *
 * Acceptance Criteria tested:
 * - Happy path: selecting Cash payment method
 * - Happy path: selecting Credit Card payment method
 * - Empty cart prevention (checkout button disabled)
 * - Displaying correct total
 * - Cancellation closes the panel
 * - Cash payment validation and change calculation via use case
 */
function mpResult(
  status: MercadoPagoPaymentResult['status'],
  extra: Partial<MercadoPagoPaymentResult> = {}
): MercadoPagoPaymentResult {
  return {
    status,
    paymentId: 'pay-1',
    preferenceId: 'pref-1',
    amount: 108.5,
    timestamp: new Date(),
    ...extra,
  };
}

describe('CheckoutComponent', () => {
  let component: CheckoutComponent;
  let fixture: ComponentFixture<CheckoutComponent>;
  let mockCartService: Partial<CartService>;
  let mockCashPaymentUseCase: Partial<ProcessCashPaymentUseCase>;
  let mockCardPaymentUseCase: Partial<ProcessCardPaymentUseCase>;
  let mockCartTotals: Partial<CalculateCartTotalsUseCase>;
  let mockPersistTransaction: Partial<PersistTransactionUseCase>;
  // Resilience layer is stubbed to run the wrapped fn directly so card-payment
  // unit tests exercise the component's own retry/error branching without the
  // real services' timers. Integration is covered by the e2e suite.
  let mockCircuitBreaker: { execute: ReturnType<typeof vi.fn> };
  let mockRetry: { execute: ReturnType<typeof vi.fn> };
  /**
   * MercadoPago port double. `useValue` hands the component this exact object,
   * so MP tests replace its methods per test; the defaults are inert.
   */
  let mockMp: {
    isEnabled: () => boolean;
    loadSdk: () => Promise<void>;
    createAndRender: ReturnType<typeof vi.fn>;
    createWalletBrick: ReturnType<typeof vi.fn>;
    cancelPayment: ReturnType<typeof vi.fn>;
    destroy: ReturnType<typeof vi.fn>;
  };

  const mockValidation = signal({ isValid: false, error: null as string | null });
  const mockAmountDue = signal(108.5);
  const mockChangeAmount = signal(0);
  const mockQuickAmounts = signal([109, 114, 119, 129]);
  const mockAmountTendered = signal(0);
  const mockIsProcessing = signal(false);

  // Card payment mock signals
  const mockCardValidation = signal({
    isValid: false,
    fields: {
      cardNumber: { isValid: false, error: null as string | null },
      expiry: { isValid: false, error: null as string | null },
      cvv: { isValid: false, error: null as string | null },
    },
  });
  const mockFieldValidation = signal({
    cardNumber: { isValid: false, error: null as string | null },
    expiry: { isValid: false, error: null as string | null },
    cvv: { isValid: false, error: null as string | null },
  });
  const mockCardBrand = signal<string>('unknown');
  const mockLast4 = signal('');
  const mockAmountToCharge = signal(108.5);
  const mockCardIsProcessing = signal(false);

  beforeEach(async () => {
    mockValidation.set({ isValid: false, error: null });
    mockAmountDue.set(108.5);
    mockChangeAmount.set(0);
    mockQuickAmounts.set([109, 114, 119, 129]);
    mockAmountTendered.set(0);
    mockIsProcessing.set(false);
    mockCardValidation.set({
      isValid: false,
      fields: {
        cardNumber: { isValid: false, error: null },
        expiry: { isValid: false, error: null },
        cvv: { isValid: false, error: null },
      },
    });
    mockFieldValidation.set({
      cardNumber: { isValid: false, error: null },
      expiry: { isValid: false, error: null },
      cvv: { isValid: false, error: null },
    });
    mockCardBrand.set('unknown');
    mockLast4.set('');
    mockAmountToCharge.set(108.5);
    mockCardIsProcessing.set(false);

    mockCartService = {
      subtotal: signal(100),
      tax: signal(8.5),
      taxRate: signal(0.085),
      total: signal(108.5),
      items: signal([]),
      itemCount: signal(2),
    } as unknown as Partial<CartService>;

    mockCashPaymentUseCase = {
      amountDue: mockAmountDue,
      amountTendered: mockAmountTendered,
      changeAmount: mockChangeAmount,
      validation: mockValidation,
      quickAmounts: mockQuickAmounts,
      isProcessing: mockIsProcessing,
      setAmountTendered: vi.fn((amount: number) => {
        mockAmountTendered.set(amount);
        if (amount >= 108.5) {
          mockValidation.set({ isValid: true, error: null });
          mockChangeAmount.set(Math.round((amount - 108.5) * 100) / 100);
        } else if (amount > 0) {
          const shortfall = Math.round((108.5 - amount) * 100) / 100;
          mockValidation.set({
            isValid: false,
            error: `Insufficient amount. Short by $${shortfall.toFixed(2)}`,
          });
          mockChangeAmount.set(0);
        } else {
          mockValidation.set({ isValid: false, error: null });
          mockChangeAmount.set(0);
        }
      }),
      reset: vi.fn(() => {
        mockAmountTendered.set(0);
        mockValidation.set({ isValid: false, error: null });
        mockChangeAmount.set(0);
        mockIsProcessing.set(false);
      }),
      execute: vi.fn(() => {
        if (mockValidation().isValid) {
          mockIsProcessing.set(true);
          return {
            success: true,
            transactionId: 'TXN-CASH-TEST123',
            amountDue: 108.5,
            amountTendered: mockAmountTendered(),
            changeAmount: mockChangeAmount(),
            timestamp: new Date(),
          };
        }
        return {
          success: false,
          transactionId: '',
          amountDue: 108.5,
          amountTendered: mockAmountTendered(),
          changeAmount: 0,
          timestamp: new Date(),
          error: mockValidation().error ?? 'Payment validation failed',
        };
      }),
      completeProcessing: vi.fn(() => {
        mockIsProcessing.set(false);
      }),
    };

    mockCardPaymentUseCase = {
      validation: mockCardValidation,
      fieldValidation: mockFieldValidation,
      cardBrand: mockCardBrand,
      last4: mockLast4,
      amountToCharge: mockAmountToCharge,
      isProcessing: mockCardIsProcessing,
      cardNumber: signal(''),
      expiry: signal(''),
      cvv: signal(''),
      setCardNumber: vi.fn((value: string) => {
        const digits = value.replace(/\D/g, '');
        if (digits.startsWith('4')) mockCardBrand.set('visa');
        else if (/^5[1-5]/.test(digits)) mockCardBrand.set('mastercard');
        else mockCardBrand.set('unknown');
        if (digits.length >= 4) mockLast4.set(digits.slice(-4));
      }),
      setExpiry: vi.fn(),
      setCvv: vi.fn(),
      reset: vi.fn(() => {
        mockCardValidation.set({
          isValid: false,
          fields: {
            cardNumber: { isValid: false, error: null },
            expiry: { isValid: false, error: null },
            cvv: { isValid: false, error: null },
          },
        });
        mockFieldValidation.set({
          cardNumber: { isValid: false, error: null },
          expiry: { isValid: false, error: null },
          cvv: { isValid: false, error: null },
        });
        mockCardBrand.set('unknown');
        mockLast4.set('');
        mockCardIsProcessing.set(false);
      }),
      execute: vi.fn(() => {
        if (mockCardValidation().isValid) {
          mockCardIsProcessing.set(true);
          return {
            success: true,
            transactionId:
              `TXN-CARD-${Date.now().toString(36)}-${Math.random().toString(36).substring(2, 8)}`.toUpperCase(),
            amount: 108.5,
            last4: mockLast4(),
            cardBrand: mockCardBrand(),
            timestamp: new Date(),
          };
        }
        return {
          success: false,
          transactionId: '',
          amount: 108.5,
          last4: mockLast4(),
          cardBrand: mockCardBrand(),
          timestamp: new Date(),
          error: 'Card validation failed',
        };
      }),
      completeProcessing: vi.fn(() => {
        mockCardIsProcessing.set(false);
      }),
    } as unknown as Partial<ProcessCardPaymentUseCase>;

    mockCartTotals = {
      totals: signal({
        subtotal: 100,
        taxRate: 0.085,
        taxAmount: 8.5,
        discountAmount: 0,
        discountLabel: '',
        total: 108.5,
        itemCount: 2,
        isEmpty: false,
      }),
    };

    mockPersistTransaction = {
      execute: vi.fn().mockResolvedValue({
        success: true,
        transactionId: 'TXN-MOCK-001',
        paymentMethod: 'cash',
        timestamp: new Date(),
      }),
    };

    // Stubs that simply invoke the wrapped function once (pass-through). Tests
    // that need retry/open-breaker behaviour override these per-test.
    mockCircuitBreaker = {
      execute: vi.fn((_name: string, fn: () => Promise<unknown>) => fn()),
    };
    mockRetry = {
      execute: vi.fn((_name: string, fn: () => Promise<unknown>) => fn()),
    };

    mockMp = {
      isEnabled: () => false,
      loadSdk: () => Promise.resolve(),
      createAndRender: vi.fn(() => Promise.reject(new Error('not tested'))),
      createWalletBrick: vi.fn(() => Promise.reject(new Error('not tested'))),
      cancelPayment: vi.fn(() => Promise.resolve(mpResult('cancelled'))),
      destroy: vi.fn(),
    };

    await TestBed.configureTestingModule({
      imports: [CheckoutComponent],
      providers: [
        { provide: CartService, useValue: mockCartService },
        { provide: ProcessCashPaymentUseCase, useValue: mockCashPaymentUseCase },
        { provide: ProcessCardPaymentUseCase, useValue: mockCardPaymentUseCase },
        { provide: CalculateCartTotalsUseCase, useValue: mockCartTotals },
        { provide: PersistTransactionUseCase, useValue: mockPersistTransaction },
        { provide: CircuitBreakerService, useValue: mockCircuitBreaker },
        { provide: RetryService, useValue: mockRetry },
        // Inert by default; the Mercado Pago cancellation suite drives it.
        { provide: MERCADOPAGO_PAYMENT_PORT, useValue: mockMp },
        // No-op stub: checkout tests do not exercise the PayPal path
        {
          provide: PAYPAL_PAYMENT_PORT,
          useValue: {
            isEnabled: () => false,
            loadSdk: () => Promise.resolve(),
            createAndRender: () => Promise.reject(new Error('not tested')),
            destroy: () => undefined,
          },
        },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(CheckoutComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  describe('Payment Method Selection (S2-1)', () => {
    it('should start on the select step', () => {
      expect(component.step()).toBe('select');
    });

    it('should display payment method options', () => {
      const el = fixture.nativeElement;
      expect(el.querySelector('[data-testid="method-cash"]')).toBeTruthy();
      expect(el.querySelector('[data-testid="method-card"]')).toBeTruthy();
      expect(el.querySelector('[data-testid="method-mobile"]')).toBeTruthy();
    });

    it('should display the correct total amount', () => {
      const el = fixture.nativeElement;
      const totalEl = el.querySelector('[data-testid="checkout-total"]');
      expect(totalEl.textContent).toContain('108.50');
    });

    it('should select cash payment method', () => {
      component.selectMethod('cash');
      expect(component.selectedMethod()).toBe('cash');
    });

    it('should select card payment method', () => {
      component.selectMethod('card');
      expect(component.selectedMethod()).toBe('card');
    });

    it('should select mobile payment method', () => {
      component.selectMethod('mobile');
      expect(component.selectedMethod()).toBe('mobile');
    });

    it('should disable Continue button when no method selected', () => {
      const el = fixture.nativeElement;
      const btn = el.querySelector('[data-testid="btn-proceed"]');
      expect(btn.disabled).toBe(true);
    });

    it('should enable Continue button when method is selected', () => {
      component.selectMethod('cash');
      fixture.detectChanges();
      const el = fixture.nativeElement;
      const btn = el.querySelector('[data-testid="btn-proceed"]');
      expect(btn.disabled).toBe(false);
    });

    it('should proceed to cash step when cash selected and Continue clicked', () => {
      component.selectMethod('cash');
      component.proceedToDetails();
      expect(component.step()).toBe('cash');
    });

    it('should proceed to card step when card selected and Continue clicked', () => {
      component.selectMethod('card');
      component.proceedToDetails();
      expect(component.step()).toBe('card');
    });

    it('should proceed to mobile step when mobile selected and Continue clicked', () => {
      component.selectMethod('mobile');
      component.proceedToDetails();
      expect(component.step()).toBe('mobile');
    });
  });

  describe('Cancellation', () => {
    it('should emit checkoutCancelled when cancel is called', () => {
      const spy = vi.fn();
      component.checkoutCancelled.subscribe(spy);
      component.cancel();
      expect(spy).toHaveBeenCalled();
    });

    it('should emit checkoutCancelled when overlay is clicked', () => {
      const spy = vi.fn();
      component.checkoutCancelled.subscribe(spy);
      const el = fixture.nativeElement;
      el.querySelector('[data-testid="checkout-overlay"]').click();
      expect(spy).toHaveBeenCalled();
    });

    it('should reset cash payment use case on cancel', () => {
      component.cancel();
      expect(mockCashPaymentUseCase.reset).toHaveBeenCalled();
    });
  });

  describe('Cash Payment Flow (S2-2)', () => {
    beforeEach(() => {
      component.selectMethod('cash');
      component.proceedToDetails();
      fixture.detectChanges();
    });

    it('should display cash payment form', () => {
      const el = fixture.nativeElement;
      expect(el.querySelector('[data-testid="cash-payment"]')).toBeTruthy();
    });

    it('should reset cash payment use case when entering cash step', () => {
      expect(mockCashPaymentUseCase.reset).toHaveBeenCalled();
    });

    it('should display amount due from use case', () => {
      const el = fixture.nativeElement;
      const amountEl = el.querySelector('.co-amount-hero-value');
      expect(amountEl.textContent).toContain('108.50');
    });

    it('should call setAmountTendered on use case when amount changes', () => {
      component.onCashAmountChange(120);
      expect(mockCashPaymentUseCase.setAmountTendered).toHaveBeenCalledWith(120);
    });

    it('should calculate change correctly via use case', () => {
      component.setCashAmount(120);
      expect(mockCashPaymentUseCase.setAmountTendered).toHaveBeenCalledWith(120);
      expect(mockChangeAmount()).toBe(11.5);
    });

    it('should not allow negative change', () => {
      component.setCashAmount(50);
      expect(mockChangeAmount()).toBe(0);
    });

    it('should disable confirm when validation is invalid', () => {
      // Default state: validation is invalid (amount = 0)
      expect(component.canConfirmCash()).toBe(false);
    });

    it('should enable confirm when validation is valid (amount equals total)', () => {
      component.setCashAmount(108.5);
      expect(component.canConfirmCash()).toBe(true);
    });

    it('should enable confirm when validation is valid (amount exceeds total)', () => {
      component.setCashAmount(120);
      expect(component.canConfirmCash()).toBe(true);
    });

    it('should show error when insufficient amount', () => {
      component.setCashAmount(50);
      fixture.detectChanges();
      const el = fixture.nativeElement;
      const errorEl = el.querySelector('[data-testid="cash-error"]');
      expect(errorEl).toBeTruthy();
      expect(errorEl.textContent).toContain('Insufficient');
    });

    it('should not show error for zero amount (initial state)', () => {
      fixture.detectChanges();
      const el = fixture.nativeElement;
      const errorEl = el.querySelector('[data-testid="cash-error"]');
      expect(errorEl).toBeFalsy();
    });

    it('should display change amount when valid', () => {
      component.setCashAmount(120);
      component.cashTendered = 120;
      fixture.detectChanges();
      const el = fixture.nativeElement;
      const changeEl = el.querySelector('[data-testid="change-amount"]');
      expect(changeEl).toBeTruthy();
      expect(changeEl.textContent).toContain('11.50');
    });

    it('should display quick amount buttons from use case', () => {
      fixture.detectChanges();
      const el = fixture.nativeElement;
      const quickBtns = el.querySelectorAll('.co-quick-btn');
      expect(quickBtns.length).toBe(4);
    });

    it('should set cash amount from quick buttons', () => {
      const quickAmounts = mockQuickAmounts();
      component.setCashAmount(quickAmounts[0]);
      expect(component.cashTendered).toBe(quickAmounts[0]);
      expect(mockCashPaymentUseCase.setAmountTendered).toHaveBeenCalledWith(quickAmounts[0]);
    });

    it('should go back to select step', () => {
      component.goBack();
      expect(component.step()).toBe('select');
    });

    it('should reset cash payment use case on go back', () => {
      (mockCashPaymentUseCase.reset as ReturnType<typeof vi.fn>).mockClear();
      component.goBack();
      expect(mockCashPaymentUseCase.reset).toHaveBeenCalled();
    });

    it('should reset cashTendered on go back', () => {
      component.cashTendered = 120;
      component.goBack();
      expect(component.cashTendered).toBe(0);
    });

    it('should handle zero/null input gracefully', () => {
      component.onCashAmountChange(0);
      expect(mockCashPaymentUseCase.setAmountTendered).toHaveBeenCalledWith(0);
    });
  });

  describe('Card Payment Flow (S2-3)', () => {
    beforeEach(() => {
      component.selectMethod('card');
      component.proceedToDetails();
      fixture.detectChanges();
    });

    it('should display card payment form', () => {
      const el = fixture.nativeElement;
      expect(el.querySelector('[data-testid="card-payment"]')).toBeTruthy();
    });

    it('should disable confirm when card validation is invalid', () => {
      // Default state: validation is invalid
      expect(component.canConfirmCard()).toBe(false);
    });

    it('should enable confirm when card validation is valid', () => {
      mockCardValidation.set({
        isValid: true,
        fields: {
          cardNumber: { isValid: true, error: null },
          expiry: { isValid: true, error: null },
          cvv: { isValid: true, error: null },
        },
      });
      expect(component.canConfirmCard()).toBe(true);
    });

    it('should call setCardNumber on use case when card number changes', () => {
      component.onCardNumberChange('4111111111111111');
      expect(mockCardPaymentUseCase.setCardNumber).toHaveBeenCalledWith('4111111111111111');
    });

    it('should call setExpiry on use case when expiry changes', () => {
      component.onCardExpiryChange('12/30');
      expect(mockCardPaymentUseCase.setExpiry).toHaveBeenCalledWith('12/30');
    });

    it('should call setCvv on use case when CVV changes', () => {
      component.onCardCvvChange('123');
      expect(mockCardPaymentUseCase.setCvv).toHaveBeenCalledWith('123');
    });

    it('should display amount to charge from use case', () => {
      const el = fixture.nativeElement;
      const amountEl = el.querySelector('.co-amount-hero-value');
      expect(amountEl.textContent).toContain('108.50');
    });

    it('should call execute on card use case when confirming card payment', () => {
      vi.useFakeTimers();
      mockCardValidation.set({
        isValid: true,
        fields: {
          cardNumber: { isValid: true, error: null },
          expiry: { isValid: true, error: null },
          cvv: { isValid: true, error: null },
        },
      });
      component.confirmPayment();
      expect(mockCardPaymentUseCase.execute).toHaveBeenCalled();
      vi.useRealTimers();
    });

    it('should not proceed if card validation fails on execute', () => {
      // validation is invalid (default)
      component.confirmPayment();
      expect(component.step()).not.toBe('processing');
    });

    it('should go back to select step', () => {
      component.goBack();
      expect(component.step()).toBe('select');
    });
  });

  describe('Transaction Completion (S2-5)', () => {
    beforeEach(() => {
      vi.useFakeTimers();
      component.selectMethod('cash');
      component.proceedToDetails();
      // Set valid amount via use case mock
      component.setCashAmount(120);
      component.cashTendered = 120;
    });

    afterEach(() => {
      vi.useRealTimers();
    });

    it('should call execute on use case for cash payment', () => {
      component.confirmPayment();
      expect(mockCashPaymentUseCase.execute).toHaveBeenCalled();
    });

    it('should transition to processing step on confirm', () => {
      component.confirmPayment();
      expect(component.step()).toBe('processing');
    });

    it('should not transition to processing if validation fails', () => {
      // Reset to invalid state
      mockValidation.set({ isValid: false, error: 'Insufficient amount. Short by $58.50' });
      component.confirmPayment();
      expect(component.step()).not.toBe('processing');
    });

    it('should emit paymentComplete with correct result after processing', () => {
      const spy = vi.fn();
      component.paymentComplete.subscribe(spy);

      component.confirmPayment();
      vi.advanceTimersByTime(1500);

      expect(spy).toHaveBeenCalledTimes(1);
      const result: PaymentResult = spy.mock.calls[0][0];
      expect(result.method).toBe('cash');
      expect(result.amount).toBe(108.5);
      expect(result.transactionId).toMatch(/^TXN-CASH-/);
      expect(result.timestamp).toBeInstanceOf(Date);
    });

    it('should call completeProcessing after payment completes', () => {
      component.confirmPayment();
      vi.advanceTimersByTime(1500);
      expect(mockCashPaymentUseCase.completeProcessing).toHaveBeenCalled();
    });

    it('should generate unique transaction IDs for card payments', async () => {
      component.selectMethod('card');
      component.proceedToDetails();
      // Set card validation to valid via mock
      mockCardValidation.set({
        isValid: true,
        fields: {
          cardNumber: { isValid: true, error: null },
          expiry: { isValid: true, error: null },
          cvv: { isValid: true, error: null },
        },
      });

      const ids = new Set<string>();
      for (let i = 0; i < 10; i++) {
        const spy = vi.fn();
        component.paymentComplete.subscribe(spy);
        component.confirmPayment();
        // Card flow is async (gateway round-trip): flush the ~600ms call.
        await vi.advanceTimersByTimeAsync(700);
        ids.add(spy.mock.calls[0][0].transactionId);
      }
      expect(ids.size).toBe(10);
    });
  });

  describe('Card Payment Resilience (#92)', () => {
    beforeEach(() => {
      component.selectMethod('card');
      component.proceedToDetails();
      mockCardValidation.set({
        isValid: true,
        fields: {
          cardNumber: { isValid: true, error: null },
          expiry: { isValid: true, error: null },
          cvv: { isValid: true, error: null },
        },
      });
    });

    it('routes card payments through the payment-gateway circuit breaker', async () => {
      vi.useFakeTimers();
      component.confirmPayment();
      await vi.advanceTimersByTimeAsync(700);
      expect(mockCircuitBreaker.execute).toHaveBeenCalledWith(
        'payment-gateway',
        expect.any(Function),
        expect.objectContaining({ failureThreshold: 5 })
      );
      vi.useRealTimers();
    });

    it('lands in the error step when the gateway declines the card', async () => {
      vi.useFakeTimers();
      component.cardNumber = '4000000000000002';
      component.confirmPayment();
      await vi.advanceTimersByTimeAsync(300);
      expect(component.step()).toBe('error');
      expect(component.errorMessage()).toContain('Payment failed');
      vi.useRealTimers();
    });

    it('lands in the error step when the circuit breaker is open', async () => {
      mockCircuitBreaker.execute.mockRejectedValueOnce(new Error('circuit open'));
      component.confirmPayment();
      await new Promise((r) => setTimeout(r, 0));
      expect(component.step()).toBe('error');
    });

    it('shows the retrying state on a second gateway attempt', async () => {
      vi.useFakeTimers();
      const setSpy = vi.spyOn(component.step, 'set');
      // Emulate the real service: one failed attempt fires onRetry before the
      // wrapped call is re-invoked and succeeds.
      mockRetry.execute.mockImplementationOnce(
        async (
          _name: string,
          fn: () => Promise<unknown>,
          config?: { onRetry?: (ctx: unknown) => void }
        ) => {
          config?.onRetry?.({ operationName: _name, attempt: 1, nextAttempt: 2 });
          return fn();
        }
      );
      component.confirmPayment();
      await vi.advanceTimersByTimeAsync(1400);
      expect(setSpy).toHaveBeenCalledWith('retrying');
      vi.useRealTimers();
    });

    it('retryPayment returns to the card entry step and clears the error', () => {
      component.step.set('error');
      component.errorMessage.set('Payment failed.');
      component.retryPayment();
      expect(component.step()).toBe('card');
      expect(component.errorMessage()).toBe('');
    });
  });

  describe('Quick Amounts (backward compatibility)', () => {
    it('should generate quick amounts based on total', () => {
      const amounts = component.quickAmounts();
      expect(amounts.length).toBeGreaterThan(0);
      amounts.forEach((amount) => {
        expect(amount).toBeGreaterThanOrEqual(108.5);
      });
    });

    it('should include rounded-up amount', () => {
      const amounts = component.quickAmounts();
      expect(amounts[0]).toBe(109); // Math.ceil(108.5)
    });
  });

  describe('Mercado Pago cancellation', () => {
    /** The pending wallet / card promise, settled by the test like the adapter would. */
    let settleAttempt: (result: MercadoPagoPaymentResult) => void;
    let onPollingStarted: (() => void) | undefined;
    let onCancelling: (() => void) | undefined;

    const el = () => fixture.nativeElement as HTMLElement;
    const q = (testId: string) => el().querySelector<HTMLElement>(`[data-testid="${testId}"]`);
    const flush = async () => {
      await fixture.whenStable();
      fixture.detectChanges();
    };

    beforeEach(() => {
      const pendingAttempt = () =>
        new Promise<MercadoPagoPaymentResult>((resolve) => (settleAttempt = resolve));
      mockMp.createWalletBrick.mockImplementation(
        (_amount: number, _id: string, polling?: () => void, cancelling?: () => void) => {
          onPollingStarted = polling;
          onCancelling = cancelling;
          return pendingAttempt();
        }
      );
      mockMp.createAndRender.mockImplementation(pendingAttempt);
    });

    /** Open the wallet step; optionally have the buyer click Pay in the Brick. */
    async function openWallet({ paid = false } = {}): Promise<void> {
      component.selectAndProceed('mercadopago');
      if (paid) onPollingStarted?.();
      await flush();
    }

    async function clickCancel(result: MercadoPagoPaymentResult): Promise<void> {
      // Like the adapter: cancel resolves and the attempt promise settles too.
      mockMp.cancelPayment.mockImplementation(async () => {
        settleAttempt(result);
        return result;
      });
      q('btn-mp-cancel')!.click();
      await flush();
    }

    it('shows Cancel payment on the wallet step before the buyer pays', async () => {
      await openWallet();
      expect(q('mp-wallet-brick-container')).toBeTruthy();
      expect(q('btn-mp-cancel')).toBeTruthy();
    });

    it('shows Cancel payment while waiting for the MP tab', async () => {
      await openWallet({ paid: true });
      expect(q('mp-wallet-waiting')).toBeTruthy();
      expect(q('btn-mp-cancel')?.textContent).toContain('Cancel payment');
    });

    it('cancel → Cancelling… (buttons disabled) → Payment cancelled, focus on the heading', async () => {
      await openWallet({ paid: true });
      let resolveCancel!: (r: MercadoPagoPaymentResult) => void;
      mockMp.cancelPayment.mockImplementation(
        () => new Promise<MercadoPagoPaymentResult>((r) => (resolveCancel = r))
      );

      q('btn-mp-cancel')!.click();
      fixture.detectChanges();
      expect(component.step()).toBe('mercadopago-cancelling');
      const cancelling = q('mp-cancelling')!;
      expect(cancelling.textContent).toContain('Cancelling payment…');
      expect(cancelling.getAttribute('aria-live')).toBe('polite');
      expect([...cancelling.querySelectorAll('button')].every((b) => b.disabled)).toBe(true);

      const result = mpResult('cancelled', { cancellationConfirmed: true });
      resolveCancel(result);
      settleAttempt(result);
      await flush();

      const cancelled = q('mp-cancelled')!;
      expect(cancelled.querySelector('h3')?.textContent).toContain('Payment cancelled');
      expect(cancelled.textContent).toContain("You weren't charged. Your cart is still here.");
      expect(q('mp-cancel-unconfirmed')).toBeNull();
      expect(document.activeElement).toBe(cancelled.querySelector('h3'));
      expect(mockMp.cancelPayment).toHaveBeenCalledOnce();
    });

    it('finalizes the sale when the gateway says the buyer already paid', async () => {
      const spy = vi.fn();
      component.paymentComplete.subscribe(spy);
      await openWallet({ paid: true });

      await clickCancel(mpResult('approved'));

      expect(spy).toHaveBeenCalledOnce();
      expect(spy.mock.calls[0][0]).toMatchObject({ method: 'mercadopago', amount: 108.5 });
      expect(q('mp-cancelled')).toBeNull();
    });

    it('ignores a late approved that arrives after the cancel settled', async () => {
      const spy = vi.fn();
      component.paymentComplete.subscribe(spy);
      await openWallet({ paid: true });
      mockMp.cancelPayment.mockResolvedValue(mpResult('cancelled'));

      q('btn-mp-cancel')!.click();
      await flush();
      expect(component.step()).toBe('mercadopago-cancelled');

      settleAttempt(mpResult('approved'));
      await flush();

      expect(spy).not.toHaveBeenCalled();
      expect(component.step()).toBe('mercadopago-cancelled');
    });

    it('ignores a late approved after checkout went back to method selection', async () => {
      const spy = vi.fn();
      component.paymentComplete.subscribe(spy);
      await openWallet();
      component.goBack();

      settleAttempt(mpResult('approved'));
      await flush();

      expect(spy).not.toHaveBeenCalled();
      expect(component.step()).toBe('select');
    });

    it('warns, but still does not finalize, when the gateway could not confirm', async () => {
      const spy = vi.fn();
      component.paymentComplete.subscribe(spy);
      await openWallet({ paid: true });

      await clickCancel(mpResult('cancelled', { cancellationConfirmed: false }));

      expect(q('mp-cancelled')).toBeTruthy();
      expect(q('mp-cancel-unconfirmed')?.textContent).toContain(
        "We couldn't confirm the cancellation with Mercado Pago"
      );
      expect(spy).not.toHaveBeenCalled();
    });

    it('Try again returns to method selection; the next attempt starts fresh', async () => {
      await openWallet({ paid: true });
      await clickCancel(mpResult('cancelled', { cancellationConfirmed: false }));

      q('btn-mp-try-again')!.click();
      await flush();

      expect(component.step()).toBe('select');
      expect(component.mpCancelUnconfirmed()).toBe(false);

      await openWallet();
      expect(mockMp.createWalletBrick).toHaveBeenCalledTimes(2);
      expect(component.step()).toBe('mercadopago-wallet');
    });

    it('Back to cart closes checkout', async () => {
      const spy = vi.fn();
      component.checkoutCancelled.subscribe(spy);
      await openWallet({ paid: true });
      await clickCancel(mpResult('cancelled'));

      q('btn-mp-back-to-cart')!.click();

      expect(spy).toHaveBeenCalledOnce();
    });

    it('closing checkout mid-payment cancels at the gateway instead of dropping it', async () => {
      const spy = vi.fn();
      component.checkoutCancelled.subscribe(spy);
      await openWallet({ paid: true });
      mockMp.cancelPayment.mockImplementation(() => new Promise(() => undefined));

      component.cancel();
      fixture.detectChanges();

      expect(spy).not.toHaveBeenCalled();
      expect(component.step()).toBe('mercadopago-cancelling');
      // Closing again while cancelling is ignored, not a second cancel.
      component.cancel();
      expect(mockMp.cancelPayment).toHaveBeenCalledOnce();
      expect(spy).not.toHaveBeenCalled();
    });

    it('an adapter-initiated cancel (buyer returned from MP) shows Cancelling… then Payment cancelled', async () => {
      await openWallet({ paid: true });

      onCancelling?.();
      fixture.detectChanges();
      expect(q('mp-cancelling')).toBeTruthy();

      settleAttempt(mpResult('cancelled', { cancellationConfirmed: true }));
      await flush();
      expect(q('mp-cancelled')).toBeTruthy();
    });

    it('the card Brick step offers Cancel payment too', async () => {
      component.mpMode.set('card');
      component.selectAndProceed('mercadopago');
      await flush();
      expect(q('mp-brick-container')).toBeTruthy();

      await clickCancel(mpResult('cancelled', { cancellationConfirmed: true }));

      expect(q('mp-cancelled')).toBeTruthy();
    });

    it('a wallet error after the attempt was abandoned is ignored', async () => {
      mockMp.createWalletBrick.mockImplementation(() => Promise.reject(new Error('boom')));
      component.selectAndProceed('mercadopago');
      component.goBack();
      await flush();
      expect(component.step()).toBe('select');
    });
  });
});
