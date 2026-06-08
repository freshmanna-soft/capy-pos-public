import { Injectable, inject, signal, computed, Signal } from '@angular/core';
import { CartService } from '../services/cart.service';
import { CalculateCartTotalsUseCase } from './calculate-cart-totals.use-case';

/**
 * Cash Payment Request DTO
 */
export interface CashPaymentRequest {
  amountTendered: number;
}

/**
 * Cash Payment Result DTO
 */
export interface CashPaymentResult {
  success: boolean;
  transactionId: string;
  amountDue: number;
  amountTendered: number;
  changeAmount: number;
  timestamp: Date;
  error?: string;
}

/**
 * Cash Payment Validation Result
 */
export interface CashPaymentValidation {
  isValid: boolean;
  error: string | null;
}

/** Standard cash denominations for quick amount buttons */
export const CASH_DENOMINATIONS = [5, 10, 20, 50, 100] as const;

/**
 * Process Cash Payment Use Case
 *
 * Application layer use case responsible for orchestrating
 * cash payment processing including validation, change calculation,
 * and transaction generation.
 *
 * Follows Clean Architecture: Application layer orchestrates domain logic.
 * Uses Money precision (2 decimal places) for all calculations.
 *
 * @example
 * ```typescript
 * const useCase = inject(ProcessCashPaymentUseCase);
 * useCase.setAmountTendered(50);
 * if (useCase.validation().isValid) {
 *   const result = useCase.execute();
 * }
 * ```
 */
@Injectable({
  providedIn: 'root'
})
export class ProcessCashPaymentUseCase {
  private readonly cartService = inject(CartService);
  private readonly cartTotals = inject(CalculateCartTotalsUseCase);

  /** Amount tendered by the customer */
  private readonly _amountTendered = signal<number>(0);

  /** Whether a payment is currently being processed */
  private readonly _isProcessing = signal<boolean>(false);

  /** Read-only amount tendered */
  readonly amountTendered: Signal<number> = this._amountTendered.asReadonly();

  /** Read-only processing state */
  readonly isProcessing: Signal<boolean> = this._isProcessing.asReadonly();

  /** Amount due (total from cart with discounts) */
  readonly amountDue: Signal<number> = computed(() => {
    return this.cartTotals.totals().total;
  });

  /** Change amount calculation with Money precision */
  readonly changeAmount: Signal<number> = computed(() => {
    const tendered = this._amountTendered();
    const due = this.amountDue();
    const change = tendered - due;
    return Math.round(Math.max(0, change) * 100) / 100;
  });

  /** Validation state - reactive */
  readonly validation: Signal<CashPaymentValidation> = computed(() => {
    const tendered = this._amountTendered();
    const due = this.amountDue();

    if (tendered === 0) {
      return { isValid: false, error: null };
    }

    if (tendered < 0) {
      return { isValid: false, error: 'Amount cannot be negative' };
    }

    if (due <= 0) {
      return { isValid: false, error: 'Cart is empty' };
    }

    if (tendered < due) {
      const shortfall = Math.round((due - tendered) * 100) / 100;
      return {
        isValid: false,
        error: `Insufficient amount. Short by $${shortfall.toFixed(2)}`
      };
    }

    return { isValid: true, error: null };
  });

  /** Quick amount suggestions based on total and standard denominations */
  readonly quickAmounts: Signal<number[]> = computed(() => {
    const due = this.amountDue();
    if (due <= 0) return [];

    const amounts: number[] = [];

    // Add "Exact" amount (the total itself)
    amounts.push(Math.round(due * 100) / 100);

    // Add standard denominations that are >= total
    for (const denom of CASH_DENOMINATIONS) {
      if (denom >= due && !amounts.includes(denom)) {
        amounts.push(denom);
      }
    }

    // If no standard denomination covers it, add next rounded amounts
    if (amounts.length < 4) {
      const nextRound = Math.ceil(due / 10) * 10;
      if (!amounts.includes(nextRound)) {
        amounts.push(nextRound);
      }
      const nextFifty = Math.ceil(due / 50) * 50;
      if (!amounts.includes(nextFifty) && nextFifty !== nextRound) {
        amounts.push(nextFifty);
      }
    }

    return amounts.sort((a, b) => a - b).slice(0, 6);
  });

  /**
   * Sets the amount tendered by the customer
   */
  setAmountTendered(amount: number): void {
    this._amountTendered.set(amount);
  }

  /**
   * Resets the use case state for a new payment
   */
  reset(): void {
    this._amountTendered.set(0);
    this._isProcessing.set(false);
  }

  /**
   * Executes the cash payment processing
   * @returns CashPaymentResult with transaction details
   * @throws Error if validation fails
   */
  execute(): CashPaymentResult {
    const validationResult = this.validation();

    if (!validationResult.isValid) {
      return {
        success: false,
        transactionId: '',
        amountDue: this.amountDue(),
        amountTendered: this._amountTendered(),
        changeAmount: 0,
        timestamp: new Date(),
        error: validationResult.error ?? 'Payment validation failed'
      };
    }

    this._isProcessing.set(true);

    const result: CashPaymentResult = {
      success: true,
      transactionId: this.generateTransactionId(),
      amountDue: this.amountDue(),
      amountTendered: this._amountTendered(),
      changeAmount: this.changeAmount(),
      timestamp: new Date(),
    };

    return result;
  }

  /**
   * Marks processing as complete (called after async operations)
   */
  completeProcessing(): void {
    this._isProcessing.set(false);
  }

  /**
   * Generates a unique transaction ID
   */
  private generateTransactionId(): string {
    const timestamp = Date.now().toString(36);
    const random = Math.random().toString(36).substring(2, 8);
    return `TXN-CASH-${timestamp}-${random}`.toUpperCase();
  }
}
