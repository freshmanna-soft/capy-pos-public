/**
 * Base Value Object Interface
 * Defines common behavior for all value objects
 * Value objects are immutable and compared by value, not identity
 */
export interface IValueObject<T> {
  /**
   * Check equality with another value object
   */
  equals(other: T): boolean;

  /**
   * Convert to plain object for serialization
   */
  toJSON(): any;

  /**
   * String representation
   */
  toString(): string;
}

/**
 * Abstract Base Value Object
 * Provides common functionality for all value objects
 * Enforces immutability and value-based equality
 */
export abstract class BaseValueObject<T> implements IValueObject<T> {
  /**
   * Check equality with another value object
   * Must be implemented by concrete classes
   */
  abstract equals(other: T): boolean;

  /**
   * Convert to plain object for serialization
   * Must be implemented by concrete classes
   */
  abstract toJSON(): any;

  /**
   * String representation
   * Can be overridden by concrete classes
   */
  toString(): string {
    return JSON.stringify(this.toJSON());
  }

  /**
   * Validate value object state
   * Can be overridden by concrete classes
   */
  protected validate(): void {
    // Default: no validation
  }

  /**
   * Deep freeze object to enforce immutability
   */
  protected freeze(): void {
    Object.freeze(this);
  }
}

/**
 * Interface for comparable value objects
 */
export interface IComparable<T> {
  /**
   * Compare with another value
   * @returns -1 if less, 0 if equal, 1 if greater
   */
  compare(other: T): number;

  /**
   * Check if greater than another value
   */
  greaterThan(other: T): boolean;

  /**
   * Check if less than another value
   */
  lessThan(other: T): boolean;
}

/**
 * Interface for numeric value objects
 */
export interface INumericValueObject<T> extends IComparable<T> {
  /**
   * Add two values
   */
  add(other: T): T;

  /**
   * Subtract two values
   */
  subtract(other: T): T;

  /**
   * Check if zero
   */
  isZero(): boolean;

  /**
   * Check if positive
   */
  isPositive(): boolean;

  /**
   * Check if negative
   */
  isNegative(): boolean;
}

/**
 * Interface for formattable value objects
 */
export interface IFormattable {
  /**
   * Format as string
   */
  format(locale?: string): string;
}

// Made with Bob