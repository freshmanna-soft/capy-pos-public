import { Injectable, inject } from '@angular/core';
import { ROLE_ADMIN_PORT } from './ports/role-admin.port';
import { AngularAuthorizationService } from './angular-authorization.service';
import { CreateRoleInput, RoleSummaryDto } from './dtos/role-summary.dto';
import { Permission } from '@core/domain/auth/permission.constants';

/**
 * ManageRolesUseCase (Application layer)
 *
 * Author data-driven roles for the admin role-management screen. Every operation
 * asserts `MANAGE_ROLES` first, so authorization is enforced at the application
 * layer regardless of what the UI shows. Built-in role protection (no edit/delete)
 * is enforced by the port implementation.
 */
@Injectable({ providedIn: 'root' })
export class ManageRolesUseCase {
  private readonly port = inject(ROLE_ADMIN_PORT);
  private readonly authz = inject(AngularAuthorizationService);

  /** @throws AuthorizationError without MANAGE_ROLES. */
  async listRoles(): Promise<RoleSummaryDto[]> {
    this.authz.assert(Permission.MANAGE_ROLES);
    return this.port.listRoles();
  }

  /** @throws AuthorizationError without MANAGE_ROLES. Returns the new role id. */
  async createRole(input: CreateRoleInput): Promise<string> {
    this.authz.assert(Permission.MANAGE_ROLES);
    return this.port.createRole(input);
  }

  /** @throws AuthorizationError without MANAGE_ROLES; Error for a built-in role. */
  async updateRolePermissions(roleId: string, permissions: Permission[]): Promise<void> {
    this.authz.assert(Permission.MANAGE_ROLES);
    await this.port.updateRolePermissions(roleId, permissions);
  }

  /** @throws AuthorizationError without MANAGE_ROLES; Error for a built-in / in-use role. */
  async deleteRole(roleId: string): Promise<void> {
    this.authz.assert(Permission.MANAGE_ROLES);
    await this.port.deleteRole(roleId);
  }
}
