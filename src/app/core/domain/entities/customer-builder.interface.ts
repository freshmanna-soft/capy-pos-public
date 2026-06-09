import { IBuilder } from './builder.interface';
import { Customer, CustomerStatus, CustomerTier } from './customer.entity';

/**
 * ICustomerBuilder Interface
 * Defines the contract for building Customer entities.
 * Extends IBuilder<Customer> with customer-specific fluent methods.
 *
 * This allows consumers to depend on the interface rather than
 * the concrete CustomerBuilder, enabling substitution and testing.
 */
export interface ICustomerBuilder extends IBuilder<Customer> {
  // Identity & audit (inherited concept from AbstractEntityBuilder)
  withId(id: string): ICustomerBuilder;
  withCreatedAt(createdAt: Date): ICustomerBuilder;
  withUpdatedAt(updatedAt: Date): ICustomerBuilder;
  withCreatedBy(createdBy: string): ICustomerBuilder;
  withUpdatedBy(updatedBy: string): ICustomerBuilder;
  withDeletedAt(deletedAt: Date): ICustomerBuilder;
  withDeletedBy(deletedBy: string): ICustomerBuilder;

  // Customer-specific fields
  withName(name: string): ICustomerBuilder;
  withEmail(email: string): ICustomerBuilder;
  withPhone(phone: string): ICustomerBuilder;
  withStatus(status: CustomerStatus): ICustomerBuilder;
  withLoyaltyPoints(loyaltyPoints: number): ICustomerBuilder;
  withTier(tier: CustomerTier): ICustomerBuilder;
  withAddress(address: string): ICustomerBuilder;
  withCity(city: string): ICustomerBuilder;
  withState(state: string): ICustomerBuilder;
  withZipCode(zipCode: string): ICustomerBuilder;
  withCountry(country: string): ICustomerBuilder;
  withDateOfBirth(dateOfBirth: Date): ICustomerBuilder;
  withNotes(notes: string): ICustomerBuilder;
}
