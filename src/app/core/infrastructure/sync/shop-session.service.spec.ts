/**
 * ShopSessionService — the customer's capability token on /shop.
 *
 * The production bug these pin down: the shop reused a one-hour token from
 * sessionStorage without ever checking it, nothing re-minted it, and a staff
 * session left on the device could overwrite it in the worker. After the hour every
 * products pull 401'd and the catalog stayed empty.
 *
 * Runs over the real SyncSessionCredentialService (so "what the worker carries" is
 * asserted at `updateConfig`, the one channel into the worker) and a stubbed fetch.
 */

import { TestBed } from '@angular/core/testing';
import { signal } from '@angular/core';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { CurrentUserService } from '@core/application/auth/current-user.service';
import { AuthSessionDto } from '@core/application/auth/dtos/auth-session.dto';
import { SyncService } from './sync.service';
import { SyncSessionCredentialService } from './sync-session-credential.service';
import {
  SHOP_SESSION_STORAGE_KEY,
  ShopSessionMintError,
  ShopSessionService,
} from './shop-session.service';

const HOUR = 3_600_000;
const MINUTE = 60_000;

function staffSession(accessToken: string): AuthSessionDto {
  return {
    operatorId: 'op-1',
    tenantId: 'tenant-1',
    roles: ['operator'],
    permissions: ['sale:process'],
    accessToken,
    expiresAt: new Date(Date.now() + 8 * HOUR).toISOString(),
  };
}

/** A token-shaped string whose payload carries `exp` (seconds). */
function jwtWithExp(expSeconds: number): string {
  const b64 = (value: unknown) =>
    btoa(JSON.stringify(value)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  return `${b64({ alg: 'HS256' })}.${b64({ type: 'shop-session', exp: expSeconds })}.sig`;
}

/** Resolve pending promise chains without running timers. */
async function flush(): Promise<void> {
  for (let i = 0; i < 10; i++) await Promise.resolve();
}

describe('ShopSessionService', () => {
  const staff = signal<AuthSessionDto | null>(null);
  const authRejections = signal(0);
  let updateConfig: ReturnType<typeof vi.fn>;
  let storage: Map<string, string>;
  let fetchStub: ReturnType<typeof vi.fn>;
  let mintCount: number;

  /** Every mint answers with a distinct token valid for an hour from "now". */
  function mintResponse(): Response {
    mintCount++;
    return new Response(
      JSON.stringify({
        token: `shop-token-${mintCount}`,
        expiresAt: new Date(Date.now() + HOUR).toISOString(),
      }),
      { status: 201, headers: { 'Content-Type': 'application/json' } }
    );
  }

  function service(): ShopSessionService {
    const instance = TestBed.inject(ShopSessionService);
    TestBed.inject(SyncSessionCredentialService);
    TestBed.tick();
    return instance;
  }

  /** The credential most recently pushed into the worker. */
  function workerToken(): string | undefined {
    const calls = updateConfig.mock.calls.filter(([config]) => 'sessionToken' in config);
    return calls.at(-1)?.[0].sessionToken;
  }

  beforeEach(() => {
    vi.useFakeTimers();
    staff.set(null);
    authRejections.set(0);
    updateConfig = vi.fn();
    storage = new Map();
    mintCount = 0;
    vi.stubGlobal('sessionStorage', {
      getItem: (key: string) => storage.get(key) ?? null,
      setItem: (key: string, value: string) => storage.set(key, value),
      removeItem: (key: string) => storage.delete(key),
    });
    fetchStub = vi.fn(async () => mintResponse());
    vi.stubGlobal('fetch', fetchStub);
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);

    TestBed.configureTestingModule({
      providers: [
        { provide: SyncService, useValue: { updateConfig, authRejections } },
        { provide: CurrentUserService, useValue: { session: staff.asReadonly() } },
      ],
    });
  });

  afterEach(() => {
    TestBed.resetTestingModule();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it('mints a token, persists it with its expiry and puts it in the worker', async () => {
    const shop = service();

    await expect(shop.acquire('store-1')).resolves.toBe('shop-token-1');

    expect(fetchStub).toHaveBeenCalledWith(
      expect.stringMatching(/\/shop\/session$/),
      expect.objectContaining({ method: 'POST', body: JSON.stringify({ storeId: 'store-1' }) })
    );
    const stored = JSON.parse(storage.get(SHOP_SESSION_STORAGE_KEY) ?? '{}');
    expect(stored).toMatchObject({ storeId: 'store-1', token: 'shop-token-1' });
    expect(stored.expiresAt).toBe(Date.now() + HOUR);
    expect(workerToken()).toBe('shop-token-1');
    expect(shop.active).toBe(true);
  });

  it('reuses a stored token for the same store while it has time left', async () => {
    storage.set(
      SHOP_SESSION_STORAGE_KEY,
      JSON.stringify({ storeId: 'store-1', token: 'kept', expiresAt: Date.now() + 30 * MINUTE })
    );

    await expect(service().acquire('store-1')).resolves.toBe('kept');
    expect(fetchStub).not.toHaveBeenCalled();
    expect(workerToken()).toBe('kept');
  });

  it('does not reuse a stored token for a different store', async () => {
    storage.set(
      SHOP_SESSION_STORAGE_KEY,
      JSON.stringify({ storeId: 'store-2', token: 'other', expiresAt: Date.now() + 30 * MINUTE })
    );

    await expect(service().acquire('store-1')).resolves.toBe('shop-token-1');
  });

  it.each([
    ['expired', -MINUTE],
    ['inside the five-minute margin', 4 * MINUTE],
  ])('re-mints instead of reusing a stored token that is %s', async (_label, remaining) => {
    storage.set(
      SHOP_SESSION_STORAGE_KEY,
      JSON.stringify({ storeId: 'store-1', token: 'stale', expiresAt: Date.now() + remaining })
    );

    await expect(service().acquire('store-1')).resolves.toBe('shop-token-1');
    expect(updateConfig).not.toHaveBeenCalledWith({ sessionToken: 'stale' });
  });

  it('ignores a stored value in the old bare-token format', async () => {
    storage.set(SHOP_SESSION_STORAGE_KEY, 'not-json');

    await expect(service().acquire('store-1')).resolves.toBe('shop-token-1');
  });

  it('ensureValid() re-mints once the current token has gone stale', async () => {
    const shop = service();
    await shop.acquire('store-1');
    vi.setSystemTime(Date.now() + 56 * MINUTE);

    await expect(shop.ensureValid()).resolves.toBe('shop-token-2');
  });

  it('re-mints proactively five minutes before expiry while active', async () => {
    const shop = service();
    await shop.acquire('store-1');

    await vi.advanceTimersByTimeAsync(54 * MINUTE);
    expect(fetchStub).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(1 * MINUTE + 1);
    expect(fetchStub).toHaveBeenCalledTimes(2);
    expect(workerToken()).toBe('shop-token-2');
    expect(shop.active).toBe(true);
  });

  it('retries a failed proactive re-mint a minute later', async () => {
    const shop = service();
    await shop.acquire('store-1');
    fetchStub.mockImplementationOnce(async () => new Response('{}', { status: 503 }));

    await vi.advanceTimersByTimeAsync(55 * MINUTE + 1);
    expect(fetchStub).toHaveBeenCalledTimes(2);
    expect(workerToken()).toBe('shop-token-1');

    await vi.advanceTimersByTimeAsync(MINUTE);
    expect(fetchStub).toHaveBeenCalledTimes(3);
    expect(workerToken()).toBe('shop-token-2');
  });

  it('re-mints after the worker reports a rejected credential, sharing one mint', async () => {
    const shop = service();
    await shop.acquire('store-1');

    authRejections.set(1);
    TestBed.tick();
    // A checkout asking for a token at the same moment joins the same request.
    vi.setSystemTime(Date.now() + 58 * MINUTE);
    const fromCheckout = shop.ensureValid();
    await flush();

    await expect(fromCheckout).resolves.toBe('shop-token-2');
    expect(fetchStub).toHaveBeenCalledTimes(2);
    expect(workerToken()).toBe('shop-token-2');
  });

  it('does not re-mint again when the token minted for a rejection is rejected too', async () => {
    const shop = service();
    await shop.acquire('store-1');
    authRejections.set(1);
    TestBed.tick();
    await flush();
    expect(fetchStub).toHaveBeenCalledTimes(2);

    // Not expiry, then (a rotated secret, say): minting again would only spin
    // against the server's rate limit.
    authRejections.set(2);
    TestBed.tick();
    await flush();
    expect(fetchStub).toHaveBeenCalledTimes(2);
  });

  it('leaves a rejection alone while no shop is active', async () => {
    service();
    authRejections.set(1);
    TestBed.tick();
    await flush();

    expect(fetchStub).not.toHaveBeenCalled();
  });

  it('release() stops refreshing and gives the worker back the staff token', async () => {
    staff.set(staffSession('staff-jwt'));
    const shop = service();
    await shop.acquire('store-1');
    expect(workerToken()).toBe('shop-token-1');

    shop.release();

    expect(workerToken()).toBe('staff-jwt');
    expect(shop.active).toBe(false);
    await vi.advanceTimersByTimeAsync(2 * HOUR);
    expect(fetchStub).toHaveBeenCalledTimes(1);
  });

  it('a staff session change while the shop is open does not displace the shop token', async () => {
    staff.set(staffSession('staff-jwt'));
    const shop = service();
    await shop.acquire('store-1');

    staff.set(null); // the leftover staff session expires
    TestBed.tick();
    staff.set(staffSession('staff-jwt-refreshed'));
    TestBed.tick();

    expect(workerToken()).toBe('shop-token-1');
    shop.release();
    expect(workerToken()).toBe('staff-jwt-refreshed');
  });

  it('does not install a token whose mint resolves after release()', async () => {
    let answer: ((response: Response) => void) | undefined;
    fetchStub.mockImplementationOnce(() => new Promise<Response>((resolve) => (answer = resolve)));
    const shop = service();
    const pending = shop.acquire('store-1');
    shop.release();

    answer?.(mintResponse());
    await pending;

    expect(updateConfig).not.toHaveBeenCalledWith({ sessionToken: 'shop-token-1' });
    expect(storage.has(SHOP_SESSION_STORAGE_KEY)).toBe(false);
  });

  it('rejects with the HTTP status when minting is refused (e.g. 429)', async () => {
    fetchStub.mockImplementationOnce(async () => new Response('{}', { status: 429 }));

    const error = await service()
      .acquire('store-1')
      .catch((e: unknown) => e);

    expect(error).toBeInstanceOf(ShopSessionMintError);
    expect((error as ShopSessionMintError).status).toBe(429);
    expect((error as Error).message).toContain('Session request failed: 429');
  });

  it('rejects when the network is down', async () => {
    fetchStub.mockImplementationOnce(async () => {
      throw new TypeError('Failed to fetch');
    });

    await expect(service().acquire('store-1')).rejects.toThrow('Failed to fetch');
  });

  it('rejects a response that carries no token', async () => {
    fetchStub.mockImplementationOnce(async () => new Response('{}', { status: 201 }));

    await expect(service().acquire('store-1')).rejects.toThrow('no token');
  });

  it('ensureValid() rejects when no shop is active', async () => {
    await expect(service().ensureValid()).rejects.toBeInstanceOf(ShopSessionMintError);
  });

  it('falls back to the JWT exp claim when the response has no expiresAt', async () => {
    const exp = Math.floor(Date.now() / 1000) + 20 * 60;
    fetchStub.mockImplementationOnce(
      async () => new Response(JSON.stringify({ token: jwtWithExp(exp) }), { status: 201 })
    );
    await service().acquire('store-1');

    expect(JSON.parse(storage.get(SHOP_SESSION_STORAGE_KEY) ?? '{}').expiresAt).toBe(exp * 1000);
  });

  it('uses a short fallback lifetime for an opaque token with no expiry', async () => {
    fetchStub.mockImplementationOnce(
      async () => new Response(JSON.stringify({ token: 'opaque', expiresAt: '' }), { status: 201 })
    );
    await service().acquire('store-1');

    expect(JSON.parse(storage.get(SHOP_SESSION_STORAGE_KEY) ?? '{}').expiresAt).toBe(
      Date.now() + 15 * MINUTE
    );
  });

  it('still works when sessionStorage is unavailable', async () => {
    const blocked = () => {
      throw new DOMException('blocked', 'SecurityError');
    };
    vi.stubGlobal('sessionStorage', { getItem: blocked, setItem: blocked, removeItem: blocked });
    const shop = service();

    await expect(shop.acquire('store-1')).resolves.toBe('shop-token-1');
    // The in-memory copy still serves the next request without another mint.
    await expect(shop.ensureValid()).resolves.toBe('shop-token-1');
    authRejections.set(1);
    TestBed.tick();
    await flush();
    expect(workerToken()).toBe('shop-token-2');
  });
});
