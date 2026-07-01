import { TestBed, ComponentFixture } from '@angular/core/testing';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { OperatorListComponent } from './operator-list.component';
import { ListTenantOperatorsUseCase } from '@core/application/auth/list-tenant-operators.use-case';
import { ManageOperatorMembershipUseCase } from '@core/application/auth/manage-operator-membership.use-case';
import { CurrentUserService } from '@core/application/auth/current-user.service';
import { AUTH_GATEWAY } from '@core/application/auth/ports/auth-gateway.port';
import { AuthSessionDto } from '@core/application/auth/dtos/auth-session.dto';
import { OperatorSummaryDto } from '@core/application/auth/dtos/operator-summary.dto';
import { RoleSummaryDto } from '@core/application/auth/dtos/role-summary.dto';
import { ToastService } from '@shared/ui/toast/toast.service';
import { Permission } from '@core/domain/auth/permission.constants';

const OPERATORS: OperatorSummaryDto[] = [
  {
    id: 'op-1',
    email: 'alice@capy.local',
    displayName: 'Alice Admin',
    roleId: 'role-admin',
    roleName: 'admin',
    isActive: true,
    tenantId: 'store-a',
  },
  {
    id: 'op-2',
    email: 'bob@capy.local',
    displayName: 'Bob Operator',
    roleId: 'role-operator',
    roleName: 'operator',
    isActive: false,
    tenantId: 'store-a',
  },
];

const ROLES: RoleSummaryDto[] = [
  { id: 'role-operator', name: 'operator', permissions: [], level: 1, isBuiltIn: true },
  { id: 'role-admin', name: 'admin', permissions: [], level: 3, isBuiltIn: true },
];

function makeGateway() {
  return {
    authenticate: vi.fn(),
    getActiveSession: vi.fn().mockResolvedValue(null),
    refresh: vi.fn().mockResolvedValue(null),
    signOut: vi.fn().mockResolvedValue(undefined),
    getAccessToken: vi.fn().mockReturnValue(null),
  };
}

function adminSession(operatorId = 'op-1'): AuthSessionDto {
  return {
    operatorId,
    tenantId: 'store-a',
    roles: ['admin'],
    permissions: [Permission.MANAGE_OPERATORS, Permission.PROCESS_SALE],
    accessToken: 'tok',
    expiresAt: new Date(Date.now() + 3_600_000).toISOString(),
  };
}

function operatorSession(): AuthSessionDto {
  return {
    operatorId: 'op-2',
    tenantId: 'store-a',
    roles: ['operator'],
    permissions: [Permission.PROCESS_SALE],
    accessToken: 'tok',
    expiresAt: new Date(Date.now() + 3_600_000).toISOString(),
  };
}

interface Mocks {
  fixture: ComponentFixture<OperatorListComponent>;
  membership: {
    listAssignableRoles: ReturnType<typeof vi.fn>;
    assignRole: ReturnType<typeof vi.fn>;
    revokeMembership: ReturnType<typeof vi.fn>;
  };
  gateway: ReturnType<typeof makeGateway>;
  currentUser: CurrentUserService;
  toast: {
    success: ReturnType<typeof vi.fn>;
    error: ReturnType<typeof vi.fn>;
    warning: ReturnType<typeof vi.fn>;
  };
}

async function setup(opts: {
  session: AuthSessionDto | null;
  result?: OperatorSummaryDto[];
  reject?: boolean;
  assignRejects?: boolean;
}): Promise<Mocks> {
  const listUseCase = {
    execute: opts.reject
      ? vi.fn().mockRejectedValue(new Error('denied'))
      : vi.fn().mockResolvedValue(opts.result ?? []),
  };
  const membership = {
    listAssignableRoles: vi.fn().mockResolvedValue(ROLES),
    assignRole: opts.assignRejects
      ? vi.fn().mockRejectedValue(new Error('nope'))
      : vi.fn().mockResolvedValue(undefined),
    revokeMembership: vi.fn().mockResolvedValue(undefined),
  };
  const gateway = makeGateway();
  const toast = { success: vi.fn(), error: vi.fn(), warning: vi.fn() };

  TestBed.configureTestingModule({
    imports: [OperatorListComponent],
    providers: [
      CurrentUserService,
      { provide: AUTH_GATEWAY, useValue: gateway },
      { provide: ListTenantOperatorsUseCase, useValue: listUseCase },
      { provide: ManageOperatorMembershipUseCase, useValue: membership },
      { provide: ToastService, useValue: toast },
    ],
  });

  const currentUser = TestBed.inject(CurrentUserService);
  if (opts.session) currentUser.setSession(opts.session);

  const fixture = TestBed.createComponent(OperatorListComponent);
  fixture.detectChanges();
  await flush(fixture);

  return { fixture, membership, gateway, currentUser, toast };
}

/**
 * Settle the async ngOnInit load (Promise.all over mocked use-cases) then re-run
 * change detection. Flushes the microtask queue rather than relying on
 * whenStable(), which doesn't await the mock promises under this setup.
 */
async function flush(fixture: ComponentFixture<OperatorListComponent>): Promise<void> {
  for (let i = 0; i < 6; i++) await Promise.resolve();
  await new Promise((r) => setTimeout(r, 0));
  fixture.detectChanges();
}

function html(fixture: ComponentFixture<OperatorListComponent>): string {
  return (fixture.nativeElement as HTMLElement).innerHTML;
}

describe('OperatorListComponent', () => {
  beforeEach(() => TestBed.resetTestingModule());

  it('renders a row per operator for an admin session', async () => {
    const { fixture } = await setup({ session: adminSession(), result: OPERATORS });
    const el = fixture.nativeElement as HTMLElement;
    expect(el.querySelector('[data-testid="operators-table"]')).not.toBeNull();
    expect(el.querySelectorAll('[data-testid="operator-name"]')).toHaveLength(2);
    expect(html(fixture)).toContain('Alice Admin');
  });

  it('shows a role dropdown selecting the operator’s current role', async () => {
    const { fixture } = await setup({ session: adminSession(), result: OPERATORS });
    const el = fixture.nativeElement as HTMLElement;
    const select = el.querySelector<HTMLSelectElement>('[data-testid="operator-role-select-op-2"]');
    expect(select).not.toBeNull();
    expect(select!.value).toBe('role-operator'); // Bob's current role selected
    expect(select!.querySelectorAll('option')).toHaveLength(ROLES.length);
  });

  it('shows the empty state when there are no operators', async () => {
    const { fixture } = await setup({ session: adminSession(), result: [] });
    const el = fixture.nativeElement as HTMLElement;
    expect(el.querySelector('[data-testid="operators-empty"]')).not.toBeNull();
  });

  it('hides the section entirely for a non-admin session (directive gate)', async () => {
    const { fixture } = await setup({ session: operatorSession(), result: OPERATORS });
    const el = fixture.nativeElement as HTMLElement;
    expect(el.querySelector('[data-testid="operators-section"]')).toBeNull();
  });

  it('surfaces a neutral error message when loading fails', async () => {
    const { fixture } = await setup({ session: adminSession(), reject: true });
    const el = fixture.nativeElement as HTMLElement;
    expect(el.querySelector('[data-testid="operators-error"]')).not.toBeNull();
  });

  it('assigns a new role via the dropdown', async () => {
    const { fixture, membership } = await setup({ session: adminSession(), result: OPERATORS });
    const el = fixture.nativeElement as HTMLElement;
    const select = el.querySelector<HTMLSelectElement>(
      '[data-testid="operator-role-select-op-2"]'
    )!;

    select.value = 'role-admin';
    select.dispatchEvent(new Event('change'));
    await flush(fixture);

    expect(membership.assignRole).toHaveBeenCalledWith('op-2', 'role-admin');
  });

  it('revokes membership after confirmation', async () => {
    const { fixture, membership } = await setup({ session: adminSession(), result: OPERATORS });
    vi.stubGlobal('confirm', vi.fn().mockReturnValue(true));
    const el = fixture.nativeElement as HTMLElement;

    el.querySelector<HTMLButtonElement>('[data-testid="operator-revoke-op-2"]')!.click();
    await flush(fixture);

    expect(membership.revokeMembership).toHaveBeenCalledWith('op-2');
    vi.unstubAllGlobals();
  });

  it('refreshes the session when the admin changes their OWN membership (AC4)', async () => {
    const { fixture, gateway } = await setup({ session: adminSession('op-1'), result: OPERATORS });
    const select = (fixture.nativeElement as HTMLElement).querySelector<HTMLSelectElement>(
      '[data-testid="operator-role-select-op-1"]'
    )!;
    select.value = 'role-operator';
    select.dispatchEvent(new Event('change'));
    await flush(fixture);
    expect(gateway.refresh).toHaveBeenCalled(); // self-change → session refreshed live
  });

  it('does NOT refresh the session when changing another operator (AC4)', async () => {
    const { fixture, gateway } = await setup({ session: adminSession('op-1'), result: OPERATORS });
    const select = (fixture.nativeElement as HTMLElement).querySelector<HTMLSelectElement>(
      '[data-testid="operator-role-select-op-2"]'
    )!;
    select.value = 'role-admin';
    select.dispatchEvent(new Event('change'));
    await flush(fixture);
    expect(gateway.refresh).not.toHaveBeenCalled();
  });

  it('does nothing when the same role is re-selected (no-op)', async () => {
    const { fixture, membership } = await setup({ session: adminSession(), result: OPERATORS });
    const select = (fixture.nativeElement as HTMLElement).querySelector<HTMLSelectElement>(
      '[data-testid="operator-role-select-op-2"]'
    )!;
    select.value = 'role-operator'; // already Bob's role
    select.dispatchEvent(new Event('change'));
    await flush(fixture);
    expect(membership.assignRole).not.toHaveBeenCalled();
  });

  it('does not revoke when the confirmation is cancelled', async () => {
    const { fixture, membership } = await setup({ session: adminSession(), result: OPERATORS });
    vi.stubGlobal('confirm', vi.fn().mockReturnValue(false));
    (fixture.nativeElement as HTMLElement)
      .querySelector<HTMLButtonElement>('[data-testid="operator-revoke-op-2"]')!
      .click();
    await flush(fixture);
    expect(membership.revokeMembership).not.toHaveBeenCalled();
    vi.unstubAllGlobals();
  });

  it('shows an error toast when assigning a role fails', async () => {
    const { fixture, toast } = await setup({
      session: adminSession(),
      result: OPERATORS,
      assignRejects: true,
    });
    const select = (fixture.nativeElement as HTMLElement).querySelector<HTMLSelectElement>(
      '[data-testid="operator-role-select-op-2"]'
    )!;
    select.value = 'role-admin';
    select.dispatchEvent(new Event('change'));
    await flush(fixture);
    expect(toast.error).toHaveBeenCalled();
  });
});
