import { Component } from '@angular/core';
import { TestBed, ComponentFixture } from '@angular/core/testing';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { HasPermissionDirective } from './has-permission.directive';
import { CurrentUserService } from '@core/application/auth/current-user.service';
import { AUTH_GATEWAY } from '@core/application/auth/ports/auth-gateway.port';
import { Permission } from '@core/domain/auth';

// ---------------------------------------------------------------------------
// Test host component
// ---------------------------------------------------------------------------

@Component({
  template: `
    <span *appHasPermission="'${Permission.MANAGE_SETTINGS}'" data-testid="admin-section">
      Admin
    </span>
  `,
  standalone: true,
  imports: [HasPermissionDirective],
})
class TestHostComponent {}

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

describe('HasPermissionDirective', () => {
  let fixture: ComponentFixture<TestHostComponent>;
  let currentUser: CurrentUserService;

  beforeEach(() => {
    TestBed.configureTestingModule({
      imports: [TestHostComponent],
      providers: [{ provide: AUTH_GATEWAY, useValue: makeGateway() }],
    });

    currentUser = TestBed.inject(CurrentUserService);
    fixture = TestBed.createComponent(TestHostComponent);
    fixture.detectChanges();
  });

  // ── hide when not authenticated ────────────────────────────────────────────

  it('does not render the host element when the user is not authenticated', () => {
    expect(fixture.nativeElement.querySelector('[data-testid="admin-section"]')).toBeNull();
  });

  // ── show when permission granted ────────────────────────────────────────────

  it('renders the host element when the current user holds the permission', () => {
    currentUser.setSession({
      operatorId: 'op-1',
      tenantId: 'store-a',
      roles: ['admin'],
      permissions: [Permission.MANAGE_SETTINGS],
      accessToken: 'token',
      expiresAt: new Date(Date.now() + 3_600_000).toISOString(),
    });
    fixture.detectChanges();
    TestBed.flushEffects();
    fixture.detectChanges();

    expect(fixture.nativeElement.querySelector('[data-testid="admin-section"]')).not.toBeNull();
  });

  // ── re-hides after logout ────────────────────────────────────────────────

  it('removes the host element again after the session is cleared', async () => {
    currentUser.setSession({
      operatorId: 'op-1',
      tenantId: 'store-a',
      roles: ['admin'],
      permissions: [Permission.MANAGE_SETTINGS],
      accessToken: 'token',
      expiresAt: new Date(Date.now() + 3_600_000).toISOString(),
    });
    fixture.detectChanges();
    TestBed.flushEffects();
    fixture.detectChanges();

    expect(fixture.nativeElement.querySelector('[data-testid="admin-section"]')).not.toBeNull();

    await currentUser.logout();
    fixture.detectChanges();
    TestBed.flushEffects();
    fixture.detectChanges();

    expect(fixture.nativeElement.querySelector('[data-testid="admin-section"]')).toBeNull();
  });

  // ── user has a different permission ──────────────────────────────────────

  it('does not render the element when the user lacks the specific permission', () => {
    currentUser.setSession({
      operatorId: 'op-1',
      tenantId: 'store-a',
      roles: ['operator'],
      permissions: [Permission.PROCESS_SALE],
      accessToken: 'token',
      expiresAt: new Date(Date.now() + 3_600_000).toISOString(),
    });
    fixture.detectChanges();
    TestBed.flushEffects();
    fixture.detectChanges();

    expect(fixture.nativeElement.querySelector('[data-testid="admin-section"]')).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Directive unit — covers the setter + updateView branches directly
// ---------------------------------------------------------------------------

@Component({
  template: `<span *appHasPermission="'sale:process'" data-testid="sale-section">Sale</span>`,
  standalone: true,
  imports: [HasPermissionDirective],
})
class SaleHostComponent {}

describe('HasPermissionDirective — setter and updateView branches', () => {
  let fixture: ComponentFixture<SaleHostComponent>;
  let currentUser: CurrentUserService;

  beforeEach(() => {
    TestBed.configureTestingModule({
      imports: [SaleHostComponent],
      providers: [{ provide: AUTH_GATEWAY, useValue: makeGateway() }],
    });

    currentUser = TestBed.inject(CurrentUserService);
    fixture = TestBed.createComponent(SaleHostComponent);
    fixture.detectChanges();
    TestBed.flushEffects();
    fixture.detectChanges();
  });

  it('shows when the user is granted the permission after mounting', () => {
    // Initially not authenticated → hidden.
    expect(fixture.nativeElement.querySelector('[data-testid="sale-section"]')).toBeNull();

    // Log in with the required permission.
    currentUser.setSession({
      operatorId: 'op-1',
      tenantId: 'store-a',
      roles: ['operator'],
      permissions: [Permission.PROCESS_SALE],
      accessToken: 'token',
      expiresAt: new Date(Date.now() + 3_600_000).toISOString(),
    });
    fixture.detectChanges();
    TestBed.flushEffects();
    fixture.detectChanges();

    expect(fixture.nativeElement.querySelector('[data-testid="sale-section"]')).not.toBeNull();
  });

  it('hides again when the user logs out (granted → denied transition)', async () => {
    currentUser.setSession({
      operatorId: 'op-1',
      tenantId: 'store-a',
      roles: ['operator'],
      permissions: [Permission.PROCESS_SALE],
      accessToken: 'token',
      expiresAt: new Date(Date.now() + 3_600_000).toISOString(),
    });
    fixture.detectChanges();
    TestBed.flushEffects();
    fixture.detectChanges();

    expect(fixture.nativeElement.querySelector('[data-testid="sale-section"]')).not.toBeNull();

    await currentUser.logout();
    fixture.detectChanges();
    TestBed.flushEffects();
    fixture.detectChanges();

    expect(fixture.nativeElement.querySelector('[data-testid="sale-section"]')).toBeNull();
  });
});
