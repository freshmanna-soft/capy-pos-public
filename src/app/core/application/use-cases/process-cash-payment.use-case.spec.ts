import { TestBed } from '@angular/core/testing';
import {
  ProcessCashPaymentUseCase,
  CASH_DENOMINATIONS,
} from '@core/application/use-cases/process-cash-payment.use-case';
import { CartService } from '@core/application/services/cart.service';
import { CalculateCartTotalsUseCase } from '@core/application/use-cases/calculate-cart-totals.use-case';
import { signal } from '@angular/core';

describe('ProcessCashPaymentUseCase', () => {
  let useCase: ProcessCashPaymentUseCase;
  let mockCartService: Partial<CartService>;
  let mockCartTotals: Partial<CalculateCartTotalsUseCase>;

  const mockTotal = signal(25.99);
  const mockSubtotal = signal(23.85);
  const mockTaxRate = signal(0.0899);
  const mockTotalItems = signal(3);
  const mockIsEmpty = signal(false);

  beforeEach(() => {
    mockCartService = {
      subtotal: mockSubtotal,
      total: mockTotal,
      taxRate: mockTaxRate,
      totalItems: mockTotalItems,
      isEmpty: mockIsEmpty,
    } as unknown as Partial<CartService>;

    mockCartTotals = {
      totals: signal({
        subtotal: 23.85,
        taxRate: 0.0899,
        taxAmount: 2.14,
        discountAmount: 0,
        discountLabel: '',
        total: 25.99,
        itemCount: 3,
        isEmpty: false,
      }),
    } as unknown as Partial<CalculateCartTotalsUseCase>;

    TestBed.configureTestingModule({
      providers: [
        ProcessCashPaymentUseCase,
        { provide: CartService, useValue: mockCartService },
        { provide: CalculateCartTotalsUseCase, useValue: mockCartTotals },
      ],
    });

    useCase = TestBed.inject(ProcessCashPaymentUseCase);
  });

  describe('Initial State', () => {
    it('should have zero amount tendered initially', () => {
      expect(useCase.amountTendered()).toBe(0);
    });

    it('should not be processing initially', () => {
      expect(useCase.isProcessing()).toBe(false);
    });

    it('should have amount due from cart totals', () => {
      expect(useCase.amountDue()).toBe(25.99);
    });

    it('should have zero change initially', () => {
      expect(useCase.changeAmount()).toBe(0);
    });

    it('should have invalid validation with no error initially', () => {
      const validation = useCase.validation();
      expect(validation.isValid).toBe(false);
      expect(validation.error).toBeNull();
    });
  });

  describe('setAmountTendered', () => {
    it('should update amount tendered', () => {
      useCase.setAmountTendered(30);
      expect(useCase.amountTendered()).toBe(30);
    });

    it('should update change amount reactively', () => {
      useCase.setAmountTendered(30);
      expect(useCase.changeAmount()).toBe(4.01);
    });

    it('should handle exact amount', () => {
      useCase.setAmountTendered(25.99);
      expect(useCase.changeAmount()).toBe(0);
    });

    it('should handle zero change for exact payment', () => {
      useCase.setAmountTendered(25.99);
      const validation = useCase.validation();
      expect(validation.isValid).toBe(true);
      expect(useCase.changeAmount()).toBe(0);
    });
  });

  describe('Validation', () => {
    it('should be invalid when amount is zero', () => {
      useCase.setAmountTendered(0);
      const validation = useCase.validation();
      expect(validation.isValid).toBe(false);
      expect(validation.error).toBeNull();
    });

    it('should show error for negative amount', () => {
      useCase.setAmountTendered(-10);
      const validation = useCase.validation();
      expect(validation.isValid).toBe(false);
      expect(validation.error).toBe('Amount cannot be negative');
    });

    it('should show error for insufficient amount', () => {
      useCase.setAmountTendered(20);
      const validation = useCase.validation();
      expect(validation.isValid).toBe(false);
      expect(validation.error).toContain('Insufficient amount');
      expect(validation.error).toContain('5.99');
    });

    it('should be valid when amount equals total', () => {
      useCase.setAmountTendered(25.99);
      const validation = useCase.validation();
      expect(validation.isValid).toBe(true);
      expect(validation.error).toBeNull();
    });

    it('should be valid when amount exceeds total', () => {
      useCase.setAmountTendered(50);
      const validation = useCase.validation();
      expect(validation.isValid).toBe(true);
      expect(validation.error).toBeNull();
    });

    it('should show error when cart is empty', () => {
      // Override totals to have zero total
      (mockCartTotals as { totals: ReturnType<typeof signal> }).totals = signal({
        subtotal: 0,
        taxRate: 0.0899,
        taxAmount: 0,
        discountAmount: 0,
        discountLabel: '',
        total: 0,
        itemCount: 0,
        isEmpty: true,
      });

      // Re-create use case with empty cart
      const emptyCartTotals = {
        totals: signal({
          subtotal: 0,
          taxRate: 0.0899,
          taxAmount: 0,
          discountAmount: 0,
          discountLabel: '',
          total: 0,
          itemCount: 0,
          isEmpty: true,
        }),
      };

      TestBed.resetTestingModule();
      TestBed.configureTestingModule({
        providers: [
          ProcessCashPaymentUseCase,
          { provide: CartService, useValue: mockCartService },
          { provide: CalculateCartTotalsUseCase, useValue: emptyCartTotals },
        ],
      });

      const emptyUseCase = TestBed.inject(ProcessCashPaymentUseCase);
      emptyUseCase.setAmountTendered(10);
      const validation = emptyUseCase.validation();
      expect(validation.isValid).toBe(false);
      expect(validation.error).toBe('Cart is empty');
    });
  });

  describe('Change Calculation', () => {
    it('should calculate correct change for round numbers', () => {
      useCase.setAmountTendered(30);
      expect(useCase.changeAmount()).toBe(4.01);
    });

    it('should calculate zero change for exact amount', () => {
      useCase.setAmountTendered(25.99);
      expect(useCase.changeAmount()).toBe(0);
    });

    it('should calculate change for large overpayment', () => {
      useCase.setAmountTendered(100);
      expect(useCase.changeAmount()).toBe(74.01);
    });

    it('should return zero change for insufficient amount', () => {
      useCase.setAmountTendered(10);
      expect(useCase.changeAmount()).toBe(0);
    });

    it('should handle floating point precision', () => {
      useCase.setAmountTendered(26);
      // 26 - 25.99 = 0.01 (with proper rounding)
      expect(useCase.changeAmount()).toBe(0.01);
    });
  });

  describe('Quick Amounts', () => {
    it('should include exact amount', () => {
      const amounts = useCase.quickAmounts();
      expect(amounts).toContain(25.99);
    });

    it('should include standard denominations >= total', () => {
      const amounts = useCase.quickAmounts();
      expect(amounts).toContain(50);
      expect(amounts).toContain(100);
    });

    it('should not include denominations less than total', () => {
      const amounts = useCase.quickAmounts();
      expect(amounts).not.toContain(5);
      expect(amounts).not.toContain(10);
      expect(amounts).not.toContain(20);
    });

    it('should be sorted in ascending order', () => {
      const amounts = useCase.quickAmounts();
      for (let i = 1; i < amounts.length; i++) {
        expect(amounts[i]).toBeGreaterThanOrEqual(amounts[i - 1]);
      }
    });

    it('should return max 6 amounts', () => {
      const amounts = useCase.quickAmounts();
      expect(amounts.length).toBeLessThanOrEqual(6);
    });

    it('should return empty array for zero total', () => {
      TestBed.resetTestingModule();
      TestBed.configureTestingModule({
        providers: [
          ProcessCashPaymentUseCase,
          { provide: CartService, useValue: mockCartService },
          {
            provide: CalculateCartTotalsUseCase,
            useValue: {
              totals: signal({
                subtotal: 0,
                taxRate: 0,
                taxAmount: 0,
                discountAmount: 0,
                discountLabel: '',
                total: 0,
                itemCount: 0,
                isEmpty: true,
              }),
            },
          },
        ],
      });

      const emptyUseCase = TestBed.inject(ProcessCashPaymentUseCase);
      expect(emptyUseCase.quickAmounts()).toEqual([]);
    });

    it('should include rounded amounts for small totals', () => {
      TestBed.resetTestingModule();
      TestBed.configureTestingModule({
        providers: [
          ProcessCashPaymentUseCase,
          { provide: CartService, useValue: mockCartService },
          {
            provide: CalculateCartTotalsUseCase,
            useValue: {
              totals: signal({
                subtotal: 3.5,
                taxRate: 0.0899,
                taxAmount: 0.31,
                discountAmount: 0,
                discountLabel: '',
                total: 3.81,
                itemCount: 1,
                isEmpty: false,
              }),
            },
          },
        ],
      });

      const smallUseCase = TestBed.inject(ProcessCashPaymentUseCase);
      const amounts = smallUseCase.quickAmounts();
      expect(amounts).toContain(3.81); // exact
      expect(amounts).toContain(5); // first denomination >= total
      expect(amounts).toContain(10); // next denomination
    });
  });

  describe('execute', () => {
    it('should return failure result when validation fails', () => {
      useCase.setAmountTendered(10); // insufficient
      const result = useCase.execute();
      expect(result.success).toBe(false);
      expect(result.error).toContain('Insufficient');
      expect(result.transactionId).toBe('');
    });

    it('should return success result for valid payment', () => {
      useCase.setAmountTendered(30);
      const result = useCase.execute();
      expect(result.success).toBe(true);
      expect(result.transactionId).toMatch(/^TXN-CASH-/);
      expect(result.amountDue).toBe(25.99);
      expect(result.amountTendered).toBe(30);
      expect(result.changeAmount).toBe(4.01);
      expect(result.timestamp).toBeInstanceOf(Date);
      expect(result.error).toBeUndefined();
    });

    it('should set processing state on success', () => {
      useCase.setAmountTendered(30);
      useCase.execute();
      expect(useCase.isProcessing()).toBe(true);
    });

    it('should not set processing state on failure', () => {
      useCase.setAmountTendered(10);
      useCase.execute();
      expect(useCase.isProcessing()).toBe(false);
    });

    it('should generate unique transaction IDs', () => {
      useCase.setAmountTendered(30);
      const result1 = useCase.execute();
      useCase.completeProcessing();
      const result2 = useCase.execute();
      expect(result1.transactionId).not.toBe(result2.transactionId);
    });

    it('should handle exact payment with zero change', () => {
      useCase.setAmountTendered(25.99);
      const result = useCase.execute();
      expect(result.success).toBe(true);
      expect(result.changeAmount).toBe(0);
    });
  });

  describe('reset', () => {
    it('should reset amount tendered to zero', () => {
      useCase.setAmountTendered(50);
      useCase.reset();
      expect(useCase.amountTendered()).toBe(0);
    });

    it('should reset processing state', () => {
      useCase.setAmountTendered(30);
      useCase.execute();
      expect(useCase.isProcessing()).toBe(true);
      useCase.reset();
      expect(useCase.isProcessing()).toBe(false);
    });

    it('should reset change amount', () => {
      useCase.setAmountTendered(50);
      expect(useCase.changeAmount()).toBeGreaterThan(0);
      useCase.reset();
      expect(useCase.changeAmount()).toBe(0);
    });
  });

  describe('completeProcessing', () => {
    it('should set processing to false', () => {
      useCase.setAmountTendered(30);
      useCase.execute();
      expect(useCase.isProcessing()).toBe(true);
      useCase.completeProcessing();
      expect(useCase.isProcessing()).toBe(false);
    });
  });

  describe('CASH_DENOMINATIONS', () => {
    it('should contain standard US denominations', () => {
      expect(CASH_DENOMINATIONS).toContain(5);
      expect(CASH_DENOMINATIONS).toContain(10);
      expect(CASH_DENOMINATIONS).toContain(20);
      expect(CASH_DENOMINATIONS).toContain(50);
      expect(CASH_DENOMINATIONS).toContain(100);
    });

    it('should be sorted in ascending order', () => {
      for (let i = 1; i < CASH_DENOMINATIONS.length; i++) {
        expect(CASH_DENOMINATIONS[i]).toBeGreaterThan(CASH_DENOMINATIONS[i - 1]);
      }
    });
  });
});
