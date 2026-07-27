import { describe, it, expect } from 'vitest';
import * as auth from './index';
import {
  Permission,
  ALL_PERMISSIONS,
  isPermission,
  Role,
  RoleName,
  BUILT_IN_ROLE_NAMES,
  Operator,
  TenantId,
  TenantMembership,
  TenantMembershipSet,
  TenantIsolationError,
  AuthorizationService,
  AuthorizationError,
} from './index';

/**
 * Guards the public surface of the auth domain (POS-139).
 *
 * The barrel is the boundary earmarked for `@freshmanna/domain-auth`, so a
 * dropped or renamed export is a breaking change for every consumer and every
 * downstream vertical. This spec fails loudly if the surface changes.
 */
describe('auth domain public surface (@core/domain/auth barrel)', () => {
  it('exposes exactly the intended named exports', () => {
    // Runtime (value) exports — sorted for a stable, reviewable diff.
    const runtimeExports = Object.keys(auth)
      .filter((key) => auth[key as keyof typeof auth] !== undefined)
      .sort();

    expect(runtimeExports).toEqual([
      'ADMIN_PERMISSIONS',
      'ALL_PERMISSIONS',
      'AuthorizationError',
      'AuthorizationService',
      'BUILT_IN_ROLE_NAMES',
      'MANAGER_PERMISSIONS',
      'OPERATOR_PERMISSIONS',
      'Operator',
      'Permission',
      'Role',
      'RoleName',
      'TenantId',
      'TenantIsolationError',
      'TenantMembership',
      'TenantMembershipSet',
      'isPermission',
    ]);
  });

  it('re-exports the permission constants and guard', () => {
    expect(isPermission(Permission.PROCESS_SALE)).toBe(true);
    expect(ALL_PERMISSIONS).toContain(Permission.MANAGE_ROLES);
  });

  it('re-exports the role model and built-in names', () => {
    expect(BUILT_IN_ROLE_NAMES).toContain(RoleName.ADMIN);
    const admin = new Role(RoleName.ADMIN);
    expect(admin.hasPermission(Permission.MANAGE_ROLES)).toBe(true);
  });

  it('wires the authorization service against the re-exported role', () => {
    const service = new AuthorizationService();
    expect(service.can([new Role(RoleName.OPERATOR)], Permission.PROCESS_SALE)).toBe(true);
    expect(service.can([new Role(RoleName.OPERATOR)], Permission.MANAGE_ROLES)).toBe(false);
  });

  it('re-exports tenant identity, membership and isolation types', () => {
    const tenant = new TenantId('store-a');
    const membership = new TenantMembership(tenant, new Role(RoleName.ADMIN));
    const set = new TenantMembershipSet([membership]);
    expect(set.isMemberOf(tenant)).toBe(true);
    expect(TenantIsolationError.prototype).toBeInstanceOf(Error);
  });

  it('exposes the entity and error constructors', () => {
    expect(typeof Operator).toBe('function');
    expect(AuthorizationError.prototype).toBeInstanceOf(Error);
  });
});
