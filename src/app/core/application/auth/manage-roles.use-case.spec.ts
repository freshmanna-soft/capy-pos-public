import { TestBed } from '@angular/core/testing';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { ManageRolesUseCase } from './manage-roles.use-case';
import { ROLE_ADMIN_PORT } from './ports/role-admin.port';
import { AngularAuthorizationService, AuthorizationError } from './angular-authorization.service';
import { Permission } from '@core/domain/auth/permission.constants';

describe('ManageRolesUseCase', () => {
  const port = {
    listRoles: vi.fn().mockResolvedValue([]),
    createRole: vi.fn().mockResolvedValue('role-new'),
    updateRolePermissions: vi.fn(),
    deleteRole: vi.fn(),
  };
  let allowed: boolean;
  const authz = {
    assert: vi.fn((p: Permission) => {
      if (!allowed) throw new AuthorizationError(p);
    }),
  };
  let useCase: ManageRolesUseCase;

  beforeEach(() => {
    allowed = true;
    vi.clearAllMocks();
    TestBed.configureTestingModule({
      providers: [
        ManageRolesUseCase,
        { provide: ROLE_ADMIN_PORT, useValue: port },
        { provide: AngularAuthorizationService, useValue: authz },
      ],
    });
    useCase = TestBed.inject(ManageRolesUseCase);
  });

  it('every operation asserts MANAGE_ROLES then delegates to the port', async () => {
    await useCase.listRoles();
    await useCase.createRole({ name: 'kiosk', permissions: [Permission.PROCESS_SALE] });
    await useCase.updateRolePermissions('role-x', [Permission.VIEW_INVENTORY]);
    await useCase.deleteRole('role-x');

    expect(authz.assert).toHaveBeenCalledTimes(4);
    expect(authz.assert).toHaveBeenCalledWith(Permission.MANAGE_ROLES);
    expect(port.listRoles).toHaveBeenCalled();
    expect(port.createRole).toHaveBeenCalledWith({
      name: 'kiosk',
      permissions: [Permission.PROCESS_SALE],
    });
    expect(port.updateRolePermissions).toHaveBeenCalledWith('role-x', [Permission.VIEW_INVENTORY]);
    expect(port.deleteRole).toHaveBeenCalledWith('role-x');
  });

  it('throws (and does not touch the port) without MANAGE_ROLES', async () => {
    allowed = false;
    await expect(useCase.createRole({ name: 'kiosk', permissions: [] })).rejects.toBeInstanceOf(
      AuthorizationError
    );
    expect(port.createRole).not.toHaveBeenCalled();
  });
});
