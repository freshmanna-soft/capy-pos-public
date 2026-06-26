import { describe, it, expect } from 'vitest';
import { TenantMembershipSet, TenantIsolationError } from './tenant-membership-set';
import { TenantMembership } from './tenant-membership.value-object';
import { TenantId } from './tenant-id.value-object';
import { RoleName } from './role.value-object';

const storeA = new TenantId('store-a');
const storeB = new TenantId('store-b');
const storeC = new TenantId('store-c');

describe('TenantMembershipSet', () => {
  describe('construction', () => {
    it('accepts an empty set', () => {
      const set = new TenantMembershipSet([]);
      expect(set.isEmpty).toBe(true);
      expect(set.size).toBe(0);
    });

    it('exposes its memberships', () => {
      const set = new TenantMembershipSet([
        TenantMembership.of('store-a', RoleName.ADMIN),
        TenantMembership.of('store-b', RoleName.OPERATOR),
      ]);
      expect(set.size).toBe(2);
      expect(set.isEmpty).toBe(false);
    });

    it('throws on duplicate tenant (one role per tenant — join PK)', () => {
      expect(
        () =>
          new TenantMembershipSet([
            TenantMembership.of('store-a', RoleName.ADMIN),
            TenantMembership.of('store-a', RoleName.OPERATOR),
          ])
      ).toThrow(/Duplicate membership for tenant 'store-a'/);
    });

    it('is frozen', () => {
      expect(Object.isFrozen(new TenantMembershipSet([]))).toBe(true);
    });
  });

  describe('membership queries', () => {
    const set = new TenantMembershipSet([
      TenantMembership.of('store-a', RoleName.ADMIN),
      TenantMembership.of('store-b', RoleName.OPERATOR),
    ]);

    it('isMemberOf is true for a joined tenant', () => {
      expect(set.isMemberOf(storeA)).toBe(true);
      expect(set.isMemberOf(storeB)).toBe(true);
    });

    it('isMemberOf is false for a foreign tenant', () => {
      expect(set.isMemberOf(storeC)).toBe(false);
    });

    it('tenantIds lists every joined tenant', () => {
      expect(
        set
          .tenantIds()
          .map((t) => t.value)
          .sort()
      ).toEqual(['store-a', 'store-b']);
    });

    it('membershipFor returns the matching membership', () => {
      expect(set.membershipFor(storeA)?.role.name).toBe(RoleName.ADMIN);
    });

    it('membershipFor returns null for a foreign tenant', () => {
      expect(set.membershipFor(storeC)).toBeNull();
    });

    it('all() exposes every membership in insertion order', () => {
      expect(set.all().map((m) => m.toString())).toEqual(['store-a:admin', 'store-b:operator']);
    });
  });

  // ──────────────────────────────────────────────────────────────────────────
  // Scenario: Multi-tenant membership — switching active tenant changes role
  // ──────────────────────────────────────────────────────────────────────────
  describe('roleFor() — per-tenant role on switch', () => {
    const set = new TenantMembershipSet([
      TenantMembership.of('store-a', RoleName.ADMIN),
      TenantMembership.of('store-b', RoleName.OPERATOR),
    ]);

    it('resolves the role held in the active tenant', () => {
      expect(set.roleFor(storeA)?.name).toBe(RoleName.ADMIN);
      expect(set.roleFor(storeB)?.name).toBe(RoleName.OPERATOR);
    });

    it('returns null when the user is not a member', () => {
      expect(set.roleFor(storeC)).toBeNull();
    });
  });

  // ──────────────────────────────────────────────────────────────────────────
  // Scenario: Isolation enforced — access denied to a non-member tenant
  // ──────────────────────────────────────────────────────────────────────────
  describe('isolation enforcement', () => {
    const set = new TenantMembershipSet([TenantMembership.of('store-a', RoleName.MANAGER)]);

    it('requireRoleFor returns the role for a member tenant', () => {
      expect(set.requireRoleFor(storeA).name).toBe(RoleName.MANAGER);
    });

    it('requireRoleFor throws TenantIsolationError for a foreign tenant', () => {
      expect(() => set.requireRoleFor(storeB)).toThrow(TenantIsolationError);
    });

    it('assertMemberOf does not throw for a member tenant', () => {
      expect(() => set.assertMemberOf(storeA)).not.toThrow();
    });

    it('assertMemberOf throws TenantIsolationError for a foreign tenant', () => {
      expect(() => set.assertMemberOf(storeB)).toThrow(TenantIsolationError);
    });

    it('TenantIsolationError carries the denied tenant id and a stable code', () => {
      let caught: TenantIsolationError | undefined;
      try {
        set.assertMemberOf(storeB);
      } catch (e) {
        caught = e as TenantIsolationError;
      }
      expect(caught?.tenantId).toBe('store-b');
      expect(caught?.code).toBe('TENANT_ISOLATION_DENIED');
      expect(caught).toBeInstanceOf(Error);
    });
  });

  describe('serialisation', () => {
    it('toJSON returns plain membership rows', () => {
      const set = new TenantMembershipSet([
        TenantMembership.of('store-a', RoleName.ADMIN),
        TenantMembership.of('store-b', RoleName.OPERATOR),
      ]);
      expect(set.toJSON()).toEqual([
        { tenantId: 'store-a', role: RoleName.ADMIN },
        { tenantId: 'store-b', role: RoleName.OPERATOR },
      ]);
    });

    it('fromJSON round-trips correctly', () => {
      const set = TenantMembershipSet.fromJSON([
        { tenantId: 'store-a', role: RoleName.ADMIN },
        { tenantId: 'store-b', role: RoleName.OPERATOR },
      ]);
      expect(set.size).toBe(2);
      expect(set.roleFor(storeA)?.name).toBe(RoleName.ADMIN);
    });
  });
});
