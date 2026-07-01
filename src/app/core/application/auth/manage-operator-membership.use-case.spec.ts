import { TestBed } from '@angular/core/testing';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { ManageOperatorMembershipUseCase } from './manage-operator-membership.use-case';
import { OPERATOR_ADMIN_PORT } from './ports/operator-admin.port';
import { CurrentUserService } from './current-user.service';
import { AngularAuthorizationService, AuthorizationError } from './angular-authorization.service';
import { Permission } from '@core/domain/auth/permission.constants';

describe('ManageOperatorMembershipUseCase', () => {
  const port = { listOperatorsForTenant: vi.fn(), assignRole: vi.fn(), revokeMembership: vi.fn() };
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
