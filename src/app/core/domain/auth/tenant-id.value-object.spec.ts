import { describe, it, expect } from 'vitest';
import { TenantId } from './tenant-id.value-object';

describe('TenantId Value Object', () => {
  describe('construction', () => {
    it('creates a valid TenantId', () => {
      const t = new TenantId('store-001');
      expect(t.value).toBe('store-001');
    });

    it('trims whitespace', () => {
      expect(new TenantId('  abc  ').value).toBe('abc');
    });

    it('throws on null', () => {
      expect(() => new TenantId(null as unknown as string)).toThrow(
        'TenantId must be a non-empty string'
      );
    });

    it('throws on empty string', () => {
      expect(() => new TenantId('')).toThrow('TenantId cannot be empty');
      expect(() => new TenantId('   ')).toThrow('TenantId cannot be empty');
    });

    it('throws when exceeding 128 characters', () => {
      expect(() => new TenantId('a'.repeat(129))).toThrow('TenantId cannot exceed 128 characters');
    });

    it('throws for invalid characters', () => {
      expect(() => new TenantId('store@001')).toThrow(
        'TenantId must be alphanumeric with hyphens or underscores only'
      );
      expect(() => new TenantId('store 001')).toThrow(
        'TenantId must be alphanumeric with hyphens or underscores only'
      );
    });

    it('accepts alphanumeric, hyphens and underscores', () => {
      expect(() => new TenantId('STORE_001-A')).not.toThrow();
    });
  });

  describe('equality', () => {
    it('is equal when values match', () => {
      expect(new TenantId('abc').equals(new TenantId('abc'))).toBe(true);
    });

    it('is not equal for different values', () => {
      expect(new TenantId('abc').equals(new TenantId('xyz'))).toBe(false);
    });

    it('returns false when compared with a non-TenantId', () => {
      const t = new TenantId('abc');
      expect(t.equals('abc' as unknown as TenantId)).toBe(false);
    });
  });

  describe('serialisation', () => {
    it('toJSON returns the string value', () => {
      expect(new TenantId('store-1').toJSON()).toBe('store-1');
    });

    it('toString returns the string value', () => {
      expect(new TenantId('store-1').toString()).toBe('store-1');
    });

    it('fromJSON round-trips correctly', () => {
      const t = TenantId.fromJSON('my-tenant');
      expect(t.value).toBe('my-tenant');
    });
  });

  describe('immutability', () => {
    it('is frozen', () => {
      expect(Object.isFrozen(new TenantId('x'))).toBe(true);
    });
  });

  describe('DEFAULT', () => {
    it('has the expected default value', () => {
      expect(TenantId.DEFAULT.value).toBe('default-tenant');
    });
  });
});
