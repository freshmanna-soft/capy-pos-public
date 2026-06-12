import {
  BaseValueObject,
  INumericValueObject,
  IFormattable,
} from '@core/domain/value-objects/base.value-object';

/**
 * Money Value Object
 * Represents monetary values with currency
 * Extends BaseValueObject and implements INumericValueObject and IFormattable
 * Immutable - all operations return new instances
 * Follows Value Object pattern from DDD
 */
export class Money
  extends BaseValueObject<Money>
  implements INumericValueObject<Money>, IFormattable
{
  private readonly _amount: number;
  private readonly _currency: string;

  constructor(amount: number, currency = 'USD') {
    super();
    this.validateAmount(amount);
    this.validateCurrency(currency);

    // Store as cents/smallest unit to avoid floating point issues
    this._amount = Math.round(amount * 100);
    this._currency = currency.toUpperCase();

    this.freeze(); // Enforce immutability
  }

  /**
   * Get amount in decimal format (e.g., 10.50)
   */
  get amount(): number {
    return this._amount / 100;
  }

  /**
   * Get amount in cents/smallest unit (e.g., 1050)
   */
  get cents(): number {
    return this._amount;
  }

  /**
   * Get currency code
   */
  get currency(): string {
    return this._currency;
  }

  /**
   * Add two Money values
   * @throws Error if currencies don't match
   */
  add(other: Money): Money {
    this.assertSameCurrency(other);
    return new Money((this._amount + other._amount) / 100, this._currency);
  }

  /**
   * Subtract two Money values
   * @throws Error if currencies don't match
   */
  subtract(other: Money): Money {
    this.assertSameCurrency(other);
    return new Money((this._amount - other._amount) / 100, this._currency);
  }

  /**
   * Multiply by a factor
   */
  multiply(factor: number): Money {
    return new Money((this._amount * factor) / 100, this._currency);
  }

  /**
   * Divide by a divisor
   * @throws Error if divisor is zero
   */
  divide(divisor: number): Money {
    if (divisor === 0) {
      throw new Error('Cannot divide by zero');
    }
    return new Money(this._amount / divisor / 100, this._currency);
  }

  /**
   * Calculate percentage
   */
  percentage(percent: number): Money {
    return new Money((this._amount * percent) / 100 / 100, this._currency);
  }

  /**
   * Check if amount is zero
   */
  isZero(): boolean {
    return this._amount === 0;
  }

  /**
   * Check if amount is positive
   */
  isPositive(): boolean {
    return this._amount > 0;
  }

  /**
   * Check if amount is negative
   */
  isNegative(): boolean {
    return this._amount < 0;
  }

  /**
   * Compare with another Money value
   * @returns -1 if less, 0 if equal, 1 if greater
   * @throws Error if currencies don't match
   */
  compare(other: Money): number {
    this.assertSameCurrency(other);
    if (this._amount < other._amount) return -1;
    if (this._amount > other._amount) return 1;
    return 0;
  }

  /**
   * Check if equal to another Money value
   */
  equals(other: Money): boolean {
    return this._amount === other._amount && this._currency === other._currency;
  }

  /**
   * Check if greater than another Money value
   */
  greaterThan(other: Money): boolean {
    return this.compare(other) > 0;
  }

  /**
   * Check if less than another Money value
   */
  lessThan(other: Money): boolean {
    return this.compare(other) < 0;
  }

  /**
   * Get absolute value
   */
  abs(): Money {
    return new Money(Math.abs(this._amount) / 100, this._currency);
  }

  /**
   * Format as string with currency symbol
   */
  format(locale = 'en-US'): string {
    return new Intl.NumberFormat(locale, {
      style: 'currency',
      currency: this._currency,
    }).format(this.amount);
  }

  /**
   * Convert to plain object for serialization
   */
  toJSON(): { amount: number; currency: string } {
    return {
      amount: this.amount,
      currency: this._currency,
    };
  }

  /**
   * Create Money from plain object
   */
  static fromJSON(data: { amount: number; currency: string }): Money {
    return new Money(data.amount, data.currency);
  }

  /**
   * Create zero Money value
   */
  static zero(currency = 'USD'): Money {
    return new Money(0, currency);
  }

  /**
   * Create Money from cents
   */
  static fromCents(cents: number, currency = 'USD'): Money {
    return new Money(cents / 100, currency);
  }

  /**
   * Validate amount
   */
  private validateAmount(amount: number): void {
    if (typeof amount !== 'number' || Number.isNaN(amount)) {
      throw new TypeError('Amount must be a valid number');
    }
    if (!Number.isFinite(amount)) {
      throw new TypeError('Amount must be finite');
    }
  }

  /**
   * Validate currency code
   */
  private validateCurrency(currency: string): void {
    if (!currency || typeof currency !== 'string') {
      throw new Error('Currency must be a valid string');
    }
    if (currency.length !== 3) {
      throw new Error('Currency must be a 3-letter ISO code');
    }
  }

  /**
   * Assert same currency for operations
   */
  private assertSameCurrency(other: Money): void {
    if (this._currency !== other._currency) {
      throw new Error(
        `Cannot operate on different currencies: ${this._currency} and ${other._currency}`
      );
    }
  }

  /**
   * String representation
   */
  override toString(): string {
    return this.format();
  }
}

// Made with Bob
