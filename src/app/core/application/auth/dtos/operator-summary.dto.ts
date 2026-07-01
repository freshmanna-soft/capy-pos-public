import { RoleName } from '@core/domain/auth/role.value-object';

/**
 * OperatorSummaryDto
 *
 * Application-layer read model describing one operator as seen by the admin
 * user-management screen. Deliberately excludes `passwordHash` and any other
 * credential material — the UI only ever needs identity + role + status.
 *
 * `roleName` is the operator's role **in the tenant being listed** (resolved
 * through the `userTenants` join), never a role stored directly on the operator
 * record. The same operator may hold a different role in another tenant.
 */
export interface OperatorSummaryDto {
  /** Operator id (matches the JWT `sub` / `userTenants.userId`). */
  readonly id: string;
  /** Login email. */
  readonly email: string;
  /** Human-friendly name shown in the table. */
  readonly displayName: string;
  /** Well-known role held in the listed tenant. */
  readonly roleName: RoleName;
  /** Whether the operator can currently sign in. */
  readonly isActive: boolean;
  /** The tenant this summary was resolved for. */
  readonly tenantId: string;
}
