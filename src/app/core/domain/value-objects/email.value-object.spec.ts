import { describe, it, expect } from 'vitest';
import { Email } from '@core/domain/value-objects/email.value-object';

describe('Email Value Object', () => {
  describe('Constructor and Validation', () => {
    it('should create a valid email', () => {
      const email = new Email('user@example.com');
      expect(email.value).toBe('user@example.com');
    });

    it('should normalize email to lowercase', () => {
      const email = new Email('User@Example.COM');
      expect(email.value).toBe('user@example.com');
    });

    it('should trim whitespace', () => {
      const email = new Email('  user@example.com  ');
      expect(email.value).toBe('user@example.com');
    });

    it('should throw error for null or undefined', () => {
      expect(() => new Email(null as unknown)).toThrow('Email must be a non-empty string');
      expect(() => new Email(undefined as unknown)).toThrow('Email must be a non-empty string');
    });

    it('should throw error for empty string', () => {
      expect(() => new Email('')).toThrow('Email cannot be empty');
      expect(() => new Email('   ')).toThrow('Email cannot be empty');
    });

    it('should throw error for non-string values', () => {
      expect(() => new Email(123 as unknown)).toThrow('Email must be a non-empty string');
      expect(() => new Email({} as unknown)).toThrow('Email must be a non-empty string');
    });

    it('should throw error for email exceeding 254 characters', () => {
      const longEmail = 'a'.repeat(250) + '@example.com';
      expect(() => new Email(longEmail)).toThrow('Email cannot exceed 254 characters');
    });

    it('should throw error for invalid email format', () => {
      expect(() => new Email('invalid')).toThrow('Invalid email format');
      expect(() => new Email('invalid@')).toThrow('Invalid email format');
      expect(() => new Email('@example.com')).toThrow('Invalid email format');
      expect(() => new Email('user@')).toThrow('Invalid email format');
      expect(() => new Email('user @example.com')).toThrow('Invalid email format');
      expect(() => new Email('user@example')).toThrow('Invalid email format');
    });

    it('should accept valid email formats', () => {
      expect(() => new Email('user@example.com')).not.toThrow();
      expect(() => new Email('user.name@example.com')).not.toThrow();
      expect(() => new Email('user+tag@example.co.uk')).not.toThrow();
      expect(() => new Email('user_name@example-domain.com')).not.toThrow();
      expect(() => new Email('123@example.com')).not.toThrow();
    });
  });

  describe('getLocalPart()', () => {
    it('should return the local part of the email', () => {
      const email = new Email('user@example.com');
      expect(email.getLocalPart()).toBe('user');
    });

    it('should return local part with special characters', () => {
      const email = new Email('user.name+tag@example.com');
      expect(email.getLocalPart()).toBe('user.name+tag');
    });
  });

  describe('getDomain()', () => {
    it('should return the domain part of the email', () => {
      const email = new Email('user@example.com');
      expect(email.getDomain()).toBe('example.com');
    });

    it('should return domain with subdomain', () => {
      const email = new Email('user@mail.example.com');
      expect(email.getDomain()).toBe('mail.example.com');
    });
  });

  describe('hasDomain()', () => {
    it('should return true for matching domain', () => {
      const email = new Email('user@example.com');
      expect(email.hasDomain('example.com')).toBe(true);
    });

    it('should return false for non-matching domain', () => {
      const email = new Email('user@example.com');
      expect(email.hasDomain('other.com')).toBe(false);
    });

    it('should be case-insensitive', () => {
      const email = new Email('user@example.com');
      expect(email.hasDomain('EXAMPLE.COM')).toBe(true);
      expect(email.hasDomain('Example.Com')).toBe(true);
    });
  });

  describe('normalize()', () => {
    it('should return the same instance (already normalized)', () => {
      const email = new Email('user@example.com');
      const normalized = email.normalize();
      expect(normalized).toBe(email);
    });
  });

  describe('isFreeEmailProvider()', () => {
    it('should return true for Gmail', () => {
      const email = new Email('user@gmail.com');
      expect(email.isFreeEmailProvider()).toBe(true);
    });

    it('should return true for Yahoo', () => {
      const email = new Email('user@yahoo.com');
      expect(email.isFreeEmailProvider()).toBe(true);
    });

    it('should return true for Hotmail', () => {
      const email = new Email('user@hotmail.com');
      expect(email.isFreeEmailProvider()).toBe(true);
    });

    it('should return true for Outlook', () => {
      const email = new Email('user@outlook.com');
      expect(email.isFreeEmailProvider()).toBe(true);
    });

    it('should return false for business domain', () => {
      const email = new Email('user@company.com');
      expect(email.isFreeEmailProvider()).toBe(false);
    });

    it('should return false for custom domain', () => {
      const email = new Email('user@mydomain.org');
      expect(email.isFreeEmailProvider()).toBe(false);
    });
  });

  describe('equals()', () => {
    it('should return true for identical emails', () => {
      const email1 = new Email('user@example.com');
      const email2 = new Email('user@example.com');
      expect(email1.equals(email2)).toBe(true);
    });

    it('should return true for emails with different casing (normalized)', () => {
      const email1 = new Email('User@Example.COM');
      const email2 = new Email('user@example.com');
      expect(email1.equals(email2)).toBe(true);
    });

    it('should return false for different emails', () => {
      const email1 = new Email('user1@example.com');
      const email2 = new Email('user2@example.com');
      expect(email1.equals(email2)).toBe(false);
    });

    it('should return false for non-Email objects', () => {
      const email = new Email('user@example.com');
      expect(email.equals('user@example.com' as unknown)).toBe(false);
      expect(email.equals(null as unknown)).toBe(false);
      expect(email.equals(undefined as unknown)).toBe(false);
    });
  });

  describe('toJSON()', () => {
    it('should return the email string', () => {
      const email = new Email('user@example.com');
      expect(email.toJSON()).toBe('user@example.com');
    });

    it('should return normalized email', () => {
      const email = new Email('User@Example.COM');
      expect(email.toJSON()).toBe('user@example.com');
    });
  });

  describe('toString()', () => {
    it('should return the email string', () => {
      const email = new Email('user@example.com');
      expect(email.toString()).toBe('user@example.com');
    });

    it('should return normalized email', () => {
      const email = new Email('User@Example.COM');
      expect(email.toString()).toBe('user@example.com');
    });
  });

  describe('Static Factory Methods', () => {
    describe('fromJSON()', () => {
      it('should create Email from JSON string', () => {
        const email = Email.fromJSON('user@example.com');
        expect(email.value).toBe('user@example.com');
      });

      it('should normalize email from JSON', () => {
        const email = Email.fromJSON('User@Example.COM');
        expect(email.value).toBe('user@example.com');
      });
    });

    describe('fromPlain()', () => {
      it('should create Email from plain object', () => {
        const email = Email.fromPlain({ value: 'user@example.com' });
        expect(email.value).toBe('user@example.com');
      });

      it('should normalize email from plain object', () => {
        const email = Email.fromPlain({ value: 'User@Example.COM' });
        expect(email.value).toBe('user@example.com');
      });
    });
  });

  describe('Immutability', () => {
    it('should be frozen and immutable', () => {
      const email = new Email('user@example.com');
      expect(Object.isFrozen(email)).toBe(true);
    });

    it('should not allow modification of value property', () => {
      const email = new Email('user@example.com');
      expect(() => {
        (email as unknown)._value = 'hacker@evil.com';
      }).toThrow();
    });
  });

  describe('Value Object Behavior', () => {
    it('should be compared by value, not reference', () => {
      const email1 = new Email('user@example.com');
      const email2 = new Email('user@example.com');
      expect(email1).not.toBe(email2); // Different references
      expect(email1.equals(email2)).toBe(true); // Same value
    });

    it('should work as Map keys', () => {
      const email1 = new Email('user1@example.com');
      const email2 = new Email('user2@example.com');
      const map = new Map<Email, string>();

      map.set(email1, 'User 1');
      map.set(email2, 'User 2');

      expect(map.get(email1)).toBe('User 1');
      expect(map.get(email2)).toBe('User 2');
      expect(map.size).toBe(2);
    });
  });
});

// Made with Bob
