import { TestBed, ComponentFixture } from '@angular/core/testing';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { RoleManagementComponent } from './role-management.component';
import { ManageRolesUseCase } from '@core/application/auth/manage-roles.use-case';
import { CurrentUserService } from '@core/application/auth/current-user.service';
import { AUTH_GATEWAY } from '@core/application/auth/ports/auth-gateway.port';
import { AuthSessionDto } from '@core/application/auth/dtos/auth-session.dto';
import { RoleSummaryDto } from '@core/application/auth/dtos/role-summary.dto';
import { ToastService } from '@shared/ui/toast/toast.service';
import { Permission } from '@core/domain/auth/permission.constants';

const ROLES: RoleSummaryDto[] = [
  {
    id: 'role-admin',
    name: 'admin',
    permissions: [Permission.MANAGE_ROLES],
    level: 3,
    isBuiltIn: true,
  },
  {
    id: 'role-kiosk',
    name: 'kiosk',
    permissions: [Permission.PROCESS_SALE],
    level: 1,
    isBuiltIn: false,
  },
];

function gateway() {
  return {
    authenticate: vi.fn(),
    getActiveSession: vi.fn().mockResolvedValue(null),
    refresh: vi.fn(),
    signOut: vi.fn(),
    getAccessToken: vi.fn().mockReturnValue(null),
  };
}

function session(perms: Permission[]): AuthSessionDto {
  return {
    operatorId: 'op-1',
    tenantId: 'store-a',
    roles: ['admin'],
    permissions: perms,
    accessToken: 't',
    expiresAt: new Date(Date.now() + 3.6e6).toISOString(),
  };
}

async function flush(fixture: ComponentFixture<RoleManagementComponent>): Promise<void> {
  for (let i = 0; i < 6; i++) await Promise.resolve();
  await new Promise((r) => setTimeout(r, 0));
  fixture.detectChanges();
}

async function setup(
  perms: Permission[],
  opts: { createRejects?: boolean } = {}
): Promise<{
  fixture: ComponentFixture<RoleManagementComponent>;
  useCase: {
    listRoles: ReturnType<typeof vi.fn>;
    createRole: ReturnType<typeof vi.fn>;
    updateRolePermissions: ReturnType<typeof vi.fn>;
    deleteRole: ReturnType<typeof vi.fn>;
  };
  toast: { success: ReturnType<typeof vi.fn>; error: ReturnType<typeof vi.fn> };
}> {
  const useCase = {
    listRoles: vi.fn().mockResolvedValue(ROLES),
    createRole: opts.createRejects
      ? vi.fn().mockRejectedValue(new Error('already exists'))
      : vi.fn().mockResolvedValue('role-new'),
    updateRolePermissions: vi.fn().mockResolvedValue(undefined),
    deleteRole: vi.fn().mockResolvedValue(undefined),
  };
  const toast = { success: vi.fn(), error: vi.fn(), warning: vi.fn() };
  TestBed.configureTestingModule({
    imports: [RoleManagementComponent],
    providers: [
      CurrentUserService,
      { provide: AUTH_GATEWAY, useValue: gateway() },
      { provide: ManageRolesUseCase, useValue: useCase },
      { provide: ToastService, useValue: toast },
    ],
  });
  TestBed.inject(CurrentUserService).setSession(session(perms));
  const fixture = TestBed.createComponent(RoleManagementComponent);
  fixture.detectChanges();
  await flush(fixture);
  return { fixture, useCase, toast };
}

describe('RoleManagementComponent', () => {
  beforeEach(() => TestBed.resetTestingModule());

  it('lists roles, badging built-ins and locking their actions', async () => {
    const { fixture } = await setup([Permission.MANAGE_ROLES]);
    const el = fixture.nativeElement as HTMLElement;
    expect(el.querySelectorAll('[data-testid^="role-card-"]')).toHaveLength(2);
    // built-in admin: badge present, no delete button
    expect(
      el.querySelector('[data-testid="role-card-role-admin"] [data-testid="builtin-badge"]')
    ).not.toBeNull();
    expect(el.querySelector('[data-testid="role-delete-role-admin"]')).toBeNull();
    // custom kiosk: delete available
    expect(el.querySelector('[data-testid="role-delete-role-kiosk"]')).not.toBeNull();
  });

  it('creates a custom role from the form', async () => {
    const { fixture, useCase } = await setup([Permission.MANAGE_ROLES]);
    const el = fixture.nativeElement as HTMLElement;

    const name = el.querySelector<HTMLInputElement>('[data-testid="role-name-input"]')!;
    name.value = 'stock-clerk';
    name.dispatchEvent(new Event('input'));
    el.querySelector<HTMLInputElement>('[data-testid="new-perm-inventory:adjust-stock"]')!.click();

    el.querySelector<HTMLFormElement>('[data-testid="role-create-form"]')!.dispatchEvent(
      new Event('submit')
    );
    await flush(fixture);

    expect(useCase.createRole).toHaveBeenCalledWith({
      name: 'stock-clerk',
      permissions: [Permission.ADJUST_STOCK],
    });
  });

  it('deletes a custom role after confirmation', async () => {
    const { fixture, useCase } = await setup([Permission.MANAGE_ROLES]);
    vi.stubGlobal('confirm', vi.fn().mockReturnValue(true));
    const el = fixture.nativeElement as HTMLElement;

    el.querySelector<HTMLButtonElement>('[data-testid="role-delete-role-kiosk"]')!.click();
    await flush(fixture);

    expect(useCase.deleteRole).toHaveBeenCalledWith('role-kiosk');
    vi.unstubAllGlobals();
  });

  it('edits a custom role’s permissions', async () => {
    const { fixture, useCase } = await setup([Permission.MANAGE_ROLES]);
    const el = fixture.nativeElement as HTMLElement;

    el.querySelector<HTMLButtonElement>('[data-testid="role-edit-role-kiosk"]')!.click();
    fixture.detectChanges();
    // kiosk starts with PROCESS_SALE; add VIEW_INVENTORY
    el.querySelector<HTMLInputElement>('[data-testid="edit-perm-inventory:view"]')!.click();
    el.querySelector<HTMLButtonElement>('[data-testid="role-save-role-kiosk"]')!.click();
    await flush(fixture);

    expect(useCase.updateRolePermissions).toHaveBeenCalledWith(
      'role-kiosk',
      expect.arrayContaining([Permission.PROCESS_SALE, Permission.VIEW_INVENTORY])
    );
  });

  it('surfaces a toast (and no throw) when creating a role fails', async () => {
    const { fixture, toast } = await setup([Permission.MANAGE_ROLES], { createRejects: true });
    const el = fixture.nativeElement as HTMLElement;
    const name = el.querySelector<HTMLInputElement>('[data-testid="role-name-input"]')!;
    name.value = 'kiosk';
    name.dispatchEvent(new Event('input'));
    el.querySelector<HTMLFormElement>('[data-testid="role-create-form"]')!.dispatchEvent(
      new Event('submit')
    );
    await flush(fixture);
    expect(toast.error).toHaveBeenCalledWith('already exists'); // Error message surfaced
  });

  it('does not delete when the confirmation is cancelled', async () => {
    const { fixture, useCase } = await setup([Permission.MANAGE_ROLES]);
    vi.stubGlobal('confirm', vi.fn().mockReturnValue(false));
    (fixture.nativeElement as HTMLElement)
      .querySelector<HTMLButtonElement>('[data-testid="role-delete-role-kiosk"]')!
      .click();
    await flush(fixture);
    expect(useCase.deleteRole).not.toHaveBeenCalled();
    vi.unstubAllGlobals();
  });

  it('hides the section entirely without MANAGE_ROLES (directive gate)', async () => {
    const { fixture } = await setup([Permission.PROCESS_SALE]);
    const el = fixture.nativeElement as HTMLElement;
    expect(el.querySelector('[data-testid="roles-section"]')).toBeNull();
  });
});
