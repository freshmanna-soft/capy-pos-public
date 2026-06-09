import { describe, it, expect } from 'vitest';
import { Phone } from '@core/domain/value-objects/phone.value-object';

describe('Phone Value Object', () => {
  describe('Constructor and Validation', () => {
    it('should create a valid US phone number', () => {
      const phone = new Phone('+1-555-123-4567');
      expect(phone.value).toBe('+15551234567');
    });

    it('should create a valid international phone number', () => {
      const phone = new Phone('+44 20 1234 5678');
      expect(phone.value).toBe('+442012345678');
    });

    it('should normalize phone number by removing formatting', () => {
      const phone = new Phone('+1 (555) 123-4567');
      expect(phone.value).toBe('+15551234567');
    });

    it('should add +1 country code if not provided', () => {
      const phone = new Phone('555-123-4567');
      expect(phone.value).toBe('+15551234567');
      expect(phone.countryCode).toBe('+1');
    });

    it('should throw error for null or undefined', () => {
      expect(() => new Phone(null as unknown)).toThrow('Phone number must be a non-empty string');
      expect(() => new Phone(undefined as unknown)).toThrow(
        'Phone number must be a non-empty string',
      );
    });

    it('should throw error for empty string', () => {
      expect(() => new Phone('')).toThrow('Phone number cannot be empty');
      expect(() => new Phone('   ')).toThrow('Phone number cannot be empty');
    });

    it('should throw error for non-string values', () => {
      expect(() => new Phone(123 as unknown)).toThrow('Phone number must be a non-empty string');
      expect(() => new Phone({} as unknown)).toThrow('Phone number must be a non-empty string');
    });

    it('should throw error for phone number with less than 10 digits', () => {
      expect(() => new Phone('123456789')).toThrow('Phone number must have at least 10 digits');
      expect(() => new Phone('+1 555')).toThrow('Phone number must have at least 10 digits');
    });

    it('should throw error for phone number exceeding 15 digits', () => {
      expect(() => new Phone('+1234567890123456')).toThrow('Phone number cannot exceed 15 digits');
    });

    it('should throw error for multiple + symbols', () => {
      expect(() => new Phone('+1+5551234567')).toThrow(
        'Phone number can only have one + symbol at the start',
      );
    });

    it('should throw error for + not at start', () => {
      expect(() => new Phone('1+5551234567')).toThrow(
        '+ symbol must be at the start of the phone number',
      );
    });

    it('should accept various valid formats', () => {
      expect(() => new Phone('+1-555-123-4567')).not.toThrow();
      expect(() => new Phone('+1 (555) 123-4567')).not.toThrow();
      expect(() => new Phone('+15551234567')).not.toThrow();
      expect(() => new Phone('555.123.4567')).not.toThrow();
      expect(() => new Phone('+44 20 1234 5678')).not.toThrow();
    });
  });

  describe('Country Code and Number Parsing', () => {
    it('should extract US country code', () => {
      const phone = new Phone('+1-555-123-4567');
      expect(phone.countryCode).toBe('+1');
      expect(phone.number).toBe('5551234567');
    });

    it('should extract UK country code', () => {
      const phone = new Phone('+44 20 1234 5678');
      expect(phone.countryCode).toBe('+44');
      expect(phone.number).toBe('2012345678');
    });

    it('should extract 3-digit country code', () => {
      const phone = new Phone('+123 4567890123');
      expect(phone.countryCode).toBe('+123');
      expect(phone.number).toBe('4567890123');
    });
  });

  describe('getDigitsOnly()', () => {
    it('should return only digits without +', () => {
      const phone = new Phone('+1-555-123-4567');
      expect(phone.getDigitsOnly()).toBe('15551234567');
    });

    it('should return digits for international number', () => {
      const phone = new Phone('+44 20 1234 5678');
      expect(phone.getDigitsOnly()).toBe('442012345678');
    });
  });

  describe('format()', () => {
    it('should format US phone number', () => {
      const phone = new Phone('+1-555-123-4567');
      expect(phone.format()).toBe('+1 (555) 123-4567');
    });

    it('should format US phone number without country code input', () => {
      const phone = new Phone('555-123-4567');
      expect(phone.format()).toBe('+1 (555) 123-4567');
    });

    it('should format international phone number', () => {
      const phone = new Phone('+44 20 1234 5678');
      expect(phone.format()).toBe('+44 2012 3456 78');
    });

    it('should format phone with spaces every 4 digits for non-US', () => {
      const phone = new Phone('+49 1234567890');
      expect(phone.format()).toBe('+49 1234 5678 90');
    });
  });

  describe('isUS()', () => {
    it('should return true for US phone numbers', () => {
      const phone = new Phone('+1-555-123-4567');
      expect(phone.isUS()).toBe(true);
    });

    it('should return true for phone without country code (defaults to US)', () => {
      const phone = new Phone('555-123-4567');
      expect(phone.isUS()).toBe(true);
    });

    it('should return false for non-US phone numbers', () => {
      const phone = new Phone('+44 20 1234 5678');
      expect(phone.isUS()).toBe(false);
    });
  });

  describe('isUK()', () => {
    it('should return true for UK phone numbers', () => {
      const phone = new Phone('+44 20 1234 5678');
      expect(phone.isUK()).toBe(true);
    });

    it('should return false for non-UK phone numbers', () => {
      const phone = new Phone('+1-555-123-4567');
      expect(phone.isUK()).toBe(false);
    });
  });

  describe('hasCountryCode()', () => {
    it('should return true for matching country code with +', () => {
      const phone = new Phone('+1-555-123-4567');
      expect(phone.hasCountryCode('+1')).toBe(true);
    });

    it('should return true for matching country code without +', () => {
      const phone = new Phone('+1-555-123-4567');
      expect(phone.hasCountryCode('1')).toBe(true);
    });

    it('should return false for non-matching country code', () => {
      const phone = new Phone('+1-555-123-4567');
      expect(phone.hasCountryCode('+44')).toBe(false);
      expect(phone.hasCountryCode('44')).toBe(false);
    });

    it('should work with multi-digit country codes', () => {
      const phone = new Phone('+44 20 1234 5678');
      expect(phone.hasCountryCode('+44')).toBe(true);
      expect(phone.hasCountryCode('44')).toBe(true);
    });
  });

  describe('getAreaCode()', () => {
    it('should return area code for US phone numbers', () => {
      const phone = new Phone('+1-555-123-4567');
      expect(phone.getAreaCode()).toBe('555');
    });

    it('should return area code for phone without country code', () => {
      const phone = new Phone('555-123-4567');
      expect(phone.getAreaCode()).toBe('555');
    });

    it('should return null for non-US phone numbers', () => {
      const phone = new Phone('+44 20 1234 5678');
      expect(phone.getAreaCode()).toBeNull();
    });

    it('should return null for US phone with wrong length', () => {
      const phone = new Phone('+1 12345678901');
      expect(phone.getAreaCode()).toBeNull();
    });
  });

  describe('equals()', () => {
    it('should return true for identical phone numbers', () => {
      const phone1 = new Phone('+1-555-123-4567');
      const phone2 = new Phone('+1-555-123-4567');
      expect(phone1.equals(phone2)).toBe(true);
    });

    it('should return true for differently formatted but same phone numbers', () => {
      const phone1 = new Phone('+1-555-123-4567');
      const phone2 = new Phone('+1 (555) 123-4567');
      expect(phone1.equals(phone2)).toBe(true);
    });

    it('should return true when one has implicit US country code', () => {
      const phone1 = new Phone('555-123-4567');
      const phone2 = new Phone('+1-555-123-4567');
      expect(phone1.equals(phone2)).toBe(true);
    });

    it('should return false for different phone numbers', () => {
      const phone1 = new Phone('+1-555-123-4567');
      const phone2 = new Phone('+1-555-987-6543');
      expect(phone1.equals(phone2)).toBe(false);
    });

    it('should return false for non-Phone objects', () => {
      const phone = new Phone('+1-555-123-4567');
      expect(phone.equals('+1-555-123-4567' as unknown)).toBe(false);
      expect(phone.equals(null as unknown)).toBe(false);
      expect(phone.equals(undefined as unknown)).toBe(false);
    });
  });

  describe('toJSON()', () => {
    it('should return normalized phone string', () => {
      const phone = new Phone('+1-555-123-4567');
      expect(phone.toJSON()).toBe('+15551234567');
    });

    it('should return normalized international phone', () => {
      const phone = new Phone('+44 20 1234 5678');
      expect(phone.toJSON()).toBe('+442012345678');
    });
  });

  describe('toString()', () => {
    it('should return formatted US phone string', () => {
      const phone = new Phone('+1-555-123-4567');
      expect(phone.toString()).toBe('+1 (555) 123-4567');
    });

    it('should return formatted international phone string', () => {
      const phone = new Phone('+44 20 1234 5678');
      expect(phone.toString()).toBe('+44 2012 3456 78');
    });
  });

  describe('Static Factory Methods', () => {
    describe('fromJSON()', () => {
      it('should create Phone from JSON string', () => {
        const phone = Phone.fromJSON('+15551234567');
        expect(phone.value).toBe('+15551234567');
      });

      it('should create Phone from formatted JSON', () => {
        const phone = Phone.fromJSON('+1-555-123-4567');
        expect(phone.value).toBe('+15551234567');
      });
    });

    describe('fromPlain()', () => {
      it('should create Phone from plain object', () => {
        const phone = Phone.fromPlain({ value: '+1-555-123-4567' });
        expect(phone.value).toBe('+15551234567');
      });

      it('should normalize phone from plain object', () => {
        const phone = Phone.fromPlain({ value: '555-123-4567' });
        expect(phone.value).toBe('+15551234567');
      });
    });

    describe('createUS()', () => {
      it('should create US phone from parts', () => {
        const phone = Phone.createUS('555', '123', '4567');
        expect(phone.value).toBe('+15551234567');
        expect(phone.countryCode).toBe('+1');
        expect(phone.isUS()).toBe(true);
      });

      it('should format created US phone correctly', () => {
        const phone = Phone.createUS('555', '123', '4567');
        expect(phone.format()).toBe('+1 (555) 123-4567');
      });

      it('should extract area code from created phone', () => {
        const phone = Phone.createUS('555', '123', '4567');
        expect(phone.getAreaCode()).toBe('555');
      });
    });
  });

  describe('Immutability', () => {
    it('should be frozen and immutable', () => {
      const phone = new Phone('+1-555-123-4567');
      expect(Object.isFrozen(phone)).toBe(true);
    });

    it('should not allow modification of value property', () => {
      const phone = new Phone('+1-555-123-4567');
      expect(() => {
        (phone as unknown)._value = '+1-999-999-9999';
      }).toThrow();
    });

    it('should not allow modification of countryCode property', () => {
      const phone = new Phone('+1-555-123-4567');
      expect(() => {
        (phone as unknown)._countryCode = '+44';
      }).toThrow();
    });

    it('should not allow modification of number property', () => {
      const phone = new Phone('+1-555-123-4567');
      expect(() => {
        (phone as unknown)._number = '9999999999';
      }).toThrow();
    });
  });

  describe('Value Object Behavior', () => {
    it('should be compared by value, not reference', () => {
      const phone1 = new Phone('+1-555-123-4567');
      const phone2 = new Phone('+1-555-123-4567');
      expect(phone1).not.toBe(phone2); // Different references
      expect(phone1.equals(phone2)).toBe(true); // Same value
    });

    it('should work as Map keys', () => {
      const phone1 = new Phone('+1-555-123-4567');
      const phone2 = new Phone('+1-555-987-6543');
      const map = new Map<Phone, string>();

      map.set(phone1, 'John Doe');
      map.set(phone2, 'Jane Smith');

      expect(map.get(phone1)).toBe('John Doe');
      expect(map.get(phone2)).toBe('Jane Smith');
      expect(map.size).toBe(2);
    });
  });

  describe('Edge Cases', () => {
    it('should handle phone with dots as separators', () => {
      const phone = new Phone('555.123.4567');
      expect(phone.value).toBe('+15551234567');
    });

    it('should handle phone with mixed separators', () => {
      const phone = new Phone('+1 (555)-123.4567');
      expect(phone.value).toBe('+15551234567');
    });

    it('should handle phone with no separators', () => {
      const phone = new Phone('5551234567');
      expect(phone.value).toBe('+15551234567');
    });

    it('should handle international phone with various formats', () => {
      const phone1 = new Phone('+44-20-1234-5678');
      const phone2 = new Phone('+44 (20) 1234 5678');
      const phone3 = new Phone('+442012345678');

      expect(phone1.equals(phone2)).toBe(true);
      expect(phone2.equals(phone3)).toBe(true);
    });
  });
});

// Made with Bob
