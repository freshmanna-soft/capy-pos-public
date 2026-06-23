/**
 * Permission Constants
 *
 * Defines the full set of permissions that can be granted to roles.
 * Uses const object pattern (over enum) so values are tree-shakeable
 * and usable as both type and runtime value.
 *
 * Hierarchy: Operator < Manager < Admin
 */

export const Permission = {
  // --- POS / Sales ---
  /** Create and process sales transactions */
  PROCESS_SALE: 'sale:process',
  /** Apply discounts to line items or totals */
  APPLY_DISCOUNT: 'sale:discount',
  /** Issue full or partial refunds */
  PROCESS_REFUND: 'sale:refund',
  /** View transaction history */
  VIEW_TRANSACTIONS: 'sale:view_transactions',

  // --- Inventory ---
  /** View product list and stock levels */
  VIEW_INVENTORY: 'inventory:view',
  /** Update product details and stock quantities */
  MANAGE_INVENTORY: 'inventory:manage',
  /** Manually adjust stock quantities (stock-take, receive, correction) */
  ADJUST_STOCK: 'inventory:adjust-stock',
  /** Delete or archive products */
  DELETE_PRODUCT: 'inventory:delete',

  // --- Customers ---
  /** View customer records */
  VIEW_CUSTOMERS: 'customer:view',
  /** Create and edit customer records */
  MANAGE_CUSTOMERS: 'customer:manage',

  // --- Reporting ---
  /** View daily summary reports */
  VIEW_REPORTS: 'report:view',
  /** Export report data */
  EXPORT_REPORTS: 'report:export',

  // --- Admin ---
  /** Manage operator accounts (create/deactivate) */
  MANAGE_OPERATORS: 'admin:manage_operators',
  /** Manage roles and permissions */
  MANAGE_ROLES: 'admin:manage_roles',
  /** Access application settings */
  MANAGE_SETTINGS: 'admin:settings',
} as const;

export type Permission = (typeof Permission)[keyof typeof Permission];

/**
 * Permissions granted to each role.
 * The hierarchy is additive — Manager includes Operator permissions, Admin includes Manager.
 */
export const OPERATOR_PERMISSIONS: ReadonlySet<Permission> = new Set([
  Permission.PROCESS_SALE,
  Permission.VIEW_TRANSACTIONS,
  Permission.VIEW_INVENTORY,
  Permission.VIEW_CUSTOMERS,
]);

export const MANAGER_PERMISSIONS: ReadonlySet<Permission> = new Set([
  ...OPERATOR_PERMISSIONS,
  Permission.APPLY_DISCOUNT,
  Permission.PROCESS_REFUND,
  Permission.MANAGE_INVENTORY,
  Permission.ADJUST_STOCK,
  Permission.MANAGE_CUSTOMERS,
  Permission.VIEW_REPORTS,
  Permission.EXPORT_REPORTS,
]);

export const ADMIN_PERMISSIONS: ReadonlySet<Permission> = new Set([
  ...MANAGER_PERMISSIONS,
  Permission.DELETE_PRODUCT,
  Permission.MANAGE_OPERATORS,
  Permission.MANAGE_ROLES,
  Permission.MANAGE_SETTINGS,
]);
