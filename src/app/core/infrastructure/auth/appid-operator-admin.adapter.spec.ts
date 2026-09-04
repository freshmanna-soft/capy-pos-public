import { TestBed } from '@angular/core/testing';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { AppIdOperatorAdminAdapter } from './appid-operator-admin.adapter';
import { APPID_CONFIG, type AppIdConfig } from './appid-auth.adapter';
import { AUTH_GATEWAY } from '@core/application/auth/ports/auth-gateway.port';
import { DEFAULT_TENANT_ID } from '@core/infrastructure/database/dexie-database.service';

const RELAY_URL = 'https://relay.test/appid/token';
const ADMIN_BASE = 'https://relay.test/appid/admin';

const CONFIG: AppIdConfig = {
  enabled: true,
  region: 'us-south',
  tenantId: 'tenant-1',
  staffClientId: 'client-1',
  customerClientId: '',
  relayUrl: RELAY_URL,
};

function jsonResponse(body: unknown, status = 200) {
  return { ok: status >= 200 && status < 300, status, json: async () => body } as Response;
}

function makeAdapter(token: string | null = 'access-token-1'): AppIdOperatorAdminAdapter {
  TestBed.configureTestingModule({
    providers: [
      AppIdOperatorAdminAdapter,
      { provide: APPID_CONFIG, useValue: CONFIG },
      { provide: AUTH_GATEWAY, useValue: { getAccessToken: () => token } },
    ],
  });
  return TestBed.inject(AppIdOperatorAdminAdapter);
}

describe('AppIdOperatorAdminAdapter', () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    TestBed.resetTestingModule();
  });

  it('supportsCreate is true — this is the one adapter that can', () => {
    expect(makeAdapter().supportsCreate).toBe(true);
  });

  describe('listOperatorsForTenant', () => {
    it('maps the relay’s staff list to OperatorSummaryDto, deriving isActive from having a role', async () => {
      fetchMock.mockResolvedValue(
        jsonResponse([
          {
            id: 'u1',
            email: 'a@capy.test',
            displayName: 'Ada',
            roles: [{ id: 'role-admin', name: 'admin' }],
          },
          { id: 'u2', email: 'b@capy.test', displayName: 'Bea', roles: [] },
        ])
      );

      const result = await makeAdapter().listOperatorsForTenant('anything');

      expect(fetchMock).toHaveBeenCalledWith(
        `${ADMIN_BASE}/staff`,
        expect.objectContaining({ method: 'GET' })
      );
      expect(result).toEqual([
        {
          id: 'u1',
          email: 'a@capy.test',
          displayName: 'Ada',
          roleId: 'role-admin',
          roleName: 'admin',
          isActive: true,
          tenantId: DEFAULT_TENANT_ID,
        },
        {
          id: 'u2',
          email: 'b@capy.test',
          displayName: 'Bea',
          roleId: '',
          roleName: '',
          isActive: false,
          tenantId: DEFAULT_TENANT_ID,
        },
      ]);
    });

    it('attaches the current access token as Bearer', async () => {
      fetchMock.mockResolvedValue(jsonResponse([]));
      await makeAdapter('the-token').listOperatorsForTenant('x');
      const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
      expect((init.headers as Record<string, string>)['Authorization']).toBe('Bearer the-token');
    });

    it('throws the relay’s own error message on a non-ok response', async () => {
      fetchMock.mockResolvedValue(jsonResponse({ error: 'Requires admin:manage_operators.' }, 403));
      await expect(makeAdapter().listOperatorsForTenant('x')).rejects.toThrow(/manage_operators/);
    });
  });

  describe('listAssignableRoles', () => {
    it('fetches the roles route and maps id/name straight through', async () => {
      fetchMock.mockResolvedValue(jsonResponse([{ id: 'role-admin', name: 'admin' }]));
      const roles = await makeAdapter().listAssignableRoles();
      expect(fetchMock).toHaveBeenCalledWith(
        `${ADMIN_BASE}/roles`,
        expect.objectContaining({ method: 'GET' })
      );
      expect(roles).toEqual([
        { id: 'role-admin', name: 'admin', permissions: [], level: 0, isBuiltIn: true },
      ]);
    });
  });

  describe('createOperator', () => {
    it('posts email and roleId, and maps the returned identity', async () => {
      fetchMock.mockResolvedValue(
        jsonResponse({
          id: 'new-1',
          email: 'new@capy.test',
          displayName: 'new@capy.test',
          roles: [],
        })
      );

      const result = await makeAdapter().createOperator('new@capy.test', 'role-operator');

      expect(fetchMock).toHaveBeenCalledWith(
        `${ADMIN_BASE}/staff`,
        expect.objectContaining({
          method: 'POST',
          body: JSON.stringify({ email: 'new@capy.test', roleId: 'role-operator' }),
        })
      );
      expect(result.id).toBe('new-1');
      expect(result.email).toBe('new@capy.test');
    });
  });

  describe('assignRole', () => {
    it('PUTs to the per-user role route with the given roleId', async () => {
      fetchMock.mockResolvedValue(jsonResponse(undefined, 204));
      await makeAdapter().assignRole('u1', 'tenant-ignored', 'role-manager');
      expect(fetchMock).toHaveBeenCalledWith(
        `${ADMIN_BASE}/staff/u1/role`,
        expect.objectContaining({ method: 'PUT', body: JSON.stringify({ roleId: 'role-manager' }) })
      );
    });
  });

  describe('revokeMembership', () => {
    it('DELETEs the per-user role route with no body', async () => {
      fetchMock.mockResolvedValue(jsonResponse(undefined, 204));
      await makeAdapter().revokeMembership('u1', 'tenant-ignored');
      expect(fetchMock).toHaveBeenCalledWith(
        `${ADMIN_BASE}/staff/u1/role`,
        expect.objectContaining({ method: 'DELETE' })
      );
    });
  });
});
