import { TenantId } from './tenant-id.value-object';
import { Role } from './role.value-object';
import { TenantMembership } from './tenant-membership.value-object';

/**
 * Thrown when a principal attempts to act in a tenant they are not a member of.
 * Extends Error so it can be caught generically at the application layer and
 * surfaced as an access-denied response.
 */
export class TenantIsolationError extends Error {
  readonly code = 'TENANT_ISOLATION_DENIED';

  constructor(public readonly tenantId: string) {
    super(`Access denied: not a member of tenant '${tenantId}'`);
    this.name = 'TenantIsolationError';
    Object.setPrototypeOf(this, TenantIsolationError.prototype);
  }
}

/**
 * TenantMembershipSet (Domain)
 *
 * The complete set of {@link TenantMembership}s a single user holds —
 * effectively that user's slice of the `userTenants(userId, tenantId, roleId)`
 * join. This is the seam through which Story #43 (multi-tenant membership &
 * isolation) is enforced in the framework-free domain:
 *
 *  - **Isolation**: {@link assertMemberOf} / {@link requireRoleFor} deny access
 *    to any tenant the user has no membership in.
 *  - **Switching**: {@link roleFor} resolves the role for whichever tenant is
 *    active, so changing the active tenant changes the effective role.
 *
 * A user has at most one role per tenant (the join's primary key), so
 * duplicate tenants are rejected at construction. Immutable and frozen.
 */
export class TenantMembershipSet {
  private readonly memberships: readonly TenantMembership[];

  constructor(memberships: readonly TenantMembership[]) {
    const byTenant = new Map<string, TenantMembership>();
    for (const membership of memberships) {
      const key = membership.tenantId.value;
      if (byTenant.has(key)) {
        throw new Error(
          `Duplicate membership for tenant '${key}': a user holds one role per tenant`
        );
      }
      byTenant.set(key, membership);
    }
    this.memberships = Object.freeze([...byTenant.values()]);
    Object.freeze(this);
  }

  get isEmpty(): boolean {
    return this.memberships.length === 0;
  }

  get size(): number {
    return this.memberships.length;
  }

  /** All memberships, in insertion order. */
  all(): readonly TenantMembership[] {
    return this.memberships;
  }

  /** The tenants this user belongs to. */
  tenantIds(): TenantId[] {
    return this.memberships.map((m) => m.tenantId);
  }

  isMemberOf(tenantId: TenantId): boolean {
    return this.memberships.some((m) => m.tenantId.equals(tenantId));
  }

  /** The membership for a tenant, or null when the user is not a member. */
  membershipFor(tenantId: TenantId): TenantMembership | null {
    return this.memberships.find((m) => m.tenantId.equals(tenantId)) ?? null;
  }

  /** The role held in a tenant, or null when the user is not a member. */
  roleFor(tenantId: TenantId): Role | null {
    return this.membershipFor(tenantId)?.role ?? null;
  }

  /**
   * Resolve the role for the active tenant, enforcing isolation.
   * @throws {TenantIsolationError} when the user is not a member of `tenantId`.
   */
  requireRoleFor(tenantId: TenantId): Role {
    const membership = this.membershipFor(tenantId);
    if (!membership) {
      throw new TenantIsolationError(tenantId.value);
    }
    return membership.role;
  }

  /**
   * Assert the user may act in the given tenant.
   * @throws {TenantIsolationError} when the user is not a member of `tenantId`.
   */
  assertMemberOf(tenantId: TenantId): void {
    if (!this.isMemberOf(tenantId)) {
      throw new TenantIsolationError(tenantId.value);
    }
  }

  toJSON(): { tenantId: string; role: string }[] {
    return this.memberships.map((m) => m.toJSON());
  }

  static fromJSON(raw: readonly { tenantId: string; role: string }[]): TenantMembershipSet {
    return new TenantMembershipSet(raw.map((row) => TenantMembership.fromJSON(row)));
  }
}
