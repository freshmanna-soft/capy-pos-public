import { Permission } from '@core/domain/auth/permission.constants';

/**
 * RoleSummaryDto
 *
 * Application-layer read model for the admin role-management screen: a role and
 * the permissions it grants. Built-in roles (operator/manager/admin) are flagged
 * so the UI can prevent deleting/renaming them.
 */
export interface RoleSummaryDto {
  readonly id: string;
  readonly name: string;
  /** Known permissions granted by this role (unknown stored strings are dropped). */
  readonly permissions: Permission[];
  /** Hierarchy level (higher == more privileged). */
  readonly level: number;
  /** True for the fixed operator/manager/admin roles (cannot be deleted). */
  readonly isBuiltIn: boolean;
}

/** Input for creating a custom role. */
export interface CreateRoleInput {
  readonly name: string;
  readonly permissions: Permission[];
  /** Optional explicit hierarchy level; defaults to operator level (1) when omitted. */
  readonly level?: number;
}
