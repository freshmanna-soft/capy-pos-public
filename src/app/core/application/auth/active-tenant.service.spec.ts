import { TestBed } from '@angular/core/testing';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { ActiveTenantService } from './active-tenant.service';
import { CurrentUserService, TenantIsolationError } from './current-user.service';
import { AUTH_GATEWAY } from './ports/auth-gateway.port';
import { AuthSessionDto } from './dtos/auth-session.dto';

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

const sessionWithMemberships: AuthSessionDto = {
  operatorId: 'op-001',
  tenantId: 'store-a',
  roles: ['admin'],
  permissions: ['admin:settings', 'sale:process'],
  accessToken: 'token-abc',
  expiresAt: new Date(Date.now() + 8 * 60 * 60 * 1000).toISOString(),
  memberships: [
    { tenantId: 'store-a', role: 'admin' },
    { tenantId: 'store-b', role: 'operator' },
  ],
};

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('ActiveTenantService', () => {
  let activeTenant: ActiveTenantService;
  let currentUser: CurrentUserService;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [
        CurrentUserService,
        ActiveTenantService,
        { provide: AUTH_GATEWAY, useValue: makeGateway() },
      ],
    });

    activeTenant = TestBed.inject(ActiveTenantService);
    currentUser = TestBed.inject(CurrentUserService);
  });

  // ── tenantId reflects CurrentUserService ──────────────────────────────

  describe('tenantId()', () => {
    it('is null before any session is set', () => {
      expect(activeTenant.tenantId()).toBeNull();
    });

    it('reflects the active tenant from CurrentUserService after setSession', () => {
      currentUser.setSession(sessionWithMemberships);
      expect(activeTenant.tenantId()).toBe('store-a');
    });

    it('updates when switchTenant is called via setActiveTenant', () => {
      currentUser.setSession(sessionWithMemberships);
      activeTenant.setActiveTenant('store-b');
      expect(activeTenant.tenantId()).toBe('store-b');
    });
  });

  // ── hasActiveTenant ────────────────────────────────────────────────────

  describe('hasActiveTenant()', () => {
    it('is false when no session is set', () => {
      expect(activeTenant.hasActiveTenant()).toBe(false);
    });

    it('is true after a session is set', () => {
      currentUser.setSession(sessionWithMemberships);
      expect(activeTenant.hasActiveTenant()).toBe(true);
    });
  });

  // ── availableTenantIds ─────────────────────────────────────────────────

  describe('availableTenantIds()', () => {
    it('is empty before any session is set', () => {
      expect(activeTenant.availableTenantIds()).toHaveLength(0);
    });

    it('lists all membership tenants after setSession', () => {
      currentUser.setSession(sessionWithMemberships);
      expect(activeTenant.availableTenantIds()).toEqual(
        expect.arrayContaining(['store-a', 'store-b'])
      );
      expect(activeTenant.availableTenantIds()).toHaveLength(2);
    });
  });

  // ── setActiveTenant — success ──────────────────────────────────────────

  describe('setActiveTenant — member tenant', () => {
    it('switches the active tenant to a tenant the user is a member of', () => {
      currentUser.setSession(sessionWithMemberships);
      activeTenant.setActiveTenant('store-b');
      expect(activeTenant.tenantId()).toBe('store-b');
    });

    it('switching updates CurrentUserService.activeTenantId', () => {
      currentUser.setSession(sessionWithMemberships);
      activeTenant.setActiveTenant('store-b');
      expect(currentUser.activeTenantId()).toBe('store-b');
    });
  });

  // ── setActiveTenant — non-member (Scenario 1) ─────────────────────────

  describe('setActiveTenant — non-member tenant', () => {
    it('throws TenantIsolationError when switching to a tenant the user is NOT a member of', () => {
      currentUser.setSession(sessionWithMemberships);
      expect(() => activeTenant.setActiveTenant('store-c')).toThrow(TenantIsolationError);
    });

    it('tenantId remains unchanged after a failed switch', () => {
      currentUser.setSession(sessionWithMemberships);
      try {
        activeTenant.setActiveTenant('store-c');
      } catch {
        // expected
      }
      expect(activeTenant.tenantId()).toBe('store-a');
    });
  });
});
