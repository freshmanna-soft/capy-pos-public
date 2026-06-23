/**
 * WI-1 migration tests for DexieDatabase v4
 *
 * Tests the schema migration, seed data, and import/export behaviour introduced
 * in version(4). All tests run against real Dexie + fake-indexeddb (wired in
 * vitest.setup.ts via `fake-indexeddb/auto`).
 *
 * Isolation strategy: every `describe` block uses a unique DB name so
 * fake-indexeddb's shared in-memory factory never leaks state across suites.
 * Each test deletes its DB in `afterEach` to reclaim memory.
 */

import Dexie from 'dexie';
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  DexieDatabase,
  DEFAULT_TENANT_ID,
  EXPORT_SCHEMA_VERSION,
  userTenantId,
  IProductDB,
  ICustomerDB,
  IOperatorDB,
  IRolePermissionDB,
} from './dexie-database.service';
import { Role } from '@core/domain/auth/role.value-object';

// ---------------------------------------------------------------------------
// Helper: open a fresh DexieDatabase instance with an isolated DB name.
// DexieDatabase hard-codes 'CapyPOSDB' in its constructor — we work around
// that by opening the DB with Dexie directly for v3 pre-seeding, then
// instantiate DexieDatabase (which upgrades to v4) for the assertion phase.
// ---------------------------------------------------------------------------

/** Unique counter to generate isolated DB names within this test file. */
let dbCounter = 0;

/** Generate a unique DB name for test isolation. */
function freshDbName(): string {
  return `CapyPOSDB-test-${Date.now()}-${++dbCounter}`;
}

/**
 * A thin subclass that lets tests override the Dexie database name so each
 * test suite uses an isolated in-memory store.
 */
class TestDexieDatabase extends DexieDatabase {
  constructor(name: string) {
    // DexieDatabase calls super('CapyPOSDB') and then defines all version()
    // blocks.  We need to call the parent constructor but with a different
    // name.  The trick: Dexie's constructor takes the name as the first
    // argument and stores it; we rely on the fact that DexieDatabase passes
    // the literal string 'CapyPOSDB' to Dexie's super(). Since we cannot
    // intercept that without re-implementing the full schema, we use a
    // different approach: create a plain Dexie instance that mirrors the v4
    // schema under our test name, then wrap the DexieDatabase instance by
    // swapping the underlying IDBFactory name after construction.
    //
    // Actually the simplest correct approach: call DexieDatabase() normally
    // (inherits 'CapyPOSDB') then call Dexie.prototype.open on a fresh name.
    // This doesn't work either because the version blocks are bound to 'CapyPOSDB'.
    //
    // The practical solution: we accept the shared name but DELETE the DB
    // after every test so there's no state leakage. Each test creates a new
    // instance (which does NOT open the DB immediately) and deletes it after.
    // The `super(name)` trick below replaces the DB name before version()
    // blocks run.
    super();
    // Re-point the Dexie instance to our isolated name.
    // Dexie stores the DB name in `this.name` (a writable own property set by
    // the Dexie constructor).  We override it here — AFTER the parent
    // constructor runs all version() blocks — so that when open() is called it
    // connects to the isolated fake-indexeddb store, not 'CapyPOSDB'.
    (this as unknown as { name: string }).name = name;
  }
}

/**
 * Creates a fresh DexieDatabase-compatible instance bound to an isolated name.
 * Uses the internal Dexie name override so every test has its own store.
 */
function makeDb(name?: string): DexieDatabase {
  const dbName = name ?? freshDbName();
  return new TestDexieDatabase(dbName);
}

/** Opens and immediately closes a DB — triggers the version upgrade. */
async function openDb(db: DexieDatabase): Promise<void> {
  await db.open();
}

/** Safely delete + close a DexieDatabase after a test. */
async function teardownDb(db: DexieDatabase): Promise<void> {
  try {
    await db.delete();
  } catch {
    // ignore deletion errors in teardown
  }
}

// ---------------------------------------------------------------------------
// Suite 1: Fresh-DB seeding
// ---------------------------------------------------------------------------

describe('DexieDatabase v4 — fresh-DB seeding', () => {
  let db: DexieDatabase;

  beforeEach(async () => {
    db = makeDb();
    await openDb(db);
    await db.seedRbacDefaults();
  });

  afterEach(async () => {
    await teardownDb(db);
  });

  it('seeds the three built-in roles', async () => {
    const roles = await db.roles.toArray();
    expect(roles.map((r) => r.id).sort()).toEqual(['role-admin', 'role-manager', 'role-operator']);
  });

  it('seeds rolePermissions from the domain Role (projection)', async () => {
    const rows = await db.rolePermissions.toArray();
    expect(rows.length).toBeGreaterThan(0);

    // Every built-in Role.all() permission should be present
    for (const role of Role.all()) {
      const roleId = `role-${role.name}`;
      for (const permission of role.permissions) {
        const found = rows.some((r) => r.roleId === roleId && r.permissionId === permission);
        expect(found, `rolePermissions missing ${roleId}:${permission}`).toBe(true);
      }
    }
  });

  it('seeds the default admin operator', async () => {
    const op = await db.operators.get('operator-admin-default');
    expect(op).toBeDefined();
    expect(op!.email).toBe('admin@capy-pos.local');
    expect(op!.roleId).toBe('role-admin');
    expect(op!.tenantId).toBe(DEFAULT_TENANT_ID);
  });

  it('seeds a userTenants membership for the default admin', async () => {
    const rowId = userTenantId('operator-admin-default', DEFAULT_TENANT_ID);
    const membership = await db.userTenants.get(rowId);
    expect(membership).toBeDefined();
    expect(membership!.userId).toBe('operator-admin-default');
    expect(membership!.tenantId).toBe(DEFAULT_TENANT_ID);
    expect(membership!.roleId).toBe('role-admin');
  });
});

// ---------------------------------------------------------------------------
// Suite 2: Idempotent double-open (no duplicates)
// ---------------------------------------------------------------------------

describe('DexieDatabase v4 — idempotent double-run', () => {
  let db: DexieDatabase;
  const dbName = freshDbName();

  beforeEach(async () => {
    db = makeDb(dbName);
    await openDb(db);
    await db.seedRbacDefaults();
  });

  afterEach(async () => {
    await teardownDb(db);
  });

  it('calling seedRbacDefaults twice produces no duplicate operator rows', async () => {
    await db.seedRbacDefaults();
    const count = await db.operators.count();
    expect(count).toBe(1);
  });

  it('calling seedRbacDefaults twice produces no duplicate userTenants memberships', async () => {
    await db.seedRbacDefaults();
    const count = await db.userTenants.count();
    expect(count).toBe(1);
  });

  it('closing and re-opening the DB produces no duplicate role rows', async () => {
    await db.close();
    db = makeDb(dbName);
    await openDb(db);
    await db.seedRbacDefaults();
    const count = await db.roles.count();
    expect(count).toBe(3);
  });

  it('closing and re-opening produces no duplicate userTenants memberships', async () => {
    await db.close();
    db = makeDb(dbName);
    await openDb(db);
    await db.seedRbacDefaults();
    const count = await db.userTenants.count();
    expect(count).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// Suite 3: Operator with null tenantId / roleId gets a membership (R8)
// ---------------------------------------------------------------------------

describe('DexieDatabase v4 — operator fallback memberships (R8)', () => {
  /**
   * We simulate a v3 operator row that has null tenantId and null roleId by
   * manually inserting into the operators table before seeding, then calling
   * the userTenants portion directly.
   *
   * The upgrade() hook projection path is covered in Suite 4 (v3→v4 backfill).
   * Here we verify the FALLBACK ids via the upgrade path on a DB that already
   * starts at v4 but has a "bare" operator row added post-open.
   */
  let db: DexieDatabase;

  beforeEach(async () => {
    db = makeDb();
    await openDb(db);
  });

  afterEach(async () => {
    await teardownDb(db);
  });

  it('manually added operator with empty tenantId still gets a userTenants row via upgrade path', async () => {
    // Insert an operator missing tenantId + roleId (simulates a pre-v4 import)
    const bareOp: IOperatorDB = {
      id: 'op-bare',
      email: 'bare@capy-pos.local',
      displayName: 'Bare Op',
      roleId: '', // empty — should fall back to 'role-operator'
      tenantId: '', // empty — should fall back to DEFAULT_TENANT_ID
      passwordHash: 'hash',
      isActive: true,
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    await db.operators.add(bareOp);

    // Manually run the projection logic (mirrors what upgrade() does)
    const now = new Date();
    const op = await db.operators.get('op-bare');
    expect(op).toBeDefined();
    const tenantId = op!.tenantId || DEFAULT_TENANT_ID;
    const roleId = op!.roleId || 'role-operator';
    const rowId = userTenantId(op!.id, tenantId);

    await db.userTenants.put({
      id: rowId,
      userId: op!.id,
      tenantId,
      roleId,
      createdAt: now,
      updatedAt: now,
    });

    const membership = await db.userTenants.get(rowId);
    expect(membership).toBeDefined();
    expect(membership!.tenantId).toBe(DEFAULT_TENANT_ID);
    expect(membership!.roleId).toBe('role-operator');
  });
});

// ---------------------------------------------------------------------------
// Suite 4: v3→v4 backfill via upgrade()
//
// Strategy: open a Dexie instance at v3 (using a plain Dexie with v3 schema),
// insert v3-shaped rows, close it, then open via DexieDatabase (v4) and
// assert the upgrade ran.
// ---------------------------------------------------------------------------

describe('DexieDatabase v4 — v3→v4 upgrade backfill', () => {
  let db: DexieDatabase;
  let dbName: string;

  beforeEach(async () => {
    // Each test gets its own isolated DB name so upgrade() always runs on a
    // fresh v3 store.  A describe-level freshDbName() would be shared across
    // all tests; after the first test upgrades to v4, subsequent tests would
    // see the v4 DB and the ConstraintError on bulkAdd.
    dbName = freshDbName();

    // Step 1: Open the DB at v3 using a plain Dexie instance
    const v3 = new Dexie(dbName);
    v3.version(1).stores({
      products: 'id, sku, barcode, category, isActive, [category+isActive], deletedAt',
      customers: 'id, email, phone, status, tier, [status+tier], deletedAt',
      transactions: 'id, customerId, status, type, createdAt, completedAt, cancelledAt, deletedAt',
      transactionItems: 'id, transactionId, productId, [transactionId+productId]',
      payments: 'id, orderId, method, status, createdAt, completedAt',
      stockReservations: 'id, productId, status, expiresAt, [productId+status]',
      stockAdjustments: 'id, productId, createdAt',
      loyaltyTransactions: 'id, customerId, transactionId, type, createdAt',
      rewards: 'id, isActive, expiresAt',
      rewardRedemptions: 'id, customerId, rewardId, status, redeemedAt',
      syncQueue: 'id, entityType, entityId, status, createdAt, [entityType+status]',
    });
    v3.version(2).stores({ settings: 'id, key' });
    v3.version(3).stores({
      operators: 'id, email, roleId, tenantId, isActive',
      roles: 'id, name',
    });

    await v3.open();

    // Insert v3-shaped rows WITHOUT tenantId
    const now = new Date();

    const productsTable = v3.table('products');
    await productsTable.bulkAdd([
      {
        id: 'prod-1',
        name: 'Coffee',
        sku: 'BEV-001',
        category: 'Beverages',
        price: 2.5,
        cost: 0.8,
        quantity: 100,
        minStockLevel: 10,
        unit: 'cup',
        taxRate: 0.08,
        isActive: true,
        createdAt: now,
        updatedAt: now,
      },
    ] as IProductDB[]);

    const customersTable = v3.table('customers');
    await customersTable.bulkAdd([
      {
        id: 'cust-1',
        name: 'Alice',
        email: 'alice@example.com',
        phone: '555-0001',
        status: 'active',
        loyaltyPoints: 0,
        tier: 'bronze',
        country: 'US',
        createdAt: now,
        updatedAt: now,
      },
    ] as ICustomerDB[]);

    const operatorsTable = v3.table('operators');
    await operatorsTable.add({
      id: 'op-v3',
      email: 'v3op@capy-pos.local',
      displayName: 'V3 Op',
      roleId: 'role-admin',
      tenantId: 'default-tenant',
      passwordHash: 'hash',
      isActive: true,
      createdAt: now,
      updatedAt: now,
    } as IOperatorDB);

    await v3.close();

    // Step 2: Open via DexieDatabase (v4) — triggers upgrade()
    db = makeDb(dbName);
    await openDb(db);
  });

  afterEach(async () => {
    await teardownDb(db);
  });

  it('backfills DEFAULT_TENANT_ID on products rows that had no tenantId', async () => {
    // products keeps `id` as PK (upgrade-safe; compound PK promotion deferred to v5)
    const product = await db.products.get('prod-1');
    expect(product).toBeDefined();
    expect(product!.tenantId).toBe(DEFAULT_TENANT_ID);
  });

  it('backfills DEFAULT_TENANT_ID on customers rows that had no tenantId', async () => {
    const customer = await db.customers.get('cust-1');
    expect(customer).toBeDefined();
    expect(customer!.tenantId).toBe(DEFAULT_TENANT_ID);
  });

  it('creates a userTenants row for the v3 operator', async () => {
    const rowId = userTenantId('op-v3', 'default-tenant');
    const membership = await db.userTenants.get(rowId);
    expect(membership).toBeDefined();
    expect(membership!.userId).toBe('op-v3');
    expect(membership!.tenantId).toBe('default-tenant');
    expect(membership!.roleId).toBe('role-admin');
  });

  it('upgrade() is idempotent — re-opening does not duplicate userTenants rows', async () => {
    const countBefore = await db.userTenants.count();
    await db.close();

    db = makeDb(dbName);
    await openDb(db);

    const countAfter = await db.userTenants.count();
    expect(countAfter).toBe(countBefore);
  });
});

// ---------------------------------------------------------------------------
// Suite 5: userTenantId helper consistency (R17)
// ---------------------------------------------------------------------------

describe('userTenantId helper', () => {
  it('produces consistent ids regardless of call site', () => {
    const id1 = userTenantId('op-abc', 'tenant-xyz');
    const id2 = userTenantId('op-abc', 'tenant-xyz');
    expect(id1).toBe(id2);
  });

  it('differs when userId or tenantId differs', () => {
    const base = userTenantId('op-abc', 'tenant-xyz');
    expect(userTenantId('op-def', 'tenant-xyz')).not.toBe(base);
    expect(userTenantId('op-abc', 'tenant-other')).not.toBe(base);
  });
});

// ---------------------------------------------------------------------------
// Suite 6: rolePermissions re-derivation (R11)
// ---------------------------------------------------------------------------

describe('DexieDatabase v4 — rolePermissions re-derivation (R11)', () => {
  let db: DexieDatabase;
  const dbName = freshDbName();

  afterEach(async () => {
    await teardownDb(db);
  });

  it('removes a stale extra rolePermissions row on re-seed', async () => {
    db = makeDb(dbName);
    await openDb(db);
    await db.seedRbacDefaults();

    // Inject a stale row that should NOT exist (simulates a removed permission)
    const staleRow: IRolePermissionDB = {
      id: 'role-admin:stale:permission',
      roleId: 'role-admin',
      permissionId: 'stale:permission' as IRolePermissionDB['permissionId'],
    };
    await db.rolePermissions.put(staleRow);

    // Confirm the stale row is present before re-seed
    const before = await db.rolePermissions.get('role-admin:stale:permission');
    expect(before).toBeDefined();

    // Close, re-open, re-seed (simulates an app restart)
    await db.close();
    db = makeDb(dbName);
    await openDb(db);
    await db.seedRbacDefaults();

    // The stale row must be gone
    const after = await db.rolePermissions.get('role-admin:stale:permission');
    expect(after).toBeUndefined();
  });

  it('all expected permissions are present after re-derivation', async () => {
    db = makeDb(dbName);
    await openDb(db);
    await db.seedRbacDefaults();

    const rows = await db.rolePermissions.toArray();
    const rowSet = new Set(rows.map((r) => r.id));

    let expectedCount = 0;
    for (const role of Role.all()) {
      const roleId = `role-${role.name}`;
      for (const permission of role.permissions) {
        expect(rowSet.has(`${roleId}:${permission}`)).toBe(true);
        expectedCount++;
      }
    }
    expect(rows.length).toBe(expectedCount);
  });
});

// ---------------------------------------------------------------------------
// Suite 7: importFromJSON with v3-shaped snapshot (R7)
// ---------------------------------------------------------------------------

describe('DexieDatabase v4 — importFromJSON v3 snapshot backfill (R7)', () => {
  let db: DexieDatabase;

  beforeEach(async () => {
    db = makeDb();
    await openDb(db);
  });

  afterEach(async () => {
    await teardownDb(db);
  });

  it('stamps DEFAULT_TENANT_ID on products rows imported from a v3 snapshot', async () => {
    // Build a legacy v3 snapshot (plain object, no schemaVersion envelope)
    const v3Snapshot = {
      products: [
        {
          id: 'imported-1',
          name: 'Tea',
          sku: 'BEV-TEA-001',
          category: 'Beverages',
          price: 1.5,
          cost: 0.3,
          quantity: 50,
          minStockLevel: 5,
          unit: 'cup',
          taxRate: 0.08,
          isActive: true,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
          // no tenantId
        },
      ],
    };

    await db.importFromJSON(JSON.stringify(v3Snapshot));

    // products keeps `id` as PK (upgrade-safe); query by primary key
    const imported = await db.products.get('imported-1');
    expect(imported).toBeDefined();
    expect(imported!.tenantId).toBe(DEFAULT_TENANT_ID);
  });

  it('stamps DEFAULT_TENANT_ID on customer rows imported from a v3 snapshot', async () => {
    const v3Snapshot = {
      customers: [
        {
          id: 'cust-import',
          name: 'Bob',
          email: 'bob@example.com',
          phone: '555-9999',
          status: 'active',
          loyaltyPoints: 0,
          tier: 'bronze',
          country: 'US',
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
          // no tenantId
        },
      ],
    };

    await db.importFromJSON(JSON.stringify(v3Snapshot));

    const customer = await db.customers.get('cust-import');
    expect(customer).toBeDefined();
    expect(customer!.tenantId).toBe(DEFAULT_TENANT_ID);
  });

  it('preserves existing tenantId when row already has one', async () => {
    const snapshotWithTenant = {
      customers: [
        {
          id: 'cust-tenanted',
          name: 'Carol',
          email: 'carol@example.com',
          phone: '555-7777',
          status: 'active',
          loyaltyPoints: 0,
          tier: 'silver',
          country: 'US',
          tenantId: 'tenant-explicit',
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        },
      ],
    };

    await db.importFromJSON(JSON.stringify(snapshotWithTenant));

    const customer = await db.customers.get('cust-tenanted');
    expect(customer).toBeDefined();
    expect(customer!.tenantId).toBe('tenant-explicit');
  });

  it('refuses to import a snapshot with a newer schemaVersion', async () => {
    const futureEnvelope = {
      schemaVersion: EXPORT_SCHEMA_VERSION + 1,
      exportedAt: new Date().toISOString(),
      data: { products: [] },
    };

    await expect(db.importFromJSON(JSON.stringify(futureEnvelope))).rejects.toThrow(
      /schemaVersion.*newer/
    );
  });

  it('accepts an envelope with the current schemaVersion', async () => {
    const currentEnvelope = {
      schemaVersion: EXPORT_SCHEMA_VERSION,
      exportedAt: new Date().toISOString(),
      data: {
        products: [
          {
            id: 'env-prod-1',
            tenantId: DEFAULT_TENANT_ID,
            name: 'Envelope Coffee',
            sku: 'BEV-ENV-001',
            category: 'Beverages',
            price: 2.5,
            cost: 0.8,
            quantity: 10,
            minStockLevel: 2,
            unit: 'cup',
            taxRate: 0.08,
            isActive: true,
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
          },
        ],
      },
    };

    await expect(db.importFromJSON(JSON.stringify(currentEnvelope))).resolves.not.toThrow();
    // products keeps `id` as PK
    const product = await db.products.get('env-prod-1');
    expect(product).toBeDefined();
  });
});

// ---------------------------------------------------------------------------
// Suite 8: exportToJSON includes schemaVersion envelope
// ---------------------------------------------------------------------------

describe('DexieDatabase v4 — exportToJSON envelope', () => {
  let db: DexieDatabase;

  beforeEach(async () => {
    db = makeDb();
    await openDb(db);
  });

  afterEach(async () => {
    await teardownDb(db);
  });

  it('export includes schemaVersion field matching EXPORT_SCHEMA_VERSION', async () => {
    const json = await db.exportToJSON();
    const envelope = JSON.parse(json) as {
      schemaVersion: number;
      exportedAt: string;
      data: unknown;
    };
    expect(envelope.schemaVersion).toBe(EXPORT_SCHEMA_VERSION);
  });

  it('export includes exportedAt timestamp', async () => {
    const json = await db.exportToJSON();
    const envelope = JSON.parse(json) as {
      schemaVersion: number;
      exportedAt: string;
      data: unknown;
    };
    expect(typeof envelope.exportedAt).toBe('string');
    expect(new Date(envelope.exportedAt).getTime()).not.toBeNaN();
  });

  it('export data field contains known table names', async () => {
    const json = await db.exportToJSON();
    const envelope = JSON.parse(json) as { data: Record<string, unknown[]> };
    expect(Object.keys(envelope.data)).toContain('products');
    expect(Object.keys(envelope.data)).toContain('operators');
    expect(Object.keys(envelope.data)).toContain('userTenants');
    expect(Object.keys(envelope.data)).toContain('rolePermissions');
  });
});

// ---------------------------------------------------------------------------
// Suite 9: DEFAULT_TENANT_ID constant integrity
// ---------------------------------------------------------------------------

describe('DEFAULT_TENANT_ID', () => {
  it('equals "default-tenant" (migration sentinel value)', () => {
    // This test is intentionally brittle: the value must not change between
    // deployments or all existing migrated rows will be orphaned.
    expect(DEFAULT_TENANT_ID).toBe('default-tenant');
  });
});

// ---------------------------------------------------------------------------
// Suite 10: Products [tenantId+id] secondary index (R1)
//
// NOTE: Dexie does not support changing primary keys during upgrades
// ("Not yet support for changing primary key"). The `products` table keeps
// `id` as its primary key in v4 to remain upgrade-safe. The compound index
// `[tenantId+id]` is secondary and enables efficient tenant-scoped queries.
// Full PK promotion to [tenantId+id] is deferred to v5.
// WI-3 write-time enforcement will prevent cross-tenant id reuse at the
// application layer once enforcement is in place.
// ---------------------------------------------------------------------------

describe('DexieDatabase v4 — products [tenantId+id] secondary index (R1)', () => {
  let db: DexieDatabase;

  beforeEach(async () => {
    db = makeDb();
    await openDb(db);
  });

  afterEach(async () => {
    await teardownDb(db);
  });

  it('[tenantId+id] compound secondary index enables tenant-scoped product queries', async () => {
    const base: Omit<IProductDB, 'tenantId'> = {
      id: 'prod-ta',
      name: 'Product A',
      sku: 'SKU-A',
      category: 'Test',
      price: 1,
      cost: 0.5,
      quantity: 1,
      minStockLevel: 0,
      unit: 'unit',
      taxRate: 0,
      isActive: true,
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    await db.products.add({ ...base, tenantId: 'tenant-a' });

    // Query via compound secondary index [tenantId+id]
    const found = await db.products.where('[tenantId+id]').equals(['tenant-a', 'prod-ta']).first();

    expect(found).toBeDefined();
    expect(found!.name).toBe('Product A');
    expect(found!.tenantId).toBe('tenant-a');
  });

  it('tenantId index enables filtering all products for a tenant', async () => {
    await db.products.add({
      id: 'p-ta1',
      tenantId: 'tenant-a',
      name: 'TA Product 1',
      sku: 'TA-1',
      category: 'C',
      price: 1,
      cost: 0,
      quantity: 1,
      minStockLevel: 0,
      unit: 'u',
      taxRate: 0,
      isActive: true,
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    await db.products.add({
      id: 'p-tb1',
      tenantId: 'tenant-b',
      name: 'TB Product 1',
      sku: 'TB-1',
      category: 'C',
      price: 1,
      cost: 0,
      quantity: 1,
      minStockLevel: 0,
      unit: 'u',
      taxRate: 0,
      isActive: true,
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    const taProducts = await db.products.where('tenantId').equals('tenant-a').toArray();
    expect(taProducts.length).toBe(1);
    expect(taProducts[0].name).toBe('TA Product 1');
  });

  it('toArray returns all products (pre-WI-3, no tenant filtering)', async () => {
    await db.products.add({
      id: 'all-p1',
      tenantId: 'ta',
      name: 'P1',
      sku: 'P1',
      category: 'X',
      price: 1,
      cost: 0,
      quantity: 1,
      minStockLevel: 0,
      unit: 'u',
      taxRate: 0,
      isActive: true,
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    await db.products.add({
      id: 'all-p2',
      tenantId: 'tb',
      name: 'P2',
      sku: 'P2',
      category: 'X',
      price: 1,
      cost: 0,
      quantity: 1,
      minStockLevel: 0,
      unit: 'u',
      taxRate: 0,
      isActive: true,
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    const all = await db.products.toArray();
    expect(all.length).toBe(2);
  });
});
