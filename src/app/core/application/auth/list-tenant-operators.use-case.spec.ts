import { TestBed } from '@angular/core/testing';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { ListTenantOperatorsUseCase } from './list-tenant-operators.use-case';
import { OPERATOR_ADMIN_PORT } from './ports/operator-admin.port';
import { CurrentUserService } from './current-user.service';
import { AngularAuthorizationService, AuthorizationError } from './angular-authorization.service';
import { OperatorSummaryDto } from './dtos/operator-summary.dto';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const summaries: OperatorSummaryDto[] = [
  {
    id: 'op-1',
    email: 'a@capy.local',
    displayName: 'Alice',
    roleName: 'admin',
    isActive: true,
    tenantId: 'store-a',
  },
];

function makePort() {
  return { listOperatorsForTenant: vi.fn().mockResolvedValue(summaries) };
}

function makeCurrentUser(tenantId: string | null) {
  return { activeTenantId: vi.fn(() => tenantId) };
}

function makeAuthz(granted: boolean) {
  return {
    assert: vi.fn(() => {
      if (!granted) throw new AuthorizationError('admin:manage_operators');
    }),
  };
}

function build(opts: { granted: boolean; tenantId: string | null }) {
  const port = makePort();
  const currentUser = makeCurrentUser(opts.tenantId);
  const authz = makeAuthz(opts.granted);

  TestBed.configureTestingModule({
    providers: [
      ListTenantOperatorsUseCase,
      { provide: OPERATOR_ADMIN_PORT, useValue: port },
      { provide: CurrentUserService, useValue: currentUser },
      { provide: AngularAuthorizationService, useValue: authz },
    ],
  });

  return { useCase: TestBed.inject(ListTenantOperatorsUseCase), port, currentUser, authz };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('ListTenantOperatorsUseCase', () => {
  beforeEach(() => TestBed.resetTestingModule());

  it('asserts MANAGE_OPERATORS before reading any data', async () => {
    const { useCase, authz, port } = build({ granted: true, tenantId: 'store-a' });

    await useCase.execute();

    expect(authz.assert).toHaveBeenCalledWith('admin:manage_operators');
    expect(port.listOperatorsForTenant).toHaveBeenCalledWith('store-a');
  });

  it('returns the operators for the active tenant', async () => {
    const { useCase } = build({ granted: true, tenantId: 'store-a' });

    const result = await useCase.execute();

    expect(result).toEqual(summaries);
  });

  it('throws AuthorizationError and never touches the port when permission is denied', async () => {
    const { useCase, port } = build({ granted: false, tenantId: 'store-a' });

    await expect(useCase.execute()).rejects.toThrow(AuthorizationError);
    expect(port.listOperatorsForTenant).not.toHaveBeenCalled();
  });

  it('returns an empty list (without hitting the port) when no tenant is active', async () => {
    const { useCase, port } = build({ granted: true, tenantId: null });

    const result = await useCase.execute();

    expect(result).toEqual([]);
    expect(port.listOperatorsForTenant).not.toHaveBeenCalled();
  });
});
