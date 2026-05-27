import { BaseValueObject, IValueObject } from './base.value-object';

/**
 * Address components interface
 */
export interface AddressComponents {
  street: string;
  city: string;
  state: string;
  postalCode: string;
  country: string;
}

/**
 * Address Value Object
 * 
 * Represents a physical address with validation.
 * Immutable and compared by value.
 * 
 * @example
 * ```typescript
 * const address = new Address({
 *   street: '123 Main St',
 *   city: 'San Francisco',
 *   state: 'CA',
 *   postalCode: '94102',
 *   country: 'USA'
 * });
 * const formatted = address.format(); // Multi-line formatted address
 * const oneLine = address.toOneLine(); // Single line format
 * ```
 */
export class Address extends BaseValueObject<Address> implements IValueObject<Address> {
  private readonly _street: string;
  private readonly _city: string;
  private readonly _state: string;
  private readonly _postalCode: string;
  private readonly _country: string;

  constructor(components: AddressComponents) {
    super();
    this.validateComponents(components);
    
    this._street = components.street.trim();
    this._city = components.city.trim();
    this._state = components.state.trim().toUpperCase();
    this._postalCode = this.normalizePostalCode(components.postalCode);
    this._country = components.country.trim().toUpperCase();
    
    this.freeze();
  }

  /**
   * Get street address
   */
  get street(): string {
    return this._street;
  }

  /**
   * Get city
   */
  get city(): string {
    return this._city;
  }

  /**
   * Get state/province
   */
  get state(): string {
    return this._state;
  }

  /**
   * Get postal/zip code
   */
  get postalCode(): string {
    return this._postalCode;
  }

  /**
   * Get country
   */
  get country(): string {
    return this._country;
  }

  /**
   * Validate address components
   */
  private validateComponents(components: AddressComponents): void {
    if (!components || typeof components !== 'object') {
      throw new Error('Address components must be an object');
    }

    const { street, city, state, postalCode, country } = components;

    // Validate street
    if (!street || typeof street !== 'string' || street.trim().length === 0) {
      throw new Error('Street address is required');
    }
    if (street.trim().length > 200) {
      throw new Error('Street address cannot exceed 200 characters');
    }

    // Validate city
    if (!city || typeof city !== 'string' || city.trim().length === 0) {
      throw new Error('City is required');
    }
    if (city.trim().length > 100) {
      throw new Error('City cannot exceed 100 characters');
    }

    // Validate state
    if (!state || typeof state !== 'string' || state.trim().length === 0) {
      throw new Error('State/Province is required');
    }
    if (state.trim().length > 50) {
      throw new Error('State/Province cannot exceed 50 characters');
    }

    // Validate postal code
    if (!postalCode || typeof postalCode !== 'string' || postalCode.trim().length === 0) {
      throw new Error('Postal code is required');
    }
    if (postalCode.trim().length > 20) {
      throw new Error('Postal code cannot exceed 20 characters');
    }

    // Validate country
    if (!country || typeof country !== 'string' || country.trim().length === 0) {
      throw new Error('Country is required');
    }
    if (country.trim().length > 100) {
      throw new Error('Country cannot exceed 100 characters');
    }
  }

  /**
   * Normalize postal code format
   */
  private normalizePostalCode(postalCode: string): string {
    const trimmed = postalCode.trim().toUpperCase();
    
    // Remove extra spaces
    return trimmed.replace(/\s+/g, ' ');
  }

  /**
   * Check if this is a US address
   */
  isUS(): boolean {
    return this._country === 'USA' || this._country === 'US' || this._country === 'UNITED STATES';
  }

  /**
   * Check if this is a Canadian address
   */
  isCanada(): boolean {
    return this._country === 'CANADA' || this._country === 'CA';
  }

  /**
   * Check if this is a UK address
   */
  isUK(): boolean {
    return this._country === 'UK' || this._country === 'GB' || this._country === 'UNITED KINGDOM';
  }

  /**
   * Check if address is in a specific country
   */
  isInCountry(country: string): boolean {
    return this._country === country.trim().toUpperCase();
  }

  /**
   * Check if address is in a specific state/province
   */
  isInState(state: string): boolean {
    return this._state === state.trim().toUpperCase();
  }

  /**
   * Check if address is in a specific city
   */
  isInCity(city: string): boolean {
    return this._city.toLowerCase() === city.trim().toLowerCase();
  }

  /**
   * Format address for display (multi-line)
   */
  format(): string {
    return `${this._street}\n${this._city}, ${this._state} ${this._postalCode}\n${this._country}`;
  }

  /**
   * Format address as single line
   */
  toOneLine(): string {
    return `${this._street}, ${this._city}, ${this._state} ${this._postalCode}, ${this._country}`;
  }

  /**
   * Get address components as object
   */
  getComponents(): AddressComponents {
    return {
      street: this._street,
      city: this._city,
      state: this._state,
      postalCode: this._postalCode,
      country: this._country
    };
  }

  /**
   * Compare with another Address
   */
  equals(other: Address): boolean {
    if (!(other instanceof Address)) {
      return false;
    }
    return (
      this._street === other._street &&
      this._city === other._city &&
      this._state === other._state &&
      this._postalCode === other._postalCode &&
      this._country === other._country
    );
  }

  /**
   * Convert to JSON representation
   */
  toJSON(): AddressComponents {
    return this.getComponents();
  }

  /**
   * Convert to string representation
   */
  override toString(): string {
    return this.toOneLine();
  }

  /**
   * Create Address from JSON
   */
  static fromJSON(json: AddressComponents): Address {
    return new Address(json);
  }

  /**
   * Create Address from plain object
   */
  static fromPlain(plain: AddressComponents): Address {
    return new Address(plain);
  }

  /**
   * Create US address
   */
  static createUS(street: string, city: string, state: string, zipCode: string): Address {
    return new Address({
      street,
      city,
      state,
      postalCode: zipCode,
      country: 'USA'
    });
  }

  /**
   * Create Canadian address
   */
  static createCanada(street: string, city: string, province: string, postalCode: string): Address {
    return new Address({
      street,
      city,
      state: province,
      postalCode,
      country: 'CANADA'
    });
  }

  /**
   * Create UK address
   */
  static createUK(street: string, city: string, county: string, postcode: string): Address {
    return new Address({
      street,
      city,
      state: county,
      postalCode: postcode,
      country: 'UK'
    });
  }
}

// Made with Bob
