import { TestBed } from '@angular/core/testing';
import { signal } from '@angular/core';
import { Router } from '@angular/router';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { SessionExpiryNavigatorService } from './session-expiry-navigator.service';
import { CurrentUserService } from '@core/application/auth/current-user.service';

describe('SessionExpiryNavigatorService', () => {
  const authenticated = signal(true);
  const reason = signal<'expired' | 'manual' | null>(null);
  let navigate: ReturnType<typeof vi.fn>;

  /** Construct the service under the current state and settle its effect. */
  function bind(): SessionExpiryNavigatorService {
    const service = TestBed.inject(SessionExpiryNavigatorService);
    TestBed.tick();
    return service;
  }

  beforeEach(() => {
    authenticated.set(true);
    reason.set(null);
    navigate = vi.fn().mockResolvedValue(true);

    TestBed.configureTestingModule({
      providers: [
        SessionExpiryNavigatorService,
        {
          provide: CurrentUserService,
          useValue: {
            isAuthenticated: authenticated.asReadonly(),
            logoutReason: reason.asReadonly(),
          },
        },
        { provide: Router, useValue: { navigate } },
      ],
    });
  });

  it('redirects to /login with an expired reason on an authenticated→expired transition', () => {
    bind();

    authenticated.set(false);
    reason.set('expired');
    TestBed.tick();

    expect(navigate).toHaveBeenCalledWith(['/login'], { queryParams: { reason: 'expired' } });
  });

  it('does not redirect for a manual sign-out', () => {
    bind();

    authenticated.set(false);
    reason.set('manual');
    TestBed.tick();

    expect(navigate).not.toHaveBeenCalled();
  });

  it('does not redirect while still authenticated', () => {
    bind();

    reason.set('expired'); // a hypothetical stale reason with no fresh transition
    TestBed.tick();

    expect(navigate).not.toHaveBeenCalled();
  });

  it('does not redirect a session that was never authenticated in the first place', () => {
    authenticated.set(false);
    bind();

    reason.set('expired');
    TestBed.tick();

    expect(navigate).not.toHaveBeenCalled();
  });
});
