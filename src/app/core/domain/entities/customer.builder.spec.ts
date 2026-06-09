import { describe, it, expect, beforeEach } from 'vitest';
import { CustomerBuilder } from './customer.builder';
import { Customer, CustomerStatus, CustomerTier } from './customer.entity';

describe('CustomerBuilder', () => {
  let builder: CustomerBuilder;

  beforeEach(() => {
    builder = new CustomerBuilder();
  });

  describe('build() with defaults', () => {
    it('should create a Customer with sensible defaults', () => {
      const customer = builder.build();

      expect(customer).toBeInstanceOf(Customer);
      expect(customer.name).toBe('Default Customer');
      expect(customer.email).toBe('default@example.com');
      expect(customer.phone).toBe('+1000000000');
      expect(customer.status).toBe(CustomerStatus.ACTIVE);
      expect(customer.loyaltyPoints).toBe(0);
      expect(customer.tier).toBe(CustomerTier.BRONZE);
      expect(customer.country).toBe('USA');
    });

    it('should generate a UUID for id by default', () => {
      const customer = builder.build();
      expect(customer.id).toBeDefined();
      expect(customer.id.length).toBeGreaterThan(0);
    });

    it('should set createdAt and updatedAt to current time by default', () => {
      const before = new Date();
      const customer = builder.build();
      const after = new Date();

      expect(customer.createdAt.getTime()).toBeGreaterThanOrEqual(before.getTime());
      expect(customer.createdAt.getTime()).toBeLessThanOrEqual(after.getTime());
      expect(customer.updatedAt.getTime()).toBeGreaterThanOrEqual(before.getTime());
      expect(customer.updatedAt.getTime()).toBeLessThanOrEqual(after.getTime());
    });
  });

  describe('Identity & audit fields', () => {
    it('should set id via withId()', () => {
      const customer = builder.withId('cust-123').build();
      expect(customer.id).toBe('cust-123');
    });

    it('should set createdAt via withCreatedAt()', () => {
      const date = new Date('2025-01-15T10:00:00Z');
      const customer = builder.withCreatedAt(date).build();
      expect(customer.createdAt).toEqual(date);
    });

    it('should set updatedAt via withUpdatedAt()', () => {
      const date = new Date('2025-06-01T12:00:00Z');
      const customer = builder.withUpdatedAt(date).build();
      expect(customer.updatedAt).toEqual(date);
    });

    it('should set createdBy via withCreatedBy()', () => {
      const customer = builder.withCreatedBy('admin').build();
      expect(customer.createdBy).toBe('admin');
    });

    it('should set updatedBy via withUpdatedBy()', () => {
      const customer = builder.withUpdatedBy('manager').build();
      expect(customer.updatedBy).toBe('manager');
    });

    it('should set deletedAt via withDeletedAt()', () => {
      const date = new Date('2025-12-31T23:59:59Z');
      const customer = builder.withDeletedAt(date).build();
      expect(customer.deletedAt).toEqual(date);
    });

    it('should set deletedBy via withDeletedBy()', () => {
      const customer = builder.withDeletedBy('system').build();
      expect(customer.deletedBy).toBe('system');
    });
  });

  describe('Customer-specific fields', () => {
    it('should set name via withName()', () => {
      const customer = builder.withName('Jane Smith').build();
      expect(customer.name).toBe('Jane Smith');
    });

    it('should set email via withEmail()', () => {
      const customer = builder.withEmail('jane@company.com').build();
      expect(customer.email).toBe('jane@company.com');
    });

    it('should set phone via withPhone()', () => {
      const customer = builder.withPhone('+1987654321').build();
      expect(customer.phone).toBe('+1987654321');
    });

    it('should set status via withStatus()', () => {
      const customer = builder.withStatus(CustomerStatus.VIP).build();
      expect(customer.status).toBe(CustomerStatus.VIP);
    });

    it('should set loyaltyPoints via withLoyaltyPoints()', () => {
      const customer = builder.withLoyaltyPoints(5000).build();
      expect(customer.loyaltyPoints).toBe(5000);
    });

    it('should set tier via withTier()', () => {
      const customer = builder.withTier(CustomerTier.GOLD).build();
      expect(customer.tier).toBe(CustomerTier.GOLD);
    });

    it('should set address via withAddress()', () => {
      const customer = builder.withAddress('123 Main St').build();
      expect(customer.address).toBe('123 Main St');
    });

    it('should set city via withCity()', () => {
      const customer = builder.withCity('Springfield').build();
      expect(customer.city).toBe('Springfield');
    });

    it('should set state via withState()', () => {
      const customer = builder.withState('IL').build();
      expect(customer.state).toBe('IL');
    });

    it('should set zipCode via withZipCode()', () => {
      const customer = builder.withZipCode('62701').build();
      expect(customer.zipCode).toBe('62701');
    });

    it('should set country via withCountry()', () => {
      const customer = builder.withCountry('Canada').build();
      expect(customer.country).toBe('Canada');
    });

    it('should set dateOfBirth via withDateOfBirth()', () => {
      const dob = new Date('1990-05-15');
      const customer = builder.withDateOfBirth(dob).build();
      expect(customer.dateOfBirth).toEqual(dob);
    });

    it('should set notes via withNotes()', () => {
      const customer = builder.withNotes('VIP customer, prefers email').build();
      expect(customer.notes).toBe('VIP customer, prefers email');
    });
  });

  describe('Fluent API chaining', () => {
    it('should support full method chaining', () => {
      const dob = new Date('1985-03-20');
      const customer = new CustomerBuilder()
        .withId('cust-456')
        .withName('Alice Johnson')
        .withEmail('alice@example.com')
        .withPhone('+1555123456')
        .withStatus(CustomerStatus.VIP)
        .withLoyaltyPoints(12000)
        .withTier(CustomerTier.PLATINUM)
        .withAddress('456 Oak Ave')
        .withCity('Portland')
        .withState('OR')
        .withZipCode('97201')
        .withCountry('USA')
        .withDateOfBirth(dob)
        .withNotes('Platinum member since 2020')
        .withCreatedBy('system')
        .withUpdatedBy('admin')
        .build();

      expect(customer.id).toBe('cust-456');
      expect(customer.name).toBe('Alice Johnson');
      expect(customer.email).toBe('alice@example.com');
      expect(customer.phone).toBe('+1555123456');
      expect(customer.status).toBe(CustomerStatus.VIP);
      expect(customer.loyaltyPoints).toBe(12000);
      expect(customer.tier).toBe(CustomerTier.PLATINUM);
      expect(customer.address).toBe('456 Oak Ave');
      expect(customer.city).toBe('Portland');
      expect(customer.state).toBe('OR');
      expect(customer.zipCode).toBe('97201');
      expect(customer.country).toBe('USA');
      expect(customer.dateOfBirth).toEqual(dob);
      expect(customer.notes).toBe('Platinum member since 2020');
      expect(customer.createdBy).toBe('system');
      expect(customer.updatedBy).toBe('admin');
    });

    it('should allow partial configuration (only required-like fields)', () => {
      const customer = new CustomerBuilder()
        .withName('Bob')
        .withEmail('bob@test.com')
        .withPhone('+1222333444')
        .build();

      expect(customer.name).toBe('Bob');
      expect(customer.email).toBe('bob@test.com');
      expect(customer.phone).toBe('+1222333444');
      expect(customer.status).toBe(CustomerStatus.ACTIVE);
      expect(customer.address).toBeUndefined();
      expect(customer.city).toBeUndefined();
      expect(customer.dateOfBirth).toBeUndefined();
      expect(customer.notes).toBeUndefined();
    });
  });

  describe('Validation delegation', () => {
    it('should throw when name is empty', () => {
      expect(() => builder.withName('').build()).toThrow('Customer name is required');
    });

    it('should throw when email is invalid', () => {
      expect(() => builder.withEmail('not-an-email').build()).toThrow('Valid email is required');
    });

    it('should throw when phone is invalid', () => {
      expect(() => builder.withPhone('123').build()).toThrow('Valid phone number is required');
    });

    it('should throw when loyaltyPoints is negative', () => {
      expect(() => builder.withLoyaltyPoints(-100).build()).toThrow(
        'Loyalty points cannot be negative',
      );
    });
  });

  describe('Entity behavior after build', () => {
    it('should produce a Customer that supports addPoints()', () => {
      const customer = builder
        .withName('Test User')
        .withEmail('test@user.com')
        .withPhone('+1999888777')
        .withLoyaltyPoints(500)
        .build();

      customer.addPoints(600);
      expect(customer.loyaltyPoints).toBe(1100);
      expect(customer.tier).toBe(CustomerTier.SILVER);
    });

    it('should produce a Customer that supports getFullAddress()', () => {
      const customer = builder
        .withAddress('789 Elm St')
        .withCity('Austin')
        .withState('TX')
        .withZipCode('73301')
        .withCountry('USA')
        .build();

      expect(customer.getFullAddress()).toBe('789 Elm St, Austin, TX, 73301, USA');
    });

    it('should produce a Customer that supports clone()', () => {
      const original = builder
        .withId('clone-test')
        .withName('Clone Me')
        .withEmail('clone@test.com')
        .withPhone('+1111222333')
        .build();

      const cloned = original.clone();
      expect(cloned.id).toBe(original.id);
      expect(cloned.name).toBe(original.name);
      expect(cloned).not.toBe(original);
    });
  });

  describe('Multiple builds (builder reuse)', () => {
    it('should produce independent instances on successive builds', () => {
      const baseBuilder = new CustomerBuilder()
        .withName('Shared Name')
        .withEmail('shared@test.com')
        .withPhone('+1444555666');

      const customer1 = baseBuilder.withId('id-1').build();
      const customer2 = baseBuilder.withId('id-2').build();

      expect(customer1.id).toBe('id-1');
      expect(customer2.id).toBe('id-2');
      expect(customer1).not.toBe(customer2);
    });
  });
});
