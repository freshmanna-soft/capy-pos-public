import { describe, it, expect } from 'vitest';
import { AuthorizationService, AuthorizationError } from './authorization.service';
import { Permission } from './permission.constants';
import { Role, RoleName } from './role.value-object';

describe('AuthorizationService', () => {
  let svc: AuthorizationService;

  beforeEach(() => {
    svc = new AuthorizationService();
  });

  // ──────────────────────────────────────────────────────────────────────────
  // can() — permission evaluation (roles carry their own permission set)
  // ──────────────────────────────────────────────────────────────────────────

  describe('can()', () => {
    it('returns false for empty roles array', () => {
      expect(svc.can([], Permission.PROCESS_SALE)).toBe(false);
    });

    it('returns false for a custom role lacking the permission (never crashes)', () => {
      const custom = Role.fromRecord({ name: 'superuser', permissions: [], level: 1 });
      expect(svc.can([custom], Permission.PROCESS_SALE)).toBe(false);
    });

    it('honours a data-driven custom role that DOES grant the permission', () => {
      const custom = Role.fromRecord({
        name: 'stock-clerk',
        permissions: [Permission.ADJUST_STOCK],
        level: 1,
      });
      expect(svc.can([custom], Permission.ADJUST_STOCK)).toBe(true);
      expect(svc.can([custom], Permission.PROCESS_REFUND)).toBe(false);
    });

    it('Operator CAN process sales', () => {
      expect(svc.can([Role.operator()], Permission.PROCESS_SALE)).toBe(true);
    });

    it('Operator CANNOT adjust stock', () => {
      expect(svc.can([Role.operator()], Permission.ADJUST_STOCK)).toBe(false);
    });

    it('Manager CAN adjust stock', () => {
      expect(svc.can([Role.manager()], Permission.ADJUST_STOCK)).toBe(true);
    });

    it('Admin CAN adjust stock (inherits Manager permissions)', () => {
      expect(svc.can([Role.admin()], Permission.ADJUST_STOCK)).toBe(true);
    });

    it('Operator CANNOT manage inventory', () => {
      expect(svc.can([Role.operator()], Permission.MANAGE_INVENTORY)).toBe(false);
    });

    it('Manager CAN manage inventory', () => {
      expect(svc.can([Role.manager()], Permission.MANAGE_INVENTORY)).toBe(true);
    });

    it('Admin CAN delete products', () => {
      expect(svc.can([Role.admin()], Permission.DELETE_PRODUCT)).toBe(true);
    });

    it('Manager CANNOT delete products', () => {
      expect(svc.can([Role.manager()], Permission.DELETE_PRODUCT)).toBe(false);
    });

    it('returns true if ANY supplied role has the permission (multi-role principal)', () => {
      expect(svc.can([Role.operator(), Role.manager()], Permission.ADJUST_STOCK)).toBe(true);
    });
  });

  // ──────────────────────────────────────────────────────────────────────────
  // atLeast() — hierarchy evaluation (by level)
  // ──────────────────────────────────────────────────────────────────────────

  describe('atLeast()', () => {
    it('returns false for empty roles', () => {
      expect(svc.atLeast([], RoleName.OPERATOR)).toBe(false);
    });

    it('Operator atLeast Operator → true', () => {
      expect(svc.atLeast([Role.operator()], RoleName.OPERATOR)).toBe(true);
    });

    it('Operator atLeast Manager → false', () => {
      expect(svc.atLeast([Role.operator()], RoleName.MANAGER)).toBe(false);
    });

    it('Manager atLeast Manager → true', () => {
      expect(svc.atLeast([Role.manager()], RoleName.MANAGER)).toBe(true);
    });

    it('Manager atLeast Admin → false', () => {
      expect(svc.atLeast([Role.manager()], RoleName.ADMIN)).toBe(false);
    });

    it('Admin atLeast Admin → true', () => {
      expect(svc.atLeast([Role.admin()], RoleName.ADMIN)).toBe(true);
    });

    it('Admin atLeast Operator → true', () => {
      expect(svc.atLeast([Role.admin()], RoleName.OPERATOR)).toBe(true);
    });

    it('a custom role uses its own level for the hierarchy check', () => {
      const senior = Role.fromRecord({ name: 'senior', permissions: [], level: 2 });
      expect(svc.atLeast([senior], RoleName.MANAGER)).toBe(true);
      expect(svc.atLeast([senior], RoleName.ADMIN)).toBe(false);
    });
  });

  // ──────────────────────────────────────────────────────────────────────────
  // assert() — throwing version
  // ──────────────────────────────────────────────────────────────────────────

  describe('assert()', () => {
    it('does not throw when permission is granted', () => {
      expect(() => svc.assert([Role.manager()], Permission.ADJUST_STOCK)).not.toThrow();
    });

    it('throws AuthorizationError when permission is denied', () => {
      expect(() => svc.assert([Role.operator()], Permission.ADJUST_STOCK)).toThrow(
        AuthorizationError
      );
    });

    it('AuthorizationError carries the denied permission', () => {
      let caught: AuthorizationError | undefined;
      try {
        svc.assert([Role.operator()], Permission.ADJUST_STOCK);
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
