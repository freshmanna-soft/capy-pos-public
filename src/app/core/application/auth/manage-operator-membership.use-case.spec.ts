import { TestBed } from '@angular/core/testing';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { ManageOperatorMembershipUseCase } from './manage-operator-membership.use-case';
import { OPERATOR_ADMIN_PORT } from './ports/operator-admin.port';
import { CurrentUserService } from './current-user.service';
import { AngularAuthorizationService, AuthorizationError } from './angular-authorization.service';
import { Permission } from '@core/domain/auth';

describe('ManageOperatorMembershipUseCase', () => {
  const port = {
    supportsCreate: true,
    listOperatorsForTenant: vi.fn(),
    listAssignableRoles: vi.fn().mockResolvedValue([{ id: 'role-admin', name: 'admin' }]),
    createOperator: vi.fn(),
    assignRole: vi.fn(),
    revokeMembership: vi.fn(),
  };
  let allowed: boolean;
  let activeTenant: string | null;

  const authz = {
    assert: vi.fn((p: Permission) => {
      if (!allowed) throw new AuthorizationError(p);
    }),
  };
  const currentUser = { activeTenantId: () => activeTenant };

  let useCase: ManageOperatorMembershipUseCase;

  beforeEach(() => {
    allowed = true;
    activeTenant = 'store-a';
    vi.clearAllMocks();
    TestBed.configureTestingModule({
      providers: [
        ManageOperatorMembershipUseCase,
        { provide: OPERATOR_ADMIN_PORT, useValue: port },
        { provide: CurrentUserService, useValue: currentUser },
        { provide: AngularAuthorizationService, useValue: authz },
      ],
    });
    useCase = TestBed.inject(ManageOperatorMembershipUseCase);
  });

  it('listAssignableRoles asserts MANAGE_OPERATORS then returns roles from the port', async () => {
    const roles = await useCase.listAssignableRoles();
    expect(authz.assert).toHaveBeenCalledWith(Permission.MANAGE_OPERATORS);
    expect(port.listAssignableRoles).toHaveBeenCalled();
    expect(roles).toEqual([{ id: 'role-admin', name: 'admin' }]);
  });

  it('supportsCreate reflects the port’s own capability flag, with no permission gate', () => {
    expect(useCase.supportsCreate).toBe(true);
    expect(authz.assert).not.toHaveBeenCalled();
  });

  it('createOperator asserts MANAGE_OPERATORS then delegates to the port', async () => {
    port.createOperator.mockResolvedValue({
      id: 'new-1',
      email: 'new@capy.test',
      displayName: 'new@capy.test',
    });
    const created = await useCase.createOperator('new@capy.test', 'role-admin');
    expect(authz.assert).toHaveBeenCalledWith(Permission.MANAGE_OPERATORS);
    expect(port.createOperator).toHaveBeenCalledWith('new@capy.test', 'role-admin');
    expect(created.id).toBe('new-1');
  });

  it('createOperator throws (and does not write) without the permission', async () => {
    allowed = false;
    await expect(useCase.createOperator('new@capy.test', 'role-admin')).rejects.toBeInstanceOf(
      AuthorizationError
    );
    expect(port.createOperator).not.toHaveBeenCalled();
  });

  it('assignRole asserts MANAGE_OPERATORS then writes to the active tenant', async () => {
    await useCase.assignRole('op-1', 'role-admin');
    expect(authz.assert).toHaveBeenCalledWith(Permission.MANAGE_OPERATORS);
    expect(port.assignRole).toHaveBeenCalledWith('op-1', 'store-a', 'role-admin');
  });

  it('revokeMembership asserts MANAGE_OPERATORS then revokes in the active tenant', async () => {
    await useCase.revokeMembership('op-1');
    expect(authz.assert).toHaveBeenCalledWith(Permission.MANAGE_OPERATORS);
    expect(port.revokeMembership).toHaveBeenCalledWith('op-1', 'store-a');
  });

  it('throws (and does not write) without the permission', async () => {
    allowed = false;
    await expect(useCase.assignRole('op-1', 'role-admin')).rejects.toBeInstanceOf(
      AuthorizationError
    );
    expect(port.assignRole).not.toHaveBeenCalled();
  });

  it('throws when there is no active tenant', async () => {
    activeTenant = null;
    await expect(useCase.assignRole('op-1', 'role-admin')).rejects.toThrow(/active tenant/);
    expect(port.assignRole).not.toHaveBeenCalled();
  });
});
