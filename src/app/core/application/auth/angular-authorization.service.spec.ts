import { TestBed } from '@angular/core/testing';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { AngularAuthorizationService, AuthorizationError } from './angular-authorization.service';
import { CurrentUserService } from './current-user.service';
import { Permission } from '@core/domain/auth/permission.constants';
import { RoleName } from '@core/domain/auth/role.value-object';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Minimal CurrentUserService stand-in: only `roles()` is consumed by
 * AngularAuthorizationService. `roles` is a signal, so the service calls it
 * as a function — a vi.fn returning the current role list mirrors that.
 */
function makeCurrentUser() {
  let roleNames: string[] = [];
  return {
    roles: vi.fn(() => roleNames),
    setRoles(next: string[]) {
      roleNames = next;
    },
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('AngularAuthorizationService', () => {
  let service: AngularAuthorizationService;
  let currentUser: ReturnType<typeof makeCurrentUser>;

  beforeEach(() => {
    currentUser = makeCurrentUser();

    TestBed.configureTestingModule({
      providers: [
        AngularAuthorizationService,
        { provide: CurrentUserService, useValue: currentUser },
      ],
    });

    service = TestBed.inject(AngularAuthorizationService);
  });

  // ── can() ────────────────────────────────────────────────────────────────

  describe('can', () => {
    it('returns true when a role grants the permission', () => {
      currentUser.setRoles([RoleName.OPERATOR]);
      expect(service.can(Permission.PROCESS_SALE)).toBe(true);
    });

    it('returns false when the role lacks the permission', () => {
      currentUser.setRoles([RoleName.OPERATOR]);
      // DELETE_PRODUCT is admin-only; an operator must not have it.
      expect(service.can(Permission.DELETE_PRODUCT)).toBe(false);
    });

    it('honours the additive hierarchy (admin inherits operator permissions)', () => {
      currentUser.setRoles([RoleName.ADMIN]);
      expect(service.can(Permission.PROCESS_SALE)).toBe(true);
      expect(service.can(Permission.MANAGE_SETTINGS)).toBe(true);
    });

    it('returns false when not authenticated (no roles)', () => {
      currentUser.setRoles([]);
      expect(service.can(Permission.PROCESS_SALE)).toBe(false);
    });
  });

  // ── atLeast() ──────────────────────────────────────────────────────────────

  describe('atLeast', () => {
    it('returns true when the role meets the minimum', () => {
      currentUser.setRoles([RoleName.MANAGER]);
      expect(service.atLeast(RoleName.MANAGER)).toBe(true);
    });

    it('returns true when the role exceeds the minimum', () => {
      currentUser.setRoles([RoleName.ADMIN]);
      expect(service.atLeast(RoleName.MANAGER)).toBe(true);
    });

    it('returns false when the role is below the minimum', () => {
      currentUser.setRoles([RoleName.OPERATOR]);
      expect(service.atLeast(RoleName.ADMIN)).toBe(false);
    });

    it('returns false when not authenticated (no roles)', () => {
      currentUser.setRoles([]);
      expect(service.atLeast(RoleName.OPERATOR)).toBe(false);
    });
  });

  // ── assert() ───────────────────────────────────────────────────────────────

  describe('assert', () => {
    it('does not throw when the permission is granted', () => {
      currentUser.setRoles([RoleName.ADMIN]);
      expect(() => service.assert(Permission.MANAGE_SETTINGS)).not.toThrow();
    });

    it('throws AuthorizationError when the permission is denied', () => {
      currentUser.setRoles([RoleName.OPERATOR]);
      expect(() => service.assert(Permission.DELETE_PRODUCT)).toThrow(AuthorizationError);
    });

    it('throws AuthorizationError when not authenticated', () => {
      currentUser.setRoles([]);
      expect(() => service.assert(Permission.PROCESS_SALE)).toThrow(AuthorizationError);
    });
  });
});
