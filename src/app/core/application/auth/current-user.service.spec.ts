import { TestBed } from '@angular/core/testing';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { CurrentUserService, TenantIsolationError } from './current-user.service';
import { AUTH_GATEWAY } from './ports/auth-gateway.port';
import { AuthSessionDto } from './dtos/auth-session.dto';
import { Permission } from '@core/domain/auth/permission.constants';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeGateway() {
  return {
    authenticate: vi.fn(),
    getActiveSession: vi.fn().mockResolvedValue(null),
    refresh: vi.fn(),
    signOut: vi.fn().mockResolvedValue(undefined),
    getAccessToken: vi.fn().mockReturnValue(null),
  };
}

const baseSession: AuthSessionDto = {
  operatorId: 'op-001',
  tenantId: 'store-a',
  roles: ['admin'],
  permissions: ['admin:settings', 'sale:process'],
  accessToken: 'token-abc',
  expiresAt: new Date(Date.now() + 8 * 60 * 60 * 1000).toISOString(),
};

const sessionWithMemberships: AuthSessionDto = {
  ...baseSession,
  memberships: [
    { tenantId: 'store-a', role: 'admin' },
    { tenantId: 'store-b', role: 'operator' },
  ],
};

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('CurrentUserService', () => {
  let service: CurrentUserService;
  let gateway: ReturnType<typeof makeGateway>;

  beforeEach(() => {
    gateway = makeGateway();

    TestBed.configureTestingModule({
      providers: [CurrentUserService, { provide: AUTH_GATEWAY, useValue: gateway }],
    });

    service = TestBed.inject(CurrentUserService);
  });

  // ── setSession initialises activeTenantId ──────────────────────────────

  describe('setSession', () => {
    it('initialises activeTenantId to session.tenantId', () => {
      service.setSession(baseSession);
      expect(service.activeTenantId()).toBe('store-a');
    });

    it('marks the user as authenticated', () => {
      service.setSession(baseSession);
      expect(service.isAuthenticated()).toBe(true);
    });

    it('exposes the operatorId', () => {
      service.setSession(baseSession);
      expect(service.operatorId()).toBe('op-001');
    });
  });

  // ── memberships ────────────────────────────────────────────────────────

  describe('memberships()', () => {
    it('parses session.memberships into a TenantMembershipSet with correct size', () => {
      service.setSession(sessionWithMemberships);
      expect(service.memberships().size).toBe(2);
    });

    it('exposes the correct tenantIds from memberships', () => {
      service.setSession(sessionWithMemberships);
      const ids = service
        .memberships()
        .tenantIds()
        .map((t) => t.value);
      expect(ids).toContain('store-a');
      expect(ids).toContain('store-b');
    });

    it('returns an empty TenantMembershipSet when not authenticated', () => {
      expect(service.memberships().isEmpty).toBe(true);
    });

    it('returns an empty TenantMembershipSet for a session without memberships', () => {
      service.setSession(baseSession); // no memberships field
      expect(service.memberships().isEmpty).toBe(true);
    });
  });

  // ── availableTenantIds ──────────────────────────────────────────────────

  describe('availableTenantIds()', () => {
    it('lists all membership tenants as strings', () => {
      service.setSession(sessionWithMemberships);
      expect(service.availableTenantIds()).toEqual(expect.arrayContaining(['store-a', 'store-b']));
      expect(service.availableTenantIds()).toHaveLength(2);
    });

    it('returns empty array when no memberships', () => {
      expect(service.availableTenantIds()).toHaveLength(0);
    });
  });

  // ── Scenario 2: role-per-tenant switching ──────────────────────────────

  describe('switchTenant — role-per-tenant', () => {
    beforeEach(() => {
      service.setSession(sessionWithMemberships);
    });

    it('initial active tenant is store-a with admin role', () => {
      expect(service.roles()).toEqual(['admin']);
    });

    it('initial permissions include an admin-only permission', () => {
      expect(service.permissions()).toContain(Permission.MANAGE_SETTINGS);
    });

    it('after switchTenant to store-b: roles() reflect operator role', () => {
      service.switchTenant('store-b');
      expect(service.roles()).toEqual(['operator']);
    });

    it('after switchTenant to store-b: permissions reflect operator (sale:process present)', () => {
      service.switchTenant('store-b');
      expect(service.permissions()).toContain(Permission.PROCESS_SALE);
    });

    it('after switchTenant to store-b: admin-only permission is absent', () => {
      service.switchTenant('store-b');
      expect(service.permissions()).not.toContain(Permission.MANAGE_SETTINGS);
    });

    it('activeTenantId updates on switch', () => {
      service.switchTenant('store-b');
      expect(service.activeTenantId()).toBe('store-b');
    });
  });

  // ── Scenario 1: access denied for non-member tenant ────────────────────

  describe('switchTenant — access denied', () => {
    it('throws TenantIsolationError when switching to a tenant the user is NOT a member of', () => {
      service.setSession(sessionWithMemberships);
      expect(() => service.switchTenant('store-c')).toThrow(TenantIsolationError);
    });

    it('TenantIsolationError carries the correct tenantId', () => {
      service.setSession(sessionWithMemberships);
      let caught: TenantIsolationError | null = null;
      try {
        service.switchTenant('store-c');
      } catch (e) {
        caught = e as TenantIsolationError;
      }
      expect(caught?.tenantId).toBe('store-c');
      expect(caught?.code).toBe('TENANT_ISOLATION_DENIED');
    });

    it('activeTenantId remains unchanged after a failed switch', () => {
      service.setSession(sessionWithMemberships);
      try {
        service.switchTenant('store-c');
      } catch {
        // expected
      }
      expect(service.activeTenantId()).toBe('store-a');
    });
  });

  // ── Back-compat: session without memberships ────────────────────────────

  describe('back-compat: session without memberships', () => {
    it('roles() falls back to session.roles when no memberships', () => {
      service.setSession(baseSession);
      // baseSession has no memberships, active tenant defaults to 'store-a'
      // but memberships set is empty so activeRole is null → fallback
      expect(service.roles()).toEqual(['admin']);
    });

    it('permissions() falls back to session.permissions when no memberships', () => {
      service.setSession(baseSession);
      expect(service.permissions()).toContain('admin:settings');
      expect(service.permissions()).toContain('sale:process');
    });

    it('hasPermission uses the fallback permissions correctly', () => {
      service.setSession(baseSession);
      expect(service.hasPermission(Permission.PROCESS_SALE)).toBe(true);
    });

    it('hasRole uses the fallback roles correctly', () => {
      service.setSession(baseSession);
      expect(service.hasRole('admin')).toBe(true);
    });
  });

  // ── resilient claim handling ─────────────────────────────────────────────
  // A corrupted or forward-incompatible session claim must never crash the
  // signal graph: memberships()/activeRole() swallow the parse error and the
  // service degrades gracefully to the flat session roles/permissions claims.

  describe('resilient claim handling', () => {
    it('returns an empty membership set when a memberships row has an unknown role', () => {
      service.setSession({
        ...baseSession,
        memberships: [{ tenantId: 'store-a', role: 'super-kiosk-custom' }],
      });
      expect(service.memberships().isEmpty).toBe(true);
    });

    it('returns an empty membership set when memberships contain a duplicate tenant', () => {
      service.setSession({
        ...baseSession,
        memberships: [
          { tenantId: 'store-a', role: 'admin' },
          { tenantId: 'store-a', role: 'operator' },
        ],
      });
      expect(service.memberships().isEmpty).toBe(true);
    });

    it('falls back to session roles/permissions when the memberships claim is malformed', () => {
      service.setSession({
        ...baseSession,
        memberships: [{ tenantId: 'store-a', role: 'super-kiosk-custom' }],
      });
      expect(service.roles()).toEqual(['admin']);
      expect(service.permissions()).toContain('admin:settings');
    });

    it('resolves no active role (falls back) when the active tenant id is not a valid TenantId', () => {
      service.setSession({
        ...baseSession,
        tenantId: 'bad tenant!', // illegal chars → TenantId construction throws in activeRole()
        memberships: [{ tenantId: 'store-a', role: 'admin' }],
      });
      // activeRole() swallows the TenantId validation error and falls back to the session claim.
      expect(service.roles()).toEqual(['admin']);
      expect(service.hasRole('admin')).toBe(true);
    });
  });

  // ── logout ─────────────────────────────────────────────────────────────

  describe('logout()', () => {
    it('resets activeTenantId to null', async () => {
      service.setSession(sessionWithMemberships);
      expect(service.activeTenantId()).toBe('store-a');

      await service.logout();

      expect(service.activeTenantId()).toBeNull();
    });

    it('clears the session', async () => {
      service.setSession(sessionWithMemberships);
      await service.logout();
      expect(service.isAuthenticated()).toBe(false);
    });

    it('calls gateway.signOut()', async () => {
      service.setSession(sessionWithMemberships);
      await service.logout();
      expect(gateway.signOut).toHaveBeenCalledOnce();
    });
  });

  // ── hydrate ────────────────────────────────────────────────────────────

  describe('hydrate()', () => {
    it('sets activeTenantId from the stored session', async () => {
      gateway.getActiveSession.mockResolvedValue(sessionWithMemberships);
      await service.hydrate();
      expect(service.activeTenantId()).toBe('store-a');
    });

    it('sets activeTenantId to null when no stored session', async () => {
      gateway.getActiveSession.mockResolvedValue(null);
      await service.hydrate();
      expect(service.activeTenantId()).toBeNull();
    });
  });
});
