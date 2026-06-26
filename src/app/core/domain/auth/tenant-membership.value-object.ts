import { BaseValueObject } from '@core/domain/value-objects/base.value-object';
import { TenantId } from './tenant-id.value-object';
import { Role } from './role.value-object';

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

  toJSON(): { tenantId: string; role: string } {
    return { tenantId: this._tenantId.value, role: this._role.name };
  }

  override toString(): string {
    return `${this._tenantId.value}:${this._role.name}`;
  }

  // ---------------------------------------------------------------------------
  // Static factory helpers
  // ---------------------------------------------------------------------------

  /** Build from primitive strings (e.g. a JWT claim or join-table row). */
  static of(tenantId: string, roleName: string): TenantMembership {
    return new TenantMembership(new TenantId(tenantId), Role.fromName(roleName));
  }

  static fromJSON(raw: { tenantId: string; role: string }): TenantMembership {
    return TenantMembership.of(raw.tenantId, raw.role);
  }
}
