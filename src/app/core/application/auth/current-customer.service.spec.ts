import { TestBed } from '@angular/core/testing';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { CurrentCustomerService } from './current-customer.service';
import { CUSTOMER_AUTH_GATEWAY } from './ports/customer-auth-gateway.port';
import { CustomerSessionDto } from './dtos/customer-session.dto';
import { Permission } from '@core/domain/auth';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeGateway() {
  return {
    signUp: vi.fn(),
    authenticate: vi.fn(),
    getActiveSession: vi.fn().mockResolvedValue(null),
    refresh: vi.fn(),
    signOut: vi.fn().mockResolvedValue(undefined),
    getAccessToken: vi.fn().mockReturnValue(null),
  };
}

const baseSession: CustomerSessionDto = {
  customerId: 'cust-001',
  email: 'shopper@example.com',
  tenantId: 'store-a',
  roles: ['customer'],
  permissions: [Permission.PROCESS_SALE],
  accessToken: 'customer-token-abc',
  expiresAt: new Date(Date.now() + 30 * 60 * 1000).toISOString(),
};

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('CurrentCustomerService', () => {
  let service: CurrentCustomerService;
  let gateway: ReturnType<typeof makeGateway>;

  beforeEach(() => {
    gateway = makeGateway();

    TestBed.configureTestingModule({
      providers: [CurrentCustomerService, { provide: CUSTOMER_AUTH_GATEWAY, useValue: gateway }],
    });

    service = TestBed.inject(CurrentCustomerService);
  });

  // ── initial state ───────────────────────────────────────────────────────

  describe('before any session is loaded', () => {
    it('is not authenticated', () => {
      expect(service.isAuthenticated()).toBe(false);
      expect(service.session()).toBeNull();
    });

    it('exposes null identity claims rather than throwing', () => {
      expect(service.customerId()).toBeNull();
      expect(service.email()).toBeNull();
      expect(service.tenantId()).toBeNull();
      expect(service.sessionExpiresAt()).toBeNull();
    });

    it('exposes empty roles and permissions', () => {
      expect(service.roles()).toEqual([]);
      expect(service.permissions()).toEqual([]);
    });

    it('denies every permission check', () => {
      expect(service.hasPermission(Permission.PROCESS_SALE)).toBe(false);
    });

    it('has no logout reason yet', () => {
      expect(service.logoutReason()).toBeNull();
    });
  });

  // ── setSession ──────────────────────────────────────────────────────────

  describe('setSession', () => {
    it('marks the customer as authenticated and exposes their claims', () => {
      service.setSession(baseSession);

      expect(service.isAuthenticated()).toBe(true);
      expect(service.customerId()).toBe('cust-001');
      expect(service.email()).toBe('shopper@example.com');
      expect(service.tenantId()).toBe('store-a');
      expect(service.roles()).toEqual(['customer']);
      expect(service.permissions()).toEqual([Permission.PROCESS_SALE]);
    });

    it('grants only the permissions the session actually carries', () => {
      service.setSession(baseSession);

      expect(service.hasPermission(Permission.PROCESS_SALE)).toBe(true);
      expect(service.hasPermission(Permission.MANAGE_SETTINGS)).toBe(false);
    });
  });

  // ── hydrate ─────────────────────────────────────────────────────────────

  describe('hydrate', () => {
    it('adopts a session the gateway still holds', async () => {
      gateway.getActiveSession.mockResolvedValue(baseSession);

      await service.hydrate();

      expect(service.isAuthenticated()).toBe(true);
      expect(service.customerId()).toBe('cust-001');
    });

    it('stays unauthenticated when the gateway has no session', async () => {
      await service.hydrate();

      expect(service.isAuthenticated()).toBe(false);
    });

    it('is idempotent — a second call does not disturb the loaded session', async () => {
      gateway.getActiveSession.mockResolvedValue(baseSession);

      await service.hydrate();
      await service.hydrate();

      expect(service.isAuthenticated()).toBe(true);
      expect(service.session()).toEqual(baseSession);
    });
  });

  // ── refresh ─────────────────────────────────────────────────────────────

  describe('refresh', () => {
    it('replaces the session with the re-issued one', async () => {
      service.setSession(baseSession);
      const refreshed: CustomerSessionDto = { ...baseSession, accessToken: 'customer-token-xyz' };
      gateway.refresh.mockResolvedValue(refreshed);

      await service.refresh();

      expect(service.session()?.accessToken).toBe('customer-token-xyz');
    });
  });

  // ── logout ──────────────────────────────────────────────────────────────

  describe('logout', () => {
    it('clears the session and tells the gateway to sign out', async () => {
      service.setSession(baseSession);

      await service.logout();

      expect(gateway.signOut).toHaveBeenCalledOnce();
      expect(service.isAuthenticated()).toBe(false);
      expect(service.session()).toBeNull();
      expect(service.sessionExpiresAt()).toBeNull();
    });

    it('records a manual logout by default', async () => {
      service.setSession(baseSession);

      await service.logout();

      expect(service.logoutReason()).toBe('manual');
    });

    it('records an expiry when told the reason was expiry', async () => {
      service.setSession(baseSession);

      await service.logout('expired');

      expect(service.logoutReason()).toBe('expired');
    });
  });

  // ── isolation from the staff identity ───────────────────────────────────

  describe('isolation from the staff identity', () => {
    it('never consults the staff AUTH_GATEWAY — only the customer one', async () => {
      // The whole reason this is a second parallel service (#261 item 12): a
      // customer session must not be readable as, or clear, a staff session.
      // The TestBed here provides no AUTH_GATEWAY at all, so any leak into the
      // staff seam would surface as a resolution failure rather than silently
      // sharing state.
      gateway.getActiveSession.mockResolvedValue(baseSession);

      await service.hydrate();
      await service.logout();

      expect(gateway.getActiveSession).toHaveBeenCalledOnce();
      expect(gateway.signOut).toHaveBeenCalledOnce();
    });
  });

  // ── session expiry timer ────────────────────────────────────────────────

  describe('the session expiry timer', () => {
    // The teardown trap this project has already hit once: a fake-timer test
    // that forgets to restore real timers leaks into whichever spec file runs
    // next. Every test in this block must leave with real timers.
    afterEach(() => {
      vi.useRealTimers();
    });

    it('logs out automatically the instant the token expires', async () => {
      vi.useFakeTimers();
      service.setSession({
        ...baseSession,
        expiresAt: new Date(Date.now() + 5000).toISOString(),
      });
      expect(service.isAuthenticated()).toBe(true);

      await vi.advanceTimersByTimeAsync(5000);

      expect(service.isAuthenticated()).toBe(false);
      expect(service.logoutReason()).toBe('expired');
    });

    it('does not log out before the token actually expires', async () => {
      vi.useFakeTimers();
      service.setSession({
        ...baseSession,
        expiresAt: new Date(Date.now() + 5000).toISOString(),
      });

      await vi.advanceTimersByTimeAsync(4999);

      expect(service.isAuthenticated()).toBe(true);
    });

    it('logs out immediately for a session that was already expired when loaded', async () => {
      // A kiosk tab left open long after the token lapsed — hydrate() must not
      // arm a timer with a negative delay and wait forever.
      gateway.getActiveSession.mockResolvedValue({
        ...baseSession,
        expiresAt: new Date(Date.now() - 1000).toISOString(),
      });

      await service.hydrate();

      expect(service.isAuthenticated()).toBe(false);
      expect(service.logoutReason()).toBe('expired');
    });

    it('re-arms the timer to the refreshed session, not the original one', async () => {
      vi.useFakeTimers();
      service.setSession({
        ...baseSession,
        expiresAt: new Date(Date.now() + 100_000).toISOString(),
      });

      gateway.refresh.mockResolvedValue({
        ...baseSession,
        expiresAt: new Date(Date.now() + 5000).toISOString(),
      });
      await service.refresh();

      // The *original* 100s timer must not be what fires — refresh() should
      // have replaced it with one matching the new, shorter expiry.
      await vi.advanceTimersByTimeAsync(5000);
      expect(service.isAuthenticated()).toBe(false);
    });

    it('a manual logout cancels the pending expiry timer', async () => {
      vi.useFakeTimers();
      service.setSession({
        ...baseSession,
        expiresAt: new Date(Date.now() + 5000).toISOString(),
      });

      await service.logout();
      expect(service.logoutReason()).toBe('manual');

      // If the old timer were still armed, it would overwrite 'manual' with
      // 'expired' once fake time crosses the original expiry.
      await vi.advanceTimersByTimeAsync(5000);
      expect(service.logoutReason()).toBe('manual');
    });
  });

  // ── session expiry warning ──────────────────────────────────────────────

  describe('the session expiry warning', () => {
    afterEach(() => {
      vi.useRealTimers();
    });

    it('exposes the current session’s expiry, and clears it on logout', async () => {
      vi.useFakeTimers();
      const expiresAt = new Date(Date.now() + 5000).toISOString();
      service.setSession({ ...baseSession, expiresAt });
      expect(service.sessionExpiresAt()).toBe(expiresAt);

      await service.logout();
      expect(service.sessionExpiresAt()).toBeNull();
    });

    it('stays false until the last minute before expiry, then flips true', async () => {
      vi.useFakeTimers();
      service.setSession({
        ...baseSession,
        expiresAt: new Date(Date.now() + 120_000).toISOString(),
      });
      expect(service.expiryWarningActive()).toBe(false);

      await vi.advanceTimersByTimeAsync(59_000); // 61s remaining — outside the 60s window
      expect(service.expiryWarningActive()).toBe(false);

      await vi.advanceTimersByTimeAsync(2000); // 59s remaining — inside it
      expect(service.expiryWarningActive()).toBe(true);
    });

    it('fires immediately for a session loaded already inside the warning window', () => {
      vi.useFakeTimers();
      service.setSession({
        ...baseSession,
        expiresAt: new Date(Date.now() + 30_000).toISOString(),
      });

      expect(service.expiryWarningActive()).toBe(true);
    });

    it('a refresh to a later expiry clears an active warning', async () => {
      vi.useFakeTimers();
      service.setSession({
        ...baseSession,
        expiresAt: new Date(Date.now() + 30_000).toISOString(),
      });
      expect(service.expiryWarningActive()).toBe(true);

      gateway.refresh.mockResolvedValue({
        ...baseSession,
        expiresAt: new Date(Date.now() + 600_000).toISOString(),
      });
      await service.refresh();

      expect(service.expiryWarningActive()).toBe(false);
    });
  });
});
