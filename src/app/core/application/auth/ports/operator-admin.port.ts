import { InjectionToken } from '@angular/core';
import { OperatorSummaryDto } from '../dtos/operator-summary.dto';
import { RoleSummaryDto } from '../dtos/role-summary.dto';

/**
 * OperatorAdminPort
 *
 * Swap seam that decouples the operator-administration use-cases from the
 * concrete persistence mechanism — local Dexie ({@link DexieOperatorAdminAdapter})
 * when the local credential adapter is the active `AuthGateway`, App ID's own
 * Management API ({@link AppIdOperatorAdminAdapter}) once `environment.appId.enabled`
 * is true. Implementations live in infrastructure and are bound via the
 * {@link OPERATOR_ADMIN_PORT} token, same `useAppIdGateway` ternary as
 * `AUTH_GATEWAY` in `auth.providers.ts`.
 *
 * Read + membership mutations (story #44), plus staff creation (Phase 3d).
 * `listAssignableRoles()` lives here rather than on the separate
 * {@link RoleAdminPort} because it genuinely differs per backend: Dexie's set is
 * the full data-driven custom-role list, App ID's is fixed to the three
 * built-in role names with App ID's own role ids — `RoleAdminPort`'s custom
 * role *authoring* stays Dexie-only regardless of which gateway is active, since
 * App ID's scopes-compiled-into-roles model has no equivalent for an arbitrary
 * permission set.
 */
export interface OperatorAdminPort {
  /**
   * Whether `createOperator()` can actually succeed on this backend — `false`
   * for {@link DexieOperatorAdminAdapter} (local/dev never had a creation
   * path), `true` for {@link AppIdOperatorAdminAdapter}. A capability flag, not
   * a permission check: `OperatorListComponent` reads this to decide whether
   * to *offer* the "add staff" form at all, the same "offered only when it can
   * succeed" convention `LoginComponent` already uses for passkey/PIN — not
   * something to gate behind a promise the caller has to catch.
   */
  readonly supportsCreate: boolean;

  /**
   * List every operator who holds a membership in `tenantId`, together with the
   * role they hold **in that tenant**. Enforces tenant isolation by construction:
   * only operators joined to the given tenant are returned.
   *
   * Implementations must map resiliently — a membership row that references a
   * missing operator (or, for the App ID adapter, a role no longer configured)
   * is skipped (logged, not thrown), so one bad row cannot break the whole screen.
   */
  listOperatorsForTenant(tenantId: string): Promise<OperatorSummaryDto[]>;

  /**
   * Roles that may be assigned to an operator — the source for the assign-role
   * dropdown and for `createOperator()`'s role picker alike.
   */
  listAssignableRoles(): Promise<RoleSummaryDto[]>;

  /**
   * Create a new staff account and assign it `roleId`. Throws when this backend
   * has no creation path at all ({@link DexieOperatorAdminAdapter} — local/dev
   * never had one) or when the underlying call fails (e.g. the role no longer
   * exists). Never returns or logs a password: the App ID adapter's account
   * starts with a server-generated throwaway one and immediately triggers App
   * ID's own reset-password email, so the new hire sets their own.
   */
  createOperator(email: string, roleId: string): Promise<OperatorSummaryDto>;

  /**
   * Assign (or reassign) `roleId` to `userId` within `tenantId` — upserts the
   * single `userTenants(userId, tenantId)` row (one role per tenant) for Dexie,
   * or replaces the App ID user's role set for the App ID adapter. Throws if
   * the operator or role does not exist.
   */
  assignRole(userId: string, tenantId: string, roleId: string): Promise<void>;

  /**
   * Remove `userId`'s membership in `tenantId` (revokes all access there). No-op
   * if the membership does not exist. For the App ID adapter this unassigns
   * every role rather than deleting the account — reversible, and the faithful
   * equivalent of "remove this tenant's membership," not "delete the person."
   */
  revokeMembership(userId: string, tenantId: string): Promise<void>;
}

export const OPERATOR_ADMIN_PORT = new InjectionToken<OperatorAdminPort>('OPERATOR_ADMIN_PORT');
