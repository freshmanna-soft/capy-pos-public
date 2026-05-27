import { describe, it, expect } from 'vitest';
import { Address, AddressComponents } from './address.value-object';

describe('Address Value Object', () => {
  const validUSAddress: AddressComponents = {
    street: '123 Main St',
    city: 'San Francisco',
    state: 'CA',
    postalCode: '94102',
    country: 'USA'
  };

  const validUKAddress: AddressComponents = {
    street: '10 Downing Street',
    city: 'London',
    state: 'Greater London',
    postalCode: 'SW1A 2AA',
    country: 'UK'
  };

  const validCanadaAddress: AddressComponents = {
    street: '123 Maple Ave',
    city: 'Toronto',
    state: 'ON',
    postalCode: 'M5H 2N2',
    country: 'Canada'
  };

  describe('Constructor and Validation', () => {
    it('should create a valid address', () => {
      const address = new Address(validUSAddress);
      expect(address.street).toBe('123 Main St');
      expect(address.city).toBe('San Francisco');
      expect(address.state).toBe('CA');
      expect(address.postalCode).toBe('94102');
      expect(address.country).toBe('USA');
    });

    it('should normalize state to uppercase', () => {
      const address = new Address({ ...validUSAddress, state: 'ca' });
      expect(address.state).toBe('CA');
    });

    it('should normalize country to uppercase', () => {
      const address = new Address({ ...validUSAddress, country: 'usa' });
      expect(address.country).toBe('USA');
    });

    it('should trim whitespace from all fields', () => {
      const address = new Address({
        street: '  123 Main St  ',
        city: '  San Francisco  ',
        state: '  CA  ',
        postalCode: '  94102  ',
        country: '  USA  '
      });
      expect(address.street).toBe('123 Main St');
      expect(address.city).toBe('San Francisco');
      expect(address.state).toBe('CA');
      expect(address.postalCode).toBe('94102');
      expect(address.country).toBe('USA');
    });

    it('should normalize postal code spacing', () => {
      const address = new Address({ ...validUKAddress, postalCode: 'SW1A   2AA' });
      expect(address.postalCode).toBe('SW1A 2AA');
    });

    it('should throw error for null or undefined components', () => {
      expect(() => new Address(null as any)).toThrow('Address components must be an object');
      expect(() => new Address(undefined as any)).toThrow('Address components must be an object');
    });

    it('should throw error for non-object components', () => {
      expect(() => new Address('invalid' as any)).toThrow('Address components must be an object');
      expect(() => new Address(123 as any)).toThrow('Address components must be an object');
    });

    describe('Street Validation', () => {
      it('should throw error for missing street', () => {
        expect(() => new Address({ ...validUSAddress, street: '' })).toThrow('Street address is required');
        expect(() => new Address({ ...validUSAddress, street: '   ' })).toThrow('Street address is required');
        expect(() => new Address({ ...validUSAddress, street: null as any })).toThrow('Street address is required');
      });

      it('should throw error for street exceeding 200 characters', () => {
        const longStreet = 'A'.repeat(201);
        expect(() => new Address({ ...validUSAddress, street: longStreet })).toThrow('Street address cannot exceed 200 characters');
      });

      it('should accept street with 200 characters', () => {
        const maxStreet = 'A'.repeat(200);
        expect(() => new Address({ ...validUSAddress, street: maxStreet })).not.toThrow();
      });
    });

    describe('City Validation', () => {
      it('should throw error for missing city', () => {
        expect(() => new Address({ ...validUSAddress, city: '' })).toThrow('City is required');
        expect(() => new Address({ ...validUSAddress, city: '   ' })).toThrow('City is required');
        expect(() => new Address({ ...validUSAddress, city: null as any })).toThrow('City is required');
      });

      it('should throw error for city exceeding 100 characters', () => {
        const longCity = 'A'.repeat(101);
        expect(() => new Address({ ...validUSAddress, city: longCity })).toThrow('City cannot exceed 100 characters');
      });

      it('should accept city with 100 characters', () => {
        const maxCity = 'A'.repeat(100);
        expect(() => new Address({ ...validUSAddress, city: maxCity })).not.toThrow();
      });
    });

    describe('State Validation', () => {
      it('should throw error for missing state', () => {
        expect(() => new Address({ ...validUSAddress, state: '' })).toThrow('State/Province is required');
        expect(() => new Address({ ...validUSAddress, state: '   ' })).toThrow('State/Province is required');
        expect(() => new Address({ ...validUSAddress, state: null as any })).toThrow('State/Province is required');
      });

      it('should throw error for state exceeding 50 characters', () => {
        const longState = 'A'.repeat(51);
        expect(() => new Address({ ...validUSAddress, state: longState })).toThrow('State/Province cannot exceed 50 characters');
      });

      it('should accept state with 50 characters', () => {
        const maxState = 'A'.repeat(50);
        expect(() => new Address({ ...validUSAddress, state: maxState })).not.toThrow();
      });
    });

    describe('Postal Code Validation', () => {
      it('should throw error for missing postal code', () => {
        expect(() => new Address({ ...validUSAddress, postalCode: '' })).toThrow('Postal code is required');
        expect(() => new Address({ ...validUSAddress, postalCode: '   ' })).toThrow('Postal code is required');
        expect(() => new Address({ ...validUSAddress, postalCode: null as any })).toThrow('Postal code is required');
      });

      it('should throw error for postal code exceeding 20 characters', () => {
        const longPostalCode = 'A'.repeat(21);
        expect(() => new Address({ ...validUSAddress, postalCode: longPostalCode })).toThrow('Postal code cannot exceed 20 characters');
      });

      it('should accept postal code with 20 characters', () => {
        const maxPostalCode = 'A'.repeat(20);
        expect(() => new Address({ ...validUSAddress, postalCode: maxPostalCode })).not.toThrow();
      });
    });

    describe('Country Validation', () => {
      it('should throw error for missing country', () => {
        expect(() => new Address({ ...validUSAddress, country: '' })).toThrow('Country is required');
        expect(() => new Address({ ...validUSAddress, country: '   ' })).toThrow('Country is required');
        expect(() => new Address({ ...validUSAddress, country: null as any })).toThrow('Country is required');
      });

      it('should throw error for country exceeding 100 characters', () => {
        const longCountry = 'A'.repeat(101);
        expect(() => new Address({ ...validUSAddress, country: longCountry })).toThrow('Country cannot exceed 100 characters');
      });

      it('should accept country with 100 characters', () => {
        const maxCountry = 'A'.repeat(100);
        expect(() => new Address({ ...validUSAddress, country: maxCountry })).not.toThrow();
      });
    });
  });

  describe('Country Checks', () => {
    describe('isUS()', () => {
      it('should return true for USA', () => {
        const address = new Address({ ...validUSAddress, country: 'USA' });
        expect(address.isUS()).toBe(true);
      });

      it('should return true for US', () => {
        const address = new Address({ ...validUSAddress, country: 'US' });
        expect(address.isUS()).toBe(true);
      });

      it('should return true for United States', () => {
        const address = new Address({ ...validUSAddress, country: 'United States' });
        expect(address.isUS()).toBe(true);
      });

      it('should return false for non-US countries', () => {
        const address = new Address(validUKAddress);
        expect(address.isUS()).toBe(false);
      });
    });

    describe('isCanada()', () => {
      it('should return true for Canada', () => {
        const address = new Address({ ...validCanadaAddress, country: 'Canada' });
        expect(address.isCanada()).toBe(true);
      });

      it('should return true for CA', () => {
        const address = new Address({ ...validCanadaAddress, country: 'CA' });
        expect(address.isCanada()).toBe(true);
      });

      it('should return false for non-Canadian countries', () => {
        const address = new Address(validUSAddress);
        expect(address.isCanada()).toBe(false);
      });
    });

    describe('isUK()', () => {
      it('should return true for UK', () => {
        const address = new Address({ ...validUKAddress, country: 'UK' });
        expect(address.isUK()).toBe(true);
      });

      it('should return true for GB', () => {
        const address = new Address({ ...validUKAddress, country: 'GB' });
        expect(address.isUK()).toBe(true);
      });

      it('should return true for United Kingdom', () => {
        const address = new Address({ ...validUKAddress, country: 'United Kingdom' });
        expect(address.isUK()).toBe(true);
      });

      it('should return false for non-UK countries', () => {
        const address = new Address(validUSAddress);
        expect(address.isUK()).toBe(false);
      });
    });

    describe('isInCountry()', () => {
      it('should return true for matching country', () => {
        const address = new Address(validUSAddress);
        expect(address.isInCountry('USA')).toBe(true);
        expect(address.isInCountry('usa')).toBe(true);
      });

      it('should return false for non-matching country', () => {
        const address = new Address(validUSAddress);
        expect(address.isInCountry('Canada')).toBe(false);
      });
    });
  });

  describe('Location Checks', () => {
    describe('isInState()', () => {
      it('should return true for matching state', () => {
        const address = new Address(validUSAddress);
        expect(address.isInState('CA')).toBe(true);
        expect(address.isInState('ca')).toBe(true);
      });

      it('should return false for non-matching state', () => {
        const address = new Address(validUSAddress);
        expect(address.isInState('NY')).toBe(false);
      });
    });

    describe('isInCity()', () => {
      it('should return true for matching city', () => {
        const address = new Address(validUSAddress);
        expect(address.isInCity('San Francisco')).toBe(true);
        expect(address.isInCity('san francisco')).toBe(true);
        expect(address.isInCity('SAN FRANCISCO')).toBe(true);
      });

      it('should return false for non-matching city', () => {
        const address = new Address(validUSAddress);
        expect(address.isInCity('Los Angeles')).toBe(false);
      });
    });
  });

  describe('Formatting', () => {
    describe('format()', () => {
      it('should format US address as multi-line', () => {
        const address = new Address(validUSAddress);
        const formatted = address.format();
        expect(formatted).toBe('123 Main St\nSan Francisco, CA 94102\nUSA');
      });

      it('should format UK address as multi-line', () => {
        const address = new Address(validUKAddress);
        const formatted = address.format();
        expect(formatted).toBe('10 Downing Street\nLondon, GREATER LONDON SW1A 2AA\nUK');
      });

      it('should format Canadian address as multi-line', () => {
        const address = new Address(validCanadaAddress);
        const formatted = address.format();
        expect(formatted).toBe('123 Maple Ave\nToronto, ON M5H 2N2\nCANADA');
      });
    });

    describe('toOneLine()', () => {
      it('should format US address as single line', () => {
        const address = new Address(validUSAddress);
        const oneLine = address.toOneLine();
        expect(oneLine).toBe('123 Main St, San Francisco, CA 94102, USA');
      });

      it('should format UK address as single line', () => {
        const address = new Address(validUKAddress);
        const oneLine = address.toOneLine();
        expect(oneLine).toBe('10 Downing Street, London, GREATER LONDON SW1A 2AA, UK');
      });

      it('should format Canadian address as single line', () => {
        const address = new Address(validCanadaAddress);
        const oneLine = address.toOneLine();
        expect(oneLine).toBe('123 Maple Ave, Toronto, ON M5H 2N2, CANADA');
      });
    });
  });

  describe('getComponents()', () => {
    it('should return address components', () => {
      const address = new Address(validUSAddress);
      const components = address.getComponents();
      expect(components).toEqual({
        street: '123 Main St',
        city: 'San Francisco',
        state: 'CA',
        postalCode: '94102',
        country: 'USA'
      });
    });

    it('should return normalized components', () => {
      const address = new Address({ ...validUSAddress, state: 'ca', country: 'usa' });
      const components = address.getComponents();
      expect(components.state).toBe('CA');
      expect(components.country).toBe('USA');
    });
  });

  describe('equals()', () => {
    it('should return true for identical addresses', () => {
      const address1 = new Address(validUSAddress);
      const address2 = new Address(validUSAddress);
      expect(address1.equals(address2)).toBe(true);
    });

    it('should return true for addresses with different casing (normalized)', () => {
      const address1 = new Address({ ...validUSAddress, state: 'CA', country: 'USA' });
      const address2 = new Address({ ...validUSAddress, state: 'ca', country: 'usa' });
      expect(address1.equals(address2)).toBe(true);
    });

    it('should return false for different streets', () => {
      const address1 = new Address(validUSAddress);
      const address2 = new Address({ ...validUSAddress, street: '456 Oak Ave' });
      expect(address1.equals(address2)).toBe(false);
    });

    it('should return false for different cities', () => {
      const address1 = new Address(validUSAddress);
      const address2 = new Address({ ...validUSAddress, city: 'Los Angeles' });
      expect(address1.equals(address2)).toBe(false);
    });

    it('should return false for different states', () => {
      const address1 = new Address(validUSAddress);
      const address2 = new Address({ ...validUSAddress, state: 'NY' });
      expect(address1.equals(address2)).toBe(false);
    });

    it('should return false for different postal codes', () => {
      const address1 = new Address(validUSAddress);
      const address2 = new Address({ ...validUSAddress, postalCode: '90210' });
      expect(address1.equals(address2)).toBe(false);
    });

    it('should return false for different countries', () => {
      const address1 = new Address(validUSAddress);
      const address2 = new Address({ ...validUSAddress, country: 'Canada' });
      expect(address1.equals(address2)).toBe(false);
    });

    it('should return false for non-Address objects', () => {
      const address = new Address(validUSAddress);
      expect(address.equals('123 Main St' as any)).toBe(false);
      expect(address.equals(null as any)).toBe(false);
      expect(address.equals(undefined as any)).toBe(false);
    });
  });

  describe('toJSON()', () => {
    it('should return address components', () => {
      const address = new Address(validUSAddress);
      const json = address.toJSON();
      expect(json).toEqual({
        street: '123 Main St',
        city: 'San Francisco',
        state: 'CA',
        postalCode: '94102',
        country: 'USA'
      });
    });
  });

  describe('toString()', () => {
    it('should return single line format', () => {
      const address = new Address(validUSAddress);
      expect(address.toString()).toBe('123 Main St, San Francisco, CA 94102, USA');
    });
  });

  describe('Static Factory Methods', () => {
    describe('fromJSON()', () => {
      it('should create Address from JSON', () => {
        const address = Address.fromJSON(validUSAddress);
        expect(address.street).toBe('123 Main St');
        expect(address.city).toBe('San Francisco');
      });
    });

    describe('fromPlain()', () => {
      it('should create Address from plain object', () => {
        const address = Address.fromPlain(validUSAddress);
        expect(address.street).toBe('123 Main St');
        expect(address.city).toBe('San Francisco');
      });
    });

    describe('createUS()', () => {
      it('should create US address', () => {
        const address = Address.createUS('123 Main St', 'San Francisco', 'CA', '94102');
        expect(address.street).toBe('123 Main St');
        expect(address.city).toBe('San Francisco');
        expect(address.state).toBe('CA');
        expect(address.postalCode).toBe('94102');
        expect(address.country).toBe('USA');
        expect(address.isUS()).toBe(true);
      });
    });

    describe('createCanada()', () => {
      it('should create Canadian address', () => {
        const address = Address.createCanada('123 Maple Ave', 'Toronto', 'ON', 'M5H 2N2');
        expect(address.street).toBe('123 Maple Ave');
        expect(address.city).toBe('Toronto');
        expect(address.state).toBe('ON');
        expect(address.postalCode).toBe('M5H 2N2');
        expect(address.country).toBe('CANADA');
        expect(address.isCanada()).toBe(true);
      });
    });

    describe('createUK()', () => {
      it('should create UK address', () => {
        const address = Address.createUK('10 Downing Street', 'London', 'Greater London', 'SW1A 2AA');
        expect(address.street).toBe('10 Downing Street');
        expect(address.city).toBe('London');
        expect(address.state).toBe('GREATER LONDON');
        expect(address.postalCode).toBe('SW1A 2AA');
        expect(address.country).toBe('UK');
        expect(address.isUK()).toBe(true);
      });
    });
  });

  describe('Immutability', () => {
    it('should be frozen and immutable', () => {
      const address = new Address(validUSAddress);
      expect(Object.isFrozen(address)).toBe(true);
    });

    it('should not allow modification of street property', () => {
      const address = new Address(validUSAddress);
      expect(() => {
        (address as any)._street = '456 Hacker St';
      }).toThrow();
    });

    it('should not allow modification of city property', () => {
      const address = new Address(validUSAddress);
      expect(() => {
        (address as any)._city = 'Hacker City';
      }).toThrow();
    });

    it('should not allow modification of state property', () => {
      const address = new Address(validUSAddress);
      expect(() => {
        (address as any)._state = 'XX';
      }).toThrow();
    });

    it('should not allow modification of postalCode property', () => {
      const address = new Address(validUSAddress);
      expect(() => {
        (address as any)._postalCode = '00000';
      }).toThrow();
    });

    it('should not allow modification of country property', () => {
      const address = new Address(validUSAddress);
      expect(() => {
        (address as any)._country = 'HACKERLAND';
      }).toThrow();
    });
  });

  describe('Value Object Behavior', () => {
    it('should be compared by value, not reference', () => {
      const address1 = new Address(validUSAddress);
      const address2 = new Address(validUSAddress);
      expect(address1).not.toBe(address2); // Different references
      expect(address1.equals(address2)).toBe(true); // Same value
    });

    it('should work as Map keys', () => {
      const address1 = new Address(validUSAddress);
      const address2 = new Address(validUKAddress);
      const map = new Map<Address, string>();
      
      map.set(address1, 'US Office');
      map.set(address2, 'UK Office');
      
      expect(map.get(address1)).toBe('US Office');
      expect(map.get(address2)).toBe('UK Office');
      expect(map.size).toBe(2);
    });
  });
});

// Made with Bob
