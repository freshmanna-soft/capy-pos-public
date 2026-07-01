import { TestBed } from '@angular/core/testing';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { DexieOperatorAdminAdapter } from './dexie-operator-admin.adapter';
import {
  DexieDatabase,
  IOperatorDB,
  IRoleDB,
  IUserTenantDB,
} from '@core/infrastructure/database/dexie-database.service';

// ---------------------------------------------------------------------------
// Fixtures — real Dexie via fake-indexeddb (loaded in vitest.setup)
// ---------------------------------------------------------------------------

const now = new Date();

function operatorRow(overrides: Partial<IOperatorDB> = {}): IOperatorDB {
  return {
    id: 'op-1',
    email: 'op1@capy.local',
    displayName: 'Operator One',
    roleId: 'role-operator',
    tenantId: 'store-a',
    passwordHash: 'pbkdf2:1:aa:bb',
    isActive: true,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

function roleRow(id: string, name: string): IRoleDB {
  return { id, name, permissions: '[]', createdAt: now, updatedAt: now };
}

function membershipRow(overrides: Partial<IUserTenantDB> = {}): IUserTenantDB {
  return {
    id: 'ut-op-1-store-a',
    userId: 'op-1',
    tenantId: 'store-a',
    roleId: 'role-operator',
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

describe('DexieOperatorAdminAdapter', () => {
  let db: DexieDatabase;
  let adapter: DexieOperatorAdminAdapter;

  beforeEach(async () => {
    db = new DexieDatabase();
    await db.open();

    TestBed.configureTestingModule({
      providers: [DexieOperatorAdminAdapter, { provide: DexieDatabase, useValue: db }],
    });
    adapter = TestBed.inject(DexieOperatorAdminAdapter);
  });

  afterEach(async () => {
    await db.delete();
  });

  it('lists operators who are members of the given tenant, with their per-tenant role', async () => {
    await db.roles.bulkAdd([roleRow('role-admin', 'admin'), roleRow('role-operator', 'operator')]);
    await db.operators.bulkAdd([
      operatorRow({ id: 'op-1', displayName: 'Alice', roleId: 'role-admin' }),
      operatorRow({ id: 'op-2', displayName: 'Bob', roleId: 'role-operator' }),
    ]);
    await db.userTenants.bulkAdd([
      membershipRow({ id: 'ut-1', userId: 'op-1', tenantId: 'store-a', roleId: 'role-admin' }),
      membershipRow({ id: 'ut-2', userId: 'op-2', tenantId: 'store-a', roleId: 'role-operator' }),
    ]);

    const result = await adapter.listOperatorsForTenant('store-a');

    expect(result).toHaveLength(2);
    expect(result.map((o) => o.displayName)).toEqual(['Alice', 'Bob']); // sorted
    expect(result.find((o) => o.id === 'op-1')?.roleName).toBe('admin');
    expect(result.find((o) => o.id === 'op-2')?.roleName).toBe('operator');
  });

  it('never exposes passwordHash on the summary', async () => {
    await db.roles.add(roleRow('role-operator', 'operator'));
    await db.operators.add(operatorRow());
    await db.userTenants.add(membershipRow());

    const [summary] = await adapter.listOperatorsForTenant('store-a');

    expect(summary).not.toHaveProperty('passwordHash');
  });

  it('enforces tenant isolation — excludes operators from other tenants', async () => {
    await db.roles.add(roleRow('role-operator', 'operator'));
    await db.operators.bulkAdd([
      operatorRow({ id: 'op-1', displayName: 'In Tenant' }),
      operatorRow({ id: 'op-2', displayName: 'Other Tenant' }),
    ]);
    await db.userTenants.bulkAdd([
      membershipRow({ id: 'ut-1', userId: 'op-1', tenantId: 'store-a', roleId: 'role-operator' }),
      membershipRow({ id: 'ut-2', userId: 'op-2', tenantId: 'store-b', roleId: 'role-operator' }),
    ]);

    const result = await adapter.listOperatorsForTenant('store-a');

    expect(result).toHaveLength(1);
    expect(result[0].id).toBe('op-1');
  });

  it('reflects the role held IN the listed tenant (same operator, different tenants)', async () => {
    await db.roles.bulkAdd([roleRow('role-admin', 'admin'), roleRow('role-operator', 'operator')]);
    await db.operators.add(operatorRow({ id: 'op-1', displayName: 'Multi' }));
    await db.userTenants.bulkAdd([
      membershipRow({ id: 'ut-a', userId: 'op-1', tenantId: 'store-a', roleId: 'role-admin' }),
      membershipRow({ id: 'ut-b', userId: 'op-1', tenantId: 'store-b', roleId: 'role-operator' }),
    ]);

    const inA = await adapter.listOperatorsForTenant('store-a');
    const inB = await adapter.listOperatorsForTenant('store-b');

    expect(inA[0].roleName).toBe('admin');
    expect(inB[0].roleName).toBe('operator');
  });

  it('resilient mapping: skips a membership whose operator record is missing', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    await db.roles.add(roleRow('role-operator', 'operator'));
    await db.operators.add(operatorRow({ id: 'op-1', displayName: 'Present' }));
    await db.userTenants.bulkAdd([
      membershipRow({ id: 'ut-1', userId: 'op-1', tenantId: 'store-a', roleId: 'role-operator' }),
      membershipRow({ id: 'ut-2', userId: 'ghost', tenantId: 'store-a', roleId: 'role-operator' }),
    ]);

    const result = await adapter.listOperatorsForTenant('store-a');

    expect(result).toHaveLength(1);
    expect(result[0].id).toBe('op-1');
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });

  it('data-driven: retains a custom role, surfacing its name and id', async () => {
    await db.roles.bulkAdd([
      roleRow('role-operator', 'operator'),
      roleRow('role-custom', 'kiosk-attendant'),
    ]);
    await db.operators.bulkAdd([
      operatorRow({ id: 'op-1', displayName: 'Known' }),
      operatorRow({ id: 'op-2', displayName: 'Custom' }),
    ]);
    await db.userTenants.bulkAdd([
      membershipRow({ id: 'ut-1', userId: 'op-1', tenantId: 'store-a', roleId: 'role-operator' }),
      membershipRow({ id: 'ut-2', userId: 'op-2', tenantId: 'store-a', roleId: 'role-custom' }),
    ]);

    const result = await adapter.listOperatorsForTenant('store-a');

    expect(result).toHaveLength(2);
    const custom = result.find((o) => o.id === 'op-2');
    expect(custom?.roleName).toBe('kiosk-attendant');
    expect(custom?.roleId).toBe('role-custom');
  });

  it('falls back to the roleId as name when the role record is missing (does not skip)', async () => {
    await db.operators.add(operatorRow({ id: 'op-1', displayName: 'Orphan' }));
    // membership references a role with no roles-table record
    await db.userTenants.add(
      membershipRow({ id: 'ut-1', userId: 'op-1', tenantId: 'store-a', roleId: 'role-gone' })
    );

    const result = await adapter.listOperatorsForTenant('store-a');

    expect(result).toHaveLength(1);
    expect(result[0].roleId).toBe('role-gone');
    expect(result[0].roleName).toBe('role-gone'); // fallback to id, not skipped
  });

  it('returns an empty array when the tenant has no members', async () => {
    const result = await adapter.listOperatorsForTenant('empty-tenant');
    expect(result).toEqual([]);
  });

  describe('assignRole / revokeMembership', () => {
    beforeEach(async () => {
      await db.roles.bulkAdd([
        roleRow('role-operator', 'operator'),
        roleRow('role-admin', 'admin'),
      ]);
      await db.operators.add(operatorRow({ id: 'op-1', displayName: 'Alice' }));
    });

    it('assignRole upserts the userTenants row (one role per tenant)', async () => {
      await adapter.assignRole('op-1', 'store-a', 'role-operator');
      let list = await adapter.listOperatorsForTenant('store-a');
      expect(list).toHaveLength(1);
      expect(list[0].roleId).toBe('role-operator');

      // Reassign — must overwrite, not duplicate.
      await adapter.assignRole('op-1', 'store-a', 'role-admin');
      list = await adapter.listOperatorsForTenant('store-a');
      expect(list).toHaveLength(1);
      expect(list[0].roleId).toBe('role-admin');
    });

    it('assignRole throws for an unknown operator or role', async () => {
      await expect(adapter.assignRole('ghost', 'store-a', 'role-admin')).rejects.toThrow(
        /Operator/
      );
      await expect(adapter.assignRole('op-1', 'store-a', 'role-ghost')).rejects.toThrow(/Role/);
    });

    it('revokeMembership removes the row (and is idempotent)', async () => {
      await adapter.assignRole('op-1', 'store-a', 'role-admin');
      await adapter.revokeMembership('op-1', 'store-a');
      expect(await adapter.listOperatorsForTenant('store-a')).toEqual([]);
      // second revoke is a no-op, does not throw
      await expect(adapter.revokeMembership('op-1', 'store-a')).resolves.toBeUndefined();
    });
  });
});
