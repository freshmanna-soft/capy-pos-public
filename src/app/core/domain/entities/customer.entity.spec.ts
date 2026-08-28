import { describe, it, expect, beforeEach } from 'vitest';
import { Customer, CustomerStatus, CustomerTier } from '@core/domain/entities/customer.entity';

describe('Customer Entity', () => {
  let customer: Customer;
  const testId = 'customer-123';
  const testName = 'John Doe';
  const testEmail = 'john.doe@example.com';
  const testPhone = '+1-555-0123';

  beforeEach(() => {
    customer = new Customer({ id: testId, name: testName, email: testEmail, phone: testPhone });
  });

  describe('Creation & Validation', () => {
    it('should create valid customer', () => {
      expect(customer.id).toBe(testId);
      expect(customer.name).toBe(testName);
      expect(customer.email).toBe(testEmail);
      expect(customer.phone).toBe(testPhone);
      expect(customer.status).toBe(CustomerStatus.ACTIVE);
      expect(customer.loyaltyPoints).toBe(0);
      expect(customer.tier).toBe(CustomerTier.BRONZE);
    });

    it.each([
      ['empty name', '', testEmail, testPhone, 'Customer name is required'],
      ['invalid email', testName, 'invalid-email', testPhone, 'Valid email is required'],
      ['invalid phone', testName, testEmail, '123', 'Valid phone number is required'],
    ])('should throw error for %s', (_, name, email, phone, expectedError) => {
      expect(() => new Customer({ id: testId, name, email, phone })).toThrow(expectedError);
    });

    it('should throw error for negative loyalty points', () => {
      expect(
        () =>
          new Customer({
            id: testId,
            name: testName,
            email: testEmail,
            phone: testPhone,
            status: CustomerStatus.ACTIVE,
            loyaltyPoints: -100,
          })
      ).toThrow('Loyalty points cannot be negative');
    });
  });

  describe('Loyalty Program', () => {
    it.each([
      ['add points', 100, 100, CustomerTier.BRONZE],
      ['reach silver', 1500, 1500, CustomerTier.SILVER],
      ['reach gold', 6000, 6000, CustomerTier.GOLD],
      ['reach platinum', 12000, 12000, CustomerTier.PLATINUM],
    ])('should %s', (_, points, expectedPoints, expectedTier) => {
      customer.addPoints(points, 'user-1');
      expect(customer.loyaltyPoints).toBe(expectedPoints);
      expect(customer.tier).toBe(expectedTier);
    });

    it('should add multiple point transactions', () => {
      customer.addPoints(500);
      customer.addPoints(700);
      expect(customer.loyaltyPoints).toBe(1200);
      expect(customer.tier).toBe(CustomerTier.SILVER);
    });

    it('should redeem points', () => {
      customer.addPoints(1000);
      customer.redeemPoints(300, 'user-1');
      expect(customer.loyaltyPoints).toBe(700);
    });

    it.each([
      ['zero points', 0, 'Points to add must be greater than 0'],
      ['negative points', -50, 'Points to add must be greater than 0'],
    ])('should throw error when adding %s', (_, points, expectedError) => {
      expect(() => customer.addPoints(points)).toThrow(expectedError);
    });

    it.each([
      ['zero points', 0, 'Points to redeem must be greater than 0'],
      ['negative points', -50, 'Points to redeem must be greater than 0'],
      ['insufficient points', 1000, 'Insufficient loyalty points'],
    ])('should throw error when redeeming %s', (_, points, expectedError) => {
      expect(() => customer.redeemPoints(points)).toThrow(expectedError);
    });

    it('should not allow points operations for blocked customer', () => {
      customer.addPoints(100); // Add points first
      customer.block('Fraud', 'admin');
      expect(() => customer.addPoints(100)).toThrow('Cannot add points to blocked customer');
      expect(() => customer.redeemPoints(50)).toThrow('Cannot redeem points for blocked customer');
    });

    it('should recalculate tier after redemption', () => {
      customer.addPoints(6000); // Gold tier
      expect(customer.tier).toBe(CustomerTier.GOLD);
      customer.redeemPoints(2000); // Back to Silver
      expect(customer.tier).toBe(CustomerTier.SILVER);
    });
  });

  describe('Status Management', () => {
    it.each([
      ['activate', (c: Customer) => c.activate('user-1'), CustomerStatus.ACTIVE],
      ['deactivate', (c: Customer) => c.deactivate('user-1'), CustomerStatus.INACTIVE],
      ['block', (c: Customer) => c.block('Test', 'user-1'), CustomerStatus.BLOCKED],
      ['promote to VIP', (c: Customer) => c.promoteToVIP('user-1'), CustomerStatus.VIP],
    ])('should %s customer', (_, action, expectedStatus) => {
      if (expectedStatus === CustomerStatus.INACTIVE) {
        // Start from active to deactivate
        action(customer);
      } else if (expectedStatus === CustomerStatus.ACTIVE) {
        // Start from inactive to activate
        customer.deactivate();
        action(customer);
      } else {
        action(customer);
      }
      expect(customer.status).toBe(expectedStatus);
    });

    it('should throw error when activating already active customer', () => {
      expect(() => customer.activate()).toThrow('Customer is already active');
    });

    it('should throw error when deactivating already inactive customer', () => {
      customer.deactivate();
      expect(() => customer.deactivate()).toThrow('Customer is already inactive');
    });

    it('should throw error when blocking already blocked customer', () => {
      customer.block('Test');
      expect(() => customer.block('Test')).toThrow('Customer is already blocked');
    });

    it('should throw error when promoting already VIP customer', () => {
      customer.promoteToVIP();
      expect(() => customer.promoteToVIP()).toThrow('Customer is already VIP');
    });
  });

  describe('Status Checks', () => {
    it.each([
      [CustomerStatus.ACTIVE, { isActive: true, isVIP: false, isBlocked: false }],
      [CustomerStatus.VIP, { isActive: true, isVIP: true, isBlocked: false }],
      [CustomerStatus.INACTIVE, { isActive: false, isVIP: false, isBlocked: false }],
      [CustomerStatus.BLOCKED, { isActive: false, isVIP: false, isBlocked: true }],
    ])('should check %s status', (status, expected) => {
      if (status === CustomerStatus.INACTIVE) customer.deactivate();
      if (status === CustomerStatus.BLOCKED) customer.block('Test');
      if (status === CustomerStatus.VIP) customer.promoteToVIP();

      expect(customer.isActive()).toBe(expected.isActive);
      expect(customer.isVIP()).toBe(expected.isVIP);
      expect(customer.isBlocked()).toBe(expected.isBlocked);
    });
  });

  describe('Profile Management', () => {
    it('should update profile', () => {
      customer.updateProfile(
        {
          name: 'Jane Doe',
          email: 'jane.doe@example.com',
          phone: '+1-555-9999',
          address: '123 Main St',
          city: 'New York',
          state: 'NY',
          zipCode: '10001',
        },
        'user-1'
      );

      expect(customer.name).toBe('Jane Doe');
      expect(customer.email).toBe('jane.doe@example.com');
      expect(customer.phone).toBe('+1-555-9999');
      expect(customer.address).toBe('123 Main St');
      expect(customer.city).toBe('New York');
      expect(customer.state).toBe('NY');
      expect(customer.zipCode).toBe('10001');
      expect(customer.updatedBy).toBe('user-1');
    });

    it('should update partial profile', () => {
      customer.updateProfile({ address: '456 Oak Ave' });
      expect(customer.name).toBe(testName); // Unchanged
      expect(customer.address).toBe('456 Oak Ave');
    });

    it('should validate after profile update', () => {
      expect(() =>
        customer.updateProfile({ name: '', email: 'valid@email.com', phone: '+1-555-0000' })
      ).toThrow('Customer name is required');
    });
  });

  describe('Address & Demographics', () => {
    it('should get full address', () => {
      const customerWithAddress = new Customer({
        id: testId,
        name: testName,
        email: testEmail,
        phone: testPhone,
        status: CustomerStatus.ACTIVE,
        loyaltyPoints: 0,
        tier: CustomerTier.BRONZE,
        address: '123 Main St',
        city: 'New York',
        state: 'NY',
        zipCode: '10001',
        country: 'USA',
      });

      expect(customerWithAddress.getFullAddress()).toBe('123 Main St, New York, NY, 10001, USA');
    });

    it('should return undefined for missing address', () => {
      expect(customer.getFullAddress()).toBeUndefined();
    });

    it('should calculate customer age', () => {
      const birthDate = new Date('1990-01-15');
      const customerWithDOB = new Customer({
        id: testId,
        name: testName,
        email: testEmail,
        phone: testPhone,
        status: CustomerStatus.ACTIVE,
        loyaltyPoints: 0,
        tier: CustomerTier.BRONZE,
        country: 'USA',
        dateOfBirth: birthDate,
      });

      const age = customerWithDOB.getCustomerAge();
      expect(age).toBeGreaterThan(30);
      expect(age).toBeLessThan(40);
    });

    it('should return undefined for missing date of birth', () => {
      expect(customer.getCustomerAge()).toBeUndefined();
    });
  });

  describe('Soft Delete', () => {
    it('should soft delete customer', () => {
      customer.softDelete('admin');
      expect(customer.isDeleted).toBe(true);
      expect(customer.deletedBy).toBe('admin');
      expect(customer.deletedAt).toBeInstanceOf(Date);
    });

    it('should restore soft deleted customer', () => {
      customer.softDelete('admin');
      customer.restore('admin');
      expect(customer.isDeleted).toBe(false);
      expect(customer.deletedAt).toBeUndefined();
    });

    it('should throw error when deleting already deleted customer', () => {
      customer.softDelete();
      expect(() => customer.softDelete()).toThrow('Customer is already deleted');
    });

    it('should throw error when restoring non-deleted customer', () => {
      expect(() => customer.restore()).toThrow('Customer is not deleted');
    });
  });

  describe('Clone & Serialization', () => {
    it('should clone customer', () => {
      const cloned = customer.clone();
      expect(cloned).not.toBe(customer);
      expect(cloned.id).toBe(customer.id);
      expect(cloned.name).toBe(customer.name);
      expect(cloned.email).toBe(customer.email);
    });

    it('should convert to JSON', () => {
      customer.addPoints(1500);
      customer.updateProfile({ address: '123 Main St', city: 'NYC' });

      const json = customer.toJSON();
      expect(json['id']).toBe(testId);
      expect(json['name']).toBe(testName);
      expect(json['loyaltyPoints']).toBe(1500);
      expect(json['tier']).toBe(CustomerTier.SILVER);
      expect(json['isActive']).toBe(true);
      expect(json['fullAddress']).toContain('123 Main St');
    });

    it('should create from JSON', () => {
      const json = customer.toJSON();
      const restored = Customer.fromJSON(json);
      expect(restored.id).toBe(customer.id);
      expect(restored.name).toBe(customer.name);
      expect(restored.email).toBe(customer.email);
    });
  });

  describe('Base Entity Features', () => {
    it('should track timestamps', () => {
      expect(customer.createdAt).toBeInstanceOf(Date);
      expect(customer.updatedAt).toBeInstanceOf(Date);
    });

    it('should update timestamp on changes', () => {
      const originalUpdatedAt = customer.updatedAt;
      setTimeout(() => {
        customer.addPoints(100, 'user-1');
        expect(customer.updatedAt.getTime()).toBeGreaterThan(originalUpdatedAt.getTime());
      }, 10);
    });

    it('should check if customer is new', () => {
      expect(customer.isNew()).toBe(true);
    });

    it('should compare customers by ID', () => {
      const sameCustomer = new Customer({
        id: testId,
        name: testName,
        email: testEmail,
        phone: testPhone,
      });
      const differentCustomer = new Customer({
        id: 'different-id',
        name: testName,
        email: testEmail,
        phone: testPhone,
      });
      expect(customer.equals(sameCustomer)).toBe(true);
      expect(customer.equals(differentCustomer)).toBe(false);
    });
  });

  describe('partially filled records', () => {
    it('joins only the address parts that are actually there', () => {
      // Customers are entered in a hurry at a counter; a join that assumes every
      // field produces "123 Main St, , , , " on a receipt.
      const sparse = new Customer({
        id: 'c1',
        name: 'Jane',
        email: 'jane@example.com',
        phone: '+1234567890',
        address: '12 Bridge Road',
        zipCode: 'E1 6AN',
      });

      // The country is defaulted by the entity, so it is always present; the city
      // and state simply do not appear.
      expect(sparse.getFullAddress()).toBe('12 Bridge Road, E1 6AN, USA');
    });

    it('does not count a birthday that has not come round yet', () => {
      // Off-by-one here is a real problem where age gates a sale.
      const today = new Date();
      const tomorrow = new Date(today);
      tomorrow.setDate(today.getDate() + 1);
      const notYet = new Date(today.getFullYear() - 30, tomorrow.getMonth(), tomorrow.getDate());

      const customer = new Customer({
        id: 'c1',
        name: 'Jane',
        email: 'jane@example.com',
        phone: '+1234567890',
        dateOfBirth: notYet,
      });

      // 29 unless the constructed date landed on today, which only happens on a
      // month boundary; either way it must never read as 30 before the day itself.
      expect(customer.getCustomerAge()).toBeLessThan(30);
    });

    it('rebuilds from JSON that is missing every optional field', () => {
      // Rows arrive from a sync that predates half these columns; a rebuild that
      // assumes them turns absent dates into Invalid Date.
      const restored = Customer.fromJSON({
        id: 'c1',
        name: 'Jane',
        email: 'jane@example.com',
        phone: '+1234567890',
      });

      expect(restored.createdAt).toBeInstanceOf(Date);
      expect(restored.dateOfBirth).toBeUndefined();
      expect(restored.deletedAt).toBeUndefined();
      expect(restored.getFullAddress()).toBeUndefined();
    });

    it('rebuilds every date it is given', () => {
      const restored = Customer.fromJSON({
        id: 'c1',
        name: 'Jane',
        email: 'jane@example.com',
        phone: '+1234567890',
        createdAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-02-01T00:00:00.000Z',
        deletedAt: '2026-03-01T00:00:00.000Z',
        dateOfBirth: '1990-05-04T00:00:00.000Z',
      });

      expect(restored.createdAt.toISOString()).toBe('2026-01-01T00:00:00.000Z');
      expect(restored.updatedAt.toISOString()).toBe('2026-02-01T00:00:00.000Z');
      expect(restored.deletedAt?.toISOString()).toBe('2026-03-01T00:00:00.000Z');
      expect(restored.dateOfBirth?.toISOString()).toBe('1990-05-04T00:00:00.000Z');
    });
  });

  describe('loyalty code', () => {
    it('normalizes a code on the way in', () => {
      // Stored canonical so the clerk's per-frame lookup is one index hit and not a
      // scan across every spelling of the same card.
      const customer = new Customer({
        id: 'c1',
        name: 'Marco Rossi',
        email: 'marco@example.com',
        phone: '+1234567890',
        loyaltyCode: 'capy b3km npqr',
      });

      expect(customer.loyaltyCode).toBe('CAPY-B3KMNPQR');
    });

    it('is undefined for a customer who was never issued a card', () => {
      const customer = new Customer({
        id: 'c1',
        name: 'Marco Rossi',
        email: 'marco@example.com',
        phone: '+1234567890',
      });

      expect(customer.loyaltyCode).toBeUndefined();
    });

    it('treats a blank code as no card rather than a bad one', () => {
      const customer = new Customer({
        id: 'c1',
        name: 'Marco Rossi',
        email: 'marco@example.com',
        phone: '+1234567890',
        loyaltyCode: '   ',
      });

      expect(customer.loyaltyCode).toBeUndefined();
    });

    it('refuses a malformed code rather than dropping it', () => {
      // Dropped silently, the customer walks out holding a printed card that will
      // never be recognised and nothing anywhere says why.
      expect(
        () =>
          new Customer({
            id: 'c1',
            name: 'Marco Rossi',
            email: 'marco@example.com',
            phone: '+1234567890',
            loyaltyCode: '4006381333931',
          })
      ).toThrow('Invalid loyalty code');
    });

    it('carries the code through clone, toJSON and fromJSON', () => {
      const customer = new Customer({
        id: 'c1',
        name: 'Marco Rossi',
        email: 'marco@example.com',
        phone: '+1234567890',
        loyaltyCode: 'CAPY-B3KMNPQR',
      });

      expect(customer.clone().loyaltyCode).toBe('CAPY-B3KMNPQR');
      expect(customer.toJSON()['loyaltyCode']).toBe('CAPY-B3KMNPQR');
      expect(Customer.fromJSON(customer.toJSON()).loyaltyCode).toBe('CAPY-B3KMNPQR');
    });
  });

  describe('getFirstName', () => {
    it.each([
      ['Marco Rossi', 'Marco'],
      ['Marco', 'Marco'],
      ['  Marco   Rossi  ', 'Marco'],
      ['Ada Byron King', 'Ada'],
    ])('reduces %s to %s', (name, expected) => {
      const customer = new Customer({
        id: 'c1',
        name,
        email: 'marco@example.com',
        phone: '+1234567890',
      });

      expect(customer.getFirstName()).toBe(expected);
    });
  });
});

// Made with Bob
