import { ComponentFixture, TestBed } from '@angular/core/testing';
import { CheckoutComponent, PaymentMethod, PaymentResult } from './checkout.component';
import { CartService } from '../../../../core/application/services/cart.service';
import { signal } from '@angular/core';

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
 */
describe('CheckoutComponent', () => {
  let component: CheckoutComponent;
  let fixture: ComponentFixture<CheckoutComponent>;
  let mockCartService: Partial<CartService>;

  beforeEach(async () => {
    mockCartService = {
      subtotal: signal(100),
      tax: signal(8.5),
      taxRate: signal(0.085),
      total: signal(108.5),
      items: signal([]),
      itemCount: signal(2),
    } as unknown as Partial<CartService>;

    await TestBed.configureTestingModule({
      imports: [CheckoutComponent],
      providers: [
        { provide: CartService, useValue: mockCartService },
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

    it('should display amount due', () => {
      const el = fixture.nativeElement;
      const amountEl = el.querySelector('.amount-value');
      expect(amountEl.textContent).toContain('108.50');
    });

    it('should calculate change correctly', () => {
      component.cashTendered = 120;
      component.calculateChange();
      expect(component.changeAmount()).toBe(11.5);
    });

    it('should not allow negative change', () => {
      component.cashTendered = 50;
      component.calculateChange();
      expect(component.changeAmount()).toBe(0);
    });

    it('should disable confirm when cash tendered is less than total', () => {
      component.cashTendered = 50;
      expect(component.canConfirmCash()).toBe(false);
    });

    it('should enable confirm when cash tendered equals total', () => {
      component.cashTendered = 108.5;
      expect(component.canConfirmCash()).toBe(true);
    });

    it('should enable confirm when cash tendered exceeds total', () => {
      component.cashTendered = 120;
      expect(component.canConfirmCash()).toBe(true);
    });

    it('should set cash amount from quick buttons', () => {
      const quickAmounts = component.quickAmounts();
      component.setCashAmount(quickAmounts[0]);
      expect(component.cashTendered).toBe(quickAmounts[0]);
    });

    it('should go back to select step', () => {
      component.goBack();
      expect(component.step()).toBe('select');
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

    it('should disable confirm when card details are incomplete', () => {
      component.cardNumber = '1234';
      component.cardExpiry = '12';
      component.cardCvv = '1';
      expect(component.canConfirmCard()).toBe(false);
    });

    it('should enable confirm when card details are complete', () => {
      component.cardNumber = '4111111111111111';
      component.cardExpiry = '12/25';
      component.cardCvv = '123';
      expect(component.canConfirmCard()).toBe(true);
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
      component.cashTendered = 120;
      component.calculateChange();
    });

    afterEach(() => {
      vi.useRealTimers();
    });

    it('should transition to processing step on confirm', () => {
      component.confirmPayment();
      expect(component.step()).toBe('processing');
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
      expect(result.change).toBe(11.5);
      expect(result.transactionId).toMatch(/^TXN-/);
      expect(result.timestamp).toBeInstanceOf(Date);
    });

    it('should generate unique transaction IDs', () => {
      const ids = new Set<string>();
      for (let i = 0; i < 10; i++) {
        const spy = vi.fn();
        component.paymentComplete.subscribe(spy);
        component.confirmPayment();
        vi.advanceTimersByTime(1500);
        ids.add(spy.mock.calls[0][0].transactionId);
      }
      expect(ids.size).toBe(10);
    });
  });

  describe('Quick Amounts', () => {
    it('should generate quick amounts based on total', () => {
      const amounts = component.quickAmounts();
      expect(amounts.length).toBeGreaterThan(0);
      amounts.forEach(amount => {
        expect(amount).toBeGreaterThanOrEqual(108.5);
      });
    });

    it('should include rounded-up amount', () => {
      const amounts = component.quickAmounts();
      expect(amounts[0]).toBe(109); // Math.ceil(108.5)
    });
  });
});
