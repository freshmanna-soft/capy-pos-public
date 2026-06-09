import { AbstractEntityBuilder } from './abstract-entity.builder';
import { ICustomerBuilder } from './customer-builder.interface';
import { Customer, CustomerStatus, CustomerTier } from './customer.entity';

/**
 * CustomerBuilder
 * Concrete builder for constructing Customer entities using a fluent API.
 *
 * Extends AbstractEntityBuilder for common entity fields (id, timestamps, audit)
 * and implements ICustomerBuilder for the customer-specific contract.
 *
 * Usage:
 * ```typescript
 * const customer = new CustomerBuilder()
 *   .withName('John Doe')
 *   .withEmail('john@example.com')
 *   .withPhone('+1234567890')
 *   .withStatus(CustomerStatus.ACTIVE)
 *   .withAddress('123 Main St')
 *   .withCity('Springfield')
 *   .build();
 * ```
 */
export class CustomerBuilder
  extends AbstractEntityBuilder<Customer, CustomerBuilder>
  implements ICustomerBuilder
{
  private _name = 'Default Customer';
  private _email = 'default@example.com';
  private _phone = '+1000000000';
  private _status: CustomerStatus = CustomerStatus.ACTIVE;
  private _loyaltyPoints = 0;
  private _tier: CustomerTier = CustomerTier.BRONZE;
  private _address?: string;
  private _city?: string;
  private _state?: string;
  private _zipCode?: string;
  private _country = 'USA';
  private _dateOfBirth?: Date;
  private _notes?: string;

  withName(name: string): this {
    this._name = name;
    return this;
  }

  withEmail(email: string): this {
    this._email = email;
    return this;
  }

  withPhone(phone: string): this {
    this._phone = phone;
    return this;
  }

  withStatus(status: CustomerStatus): this {
    this._status = status;
    return this;
  }

  withLoyaltyPoints(loyaltyPoints: number): this {
    this._loyaltyPoints = loyaltyPoints;
    return this;
  }

  withTier(tier: CustomerTier): this {
    this._tier = tier;
    return this;
  }

  withAddress(address: string): this {
    this._address = address;
    return this;
  }

  withCity(city: string): this {
    this._city = city;
    return this;
  }

  withState(state: string): this {
    this._state = state;
    return this;
  }

  withZipCode(zipCode: string): this {
    this._zipCode = zipCode;
    return this;
  }

  withCountry(country: string): this {
    this._country = country;
    return this;
  }

  withDateOfBirth(dateOfBirth: Date): this {
    this._dateOfBirth = dateOfBirth;
    return this;
  }

  withNotes(notes: string): this {
    this._notes = notes;
    return this;
  }

  /**
   * Builds and returns the Customer entity.
   * Delegates validation to the Customer constructor.
   */
  build(): Customer {
    return new Customer({
      id: this._id,
      name: this._name,
      email: this._email,
      phone: this._phone,
      status: this._status,
      loyaltyPoints: this._loyaltyPoints,
      tier: this._tier,
      createdAt: this._createdAt,
      updatedAt: this._updatedAt,
      createdBy: this._createdBy,
      updatedBy: this._updatedBy,
      deletedAt: this._deletedAt,
      deletedBy: this._deletedBy,
      address: this._address,
      city: this._city,
      state: this._state,
      zipCode: this._zipCode,
      country: this._country,
      dateOfBirth: this._dateOfBirth,
      notes: this._notes,
    });
  }
}
