import { describe, it, expect } from 'vitest';
import { Permission, ALL_PERMISSIONS, isPermission } from './permission.constants';

describe('permission.constants', () => {
  describe('ALL_PERMISSIONS', () => {
    it('contains every declared permission and is frozen', () => {
      expect(ALL_PERMISSIONS).toContain(Permission.PROCESS_SALE);
      expect(ALL_PERMISSIONS).toContain(Permission.MANAGE_ROLES);
      expect(ALL_PERMISSIONS.length).toBe(Object.values(Permission).length);
      expect(Object.isFrozen(ALL_PERMISSIONS)).toBe(true);
    });
  });

  describe('isPermission', () => {
    it('returns true for a known permission string', () => {
      expect(isPermission(Permission.PROCESS_SALE)).toBe(true);
    });

    it('returns false for an unknown string', () => {
      expect(isPermission('totally:made-up')).toBe(false);
      expect(isPermission('')).toBe(false);
    });

    it('returns false for non-string values', () => {
      expect(isPermission(undefined)).toBe(false);
      expect(isPermission(null)).toBe(false);
      expect(isPermission(42)).toBe(false);
      expect(isPermission({})).toBe(false);
    });
  });
});
