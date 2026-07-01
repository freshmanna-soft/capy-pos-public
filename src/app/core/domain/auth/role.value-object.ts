import { BaseValueObject } from '@core/domain/value-objects/base.value-object';
import {
  Permission,
  OPERATOR_PERMISSIONS,
  MANAGER_PERMISSIONS,
  ADMIN_PERMISSIONS,
  isPermission,
} from './permission.constants';

/** Serialisable shape of a role — the source of truth for data-driven roles. */
export interface RoleRecord {
  name: string;
  permissions: readonly string[];
  level: number;
}

/**
 * Well-known role names.
 */
export const RoleName = {
  OPERATOR: 'operator',
  MANAGER: 'manager',
  ADMIN: 'admin',
} as const;

export type RoleName = (typeof RoleName)[keyof typeof RoleName];

/** Numeric level used for hierarchy comparisons. Higher == more privileged. */
const ROLE_LEVEL: Record<RoleName, number> = {
  [RoleName.OPERATOR]: 1,
  [RoleName.MANAGER]: 2,
  [RoleName.ADMIN]: 3,
};

const ROLE_PERMISSIONS: Record<RoleName, ReadonlySet<Permission>> = {
  [RoleName.OPERATOR]: OPERATOR_PERMISSIONS,
  [RoleName.MANAGER]: MANAGER_PERMISSIONS,
  [RoleName.ADMIN]: ADMIN_PERMISSIONS,
};

/** The built-in role names, which cannot be deleted or renamed. */
export const BUILT_IN_ROLE_NAMES: readonly string[] = Object.freeze(Object.values(RoleName));

/**
 * Role Value Object
 *
 * Encapsulates a role name, its permission set, and a hierarchy level.
 *
 * Two construction paths:
 *  - **Built-in** (`new Role(RoleName.X)` / `operator()`/`manager()`/`admin()`):
 *    permissions + level come from the fixed domain defaults.
 *  - **Data-driven** (`Role.fromRecord({ name, permissions, level })`): permissions
 *    and level come from a stored role record, so admins can author custom roles.
 *    Unknown permission strings are skipped (resilient mapping).
 *
 * Hierarchy: Operator (level 1) < Manager (level 2) < Admin (level 3); custom
 * roles carry their own level. Immutable, compared by name (value equality).
 */
export class Role extends BaseValueObject<Role> {
  private readonly _name: string;
  private readonly _permissions: ReadonlySet<Permission>;
  private readonly _level: number;

  constructor(name: RoleName);
  constructor(name: string, permissions: ReadonlySet<Permission>, level: number);
  constructor(name: string, permissions?: ReadonlySet<Permission>, level?: number) {
    super();
    this._name = name;
    if (permissions !== undefined && level !== undefined) {
      this._permissions = permissions;
      this._level = level;
    } else {
      // Built-in path — resolve the fixed defaults by name.
      this._permissions = ROLE_PERMISSIONS[name as RoleName] ?? new Set<Permission>();
      this._level = ROLE_LEVEL[name as RoleName] ?? 1;
    }
    this.freeze();
  }

  get name(): string {
    return this._name;
  }

  get permissions(): ReadonlySet<Permission> {
    return this._permissions;
  }

  get level(): number {
    return this._level;
  }

  /** True when this is one of the fixed, non-deletable built-in roles. */
  get isBuiltIn(): boolean {
    return BUILT_IN_ROLE_NAMES.includes(this._name);
  }

  /** Returns true if this role has the requested permission. */
  hasPermission(permission: Permission): boolean {
    return this._permissions.has(permission);
  }

  /**
   * Returns true if this role is at least as privileged as `other`.
   * Admin.atLeast(Manager) === true
   */
  atLeast(other: Role): boolean {
    return this.level >= other.level;
  }

  /** Returns true if this role is strictly more privileged than `other`. */
  outranks(other: Role): boolean {
    return this.level > other.level;
  }

  equals(other: Role): boolean {
    if (!(other instanceof Role)) return false;
    return this._name === other._name;
  }

  toJSON(): RoleRecord {
    return {
      name: this._name,
      permissions: [...this._permissions],
      level: this._level,
    };
  }

  override toString(): string {
    return this._name;
  }

  // ---------------------------------------------------------------------------
  // Static factory helpers
  // ---------------------------------------------------------------------------

  static operator(): Role {
    return new Role(RoleName.OPERATOR);
  }

  static manager(): Role {
    return new Role(RoleName.MANAGER);
  }

  static admin(): Role {
    return new Role(RoleName.ADMIN);
  }

  static fromName(name: string): Role {
    const known = Object.values(RoleName) as string[];
    if (!known.includes(name)) {
      throw new Error(`Unknown role: "${name}". Valid roles: ${known.join(', ')}`);
    }
    return new Role(name as RoleName);
  }

  /**
   * Reconstruct a role from a stored record (data-driven / custom roles).
   * Unknown permission strings are dropped (resilient mapping) so a renamed or
   * stale permission in storage can never grant access it shouldn't. Built-in
   * names still resolve to their canonical fixed permissions + level, so a
   * tampered built-in record cannot escalate privileges.
   */
  static fromRecord(record: RoleRecord): Role {
    if ((BUILT_IN_ROLE_NAMES as string[]).includes(record.name)) {
      return new Role(record.name as RoleName);
    }
    const permissions = new Set<Permission>(record.permissions.filter(isPermission));
    const level = Number.isFinite(record.level) ? record.level : 1;
    return new Role(record.name, permissions, level);
  }

  /** All roles ordered lowest → highest privilege. */
  static all(): Role[] {
    return [Role.operator(), Role.manager(), Role.admin()];
  }
}
