import { describe, it, expect } from 'vitest';
import { AuthorizationService, AuthorizationError } from './authorization.service';
import { Permission } from './permission.constants';
import { RoleName } from './role.value-object';

describe('AuthorizationService', () => {
  let svc: AuthorizationService;

  beforeEach(() => {
    svc = new AuthorizationService();
  });

  // ──────────────────────────────────────────────────────────────────────────
  // can() — permission evaluation
  // ──────────────────────────────────────────────────────────────────────────

  describe('can()', () => {
    it('returns false for empty roles array', () => {
      expect(svc.can([], Permission.PROCESS_SALE)).toBe(false);
    });

    it('returns false for unknown role names (never crashes)', () => {
      expect(svc.can(['superuser'], Permission.PROCESS_SALE)).toBe(false);
    });

    it('Operator CAN process sales', () => {
      expect(svc.can([RoleName.OPERATOR], Permission.PROCESS_SALE)).toBe(true);
    });

    it('Operator CANNOT adjust stock', () => {
      expect(svc.can([RoleName.OPERATOR], Permission.ADJUST_STOCK)).toBe(false);
    });

    it('Manager CAN adjust stock', () => {
      expect(svc.can([RoleName.MANAGER], Permission.ADJUST_STOCK)).toBe(true);
    });

    it('Admin CAN adjust stock (inherits Manager permissions)', () => {
      expect(svc.can([RoleName.ADMIN], Permission.ADJUST_STOCK)).toBe(true);
    });

    it('Operator CANNOT manage inventory', () => {
      expect(svc.can([RoleName.OPERATOR], Permission.MANAGE_INVENTORY)).toBe(false);
    });

    it('Manager CAN manage inventory', () => {
      expect(svc.can([RoleName.MANAGER], Permission.MANAGE_INVENTORY)).toBe(true);
    });

    it('Admin CAN delete products', () => {
      expect(svc.can([RoleName.ADMIN], Permission.DELETE_PRODUCT)).toBe(true);
    });

    it('Manager CANNOT delete products', () => {
      expect(svc.can([RoleName.MANAGER], Permission.DELETE_PRODUCT)).toBe(false);
    });

    it('returns true if ANY supplied role has the permission (multi-role principal)', () => {
      // A principal carrying both operator and manager roles should pass
      expect(svc.can([RoleName.OPERATOR, RoleName.MANAGER], Permission.ADJUST_STOCK)).toBe(true);
    });
  });

  // ──────────────────────────────────────────────────────────────────────────
  // atLeast() — hierarchy evaluation
  // ──────────────────────────────────────────────────────────────────────────

  describe('atLeast()', () => {
    it('returns false for empty roles', () => {
      expect(svc.atLeast([], RoleName.OPERATOR)).toBe(false);
    });

    it('Operator atLeast Operator → true', () => {
      expect(svc.atLeast([RoleName.OPERATOR], RoleName.OPERATOR)).toBe(true);
    });

    it('Operator atLeast Manager → false', () => {
      expect(svc.atLeast([RoleName.OPERATOR], RoleName.MANAGER)).toBe(false);
    });

    it('Manager atLeast Manager → true', () => {
      expect(svc.atLeast([RoleName.MANAGER], RoleName.MANAGER)).toBe(true);
    });

    it('Manager atLeast Admin → false', () => {
      expect(svc.atLeast([RoleName.MANAGER], RoleName.ADMIN)).toBe(false);
    });

    it('Admin atLeast Admin → true', () => {
      expect(svc.atLeast([RoleName.ADMIN], RoleName.ADMIN)).toBe(true);
    });

    it('Admin atLeast Operator → true', () => {
      expect(svc.atLeast([RoleName.ADMIN], RoleName.OPERATOR)).toBe(true);
    });
  });

  // ──────────────────────────────────────────────────────────────────────────
  // assert() — throwing version
  // ──────────────────────────────────────────────────────────────────────────

  describe('assert()', () => {
    it('does not throw when permission is granted', () => {
      expect(() => svc.assert([RoleName.MANAGER], Permission.ADJUST_STOCK)).not.toThrow();
    });

    it('throws AuthorizationError when permission is denied', () => {
      expect(() => svc.assert([RoleName.OPERATOR], Permission.ADJUST_STOCK)).toThrow(
        AuthorizationError
      );
    });

    it('AuthorizationError carries the denied permission', () => {
      let caught: AuthorizationError | undefined;
      try {
        svc.assert([RoleName.OPERATOR], Permission.ADJUST_STOCK);
      } catch (e) {
        caught = e as AuthorizationError;
      }
      expect(caught?.permission).toBe(Permission.ADJUST_STOCK);
      expect(caught?.code).toBe('AUTHORIZATION_DENIED');
    });

    it('throws for empty roles', () => {
      expect(() => svc.assert([], Permission.PROCESS_SALE)).toThrow(AuthorizationError);
    });
  });
});
