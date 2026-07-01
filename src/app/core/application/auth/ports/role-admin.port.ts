import { InjectionToken } from '@angular/core';
import { Permission } from '@core/domain/auth/permission.constants';
import { CreateRoleInput, RoleSummaryDto } from '../dtos/role-summary.dto';

/**
 * RoleAdminPort
 *
 * Swap seam for authoring data-driven roles (story #44). Implementations persist
 * the `roles` table; built-in roles (operator/manager/admin) are protected —
 * they cannot be deleted, and their canonical permissions are the domain source
 * of truth regardless of what is stored. Bound via {@link ROLE_ADMIN_PORT}.
 */
export interface RoleAdminPort {
  /** List all roles (built-in + custom) with their permissions and level. */
  listRoles(): Promise<RoleSummaryDto[]>;

  /**
   * Create a custom role. Throws if the name collides with an existing role
   * (built-in or custom). Returns the new role's id.
   */
  createRole(input: CreateRoleInput): Promise<string>;

  /**
   * Replace the permission set of a **custom** role. Throws for a built-in role
   * (their permissions are fixed) or an unknown role id.
   */
  updateRolePermissions(roleId: string, permissions: Permission[]): Promise<void>;

  /**
   * Delete a **custom** role. Throws for a built-in role, and refuses when any
   * membership still references the role (would orphan operators).
   */
  deleteRole(roleId: string): Promise<void>;
}

export const ROLE_ADMIN_PORT = new InjectionToken<RoleAdminPort>('ROLE_ADMIN_PORT');
