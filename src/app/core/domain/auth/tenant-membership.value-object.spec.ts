import { describe, it, expect } from 'vitest';
import { TenantMembership } from './tenant-membership.value-object';
import { TenantId } from './tenant-id.value-object';
import { Role, RoleName } from './role.value-object';

describe('TenantMembership Value Object', () => {
  describe('construction', () => {
    it('pairs a TenantId with a Role', () => {
      const m = new TenantMembership(new TenantId('store-a'), Role.manager());
      expect(m.tenantId.value).toBe('store-a');
      expect(m.role.name).toBe(RoleName.MANAGER);
    });

    it('throws when tenantId is not a TenantId', () => {
      expect(() => new TenantMembership('store-a' as unknown as TenantId, Role.manager())).toThrow(
        'TenantMembership requires a TenantId'
      );
    });

    it('throws when role is not a Role', () => {
      expect(
        () => new TenantMembership(new TenantId('store-a'), 'manager' as unknown as Role)
      ).toThrow('TenantMembership requires a Role');
    });
  });

  describe('factory helpers', () => {
    it('of() builds from primitive strings', () => {
      const m = TenantMembership.of('store-b', RoleName.OPERATOR);
      expect(m.tenantId.value).toBe('store-b');
      expect(m.role.name).toBe(RoleName.OPERATOR);
    });

    it('of() rejects an unknown role name', () => {
      expect(() => TenantMembership.of('store-b', 'superuser')).toThrow(/Unknown role/);
    });

    it('of() rejects an invalid tenant id', () => {
      expect(() => TenantMembership.of('bad id!', RoleName.OPERATOR)).toThrow();
    });
  });

  describe('equality', () => {
    it('is equal when tenant and role match', () => {
      const a = TenantMembership.of('store-a', RoleName.MANAGER);
      const b = TenantMembership.of('store-a', RoleName.MANAGER);
      expect(a.equals(b)).toBe(true);
    });

    it('is not equal when tenant differs', () => {
      const a = TenantMembership.of('store-a', RoleName.MANAGER);
      const b = TenantMembership.of('store-b', RoleName.MANAGER);
      expect(a.equals(b)).toBe(false);
    });

    it('is not equal when role differs', () => {
      const a = TenantMembership.of('store-a', RoleName.MANAGER);
      const b = TenantMembership.of('store-a', RoleName.OPERATOR);
      expect(a.equals(b)).toBe(false);
    });

    it('returns false when compared with a non-TenantMembership', () => {
      const a = TenantMembership.of('store-a', RoleName.MANAGER);
      expect(a.equals('store-a:manager' as unknown as TenantMembership)).toBe(false);
    });
  });

  describe('serialisation', () => {
    it('toJSON returns plain tenant + role', () => {
      const m = TenantMembership.of('store-a', RoleName.ADMIN);
      expect(m.toJSON()).toEqual({ tenantId: 'store-a', role: RoleName.ADMIN });
    });

    it('toString is a compact tenant:role token', () => {
      const m = TenantMembership.of('store-a', RoleName.ADMIN);
      expect(m.toString()).toBe('store-a:admin');
    });

    it('fromJSON round-trips correctly', () => {
      const m = TenantMembership.fromJSON({ tenantId: 'store-c', role: RoleName.OPERATOR });
      expect(m.tenantId.value).toBe('store-c');
      expect(m.role.name).toBe(RoleName.OPERATOR);
    });
  });

  describe('immutability', () => {
    it('is frozen', () => {
      expect(Object.isFrozen(TenantMembership.of('store-a', RoleName.MANAGER))).toBe(true);
    });
  });
});
