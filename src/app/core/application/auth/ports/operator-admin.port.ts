import { InjectionToken } from '@angular/core';
import { OperatorSummaryDto } from '../dtos/operator-summary.dto';

/**
 * OperatorAdminPort
 *
 * Swap seam that decouples the operator-administration use-cases from the
 * concrete persistence mechanism (local Dexie today, a Cognito/admin API when
 * the backend lands). Implementations live in infrastructure and are bound via
 * the {@link OPERATOR_ADMIN_PORT} token.
 *
 * Read + membership mutations (story #44). Role authoring lives on the separate
 * {@link RoleAdminPort}; this port owns the operator↔tenant↔role join only.
 */
export interface OperatorAdminPort {
  /**
   * List every operator who holds a membership in `tenantId`, together with the
   * role they hold **in that tenant**. Enforces tenant isolation by construction:
   * only operators joined to the given tenant are returned.
   *
   * Implementations must map resiliently — a membership row that references a
   * missing operator is skipped (logged, not thrown), so one bad row cannot
   * break the whole screen.
   */
  listOperatorsForTenant(tenantId: string): Promise<OperatorSummaryDto[]>;

  /**
   * Assign (or reassign) `roleId` to `userId` within `tenantId` — upserts the
   * single `userTenants(userId, tenantId)` row (one role per tenant). Throws if
   * the operator or role does not exist.
   */
  assignRole(userId: string, tenantId: string, roleId: string): Promise<void>;

  /**
   * Remove `userId`'s membership in `tenantId` (revokes all access there). No-op
   * if the membership does not exist.
   */
  revokeMembership(userId: string, tenantId: string): Promise<void>;
}

export const OPERATOR_ADMIN_PORT = new InjectionToken<OperatorAdminPort>('OPERATOR_ADMIN_PORT');
