import { Injectable, inject, signal, computed, Signal } from '@angular/core';
import { CartService } from '@core/application/services/cart.service';
import { CalculateCartTotalsUseCase } from '@core/application/use-cases/calculate-cart-totals.use-case';

/**
 * Card Payment Request DTO
 */
export interface CardPaymentRequest {
  cardNumber: string;
  expiry: string;
  cvv: string;
}

/**
 * Card Payment Result DTO
 */
export interface CardPaymentResult {
  success: boolean;
  transactionId: string;
  amount: number;
  last4: string;
  cardBrand: CardBrand;
  timestamp: Date;
  error?: string;
}

/**
 * Card field validation state
 */
export interface CardFieldValidation {
  cardNumber: { isValid: boolean; error: string | null };
  expiry: { isValid: boolean; error: string | null };
  cvv: { isValid: boolean; error: string | null };
}

/**
 * Overall card validation state
 */
export interface CardValidation {
  isValid: boolean;
  fields: CardFieldValidation;
}

/** Supported card brands */
export type CardBrand = 'visa' | 'mastercard' | 'amex' | 'discover' | 'unknown';

/**
 * Process Card Payment Use Case
 *
 * Application layer use case responsible for orchestrating
 * card payment processing including field validation,
 * Luhn check, expiry validation, and transaction generation.
 *
 * Follows Clean Architecture: Application layer orchestrates domain logic.
 *
 * @example
 * ```typescript
 * const useCase = inject(ProcessCardPaymentUseCase);
 * useCase.setCardNumber('4111111111111111');
 * useCase.setExpiry('12/25');
 * useCase.setCvv('123');
 * if (useCase.validation().isValid) {
 *   const result = useCase.execute();
 * }
 * ```
 */
@Injectable({
  providedIn: 'root',
})
export class ProcessCardPaymentUseCase {
  private readonly cartService = inject(CartService);
  private readonly cartTotals = inject(CalculateCartTotalsUseCase);

  /** Card number input */
  private readonly _cardNumber = signal<string>('');

  /** Expiry input (MM/YY) */
  private readonly _expiry = signal<string>('');

  /** CVV input */
  private readonly _cvv = signal<string>('');

  /** Whether a payment is currently being processed */
  private readonly _isProcessing = signal<boolean>(false);

  /** Read-only card number */
  readonly cardNumber: Signal<string> = this._cardNumber.asReadonly();

  /** Read-only expiry */
  readonly expiry: Signal<string> = this._expiry.asReadonly();

  /** Read-only CVV */
  readonly cvv: Signal<string> = this._cvv.asReadonly();

  /** Read-only processing state */
  readonly isProcessing: Signal<boolean> = this._isProcessing.asReadonly();

  /** Amount to charge (total from cart) */
  readonly amountToCharge: Signal<number> = computed(() => {
    return this.cartTotals.totals().total;
  });

  /** Detected card brand based on number prefix */
  readonly cardBrand: Signal<CardBrand> = computed(() => {
    return this.detectCardBrand(this._cardNumber());
  });

  /** Last 4 digits of card number */
  readonly last4: Signal<string> = computed(() => {
    const digits = this._cardNumber().replace(/\D/g, '');
    return digits.length >= 4 ? digits.slice(-4) : '';
  });

  /** Per-field validation state - reactive */
  readonly fieldValidation: Signal<CardFieldValidation> = computed(() => {
    return {
      cardNumber: this.validateCardNumber(this._cardNumber()),
      expiry: this.validateExpiry(this._expiry()),
      cvv: this.validateCvv(this._cvv()),
    };
  });

  /** Overall validation state - reactive */
  readonly validation: Signal<CardValidation> = computed(() => {
    const fields = this.fieldValidation();
    const isValid = fields.cardNumber.isValid && fields.expiry.isValid && fields.cvv.isValid;
    return { isValid, fields };
  });

  /**
   * Sets the card number
   */
  setCardNumber(value: string): void {
    this._cardNumber.set(value);
  }

  /**
   * Sets the expiry date
   */
  setExpiry(value: string): void {
    this._expiry.set(value);
  }

  /**
   * Sets the CVV
   */
  setCvv(value: string): void {
    this._cvv.set(value);
  }

  /**
   * Resets the use case state for a new payment
   */
  reset(): void {
    this._cardNumber.set('');
    this._expiry.set('');
    this._cvv.set('');
    this._isProcessing.set(false);
  }

  /**
   * Executes the card payment processing
   * @returns CardPaymentResult with transaction details
   */
  execute(): CardPaymentResult {
    const validationResult = this.validation();

    if (!validationResult.isValid) {
      const firstError = this.getFirstError(validationResult.fields);
      return {
        success: false,
        transactionId: '',
        amount: this.amountToCharge(),
        last4: this.last4(),
        cardBrand: this.cardBrand(),
        timestamp: new Date(),
        error: firstError ?? 'Card validation failed',
      };
    }

    this._isProcessing.set(true);

    return {
      success: true,
      transactionId: this.generateTransactionId(),
      amount: this.amountToCharge(),
      last4: this.last4(),
      cardBrand: this.cardBrand(),
      timestamp: new Date(),
    };
  }

  /**
   * Marks processing as complete
   */
  completeProcessing(): void {
    this._isProcessing.set(false);
  }

  // --- Private validation methods ---

  private validateCardNumber(value: string): { isValid: boolean; error: string | null } {
    const digits = value.replace(/\D/g, '');

    if (digits.length === 0) {
      return { isValid: false, error: null };
    }

    if (digits.length < 15 || digits.length > 19) {
      return { isValid: false, error: 'Card number must be 15-19 digits' };
    }

    if (!this.luhnCheck(digits)) {
      return { isValid: false, error: 'Invalid card number' };
    }

    return { isValid: true, error: null };
  }

  private validateExpiry(value: string): { isValid: boolean; error: string | null } {
    if (value.length === 0) {
      return { isValid: false, error: null };
    }

    const match = value.match(/^(\d{2})\/(\d{2})$/);
    if (!match) {
      return { isValid: false, error: 'Use MM/YY format' };
    }

    const month = parseInt(match[1], 10);
    const year = parseInt(match[2], 10) + 2000;

    if (month < 1 || month > 12) {
      return { isValid: false, error: 'Invalid month' };
    }

    const now = new Date();
    const currentMonth = now.getMonth() + 1;
    const currentYear = now.getFullYear();

    if (year < currentYear || (year === currentYear && month < currentMonth)) {
      return { isValid: false, error: 'Card has expired' };
    }

    return { isValid: true, error: null };
  }

  private validateCvv(value: string): { isValid: boolean; error: string | null } {
    if (value.length === 0) {
      return { isValid: false, error: null };
    }

    const digits = value.replace(/\D/g, '');

    if (digits.length < 3 || digits.length > 4) {
      return { isValid: false, error: 'CVV must be 3-4 digits' };
    }

    return { isValid: true, error: null };
  }

  /**
   * Luhn algorithm for card number validation
   */
  private luhnCheck(digits: string): boolean {
    let sum = 0;
    let alternate = false;

    for (let i = digits.length - 1; i >= 0; i--) {
      let n = parseInt(digits[i], 10);
      if (alternate) {
        n *= 2;
        if (n > 9) {
          n -= 9;
        }
      }
      sum += n;
      alternate = !alternate;
    }

    return sum % 10 === 0;
  }

  /**
   * Detects card brand from number prefix
   */
  private detectCardBrand(value: string): CardBrand {
    const digits = value.replace(/\D/g, '');
    if (digits.startsWith('4')) return 'visa';
    if (/^5[1-5]/.test(digits) || /^2[2-7]/.test(digits)) return 'mastercard';
    if (digits.startsWith('34') || digits.startsWith('37')) return 'amex';
    if (digits.startsWith('6011') || digits.startsWith('65')) return 'discover';
    return 'unknown';
  }

  private getFirstError(fields: CardFieldValidation): string | null {
    if (fields.cardNumber.error) return fields.cardNumber.error;
    if (fields.expiry.error) return fields.expiry.error;
    if (fields.cvv.error) return fields.cvv.error;
    return null;
  }

  private generateTransactionId(): string {
    const timestamp = Date.now().toString(36);
    const random = Math.random().toString(36).substring(2, 8);
    return `TXN-CARD-${timestamp}-${random}`.toUpperCase();
  }
}
