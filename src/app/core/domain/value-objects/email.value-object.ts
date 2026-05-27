import { BaseValueObject, IValueObject } from './base.value-object';

/**
 * Email Value Object
 * 
 * Represents an email address with validation.
 * Immutable and compared by value.
 * 
 * @example
 * ```typescript
 * const email = new Email('user@example.com');
 * const normalized = email.normalize(); // lowercase
 * const domain = email.getDomain(); // 'example.com'
 * ```
 */
export class Email extends BaseValueObject<Email> implements IValueObject<Email> {
  private readonly _value: string;

  constructor(value: string) {
    super();
    this.validateEmail(value);
    this._value = value.trim().toLowerCase();
    this.freeze();
  }

  /**
   * Get the email address value
   */
  get value(): string {
    return this._value;
  }

  /**
   * Validate email format
   */
  private validateEmail(value: string): void {
    if (!value || typeof value !== 'string') {
      throw new Error('Email must be a non-empty string');
    }

    const trimmed = value.trim();
    if (trimmed.length === 0) {
      throw new Error('Email must be a non-empty string');
    }

    if (trimmed.length > 254) {
      throw new Error('Email cannot exceed 254 characters');
    }

    // RFC 5322 compliant email regex (simplified) - requires at least one dot in domain
    const emailRegex = /^[a-zA-Z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?(?:\.[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)+$/;
    
    if (!emailRegex.test(trimmed)) {
      throw new Error('Invalid email format');
    }
  }

  /**
   * Get the local part of the email (before @)
   */
  getLocalPart(): string {
    return this._value.split('@')[0];
  }

  /**
   * Get the domain part of the email (after @)
   */
  getDomain(): string {
    return this._value.split('@')[1];
  }

  /**
   * Check if email belongs to a specific domain
   */
  hasDomain(domain: string): boolean {
    return this.getDomain().toLowerCase() === domain.toLowerCase();
  }

  /**
   * Get normalized email (already lowercase)
   */
  normalize(): Email {
    return this; // Already normalized in constructor
  }

  /**
   * Check if this email is from a common free email provider
   */
  isFreeEmailProvider(): boolean {
    const freeProviders = [
      'gmail.com',
      'yahoo.com',
      'hotmail.com',
      'outlook.com',
      'aol.com',
      'icloud.com',
      'mail.com',
      'protonmail.com'
    ];
    return freeProviders.includes(this.getDomain());
  }

  /**
   * Compare with another Email
   */
  equals(other: Email): boolean {
    if (!(other instanceof Email)) {
      return false;
    }
    return this._value === other._value;
  }

  /**
   * Convert to JSON representation
   */
  toJSON(): string {
    return this._value;
  }

  /**
   * Convert to string representation
   */
  override toString(): string {
    return this._value;
  }

  /**
   * Create Email from JSON
   */
  static fromJSON(json: string): Email {
    return new Email(json);
  }

  /**
   * Create Email from plain object
   */
  static fromPlain(plain: { value: string }): Email {
    return new Email(plain.value);
  }
}

// Made with Bob
