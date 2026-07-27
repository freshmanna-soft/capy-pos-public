/**
 * Auth Domain Module
 *
 * Exports the framework-free auth/RBAC domain: entities, value objects,
 * the authorization service, and permission/role constants.
 *
 * This barrel is the curated public surface for the domain. It is the exact
 * boundary earmarked for extraction into `@freshmanna/domain-auth` (POS-139):
 * consumers import from `@core/domain/auth` rather than reaching into
 * individual files, so swapping the local domain for the published package
 * later is a single path change per file (or a tsconfig path remap).
 */

// Permissions
export {
  Permission,
  OPERATOR_PERMISSIONS,
  MANAGER_PERMISSIONS,
  ADMIN_PERMISSIONS,
  ALL_PERMISSIONS,
  isPermission,
} from '@core/domain/auth/permission.constants';

// Role
export type { RoleRecord } from '@core/domain/auth/role.value-object';
export { Role, RoleName, BUILT_IN_ROLE_NAMES } from '@core/domain/auth/role.value-object';

// Operator entity
export { Operator } from '@core/domain/auth/operator.entity';

// Tenant identity & membership
export { TenantId } from '@core/domain/auth/tenant-id.value-object';
export type { TenantMembershipJSON } from '@core/domain/auth/tenant-membership.value-object';
export { TenantMembership } from '@core/domain/auth/tenant-membership.value-object';
export { TenantMembershipSet, TenantIsolationError } from '@core/domain/auth/tenant-membership-set';

// Authorization service
export { AuthorizationService, AuthorizationError } from '@core/domain/auth/authorization.service';
