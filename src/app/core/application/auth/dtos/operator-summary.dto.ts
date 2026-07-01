/**
 * OperatorSummaryDto
 *
 * Application-layer read model describing one operator as seen by the admin
 * user-management screen. Deliberately excludes `passwordHash` and any other
 * credential material — the UI only ever needs identity + role + status.
 *
 * `roleId`/`roleName` are the operator's role **in the tenant being listed**
 * (resolved through the `userTenants` join), never a role stored directly on the
 * operator record. The same operator may hold a different role in another tenant.
 * `roleName` is a free string (built-in or custom role name).
 */
export interface OperatorSummaryDto {
  /** Operator id (matches the JWT `sub` / `userTenants.userId`). */
  readonly id: string;
  /** Login email. */
  readonly email: string;
  /** Human-friendly name shown in the table. */
  readonly displayName: string;
  /** Id of the role held in the listed tenant (drives the assign-role dropdown). */
  readonly roleId: string;
  /** Display name of the role held in the listed tenant (built-in or custom). */
  readonly roleName: string;
  /** Whether the operator can currently sign in. */
  readonly isActive: boolean;
  /** The tenant this summary was resolved for. */
  readonly tenantId: string;
}
