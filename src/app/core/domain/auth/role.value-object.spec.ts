import { describe, it, expect } from 'vitest';
import { Role, RoleName } from './role.value-object';
import { Permission } from './permission.constants';

describe('Role Value Object', () => {
  describe('construction via named factory methods', () => {
    it('creates an Operator role', () => {
      const r = Role.operator();
      expect(r.name).toBe(RoleName.OPERATOR);
    });

    it('creates a Manager role', () => {
      const r = Role.manager();
      expect(r.name).toBe(RoleName.MANAGER);
    });

    it('creates an Admin role', () => {
      const r = Role.admin();
      expect(r.name).toBe(RoleName.ADMIN);
    });

    it('creates from name string', () => {
      expect(Role.fromName('admin').name).toBe(RoleName.ADMIN);
    });

    it('throws for unknown role name', () => {
      expect(() => Role.fromName('superuser')).toThrow('Unknown role');
    });
  });

  describe('permission set', () => {
    it('Operator has PROCESS_SALE permission', () => {
      expect(Role.operator().hasPermission(Permission.PROCESS_SALE)).toBe(true);
    });

    it('Operator does NOT have MANAGE_SETTINGS', () => {
      expect(Role.operator().hasPermission(Permission.MANAGE_SETTINGS)).toBe(false);
    });

    it('Manager has APPLY_DISCOUNT (not in Operator set)', () => {
      expect(Role.manager().hasPermission(Permission.APPLY_DISCOUNT)).toBe(true);
    });

    it('Manager inherits Operator permissions (PROCESS_SALE)', () => {
      expect(Role.manager().hasPermission(Permission.PROCESS_SALE)).toBe(true);
    });

    it('Admin has all permissions including MANAGE_SETTINGS', () => {
      expect(Role.admin().hasPermission(Permission.MANAGE_SETTINGS)).toBe(true);
    });

    it('Admin inherits Manager permissions (APPLY_DISCOUNT)', () => {
      expect(Role.admin().hasPermission(Permission.APPLY_DISCOUNT)).toBe(true);
    });
  });

  describe('hierarchy', () => {
    it('Admin level (3) > Manager level (2) > Operator level (1)', () => {
      expect(Role.admin().level).toBe(3);
      expect(Role.manager().level).toBe(2);
      expect(Role.operator().level).toBe(1);
    });

    it('Admin.atLeast(Manager) is true', () => {
      expect(Role.admin().atLeast(Role.manager())).toBe(true);
    });

    it('Manager.atLeast(Manager) is true', () => {
      expect(Role.manager().atLeast(Role.manager())).toBe(true);
    });

    it('Operator.atLeast(Manager) is false', () => {
      expect(Role.operator().atLeast(Role.manager())).toBe(false);
    });

    it('Admin.outranks(Manager) is true', () => {
      expect(Role.admin().outranks(Role.manager())).toBe(true);
    });

    it('Manager.outranks(Manager) is false', () => {
      expect(Role.manager().outranks(Role.manager())).toBe(false);
    });

    it('Operator.outranks(Admin) is false', () => {
      expect(Role.operator().outranks(Role.admin())).toBe(false);
    });
  });

  describe('equality', () => {
    it('two Operator roles are equal', () => {
      expect(Role.operator().equals(Role.operator())).toBe(true);
    });

    it('Admin and Manager are not equal', () => {
      expect(Role.admin().equals(Role.manager())).toBe(false);
    });

    it('returns false when compared with a non-Role', () => {
      expect(Role.admin().equals('admin' as unknown as Role)).toBe(false);
    });
  });

  describe('serialisation', () => {
    it('toJSON includes name and permissions array', () => {
      const json = Role.operator().toJSON();
      expect(json.name).toBe(RoleName.OPERATOR);
      expect(Array.isArray(json.permissions)).toBe(true);
      expect(json.permissions).toContain(Permission.PROCESS_SALE);
    });

    it('toString returns role name', () => {
      expect(Role.admin().toString()).toBe(RoleName.ADMIN);
    });
  });

  describe('Role.all()', () => {
    it('returns all 3 roles in ascending privilege order', () => {
      const all = Role.all();
      expect(all).toHaveLength(3);
      expect(all[0].name).toBe(RoleName.OPERATOR);
      expect(all[1].name).toBe(RoleName.MANAGER);
      expect(all[2].name).toBe(RoleName.ADMIN);
    });
  });

  describe('immutability', () => {
    it('Role instances are frozen', () => {
      expect(Object.isFrozen(Role.operator())).toBe(true);
    });
  });
});
