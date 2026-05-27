import { BaseValueObject, IValueObject } from './base.value-object';

/**
 * Phone Number Value Object
 * 
 * Represents a phone number with validation and formatting.
 * Supports international formats with country codes.
 * Immutable and compared by value.
 * 
 * @example
 * ```typescript
 * const phone = new Phone('+1-555-123-4567');
 * const formatted = phone.format(); // '+1 (555) 123-4567'
 * const digits = phone.getDigitsOnly(); // '15551234567'
 * ```
 */
export class Phone extends BaseValueObject<Phone> implements IValueObject<Phone> {
  private readonly _value: string;
  private readonly _countryCode: string;
  private readonly _number: string;

  constructor(value: string) {
    super();
    this.validatePhone(value);
    
    const normalized = this.normalizePhone(value);
    this._value = normalized;
    
    // Extract country code and number
    const parsed = this.parsePhone(normalized);
    this._countryCode = parsed.countryCode;
    this._number = parsed.number;
    
    this.freeze();
  }

  /**
   * Get the full phone number value
   */
  get value(): string {
    return this._value;
  }

  /**
   * Get the country code (e.g., '+1', '+44')
   */
  get countryCode(): string {
    return this._countryCode;
  }

  /**
   * Get the phone number without country code
   */
  get number(): string {
    return this._number;
  }

  /**
   * Validate phone number format
   */
  private validatePhone(value: string): void {
    if (!value || typeof value !== 'string') {
      throw new Error('Phone number must be a non-empty string');
    }

    const trimmed = value.trim();
    if (trimmed.length === 0) {
      throw new Error('Phone number cannot be empty');
    }

    // Remove all non-digit characters except + at the start
    const digitsOnly = trimmed.replace(/[^\d+]/g, '');
    
    // Must have at least 10 digits (minimum for most countries)
    const digitCount = digitsOnly.replace(/\+/g, '').length;
    if (digitCount < 10) {
      throw new Error('Phone number must have at least 10 digits');
    }

    if (digitCount > 15) {
      throw new Error('Phone number cannot exceed 15 digits');
    }

    // If starts with +, must be followed by digits
    if (digitsOnly.startsWith('+') && digitsOnly.length < 11) {
      throw new Error('International phone number must include country code and number');
    }
  }

  /**
   * Normalize phone number to consistent format
   */
  private normalizePhone(value: string): string {
    // Remove all whitespace and special characters except + at start
    let normalized = value.trim().replace(/[\s\-\(\)\.]/g, '');
    
    // Ensure + is only at the start
    if (normalized.includes('+')) {
      const plusCount = (normalized.match(/\+/g) || []).length;
      if (plusCount > 1) {
        throw new Error('Phone number can only have one + symbol at the start');
      }
      if (!normalized.startsWith('+')) {
        throw new Error('+ symbol must be at the start of the phone number');
      }
    }
    
    // If no country code, assume US (+1)
    if (!normalized.startsWith('+')) {
      normalized = '+1' + normalized;
    }
    
    return normalized;
  }

  /**
   * Parse phone number into country code and number
   */
  private parsePhone(normalized: string): { countryCode: string; number: string } {
    // Extract country code - try to match known patterns
    // US/Canada: +1 (1 digit)
    // Most countries: +XX (2 digits)
    // Some countries: +XXX (3 digits)
    
    // Try 1-digit country code first (US/Canada)
    if (normalized.startsWith('+1') && normalized.length >= 12) {
      return {
        countryCode: '+1',
        number: normalized.substring(2)
      };
    }
    
    // Try 2-digit country code
    if (normalized.length >= 12) {
      const twoDigitCode = normalized.substring(0, 3); // +XX
      return {
        countryCode: twoDigitCode,
        number: normalized.substring(3)
      };
    }
    
    // Try 3-digit country code
    if (normalized.length >= 13) {
      const threeDigitCode = normalized.substring(0, 4); // +XXX
      return {
        countryCode: threeDigitCode,
        number: normalized.substring(4)
      };
    }
    
    // Fallback: assume 1-digit country code
    return {
      countryCode: normalized.substring(0, 2),
      number: normalized.substring(2)
    };
  }

  /**
   * Get only the digits (no + or formatting)
   */
  getDigitsOnly(): string {
    return this._value.replace(/\+/g, '');
  }

  /**
   * Format phone number for display
   * US format: +1 (555) 123-4567
   * International: +44 20 1234 5678
   */
  format(): string {
    if (this._countryCode === '+1' && this._number.length === 10) {
      // US format
      const areaCode = this._number.substring(0, 3);
      const prefix = this._number.substring(3, 6);
      const lineNumber = this._number.substring(6);
      return `${this._countryCode} (${areaCode}) ${prefix}-${lineNumber}`;
    }
    
    // International format - add spaces every 4 digits
    const formatted = this._number.match(/.{1,4}/g)?.join(' ') || this._number;
    return `${this._countryCode} ${formatted}`;
  }

  /**
   * Check if this is a US phone number
   */
  isUS(): boolean {
    return this._countryCode === '+1';
  }

  /**
   * Check if this is a UK phone number
   */
  isUK(): boolean {
    return this._countryCode === '+44';
  }

  /**
   * Check if phone number belongs to a specific country code
   */
  hasCountryCode(code: string): boolean {
    const normalized = code.startsWith('+') ? code : `+${code}`;
    return this._countryCode === normalized;
  }

  /**
   * Get area code (for US numbers)
   */
  getAreaCode(): string | null {
    if (this.isUS() && this._number.length === 10) {
      return this._number.substring(0, 3);
    }
    return null;
  }

  /**
   * Compare with another Phone
   */
  equals(other: Phone): boolean {
    if (!(other instanceof Phone)) {
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
    return this.format();
  }

  /**
   * Create Phone from JSON
   */
  static fromJSON(json: string): Phone {
    return new Phone(json);
  }

  /**
   * Create Phone from plain object
   */
  static fromPlain(plain: { value: string }): Phone {
    return new Phone(plain.value);
  }

  /**
   * Create US phone number
   */
  static createUS(areaCode: string, prefix: string, lineNumber: string): Phone {
    return new Phone(`+1${areaCode}${prefix}${lineNumber}`);
  }
}

// Made with Bob
