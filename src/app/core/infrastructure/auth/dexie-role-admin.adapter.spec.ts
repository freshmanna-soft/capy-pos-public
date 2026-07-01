import { TestBed } from '@angular/core/testing';
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { DexieRoleAdminAdapter } from './dexie-role-admin.adapter';
import {
  DexieDatabase,
  IRoleDB,
  IUserTenantDB,
} from '@core/infrastructure/database/dexie-database.service';
import { Permission } from '@core/domain/auth/permission.constants';

const now = new Date();
const roleRow = (id: string, name: string, permissions: string[] = [], level = 1): IRoleDB => ({
  id,
  name,
  permissions: JSON.stringify(permissions),
  level,
  createdAt: now,
  updatedAt: now,
});

describe('DexieRoleAdminAdapter', () => {
  let db: DexieDatabase;
  let adapter: DexieRoleAdminAdapter;

  beforeEach(async () => {
    db = new DexieDatabase();
    await db.open();
    await db.roles.clear(); // start from a known set (open() may seed defaults)
    await db.roles.bulkAdd([
      roleRow('role-operator', 'operator', [Permission.PROCESS_SALE], 1),
      roleRow('role-admin', 'admin', [Permission.MANAGE_ROLES], 3),
    ]);
    TestBed.configureTestingModule({
      providers: [DexieRoleAdminAdapter, { provide: DexieDatabase, useValue: db }],
    });
    adapter = TestBed.inject(DexieRoleAdminAdapter);
  });

  afterEach(async () => {
    await db.delete();
  });

  it('listRoles returns roles with permissions, level, and isBuiltIn flag', async () => {
    const roles = await adapter.listRoles();
    const admin = roles.find((r) => r.name === 'admin');
    expect(admin?.isBuiltIn).toBe(true);
    expect(admin?.level).toBe(3);
    expect(admin?.permissions).toContain(Permission.MANAGE_ROLES);
  });

  it('tolerates a role row with malformed permissions JSON and a missing level', async () => {
    await db.roles.add({
      id: 'role-broken',
      name: 'broken',
      permissions: '{not json',
      createdAt: now,
      updatedAt: now,
    } as IRoleDB); // no level → defaults to 1
    const broken = (await adapter.listRoles()).find((r) => r.id === 'role-broken');
    expect(broken?.permissions).toEqual([]); // corrupt JSON → no permissions
    expect(broken?.level).toBe(1); // missing level → default
  });

  it('createRole persists a custom role and drops unknown permissions', async () => {
    const id = await adapter.createRole({
      name: 'kiosk',
      permissions: [Permission.PROCESS_SALE, 'bogus:perm' as Permission],
      level: 1,
    });
    const stored = await db.roles.get(id);
    expect(stored?.name).toBe('kiosk');
    expect(JSON.parse(stored!.permissions)).toEqual([Permission.PROCESS_SALE]); // bogus dropped
  });

  it('createRole rejects a duplicate or built-in name', async () => {
    await expect(adapter.createRole({ name: 'admin', permissions: [] })).rejects.toThrow(
      /built-in/
    );
    await adapter.createRole({ name: 'kiosk', permissions: [] });
    await expect(adapter.createRole({ name: 'kiosk', permissions: [] })).rejects.toThrow(
      /already exists/
    );
  });

  it('updateRolePermissions edits a custom role but refuses a built-in', async () => {
    const id = await adapter.createRole({ name: 'kiosk', permissions: [] });
    await adapter.updateRolePermissions(id, [Permission.VIEW_INVENTORY]);
    expect((await adapter.listRoles()).find((r) => r.id === id)?.permissions).toEqual([
      Permission.VIEW_INVENTORY,
    ]);

    await expect(
      adapter.updateRolePermissions('role-admin', [Permission.PROCESS_SALE])
    ).rejects.toThrow(/Built-in/);
  });

  it('deleteRole removes a custom role, refuses built-ins, and refuses in-use roles', async () => {
    // built-in guard
    await expect(adapter.deleteRole('role-admin')).rejects.toThrow(/cannot be deleted/);

    const id = await adapter.createRole({ name: 'kiosk', permissions: [] });
    // in-use guard
    await db.userTenants.add({
      id: 'ut-x',
      userId: 'op-1',
      tenantId: 'store-a',
      roleId: id,
      createdAt: now,
      updatedAt: now,
    } satisfies IUserTenantDB);
    await expect(adapter.deleteRole(id)).rejects.toThrow(/assigned to/);

    // once unused, it deletes
    await db.userTenants.delete('ut-x');
    await adapter.deleteRole(id);
    expect(await db.roles.get(id)).toBeUndefined();
  });
});
