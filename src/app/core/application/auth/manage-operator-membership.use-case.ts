import { Injectable, inject } from '@angular/core';
import { OPERATOR_ADMIN_PORT } from './ports/operator-admin.port';
import { ROLE_ADMIN_PORT } from './ports/role-admin.port';
import { CurrentUserService } from './current-user.service';
import { AngularAuthorizationService } from './angular-authorization.service';
import { RoleSummaryDto } from './dtos/role-summary.dto';
import { Permission } from '@core/domain/auth/permission.constants';

/**
 * ManageOperatorMembershipUseCase (Application layer)
 *
 * Assign or revoke an operator's role **in the active tenant**. Enforces the
 * authorization boundary at the application layer — `MANAGE_OPERATORS` is
 * asserted before any write, so the check can't be bypassed by calling the
 * use-case directly (the `*appHasPermission` directive only hides UI). Tenant
 * scope always comes from the current session, so an admin can only manage
 * memberships in the tenant they're working in.
 */
@Injectable({ providedIn: 'root' })
export class ManageOperatorMembershipUseCase {
  private readonly port = inject(OPERATOR_ADMIN_PORT);
  private readonly roles = inject(ROLE_ADMIN_PORT);
  private readonly currentUser = inject(CurrentUserService);
  private readonly authz = inject(AngularAuthorizationService);

  /**
   * Roles that can be assigned in the operator list. Gated by MANAGE_OPERATORS
   * (assigning a role is part of managing operators) — so an operator-manager who
   * cannot author roles (no MANAGE_ROLES) can still populate the assign dropdown.
   * @throws AuthorizationError without MANAGE_OPERATORS.
   */
  async listAssignableRoles(): Promise<RoleSummaryDto[]> {
    this.authz.assert(Permission.MANAGE_OPERATORS);
    return this.roles.listRoles();
  }

  /** @throws AuthorizationError without MANAGE_OPERATORS; Error when no active tenant. */
  async assignRole(userId: string, roleId: string): Promise<void> {
    this.authz.assert(Permission.MANAGE_OPERATORS);
    await this.port.assignRole(userId, this.requireTenant(), roleId);
  }

  /** @throws AuthorizationError without MANAGE_OPERATORS; Error when no active tenant. */
  async revokeMembership(userId: string): Promise<void> {
    this.authz.assert(Permission.MANAGE_OPERATORS);
    await this.port.revokeMembership(userId, this.requireTenant());
  }

  private requireTenant(): string {
    const tenantId = this.currentUser.activeTenantId();
    if (!tenantId) throw new Error('No active tenant — cannot manage memberships');
    return tenantId;
  }
}
