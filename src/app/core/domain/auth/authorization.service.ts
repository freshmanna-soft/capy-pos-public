import { Role, RoleName } from './role.value-object';
import { Permission } from './permission.constants';

/**
 * AuthorizationService (Domain)
 *
 * Pure, framework-free evaluation service.
 * Answers "can this principal perform this action?" using the Role hierarchy
 * and permission sets already defined on the Role value object.
 *
 * Callers pass the principal's role-name strings and the required permission.
 * The service resolves Role objects and delegates to Role.hasPermission().
 *
 * Hierarchy: Operator (level 1) < Manager (level 2) < Admin (level 3).
 * A role satisfies a permission when any of the actor's roles includes it
 * (roles are additive — Manager includes all Operator permissions, etc.)
 */
export class AuthorizationService {
  /**
   * Returns true when at least one of the supplied roles has the given permission.
   *
   * @param roleNames - role names as stored in AuthSessionDto.roles
   * @param permission - the permission constant to check
   */
  can(roleNames: readonly string[], permission: Permission): boolean {
    if (roleNames.length === 0) return false;

    return roleNames.some((name) => {
      try {
        const role = Role.fromName(name);
        return role.hasPermission(permission);
      } catch {
        return false;
      }
    });
  }

  /**
   * Returns true when at least one of the supplied roles is at least as
   * privileged as the required minimum role.
   *
   * @param roleNames - actor's role name strings
   * @param minRole   - the minimum RoleName required
   */
  atLeast(roleNames: readonly string[], minRole: RoleName): boolean {
    if (roleNames.length === 0) return false;
    const threshold = new Role(minRole);

    return roleNames.some((name) => {
      try {
        const role = Role.fromName(name);
        return role.atLeast(threshold);
      } catch {
        return false;
      }
    });
  }

  /**
   * Asserts the principal has the given permission.
   * Throws `AuthorizationError` when denied.
   */
  assert(roleNames: readonly string[], permission: Permission): void {
    if (!this.can(roleNames, permission)) {
      throw new AuthorizationError(permission);
    }
  }
}

/**
 * Thrown by AuthorizationService.assert() when a permission check fails.
 * Extends Error so it can be caught generically at the application layer.
 */
export class AuthorizationError extends Error {
  readonly code = 'AUTHORIZATION_DENIED';

  constructor(public readonly permission: Permission) {
    super(`Permission denied: '${permission}'`);
    this.name = 'AuthorizationError';
    Object.setPrototypeOf(this, AuthorizationError.prototype);
  }
}
