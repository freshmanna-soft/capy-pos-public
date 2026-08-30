/**
 * The sync worker's credential, kept in step with the operator's session (#224).
 *
 * #224 settled the two competing sync-backend strategies on one: IBM `pos-api` is
 * the backend, and it authorizes with the **session JWT the till already holds**
 * (`infra/pos-api/src/session-auth.ts` verifies HS256 over the same secret
 * `SessionIssuer` signs with), not with the shared service token #206 built for
 * `terraform/aws-demo`. That service token is empty in every checked-in
 * environment, so pointing at IBM without this service means the worker sends no
 * `Authorization` header at all and every products/transactions call answers 401 —
 * which is what prod does today.
 *
 * The session lives in the main thread and the worker is a separate context, so the
 * token has to be *pushed* across whenever it changes: sign-in, sign-out, and the
 * re-issue `CurrentUserService.refresh()` performs after a role change. These are
 * assertions on those transitions rather than on the steady state, because a token
 * that is only read once at boot is the bug: the worker would keep presenting a
 * credential the operator no longer has.
 */

import { TestBed } from '@angular/core/testing';
import { signal } from '@angular/core';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { CurrentUserService } from '@core/application/auth/current-user.service';
import { AuthSessionDto } from '@core/application/auth/dtos/auth-session.dto';
import { SyncService } from './sync.service';
import { SyncSessionCredentialService } from './sync-session-credential.service';

/** A session whose only interesting claim here is the token it carries. */
function session(accessToken: string): AuthSessionDto {
  return {
    operatorId: 'op-1',
    tenantId: 'tenant-1',
    roles: ['operator'],
    permissions: ['sale:process'],
    accessToken,
    expiresAt: new Date(Date.now() + 3_600_000).toISOString(),
  };
}

describe('SyncSessionCredentialService (#224)', () => {
  const active = signal<AuthSessionDto | null>(null);
  let updateConfig: ReturnType<typeof vi.fn>;

  /** Construct the service under the current session state and settle its effect. */
  function bind(): SyncSessionCredentialService {
    const service = TestBed.inject(SyncSessionCredentialService);
    TestBed.tick();
    return service;
  }

  beforeEach(() => {
    active.set(null);
    updateConfig = vi.fn();

    TestBed.configureTestingModule({
      providers: [
        SyncSessionCredentialService,
        { provide: SyncService, useValue: { updateConfig } },
        { provide: CurrentUserService, useValue: { session: active.asReadonly() } },
      ],
    });
  });

  it('exposes the current session token', () => {
    active.set(session('jwt-boot'));
    const service = bind();

    expect(service.token()).toBe('jwt-boot');
  });

  it('reports an empty token when nobody is signed in', () => {
    const service = bind();

    // Empty, never undefined: `sync.worker.ts` reads "no credential" off a blank
    // string and omits the header, and `Bearer undefined` is the failure mode that
    // reads like a wrong token instead of a missing one.
    expect(service.token()).toBe('');
  });

  it('does not re-send the token the worker was started with', () => {
    // `app.config.ts` passes `token()` into `SyncService.start()`, so the boot value
    // is already in the worker's config. Posting it again would be a redundant
    // message on every reload.
    active.set(session('jwt-boot'));
    bind();

    expect(updateConfig).not.toHaveBeenCalled();
  });

  it('pushes the token to the worker when an operator signs in', () => {
    bind();

    active.set(session('jwt-signed-in'));
    TestBed.tick();

    expect(updateConfig).toHaveBeenCalledWith({ sessionToken: 'jwt-signed-in' });
  });

  it('clears the credential when the operator signs out', () => {
    active.set(session('jwt-signed-in'));
    bind();

    active.set(null);
    TestBed.tick();

    // The worker must stop presenting a credential the till no longer holds — an
    // unauthenticated worker skips its pulls, a stale-token one burns the circuit
    // breaker on 401s.
    expect(updateConfig).toHaveBeenCalledWith({ sessionToken: '' });
  });

  it('pushes the re-issued token after a session refresh', () => {
    active.set(session('jwt-old'));
    bind();

    // `CurrentUserService.refresh()` mints a fresh token from current database state
    // after a role change (AC4, #44). The old one keeps verifying until it expires,
    // so nothing breaks loudly — the worker would just carry the pre-change
    // permissions for up to eight hours.
    active.set(session('jwt-new'));
    TestBed.tick();

    expect(updateConfig).toHaveBeenCalledWith({ sessionToken: 'jwt-new' });
  });

  it('does not post when the session object changes but the token does not', () => {
    active.set(session('jwt-same'));
    bind();

    active.set(session('jwt-same'));
    TestBed.tick();

    expect(updateConfig).not.toHaveBeenCalled();
  });
});
