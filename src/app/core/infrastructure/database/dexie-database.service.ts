import Dexie, { Table } from 'dexie';
import { Injectable } from '@angular/core';
import { Role } from '@core/domain/auth/role.value-object';
import { Permission } from '@core/domain/auth/permission.constants';

/**
 * bcrypt hash (cost 10) of the default admin password "admin1234".
 * Dev/single-tenant bootstrap credential only — rotate via the operator
 * management UI before any real deployment. NEVER store plaintext.
 */
const DEFAULT_ADMIN_PASSWORD_HASH = '$2b$10$EixZaYVK1fsbw1ZfbX3OXePaWxn96p36WQoeG6Lruj3vjPGga31lW';

/**
 * Migration sentinel: every pre-v4 row and every single-tenant install
 * is stamped with this tenantId during the v4 upgrade pass.
 *
 * This constant MUST NOT be used as a real tenant discriminator in query
 * code — that responsibility belongs to WI-3 (query-time enforcement).
 * It exists solely to ensure no row is left with a null tenantId after
 * the migration, making the subsequent WI-3 column-NOT-NULL constraint safe.
 */
export const DEFAULT_TENANT_ID = 'default-tenant';

/**
 * Current export envelope schema version. Used to detect and refuse/upgrade
 * mismatched importFromJSON snapshots (R7).
 */
export const EXPORT_SCHEMA_VERSION = 4;

/**
 * Chunk size for the v4 upgrade backfill pass. Keeps memory bounded when
 * tables contain large numbers of rows.
 */
const MIGRATION_CHUNK_SIZE = 500;

/**
 * Derives a stable, deterministic id for a userTenants row from userId + tenantId.
 *
 * IMPORTANT: Both upgrade() and seedRbacDefaults() MUST call this helper to
 * generate the row id — never inline the format (R17 — divergent formats
 * create duplicate memberships).
 */
export function userTenantId(userId: string, tenantId: string): string {
  return `ut-${userId}-${tenantId}`;
}

// ---------------------------------------------------------------------------
// DB record interfaces
// ---------------------------------------------------------------------------

export interface IProductDB {
  id: string;
  tenantId?: string;
  name: string;
  description?: string;
  sku: string;
  barcode?: string;
  category: string;
  price: number;
  cost: number;
  quantity: number;
  minStockLevel: number;
  maxStockLevel?: number;
  unit: string;
  taxRate: number;
  isActive: boolean;
  imageUrl?: string;
  createdAt: Date;
  updatedAt: Date;
  createdBy?: string;
  updatedBy?: string;
  deletedAt?: Date;
  deletedBy?: string;
}

export interface ICustomerDB {
  id: string;
  tenantId?: string;
  name: string;
  email: string;
  phone: string;
  status: string;
  loyaltyPoints: number;
  tier: string;
  address?: string;
  city?: string;
  state?: string;
  zipCode?: string;
  country: string;
  dateOfBirth?: Date;
  notes?: string;
  createdAt: Date;
  updatedAt: Date;
  createdBy?: string;
  updatedBy?: string;
  deletedAt?: Date;
  deletedBy?: string;
}

export interface ITransactionDB {
  id: string;
  tenantId?: string;
  customerId?: string;
  items: string; // JSON string of ITransactionItem[]
  subtotal: number;
  taxRate: number;
  taxAmount: number;
  discountAmount: number;
  total: number;
  status: string;
  type: string;
  refundedAmount: number;
  paymentIds: string; // JSON string of string[]
  receiptNumber?: string;
  notes?: string;
  completedAt?: Date;
  cancelledAt?: Date;
  cancellationReason?: string;
  createdAt: Date;
  updatedAt: Date;
  createdBy?: string;
  updatedBy?: string;
  deletedAt?: Date;
  deletedBy?: string;
}

export interface ITransactionItemDB {
  id: string;
  tenantId?: string;
  transactionId: string;
  productId: string;
  productName: string;
  quantity: number;
  unitPrice: number;
  discount: number;
  tax: number;
  subtotal: number;
  total: number;
  createdAt: Date;
}

export interface IPaymentDB {
  id: string;
  tenantId?: string;
  orderId: string; // Maps to transactionId in Payment entity
  amount: number;
  method: string;
  status: string;
  currency: string;
  refundedAmount: number;
  completedAt?: Date;
  failureReason?: string;
  transactionId?: string; // Payment gateway transaction ID
  cardLast4?: string;
  cardBrand?: string;
  receiptNumber?: string;
  createdAt: Date;
  updatedAt: Date;
  createdBy?: string;
  updatedBy?: string;
}

export interface IStockReservationDB {
  id: string;
  tenantId?: string;
  productId: string;
  quantity: number;
  reservedFor: string;
  expiresAt: Date;
  status: string;
  createdAt: Date;
  updatedAt: Date;
  createdBy?: string;
  updatedBy?: string;
}

export interface IStockAdjustmentDB {
  id: string;
  tenantId?: string;
  productId: string;
  quantityChange: number;
  reason: string;
  notes?: string;
  createdAt: Date;
  createdBy?: string;
}

export interface ILoyaltyTransactionDB {
  id: string;
  tenantId?: string;
  customerId: string;
  transactionId?: string;
  points: number;
  type: string;
  description?: string;
  createdAt: Date;
}

export interface IRewardDB {
  id: string;
  tenantId?: string;
  name: string;
  description?: string;
  pointsCost: number;
  isActive: boolean;
  expiresAt?: Date;
  createdAt: Date;
  updatedAt: Date;
}

export interface IRewardRedemptionDB {
  id: string;
  tenantId?: string;
  customerId: string;
  rewardId: string;
  pointsUsed: number;
  status: string;
  redeemedAt: Date;
  usedAt?: Date;
}

export interface ISyncQueueDB {
  id: string;
  tenantId?: string;
  entityType: string;
  entityId: string;
  operation: string;
  data: string;
  status: string;
  retryCount: number;
  lastError?: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface ISettingsDB {
  id: string;
  tenantId?: string;
  key: string;
  value: string;
  updatedAt: Date;
}

export interface IOperatorDB {
  id: string;
  email: string;
  displayName: string;
  /**
   * Kept for backward compatibility (v3 column). Will be superseded by
   * userTenants.roleId in WI-3. Do NOT drop until v5 migration.
   */
  roleId: string;
  /**
   * Kept for backward compatibility (v3 column). Will be superseded by
   * userTenants.tenantId in WI-3. Do NOT drop until v5 migration.
   */
  tenantId: string;
  passwordHash: string;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
  createdBy?: string;
  updatedBy?: string;
}

export interface IRoleDB {
  id: string;
  name: string;
  permissions: string; // JSON array of Permission strings
  createdAt: Date;
  updatedAt: Date;
}

/**
 * Join table: maps an operator (user) to a tenant with a specific role.
 * This is the v4 multi-tenant membership table — the authoritative source
 * of role-per-tenant once WI-3 enforcement is in place.
 */
export interface IUserTenantDB {
  id: string; // derived via userTenantId(userId, tenantId)
  userId: string;
  tenantId: string;
  roleId: string;
  createdAt: Date;
  updatedAt: Date;
}

/**
 * Projection table: materialises the (roleId, permissionId) pairs from the
 * domain Role value-object. Re-derived unconditionally on every boot so it
 * cannot drift from permission.constants.ts (R11).
 */
export interface IRolePermissionDB {
  id: string; // `${roleId}:${permissionId}`
  roleId: string;
  permissionId: Permission;
}

// ---------------------------------------------------------------------------
// Export envelope type
// ---------------------------------------------------------------------------

interface ExportEnvelope {
  schemaVersion: number;
  exportedAt: string;
  data: Record<string, unknown[]>;
}

/**
 * Dexie Database Service
 * Provides ORM-like interface for IndexedDB
 * Supports offline-first architecture with automatic indexing
 */
@Injectable({
  providedIn: 'root',
})
export class DexieDatabase extends Dexie {
  // Tables
  products!: Table<IProductDB, string>;
  customers!: Table<ICustomerDB, string>;
  transactions!: Table<ITransactionDB, string>;
  transactionItems!: Table<ITransactionItemDB, string>;
  payments!: Table<IPaymentDB, string>;
  stockReservations!: Table<IStockReservationDB, string>;
  stockAdjustments!: Table<IStockAdjustmentDB, string>;
  loyaltyTransactions!: Table<ILoyaltyTransactionDB, string>;
  rewards!: Table<IRewardDB, string>;
  rewardRedemptions!: Table<IRewardRedemptionDB, string>;
  syncQueue!: Table<ISyncQueueDB, string>;
  settings!: Table<ISettingsDB, string>;
  operators!: Table<IOperatorDB, string>;
  roles!: Table<IRoleDB, string>;
  userTenants!: Table<IUserTenantDB, string>;
  rolePermissions!: Table<IRolePermissionDB, string>;

  constructor() {
    super('CapyPOSDB');

    // Define schema version 1
    this.version(1).stores({
      // Products table with indexes
      products: 'id, sku, barcode, category, isActive, [category+isActive], deletedAt',

      // Customers table with indexes
      customers: 'id, email, phone, status, tier, [status+tier], deletedAt',

      // Transactions table with indexes
      transactions: 'id, customerId, status, type, createdAt, completedAt, cancelledAt, deletedAt',

      // Transaction items table with indexes
      transactionItems: 'id, transactionId, productId, [transactionId+productId]',

      // Payments table with indexes
      payments: 'id, orderId, method, status, createdAt, completedAt',

      // Stock reservations table with indexes
      stockReservations: 'id, productId, status, expiresAt, [productId+status]',

      // Stock adjustments table with indexes
      stockAdjustments: 'id, productId, createdAt',

      // Loyalty transactions table with indexes
      loyaltyTransactions: 'id, customerId, transactionId, type, createdAt',

      // Rewards table with indexes
      rewards: 'id, isActive, expiresAt',

      // Reward redemptions table with indexes
      rewardRedemptions: 'id, customerId, rewardId, status, redeemedAt',

      // Sync queue table with indexes
      syncQueue: 'id, entityType, entityId, status, createdAt, [entityType+status]',
    });

    // Version 2: Add settings table for app configuration
    this.version(2).stores({
      settings: 'id, key',
    });

    // Version 3: Add RBAC tables (operators + roles) — do NOT edit v1/v2 above
    this.version(3)
      .stores({
        operators: 'id, email, roleId, tenantId, isActive',
        roles: 'id, name',
      })
      .upgrade(async (tx) => {
        // Migrating an existing v2 database to v3: seed RBAC defaults here.
        // Fresh databases are handled by seedRbacDefaults() on boot (the
        // .upgrade() hook does not run on first-ever creation). Both paths are
        // idempotent and derive role permissions from the domain Role, so the
        // persisted JSON can never drift from permission.constants.ts.
        const now = new Date();

        const roleCount = await tx.table('roles').count();
        if (roleCount === 0) {
          await tx.table('roles').bulkAdd(
            Role.all().map((role) => ({
              id: `role-${role.name}`,
              name: role.name,
              permissions: JSON.stringify([...role.permissions]),
              createdAt: now,
              updatedAt: now,
            }))
          );
        }

        const operatorCount = await tx.table('operators').count();
        if (operatorCount === 0) {
          await tx.table('operators').add({
            id: 'operator-admin-default',
            email: 'admin@capy-pos.local',
            displayName: 'Admin',
            roleId: 'role-admin',
            tenantId: 'default-tenant',
            passwordHash: DEFAULT_ADMIN_PASSWORD_HASH,
            isActive: true,
            createdAt: now,
            updatedAt: now,
          });
        }
      });

    // Version 4: Multi-tenant isolation — additive, rollback-safe.
    //
    // What this version does:
    //   1. Adds `tenantId` index to every tenant-scoped table (the column is
    //      optional/nullable at this layer; WI-3 adds write-time enforcement).
    //   2. Adds compound index [tenantId+id] on products (and other PULL-replicated
    //      tables) for efficient tenant-scoped queries.
    //      IMPORTANT: Dexie does not support changing primary keys during upgrades
    //      ("Not yet support for changing primary key"). Changing `products` PK from
    //      `id` to `[tenantId+id]` would make this an upgrade-destroying migration.
    //      For v4 the compound index is secondary — full PK promotion to [tenantId+id]
    //      is deferred to v5 when it can be implemented via table-rename + copy-over.
    //      This still addresses R1 for new rows: WI-3 write-time enforcement will
    //      prevent cross-tenant id reuse at the application layer.
    //   3. Adds settings compound index [tenantId+key].
    //   4. Introduces userTenants and rolePermissions join tables.
    //   5. upgrade() backfills DEFAULT_TENANT_ID on all pre-v4 rows (chunked)
    //      and projects every existing operator into userTenants.
    //
    // Columns kept from v3 (operators.roleId, operators.tenantId):
    //   Dropping deferred to v5 — do NOT remove here; v4 must be safely
    //   reversible without losing data.
    this.version(4)
      .stores({
        // --- tenant-scoped tables: add tenantId index ---
        // products: keep `id` as PK (upgrade-safe), add tenantId + [tenantId+id]
        // secondary index for efficient tenant-scoped queries (R1 cross-tenant
        // collision prevention via PK change deferred to v5 — see note above).
        products:
          'id, sku, barcode, category, tenantId, isActive, [tenantId+id], [category+isActive], deletedAt',

        customers: 'id, email, phone, status, tier, tenantId, [status+tier], deletedAt',
        transactions:
          'id, customerId, status, type, tenantId, createdAt, completedAt, cancelledAt, deletedAt',
        transactionItems: 'id, transactionId, productId, tenantId, [transactionId+productId]',
        payments: 'id, orderId, method, status, tenantId, createdAt, completedAt',
        stockReservations: 'id, productId, status, tenantId, expiresAt, [productId+status]',
        stockAdjustments: 'id, productId, tenantId, createdAt',
        loyaltyTransactions: 'id, customerId, transactionId, type, tenantId, createdAt',
        rewards: 'id, isActive, tenantId, expiresAt',
        rewardRedemptions: 'id, customerId, rewardId, status, tenantId, redeemedAt',
        syncQueue: 'id, entityType, entityId, status, tenantId, createdAt, [entityType+status]',

        // settings: add tenantId + compound index [tenantId+key]
        settings: 'id, key, tenantId, [tenantId+key]',

        // --- new join tables ---
        userTenants: 'id, userId, tenantId, roleId, [userId+tenantId]',
        rolePermissions: 'id, roleId, [roleId+permissionId]',
      })
      .upgrade(async (tx) => {
        const now = new Date();

        // ----------------------------------------------------------------
        // 1. Backfill tenantId on all tenant-scoped tables (chunked)
        // ----------------------------------------------------------------
        const scopedTables = [
          'products',
          'customers',
          'transactions',
          'transactionItems',
          'payments',
          'stockReservations',
          'stockAdjustments',
          'loyaltyTransactions',
          'rewards',
          'rewardRedemptions',
          'syncQueue',
          'settings',
        ];

        for (const tableName of scopedTables) {
          const table = tx.table(tableName);
          while (true) {
            // Read the next chunk of rows still missing tenantId.
            // IMPORTANT: always read from offset 0 (no offset tracking).
            // After bulkPut stamps tenantId, those rows no longer match the
            // filter, so the next iteration's offset-0 read returns the next
            // un-stamped batch.  Advancing an explicit offset would cause rows
            // to be silently skipped when the filter shrinks after each write.
            const chunk = await table
              .filter((row: { tenantId?: string }) => !row.tenantId)
              .limit(MIGRATION_CHUNK_SIZE)
              .toArray();

            if (chunk.length === 0) break;

            // Stamp DEFAULT_TENANT_ID on each row that lacks it
            const updated = (chunk as Record<string, unknown>[]).map((row) => ({
              ...row,
              tenantId: DEFAULT_TENANT_ID,
            }));

            await table.bulkPut(updated);
          }
        }

        // ----------------------------------------------------------------
        // 2. Project every operator into userTenants (idempotency guarded)
        // ----------------------------------------------------------------
        const operators = await tx.table('operators').toArray();
        for (const op of operators as IOperatorDB[]) {
          const tenantId = op.tenantId || DEFAULT_TENANT_ID;
          const roleId = op.roleId || 'role-operator';
          const rowId = userTenantId(op.id, tenantId);

          // Idempotency: skip if already present
          const existing = await tx.table('userTenants').get(rowId);
          if (!existing) {
            await tx.table('userTenants').add({
              id: rowId,
              userId: op.id,
              tenantId,
              roleId,
              createdAt: now,
              updatedAt: now,
            } satisfies IUserTenantDB);
          }
        }
      });

    // Map tables to classes (optional, for better type safety)
    this.products.mapToClass(ProductDBRecord);
    this.customers.mapToClass(CustomerDBRecord);
  }

  /**
   * Initialize database with seed data.
   *
   * Guard: takes a pre-migration snapshot BEFORE allowing initializeWithSeedData
   * to proceed so the rollback-from-snapshot path (R19) is always available.
   * The snapshot is stored in settings under key '__v4_pre_migration_snapshot'.
   * It is a one-shot guard — once written it is not overwritten.
   */
  async initializeWithSeedData(): Promise<void> {
    // R19 guard: capture a pre-v4 snapshot the very first time this runs
    // after the v4 migration. By this point the DB is already open at v4,
    // but we record the current state so operators can roll back if needed.
    await this._ensurePreMigrationSnapshot();

    const productCount = await this.products.count();

    if (productCount === 0) {
      // Seed products
      await this.products.bulkAdd([
        {
          id: '1',
          tenantId: DEFAULT_TENANT_ID,
          name: 'Coffee',
          description: 'Fresh brewed coffee',
          sku: 'BEV-COF-001',
          barcode: '1234567890123',
          category: 'Beverages',
          price: 2.5,
          cost: 0.8,
          quantity: 150,
          minStockLevel: 30,
          maxStockLevel: 300,
          unit: 'cup',
          taxRate: 0.08,
          isActive: true,
          createdAt: new Date(),
          updatedAt: new Date(),
        },
        {
          id: '2',
          tenantId: DEFAULT_TENANT_ID,
          name: 'Cappuccino',
          description: 'Espresso with steamed milk and foam',
          sku: 'BEV-CAP-001',
          barcode: '1234567890124',
          category: 'Beverages',
          price: 4.5,
          cost: 1.8,
          quantity: 100,
          minStockLevel: 20,
          maxStockLevel: 200,
          unit: 'cup',
          taxRate: 0.08,
          isActive: true,
          createdAt: new Date(),
          updatedAt: new Date(),
        },
        {
          id: '3',
          tenantId: DEFAULT_TENANT_ID,
          name: 'Croissant',
          description: 'Buttery, flaky pastry',
          sku: 'FOOD-CRO-001',
          barcode: '1234567890125',
          category: 'Food',
          price: 3,
          cost: 1,
          quantity: 50,
          minStockLevel: 10,
          maxStockLevel: 100,
          unit: 'piece',
          taxRate: 0.08,
          isActive: true,
          createdAt: new Date(),
          updatedAt: new Date(),
        },
        {
          id: '4',
          tenantId: DEFAULT_TENANT_ID,
          name: 'Latte',
          description: 'Espresso with steamed milk',
          sku: 'BEV-LAT-001',
          barcode: '1234567890126',
          category: 'Beverages',
          price: 4,
          cost: 1,
          quantity: 100,
          minStockLevel: 20,
          maxStockLevel: 200,
          unit: 'cup',
          taxRate: 0.08,
          isActive: true,
          createdAt: new Date(),
          updatedAt: new Date(),
        },
        {
          id: '5',
          tenantId: DEFAULT_TENANT_ID,
          name: 'Muffin',
          description: 'Freshly baked muffin',
          sku: 'FOOD-MUF-001',
          barcode: '1234567890127',
          category: 'Food',
          price: 2.5,
          cost: 0.8,
          quantity: 30,
          minStockLevel: 10,
          maxStockLevel: 80,
          unit: 'piece',
          taxRate: 0.08,
          isActive: true,
          createdAt: new Date(),
          updatedAt: new Date(),
        },
        {
          id: '6',
          tenantId: DEFAULT_TENANT_ID,
          name: 'Seasonal Blend',
          description: 'Limited edition seasonal coffee blend - currently unavailable',
          sku: 'BEV-SEA-001',
          barcode: '1234567890128',
          category: 'Beverages',
          price: 5.5,
          cost: 2.5,
          quantity: 0,
          minStockLevel: 10,
          maxStockLevel: 50,
          unit: 'cup',
          taxRate: 0.08,
          isActive: true,
          createdAt: new Date(),
          updatedAt: new Date(),
        },
      ]);

      // Seed rewards
      await this.rewards.bulkAdd([
        {
          id: '1',
          tenantId: DEFAULT_TENANT_ID,
          name: 'Free Coffee',
          description: 'Redeem for any regular coffee',
          pointsCost: 100,
          isActive: true,
          createdAt: new Date(),
          updatedAt: new Date(),
        },
        {
          id: '2',
          tenantId: DEFAULT_TENANT_ID,
          name: '10% Discount',
          description: '10% off your next purchase',
          pointsCost: 200,
          isActive: true,
          createdAt: new Date(),
          updatedAt: new Date(),
        },
        {
          id: '3',
          tenantId: DEFAULT_TENANT_ID,
          name: 'Free Pastry',
          description: 'Redeem for any pastry',
          pointsCost: 150,
          isActive: true,
          createdAt: new Date(),
          updatedAt: new Date(),
        },
      ]);

      console.log('Database initialized with seed data');
    }

    // RBAC defaults are seeded independently of products: the version(3)/(4)
    // .upgrade() hooks do not run on a freshly-created database, so this
    // boot-time path guarantees the default admin + roles exist on first launch.
    await this.seedRbacDefaults();
  }

  /**
   * Captures a one-shot pre-migration snapshot for the v4 rollback guard (R19).
   * Stored as a settings row so it survives across sessions.
   * No-op after the first capture.
   */
  private async _ensurePreMigrationSnapshot(): Promise<void> {
    const SENTINEL_KEY = '__v4_pre_migration_snapshot';
    const existing = await this.settings.where('key').equals(SENTINEL_KEY).first();
    if (existing) return;

    // Export everything except the sentinel itself (which doesn't exist yet)
    const snapshotData: Record<string, unknown[]> = {};
    for (const table of this.tables) {
      if (table.name !== 'settings') {
        snapshotData[table.name] = await table.toArray();
      } else {
        // Include settings rows but exclude the sentinel (not there yet)
        const rows = await table.toArray();
        snapshotData[table.name] = rows.filter(
          (r: unknown) => (r as ISettingsDB).key !== SENTINEL_KEY
        );
      }
    }

    const envelope: ExportEnvelope = {
      schemaVersion: EXPORT_SCHEMA_VERSION,
      exportedAt: new Date().toISOString(),
      data: snapshotData,
    };

    await this.settings.put({
      id: `settings-${SENTINEL_KEY}`,
      key: SENTINEL_KEY,
      tenantId: DEFAULT_TENANT_ID,
      value: JSON.stringify(envelope),
      updatedAt: new Date(),
    });
  }

  /**
   * Seed default RBAC roles + admin operator + join-table memberships.
   * Idempotent: safe to call on every boot.
   *
   * Role permission lists AND rolePermissions rows are re-derived unconditionally
   * from the domain Role value object (permission.constants.ts) so the persisted
   * data can never drift from the authorization rules (R11).
   *
   * Default credentials: admin@capy-pos.local / admin1234.
   */
  async seedRbacDefaults(): Promise<void> {
    const now = new Date();

    // -----------------------------------------------------------------------
    // 1. Roles — seed once; count-guard is safe here because roles are stable
    // -----------------------------------------------------------------------
    const roleCount = await this.roles.count();
    if (roleCount === 0) {
      await this.roles.bulkAdd(
        Role.all().map((role) => ({
          id: `role-${role.name}`,
          name: role.name,
          permissions: JSON.stringify([...role.permissions]),
          createdAt: now,
          updatedAt: now,
        }))
      );
    }

    // -----------------------------------------------------------------------
    // 2. rolePermissions — RE-DERIVE unconditionally (R11).
    //    Delete the entire built-in projection and reinsert from the domain so
    //    removed permissions never persist.
    // -----------------------------------------------------------------------
    await this._rederiveRolePermissions(now);

    // -----------------------------------------------------------------------
    // 3. Default admin operator — seed once
    // -----------------------------------------------------------------------
    const operatorCount = await this.operators.count();
    if (operatorCount === 0) {
      await this.operators.add({
        id: 'operator-admin-default',
        email: 'admin@capy-pos.local',
        displayName: 'Admin',
        roleId: 'role-admin',
        tenantId: DEFAULT_TENANT_ID,
        passwordHash: DEFAULT_ADMIN_PASSWORD_HASH,
        isActive: true,
        createdAt: now,
        updatedAt: now,
      });
    }

    // -----------------------------------------------------------------------
    // 4. userTenants membership for default admin — idempotent via put
    // -----------------------------------------------------------------------
    const adminTenantRowId = userTenantId('operator-admin-default', DEFAULT_TENANT_ID);
    const existingMembership = await this.userTenants.get(adminTenantRowId);
    if (!existingMembership) {
      await this.userTenants.add({
        id: adminTenantRowId,
        userId: 'operator-admin-default',
        tenantId: DEFAULT_TENANT_ID,
        roleId: 'role-admin',
        createdAt: now,
        updatedAt: now,
      });
    }
  }

  /**
   * Re-derives the rolePermissions projection from the domain Role value object.
   * Deletes all existing built-in rows and reinserts the current set so stale
   * or removed permissions never persist (R11).
   */
  private async _rederiveRolePermissions(now: Date): Promise<void> {
    const freshRows: IRolePermissionDB[] = [];

    for (const role of Role.all()) {
      const roleId = `role-${role.name}`;
      for (const permission of role.permissions) {
        freshRows.push({
          id: `${roleId}:${permission}`,
          roleId,
          permissionId: permission,
        });
      }
    }

    // Delete + reinsert in a single rw transaction for atomicity
    await this.transaction('rw', this.rolePermissions, async () => {
      await this.rolePermissions.clear();
      await this.rolePermissions.bulkAdd(freshRows);
    });

    void now; // suppress unused-parameter lint warning
  }

  /**
   * Clear all data from database
   */
  async clearAllData(): Promise<void> {
    await this.transaction('rw', this.tables, async () => {
      await Promise.all(this.tables.map((table) => table.clear()));
    });
  }

  /**
   * Get database statistics
   */
  async getStats(): Promise<Record<string, number>> {
    const stats: Record<string, number> = {};

    for (const table of this.tables) {
      stats[table.name] = await table.count();
    }

    return stats;
  }

  /**
   * Export database to JSON.
   * Wraps the payload in an ExportEnvelope with a schemaVersion field (R7).
   */
  async exportToJSON(): Promise<string> {
    const data: Record<string, unknown[]> = {};

    for (const table of this.tables) {
      data[table.name] = await table.toArray();
    }

    const envelope: ExportEnvelope = {
      schemaVersion: EXPORT_SCHEMA_VERSION,
      exportedAt: new Date().toISOString(),
      data,
    };

    return JSON.stringify(envelope, null, 2);
  }

  /**
   * Import database from JSON.
   *
   * Accepts both:
   *   - New envelope format: { schemaVersion, exportedAt, data: {...} }
   *   - Legacy v3 format (plain map of table → rows) — upgraded in-place.
   *
   * For each row missing tenantId, stamps DEFAULT_TENANT_ID (R7 — prevents
   * the rollback-from-snapshot path from silently hiding all data behind
   * future tenant scoping).
   *
   * Refuses imports whose schemaVersion is newer than EXPORT_SCHEMA_VERSION
   * (forward-compatibility guard).
   */
  async importFromJSON(jsonData: string): Promise<void> {
    const raw: unknown = JSON.parse(jsonData);

    let tableData: Record<string, unknown[]>;
    let importedSchemaVersion = 0;

    // Detect envelope vs. legacy format
    if (
      raw !== null &&
      typeof raw === 'object' &&
      'schemaVersion' in (raw as object) &&
      'data' in (raw as object)
    ) {
      const envelope = raw as ExportEnvelope;
      if (envelope.schemaVersion > EXPORT_SCHEMA_VERSION) {
        throw new Error(
          `importFromJSON: snapshot schemaVersion ${envelope.schemaVersion} is newer than ` +
            `current EXPORT_SCHEMA_VERSION ${EXPORT_SCHEMA_VERSION}. Upgrade the application first.`
        );
      }
      importedSchemaVersion = envelope.schemaVersion;
      tableData = envelope.data;
    } else {
      // Legacy v3 snapshot — plain object whose keys are table names
      importedSchemaVersion = 3;
      tableData = raw as Record<string, unknown[]>;
    }

    // Tables that carry tenantId and need backfill when importing pre-v4 data
    const tenantScopedTables = new Set([
      'products',
      'customers',
      'transactions',
      'transactionItems',
      'payments',
      'stockReservations',
      'stockAdjustments',
      'loyaltyTransactions',
      'rewards',
      'rewardRedemptions',
      'syncQueue',
      'settings',
    ]);

    await this.transaction('rw', this.tables, async () => {
      for (const tableName in tableData) {
        const table = (this as unknown as Record<string, Table>)[tableName];
        if (!table) continue;

        let rows = tableData[tableName] as Record<string, unknown>[];

        // Stamp tenantId on rows from pre-v4 snapshots or any row missing it
        if (tenantScopedTables.has(tableName) && importedSchemaVersion < 4) {
          rows = rows.map((row) =>
            row['tenantId'] ? row : { ...row, tenantId: DEFAULT_TENANT_ID }
          );
        }

        await table.clear();
        await table.bulkAdd(rows);
      }
    });
  }
}

// ---------------------------------------------------------------------------
// Optional: Map database records to classes for better type safety
// ---------------------------------------------------------------------------

class ProductDBRecord implements IProductDB {
  id!: string;
  tenantId?: string;
  name!: string;
  description?: string;
  sku!: string;
  barcode?: string;
  category!: string;
  price!: number;
  cost!: number;
  quantity!: number;
  minStockLevel!: number;
  maxStockLevel?: number;
  unit!: string;
  taxRate!: number;
  isActive!: boolean;
  imageUrl?: string;
  createdAt!: Date;
  updatedAt!: Date;
  createdBy?: string;
  updatedBy?: string;
  deletedAt?: Date;
  deletedBy?: string;
}

class CustomerDBRecord implements ICustomerDB {
  id!: string;
  tenantId?: string;
  name!: string;
  email!: string;
  phone!: string;
  status!: string;
  loyaltyPoints!: number;
  tier!: string;
  address?: string;
  city?: string;
  state?: string;
  zipCode?: string;
  country!: string;
  dateOfBirth?: Date;
  notes?: string;
  createdAt!: Date;
  updatedAt!: Date;
  createdBy?: string;
  updatedBy?: string;
  deletedAt?: Date;
  deletedBy?: string;
}

// Made with Bob
