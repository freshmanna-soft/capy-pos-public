import { BaseValueObject } from '@core/domain/value-objects/base.value-object';
import { TenantId } from './tenant-id.value-object';
import { Role, RoleRecord } from './role.value-object';

/** Serialised membership row: tenant + the role held there (with its data). */
export interface TenantMembershipJSON {
  tenantId: string;
  role: string;
  permissions?: readonly string[];
  level?: number;
}

/**
 * TenantMembership Value Object (Domain)
 *
 * Represents a single row of the `userTenants(userId, tenantId, roleId)` join:
 * the pairing of one tenant with the role a user holds **in that tenant**.
 *
 * Role is per tenant, never on the user record — the same user may be an
 * Admin in Store-A and an Operator in Store-B. The owning user is implicit;
 * a {@link TenantMembershipSet} groups the memberships for one user.
 *
 * Immutable, frozen, compared by value (tenant + role).
 */
export class TenantMembership extends BaseValueObject<TenantMembership> {
  private readonly _tenantId: TenantId;
  private readonly _role: Role;

  constructor(tenantId: TenantId, role: Role) {
    super();
    if (!(tenantId instanceof TenantId)) {
      throw new Error('TenantMembership requires a TenantId');
    }
    if (!(role instanceof Role)) {
      throw new Error('TenantMembership requires a Role');
    }
    this._tenantId = tenantId;
    this._role = role;
    this.freeze();
  }

  get tenantId(): TenantId {
    return this._tenantId;
  }

  get role(): Role {
    return this._role;
  }

  equals(other: TenantMembership): boolean {
    if (!(other instanceof TenantMembership)) return false;
    return this._tenantId.equals(other._tenantId) && this._role.equals(other._role);
  }

  toJSON(): TenantMembershipJSON {
    return {
      tenantId: this._tenantId.value,
      role: this._role.name,
      permissions: [...this._role.permissions],
      level: this._role.level,
    };
  }

  override toString(): string {
    return `${this._tenantId.value}:${this._role.name}`;
  }

  // ---------------------------------------------------------------------------
  // Static factory helpers
  // ---------------------------------------------------------------------------

  /** Build from a built-in role name (e.g. a legacy JWT claim without role data). */
  static of(tenantId: string, roleName: string): TenantMembership {
    return new TenantMembership(new TenantId(tenantId), Role.fromName(roleName));
  }

  /**
   * Reconstruct from a serialised row. When the row carries the role's
   * permissions/level (data-driven / custom roles) the Role is rebuilt from that
   * record; otherwise built-in defaults are resolved by name (legacy sessions).
   */
  static fromJSON(raw: TenantMembershipJSON): TenantMembership {
    const record: RoleRecord = {
      name: raw.role,
      permissions: raw.permissions ?? [],
      level: raw.level ?? 1,
    };
    return new TenantMembership(new TenantId(raw.tenantId), Role.fromRecord(record));
  }
}
