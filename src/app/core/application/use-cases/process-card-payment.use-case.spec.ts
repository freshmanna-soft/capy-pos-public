import { TestBed } from '@angular/core/testing';
import { ProcessCardPaymentUseCase } from '@core/application/use-cases/process-card-payment.use-case';
import { CartService } from '@core/application/services/cart.service';
import { CalculateCartTotalsUseCase } from '@core/application/use-cases/calculate-cart-totals.use-case';
import { signal } from '@angular/core';

describe('ProcessCardPaymentUseCase', () => {
  let useCase: ProcessCardPaymentUseCase;
  let mockCartService: Partial<CartService>;
  let mockCartTotals: Partial<CalculateCartTotalsUseCase>;

  // Valid test card numbers (pass Luhn check)
  const VALID_VISA = '4111111111111111';
  const VALID_MASTERCARD = '5500000000000004';
  const VALID_AMEX = '340000000000009';
  const VALID_DISCOVER = '6011000000000004';
  const INVALID_LUHN = '4111111111111112';

  beforeEach(() => {
    mockCartService = {
      subtotal: signal(100),
      total: signal(108.5),
      taxRate: signal(0.085),
      totalItems: signal(3),
      isEmpty: signal(false),
    } as unknown as Partial<CartService>;

    mockCartTotals = {
      totals: signal({
        subtotal: 100,
        taxRate: 0.085,
        taxAmount: 8.5,
        discountAmount: 0,
        discountLabel: '',
        total: 108.5,
        itemCount: 3,
        isEmpty: false,
      }),
    } as unknown as Partial<CalculateCartTotalsUseCase>;

    TestBed.configureTestingModule({
      providers: [
        ProcessCardPaymentUseCase,
        { provide: CartService, useValue: mockCartService },
        { provide: CalculateCartTotalsUseCase, useValue: mockCartTotals },
      ],
    });

    useCase = TestBed.inject(ProcessCardPaymentUseCase);
  });

  describe('Initial State', () => {
    it('should have empty card number initially', () => {
      expect(useCase.cardNumber()).toBe('');
    });

    it('should have empty expiry initially', () => {
      expect(useCase.expiry()).toBe('');
    });

    it('should have empty CVV initially', () => {
      expect(useCase.cvv()).toBe('');
    });

    it('should not be processing initially', () => {
      expect(useCase.isProcessing()).toBe(false);
    });

    it('should have amount to charge from cart totals', () => {
      expect(useCase.amountToCharge()).toBe(108.5);
    });

    it('should have invalid validation initially', () => {
      expect(useCase.validation().isValid).toBe(false);
    });

    it('should have unknown card brand initially', () => {
      expect(useCase.cardBrand()).toBe('unknown');
    });

    it('should have empty last4 initially', () => {
      expect(useCase.last4()).toBe('');
    });
  });

  describe('setCardNumber', () => {
    it('should update card number', () => {
      useCase.setCardNumber(VALID_VISA);
      expect(useCase.cardNumber()).toBe(VALID_VISA);
    });

    it('should update last4 reactively', () => {
      useCase.setCardNumber(VALID_VISA);
      expect(useCase.last4()).toBe('1111');
    });

    it('should detect card brand reactively', () => {
      useCase.setCardNumber(VALID_VISA);
      expect(useCase.cardBrand()).toBe('visa');
    });
  });

  describe('setExpiry', () => {
    it('should update expiry', () => {
      useCase.setExpiry('12/28');
      expect(useCase.expiry()).toBe('12/28');
    });
  });

  describe('setCvv', () => {
    it('should update CVV', () => {
      useCase.setCvv('123');
      expect(useCase.cvv()).toBe('123');
    });
  });

  describe('Card Number Validation', () => {
    it('should be invalid with no error for empty input', () => {
      useCase.setCardNumber('');
      const fields = useCase.fieldValidation();
      expect(fields.cardNumber.isValid).toBe(false);
      expect(fields.cardNumber.error).toBeNull();
    });

    it('should show error for too short number', () => {
      useCase.setCardNumber('411111');
      const fields = useCase.fieldValidation();
      expect(fields.cardNumber.isValid).toBe(false);
      expect(fields.cardNumber.error).toBe('Card number must be 15-19 digits');
    });

    it('should show error for too long number', () => {
      useCase.setCardNumber('41111111111111111111'); // 20 digits
      const fields = useCase.fieldValidation();
      expect(fields.cardNumber.isValid).toBe(false);
      expect(fields.cardNumber.error).toBe('Card number must be 15-19 digits');
    });

    it('should show error for invalid Luhn', () => {
      useCase.setCardNumber(INVALID_LUHN);
      const fields = useCase.fieldValidation();
      expect(fields.cardNumber.isValid).toBe(false);
      expect(fields.cardNumber.error).toBe('Invalid card number');
    });

    it('should be valid for correct Visa number', () => {
      useCase.setCardNumber(VALID_VISA);
      const fields = useCase.fieldValidation();
      expect(fields.cardNumber.isValid).toBe(true);
      expect(fields.cardNumber.error).toBeNull();
    });

    it('should be valid for correct Mastercard number', () => {
      useCase.setCardNumber(VALID_MASTERCARD);
      const fields = useCase.fieldValidation();
      expect(fields.cardNumber.isValid).toBe(true);
    });

    it('should be valid for correct Amex number (15 digits)', () => {
      useCase.setCardNumber(VALID_AMEX);
      const fields = useCase.fieldValidation();
      expect(fields.cardNumber.isValid).toBe(true);
    });

    it('should strip non-digit characters for validation', () => {
      useCase.setCardNumber('4111 1111 1111 1111');
      const fields = useCase.fieldValidation();
      expect(fields.cardNumber.isValid).toBe(true);
    });
  });

  describe('Expiry Validation', () => {
    it('should be invalid with no error for empty input', () => {
      useCase.setExpiry('');
      const fields = useCase.fieldValidation();
      expect(fields.expiry.isValid).toBe(false);
      expect(fields.expiry.error).toBeNull();
    });

    it('should show error for invalid format', () => {
      useCase.setExpiry('1225');
      const fields = useCase.fieldValidation();
      expect(fields.expiry.isValid).toBe(false);
      expect(fields.expiry.error).toBe('Use MM/YY format');
    });

    it('should show error for invalid month (00)', () => {
      useCase.setExpiry('00/28');
      const fields = useCase.fieldValidation();
      expect(fields.expiry.isValid).toBe(false);
      expect(fields.expiry.error).toBe('Invalid month');
    });

    it('should show error for invalid month (13)', () => {
      useCase.setExpiry('13/28');
      const fields = useCase.fieldValidation();
      expect(fields.expiry.isValid).toBe(false);
      expect(fields.expiry.error).toBe('Invalid month');
    });

    it('should show error for expired card', () => {
      useCase.setExpiry('01/20');
      const fields = useCase.fieldValidation();
      expect(fields.expiry.isValid).toBe(false);
      expect(fields.expiry.error).toBe('Card has expired');
    });

    it('should be valid for future date', () => {
      useCase.setExpiry('12/30');
      const fields = useCase.fieldValidation();
      expect(fields.expiry.isValid).toBe(true);
      expect(fields.expiry.error).toBeNull();
    });
  });

  describe('CVV Validation', () => {
    it('should be invalid with no error for empty input', () => {
      useCase.setCvv('');
      const fields = useCase.fieldValidation();
      expect(fields.cvv.isValid).toBe(false);
      expect(fields.cvv.error).toBeNull();
    });

    it('should show error for too short CVV', () => {
      useCase.setCvv('12');
      const fields = useCase.fieldValidation();
      expect(fields.cvv.isValid).toBe(false);
      expect(fields.cvv.error).toBe('CVV must be 3-4 digits');
    });

    it('should show error for too long CVV', () => {
      useCase.setCvv('12345');
      const fields = useCase.fieldValidation();
      expect(fields.cvv.isValid).toBe(false);
      expect(fields.cvv.error).toBe('CVV must be 3-4 digits');
    });

    it('should be valid for 3-digit CVV', () => {
      useCase.setCvv('123');
      const fields = useCase.fieldValidation();
      expect(fields.cvv.isValid).toBe(true);
      expect(fields.cvv.error).toBeNull();
    });

    it('should be valid for 4-digit CVV (Amex)', () => {
      useCase.setCvv('1234');
      const fields = useCase.fieldValidation();
      expect(fields.cvv.isValid).toBe(true);
      expect(fields.cvv.error).toBeNull();
    });
  });

  describe('Card Brand Detection', () => {
    it('should detect Visa', () => {
      useCase.setCardNumber(VALID_VISA);
      expect(useCase.cardBrand()).toBe('visa');
    });

    it('should detect Mastercard', () => {
      useCase.setCardNumber(VALID_MASTERCARD);
      expect(useCase.cardBrand()).toBe('mastercard');
    });

    it('should detect Amex', () => {
      useCase.setCardNumber(VALID_AMEX);
      expect(useCase.cardBrand()).toBe('amex');
    });

    it('should detect Discover', () => {
      useCase.setCardNumber(VALID_DISCOVER);
      expect(useCase.cardBrand()).toBe('discover');
    });

    it('should return unknown for unrecognized prefix', () => {
      useCase.setCardNumber('9999999999999999');
      expect(useCase.cardBrand()).toBe('unknown');
    });
  });

  describe('Overall Validation', () => {
    it('should be invalid when any field is invalid', () => {
      useCase.setCardNumber(VALID_VISA);
      useCase.setExpiry('12/30');
      // CVV not set
      expect(useCase.validation().isValid).toBe(false);
    });

    it('should be valid when all fields are valid', () => {
      useCase.setCardNumber(VALID_VISA);
      useCase.setExpiry('12/30');
      useCase.setCvv('123');
      expect(useCase.validation().isValid).toBe(true);
    });
  });

  describe('execute', () => {
    it('should return failure when validation fails', () => {
      useCase.setCardNumber(INVALID_LUHN);
      useCase.setExpiry('12/30');
      useCase.setCvv('123');
      const result = useCase.execute();
      expect(result.success).toBe(false);
      expect(result.error).toBe('Invalid card number');
      expect(result.transactionId).toBe('');
    });

    it('should return success for valid card details', () => {
      useCase.setCardNumber(VALID_VISA);
      useCase.setExpiry('12/30');
      useCase.setCvv('123');
      const result = useCase.execute();
      expect(result.success).toBe(true);
      expect(result.transactionId).toMatch(/^TXN-CARD-/);
      expect(result.amount).toBe(108.5);
      expect(result.last4).toBe('1111');
      expect(result.cardBrand).toBe('visa');
      expect(result.timestamp).toBeInstanceOf(Date);
      expect(result.error).toBeUndefined();
    });

    it('should set processing state on success', () => {
      useCase.setCardNumber(VALID_VISA);
      useCase.setExpiry('12/30');
      useCase.setCvv('123');
      useCase.execute();
      expect(useCase.isProcessing()).toBe(true);
    });

    it('should not set processing state on failure', () => {
      useCase.setCardNumber(INVALID_LUHN);
      useCase.setExpiry('12/30');
      useCase.setCvv('123');
      useCase.execute();
      expect(useCase.isProcessing()).toBe(false);
    });

    it('should generate unique transaction IDs', () => {
      useCase.setCardNumber(VALID_VISA);
      useCase.setExpiry('12/30');
      useCase.setCvv('123');
      const result1 = useCase.execute();
      useCase.completeProcessing();
      const result2 = useCase.execute();
      expect(result1.transactionId).not.toBe(result2.transactionId);
    });
  });

  describe('reset', () => {
    it('should reset all fields', () => {
      useCase.setCardNumber(VALID_VISA);
      useCase.setExpiry('12/30');
      useCase.setCvv('123');
      useCase.reset();
      expect(useCase.cardNumber()).toBe('');
      expect(useCase.expiry()).toBe('');
      expect(useCase.cvv()).toBe('');
    });

    it('should reset processing state', () => {
      useCase.setCardNumber(VALID_VISA);
      useCase.setExpiry('12/30');
      useCase.setCvv('123');
      useCase.execute();
      useCase.reset();
      expect(useCase.isProcessing()).toBe(false);
    });

    it('should reset validation to initial state', () => {
      useCase.setCardNumber(VALID_VISA);
      useCase.setExpiry('12/30');
      useCase.setCvv('123');
      expect(useCase.validation().isValid).toBe(true);
      useCase.reset();
      expect(useCase.validation().isValid).toBe(false);
    });
  });

  describe('completeProcessing', () => {
    it('should set processing to false', () => {
      useCase.setCardNumber(VALID_VISA);
      useCase.setExpiry('12/30');
      useCase.setCvv('123');
      useCase.execute();
      expect(useCase.isProcessing()).toBe(true);
      useCase.completeProcessing();
      expect(useCase.isProcessing()).toBe(false);
    });
  });
});
