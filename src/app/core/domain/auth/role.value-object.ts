import { BaseValueObject } from '@core/domain/value-objects/base.value-object';
import {
  Permission,
  OPERATOR_PERMISSIONS,
  MANAGER_PERMISSIONS,
  ADMIN_PERMISSIONS,
} from './permission.constants';

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

/**
 * Role Value Object
 *
 * Encapsulates a role name and its associated permission set.
 * Hierarchy: Operator (level 1) < Manager (level 2) < Admin (level 3).
 *
 * Immutable, compared by name (value equality).
 */
export class Role extends BaseValueObject<Role> {
  private readonly _name: RoleName;
  private readonly _permissions: ReadonlySet<Permission>;

  constructor(name: RoleName) {
    super();
    this._name = name;
    this._permissions = ROLE_PERMISSIONS[name];
    this.freeze();
  }

  get name(): RoleName {
    return this._name;
  }

  get permissions(): ReadonlySet<Permission> {
    return this._permissions;
  }

  get level(): number {
    return ROLE_LEVEL[this._name];
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

  toJSON(): { name: RoleName; permissions: Permission[] } {
    return {
      name: this._name,
      permissions: [...this._permissions],
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

  /** All roles ordered lowest → highest privilege. */
  static all(): Role[] {
    return [Role.operator(), Role.manager(), Role.admin()];
  }
}
