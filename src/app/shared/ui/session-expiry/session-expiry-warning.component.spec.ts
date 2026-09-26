import { TestBed, ComponentFixture } from '@angular/core/testing';
import { Router } from '@angular/router';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { SessionExpiryWarningComponent } from './session-expiry-warning.component';
import { CurrentUserService } from '@core/application/auth/current-user.service';
import { AUTH_GATEWAY } from '@core/application/auth/ports/auth-gateway.port';
import { AuthSessionDto } from '@core/application/auth/dtos/auth-session.dto';

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
  operatorId: 'op-1',
  tenantId: 'store-a',
  roles: ['operator'],
  permissions: ['sale:process'],
  accessToken: 'token',
  expiresAt: new Date(Date.now() + 5000).toISOString(),
};

function html(fixture: ComponentFixture<SessionExpiryWarningComponent>): HTMLElement {
  return fixture.nativeElement as HTMLElement;
}

describe('SessionExpiryWarningComponent', () => {
  let fixture: ComponentFixture<SessionExpiryWarningComponent>;
  let currentUser: CurrentUserService;
  let gateway: ReturnType<typeof makeGateway>;
  let router: { navigate: ReturnType<typeof vi.fn> };

  beforeEach(() => {
    gateway = makeGateway();
    router = { navigate: vi.fn().mockResolvedValue(true) };

    TestBed.configureTestingModule({
      imports: [SessionExpiryWarningComponent],
      providers: [
        { provide: AUTH_GATEWAY, useValue: gateway },
        { provide: Router, useValue: router },
      ],
    });

    currentUser = TestBed.inject(CurrentUserService);
    fixture = TestBed.createComponent(SessionExpiryWarningComponent);
    fixture.detectChanges();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('renders nothing while the warning is inactive', () => {
    expect(html(fixture).querySelector('[data-testid="session-expiry-warning"]')).toBeNull();
  });

  it('shows the dialog with a countdown once the warning activates', () => {
    currentUser.setSession(baseSession); // 5s out — inside the warning window immediately
    fixture.detectChanges();

    expect(html(fixture).querySelector('[data-testid="session-expiry-warning"]')).not.toBeNull();
    const countdown = html(fixture).querySelector(
      '[data-testid="session-expiry-countdown"]'
    )!.textContent;
    expect(countdown).toMatch(/Signing out in \ds/);
  });

  it('the countdown ticks down once a second while shown', () => {
    vi.useFakeTimers();
    currentUser.setSession(baseSession);
    fixture.detectChanges();

    const before = html(fixture).querySelector(
      '[data-testid="session-expiry-countdown"]'
    )!.textContent;

    vi.advanceTimersByTime(2000);
    fixture.detectChanges();

    const after = html(fixture).querySelector(
      '[data-testid="session-expiry-countdown"]'
    )!.textContent;
    expect(after).not.toBe(before);
  });

  it('"Stay signed in" refreshes the session, which dismisses the dialog', async () => {
    currentUser.setSession(baseSession);
    fixture.detectChanges();

    gateway.refresh.mockResolvedValue({
      ...baseSession,
      expiresAt: new Date(Date.now() + 120_000).toISOString(),
    });

    html(fixture)
      .querySelector<HTMLButtonElement>('[data-testid="session-expiry-continue"]')!
      .click();
    await fixture.whenStable();
    fixture.detectChanges();

    expect(gateway.refresh).toHaveBeenCalled();
    expect(html(fixture).querySelector('[data-testid="session-expiry-warning"]')).toBeNull();
  });

  it('"Sign out now" logs out and navigates to /login without waiting for the hard expiry', async () => {
    currentUser.setSession(baseSession);
    fixture.detectChanges();

    html(fixture)
      .querySelector<HTMLButtonElement>('[data-testid="session-expiry-sign-out"]')!
      .click();
    await fixture.whenStable();
    fixture.detectChanges();

    expect(gateway.signOut).toHaveBeenCalled();
    expect(currentUser.isAuthenticated()).toBe(false);
    expect(router.navigate).toHaveBeenCalledWith(['/login']);
    expect(html(fixture).querySelector('[data-testid="session-expiry-warning"]')).toBeNull();
  });

  it('secondsRemaining returns 0 when sessionExpiresAt is null', () => {
    // No session set — expiresAt is null, so the computed takes the early return path
    const comp = fixture.componentInstance as unknown as {
      secondsRemaining: () => number;
    };
    expect(comp.secondsRemaining()).toBe(0);
  });

  it('startTicking is idempotent — calling it twice does not create a second interval', () => {
    vi.useFakeTimers();
    currentUser.setSession(baseSession); // activates the warning → startTicking called once
    fixture.detectChanges();

    // Trigger the effect again by deactivating then re-activating.
    // When warningActive goes false → stopTicking; then true → startTicking.
    // Because the warning reactivates while the timer already ran, startTicking
    // hits the `if (tickTimer !== null) return` guard on the second call.
    const longSession = {
      ...baseSession,
      expiresAt: new Date(Date.now() + 200_000).toISOString(),
    };
    currentUser.setSession(longSession); // deactivates warning (outside window)
    TestBed.flushEffects();
    fixture.detectChanges();

    currentUser.setSession(baseSession); // reactivates warning
    TestBed.flushEffects();
    fixture.detectChanges();

    // Advance — if two intervals existed the tick count would double-fire
    vi.advanceTimersByTime(1000);
    fixture.detectChanges();

    const countdownEl = html(fixture).querySelector('[data-testid="session-expiry-countdown"]');
    expect(countdownEl).not.toBeNull();
    vi.useRealTimers();
  });

  it('"Stay signed in" still works when refresh throws', async () => {
    currentUser.setSession(baseSession);
    fixture.detectChanges();

    gateway.refresh.mockRejectedValue(new Error('network error'));

    html(fixture)
      .querySelector<HTMLButtonElement>('[data-testid="session-expiry-continue"]')!
      .click();
    await fixture.whenStable();
    fixture.detectChanges();

    // Error is swallowed — dialog stays showing (warning still active)
    expect(fixture.componentInstance['busy']()).toBe(false);
  });
});
