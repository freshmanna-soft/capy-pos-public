import { TestBed, ComponentFixture } from '@angular/core/testing';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { OperatorListComponent } from './operator-list.component';
import { ListTenantOperatorsUseCase } from '@core/application/auth/list-tenant-operators.use-case';
import { CurrentUserService } from '@core/application/auth/current-user.service';
import { AUTH_GATEWAY } from '@core/application/auth/ports/auth-gateway.port';
import { AuthSessionDto } from '@core/application/auth/dtos/auth-session.dto';
import { OperatorSummaryDto } from '@core/application/auth/dtos/operator-summary.dto';
import { Permission } from '@core/domain/auth/permission.constants';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const OPERATORS: OperatorSummaryDto[] = [
  {
    id: 'op-1',
    email: 'alice@capy.local',
    displayName: 'Alice Admin',
    roleName: 'admin',
    isActive: true,
    tenantId: 'store-a',
  },
  {
    id: 'op-2',
    email: 'bob@capy.local',
    displayName: 'Bob Operator',
    roleName: 'operator',
    isActive: false,
    tenantId: 'store-a',
  },
];

function makeGateway() {
  return {
    authenticate: vi.fn(),
    getActiveSession: vi.fn().mockResolvedValue(null),
    refresh: vi.fn(),
    signOut: vi.fn().mockResolvedValue(undefined),
    getAccessToken: vi.fn().mockReturnValue(null),
  };
}

function adminSession(): AuthSessionDto {
  return {
    operatorId: 'op-1',
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

async function setup(opts: {
  session: AuthSessionDto | null;
  result?: OperatorSummaryDto[];
  reject?: boolean;
}): Promise<{
  fixture: ComponentFixture<OperatorListComponent>;
  useCase: { execute: ReturnType<typeof vi.fn> };
}> {
  const useCase = {
    execute: opts.reject
      ? vi.fn().mockRejectedValue(new Error('denied'))
      : vi.fn().mockResolvedValue(opts.result ?? []),
  };

  TestBed.configureTestingModule({
    imports: [OperatorListComponent],
    providers: [
      CurrentUserService,
      { provide: AUTH_GATEWAY, useValue: makeGateway() },
      { provide: ListTenantOperatorsUseCase, useValue: useCase },
    ],
  });

  if (opts.session) {
    TestBed.inject(CurrentUserService).setSession(opts.session);
  }

  const fixture = TestBed.createComponent(OperatorListComponent);
  fixture.detectChanges();
  await fixture.whenStable();
  fixture.detectChanges();

  return { fixture, useCase };
}

function html(fixture: ComponentFixture<OperatorListComponent>): string {
  return (fixture.nativeElement as HTMLElement).innerHTML;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('OperatorListComponent', () => {
  beforeEach(() => TestBed.resetTestingModule());

  it('renders a row per operator for an admin session', async () => {
    const { fixture } = await setup({ session: adminSession(), result: OPERATORS });
    const el = fixture.nativeElement as HTMLElement;

    expect(el.querySelector('[data-testid="operators-table"]')).not.toBeNull();
    expect(el.querySelectorAll('[data-testid="operator-name"]')).toHaveLength(2);
    expect(html(fixture)).toContain('Alice Admin');
    expect(html(fixture)).toContain('Bob Operator');
  });

  it('shows the per-tenant role and active/inactive status', async () => {
    const { fixture } = await setup({ session: adminSession(), result: OPERATORS });
    const el = fixture.nativeElement as HTMLElement;

    const roles = [...el.querySelectorAll('[data-testid="operator-role"]')].map((n) =>
      n.textContent?.trim()
    );
    const statuses = [...el.querySelectorAll('[data-testid="operator-status"]')].map((n) =>
      n.textContent?.trim()
    );

    expect(roles).toEqual(['admin', 'operator']);
    expect(statuses).toEqual(['Active', 'Inactive']);
  });

  it('shows the empty state when there are no operators', async () => {
    const { fixture } = await setup({ session: adminSession(), result: [] });
    const el = fixture.nativeElement as HTMLElement;

    expect(el.querySelector('[data-testid="operators-empty"]')).not.toBeNull();
    expect(el.querySelector('[data-testid="operators-table"]')).toBeNull();
  });

  it('hides the operators section entirely for a non-admin session (directive gate)', async () => {
    const { fixture } = await setup({ session: operatorSession(), result: OPERATORS });
    const el = fixture.nativeElement as HTMLElement;

    // *appHasPermission removes the whole section from the DOM.
    expect(el.querySelector('[data-testid="operators-section"]')).toBeNull();
    expect(el.querySelector('[data-testid="operators-table"]')).toBeNull();
  });

  it('surfaces a neutral error message when loading fails', async () => {
    const { fixture } = await setup({ session: adminSession(), reject: true });
    const el = fixture.nativeElement as HTMLElement;

    expect(el.querySelector('[data-testid="operators-error"]')).not.toBeNull();
  });
});
