import { Injectable, effect, inject, untracked } from '@angular/core';
import { environment } from '../../../../environments/environment';
import { SyncService } from './sync.service';
import { SyncSessionCredentialService } from './sync-session-credential.service';

/** sessionStorage key. Not the old `shop-session-token`, which held a bare token
 *  with no expiry and so could not be told apart from an expired one. */
export const SHOP_SESSION_STORAGE_KEY = 'shop-session';

/** A token with less than this left is treated as already gone: a checkout or a
 *  pull started on it could land after it expires. */
export const SHOP_SESSION_STALE_MARGIN_MS = 5 * 60_000;

/** Used only when neither the response nor the token says when it expires. Short
 *  on purpose — an unknown lifetime is safer re-minted early than trusted long. */
const FALLBACK_LIFETIME_MS = 15 * 60_000;

/** Floor for the proactive re-mint delay and the back-off after a failed one, so
 *  an odd expiry can never turn the timer into a tight loop against the API. */
const MIN_REFRESH_DELAY_MS = 60_000;

interface StoredShopSession {
  readonly storeId: string;
  readonly token: string;
  /** Epoch milliseconds. */
  readonly expiresAt: number;
}

/** Minting failed — the HTTP status when the server answered (429 included). */
export class ShopSessionMintError extends Error {
  constructor(
    message: string,
    readonly status?: number
  ) {
    super(message);
    this.name = 'ShopSessionMintError';
  }
}

/**
 * ShopSessionService
 *
 * Owns the anonymous customer's capability token for `/shop`.
 *
 * ## Why this exists
 *
 * `POST /api/shop/session` mints an HS256 token that expires after one hour, and
 * the shop reused whatever sat in sessionStorage without ever checking that. After
 * the hour every products pull 401'd (the catalog stayed empty) and so would the
 * checkout's `POST /api/transactions`, with nothing that re-minted. This service
 * keeps the token valid for as long as the shop is open:
 *
 *  - a stored token is reused only for the same store and with more than
 *    `SHOP_SESSION_STALE_MARGIN_MS` left;
 *  - a timer re-mints that margin before expiry while the shop is active;
 *  - a 401 on the worker's pull re-mints on demand (`SyncService.authRejections`);
 *  - concurrent requests for a token share one mint.
 *
 * It is the only writer of the shop token into the sync worker, and it writes
 * through `SyncSessionCredentialService.holdCapability()` rather than
 * `updateConfig` so a staff session left on the device cannot overwrite it, and
 * `release()` hands the slot back to that staff session.
 */
@Injectable({ providedIn: 'root' })
export class ShopSessionService {
  private readonly sync = inject(SyncService);
  private readonly credential = inject(SyncSessionCredentialService);

  /** The store the active shop is for; null while released. */
  private storeId: string | null = null;
  private current: StoredShopSession | null = null;
  private inflight: { readonly generation: number; readonly promise: Promise<string> } | null =
    null;
  private refreshTimer: ReturnType<typeof setTimeout> | null = null;
  /**
   * Bumped on every acquire/release so a mint that resolves after the shop was
   * left (or re-entered for another store) does not install its token.
   */
  private generation = 0;
  /**
   * The token minted in answer to a 401. If the API rejects that one as well, the
   * problem is not expiry (a rotated secret, a clock far off) and minting again
   * would only spin against the rate limit, so the second rejection is left alone.
   */
  private remintedAfterRejection: string | null = null;
  private seenAuthRejections = this.sync.authRejections();

  constructor() {
    effect(() => {
      const rejections = this.sync.authRejections();
      untracked(() => {
        if (rejections === this.seenAuthRejections) return;
        this.seenAuthRejections = rejections;
        this.onAuthRejected();
      });
    });
  }

  /** Whether a shop currently holds the worker's credential slot. */
  get active(): boolean {
    return this.storeId !== null;
  }

  /**
   * Start (or continue) the shop session for `storeId` and return a usable token.
   * Rejects with `ShopSessionMintError` when one cannot be minted.
   */
  acquire(storeId: string): Promise<string> {
    if (this.storeId !== storeId) {
      this.generation++;
      this.storeId = storeId;
      this.current = null;
    }
    return this.ensureValid();
  }

  /**
   * A token with comfortably more than the stale margin left, minting one if the
   * current token is missing or stale. Checkout awaits this right before it posts.
   */
  ensureValid(): Promise<string> {
    const storeId = this.storeId;
    if (storeId === null) {
      return Promise.reject(new ShopSessionMintError('No shop session is active.'));
    }
    const existing = this.current ?? this.readStored(storeId);
    if (existing && !this.isStale(existing)) {
      this.install(existing);
      return Promise.resolve(existing.token);
    }
    return this.mint();
  }

  /** Leave the shop: stop refreshing and give the worker back the staff token. */
  release(): void {
    this.generation++;
    this.storeId = null;
    this.current = null;
    this.remintedAfterRejection = null;
    this.clearTimer();
    this.credential.releaseCapability();
  }

  // ── Internals ────────────────────────────────────────────────────────────────

  private mint(reason: 'expiry' | 'rejected' = 'expiry'): Promise<string> {
    // Joined only within one generation: a mint started before a release would
    // resolve without installing its token, so a later acquire must not wait on it.
    if (this.inflight && this.inflight.generation === this.generation) {
      return this.inflight.promise;
    }
    const storeId = this.storeId;
    if (storeId === null) {
      return Promise.reject(new ShopSessionMintError('No shop session is active.'));
    }
    const generation = this.generation;

    const promise: Promise<string> = this.requestToken(storeId)
      .then((session) => {
        if (generation === this.generation) {
          this.writeStored(session);
          this.remintedAfterRejection = reason === 'rejected' ? session.token : null;
          this.install(session);
        }
        return session.token;
      })
      .finally(() => {
        if (this.inflight?.promise === promise) this.inflight = null;
      });
    this.inflight = { generation, promise };
    return promise;
  }

  private async requestToken(storeId: string): Promise<StoredShopSession> {
    let response: Response;
    try {
      response = await fetch(`${environment.apiUrl}/shop/session`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ storeId }),
      });
    } catch (err) {
      throw new ShopSessionMintError(
        err instanceof Error ? err.message : 'Could not connect to the store server.'
      );
    }
    if (!response.ok) {
      throw new ShopSessionMintError(`Session request failed: ${response.status}`, response.status);
    }
    const data = (await response.json()) as { token?: unknown; expiresAt?: unknown };
    if (typeof data.token !== 'string' || data.token.length === 0) {
      throw new ShopSessionMintError('Session response carried no token.');
    }
    return { storeId, token: data.token, expiresAt: expiryOf(data.token, data.expiresAt) };
  }

  private install(session: StoredShopSession): void {
    this.current = session;
    this.credential.holdCapability(session.token);
    this.scheduleRefresh(session.expiresAt - SHOP_SESSION_STALE_MARGIN_MS - Date.now());
  }

  private scheduleRefresh(delayMs: number): void {
    this.clearTimer();
    this.refreshTimer = setTimeout(
      () => {
        this.refreshTimer = null;
        if (!this.active) return;
        // The current token still has its margin left, so a failed proactive mint
        // is not yet visible to the customer — try again shortly.
        this.mint().catch((err: unknown) => {
          console.warn('[ShopSessionService] Proactive re-mint failed:', err);
          if (this.active && this.refreshTimer === null) {
            this.scheduleRefresh(MIN_REFRESH_DELAY_MS);
          }
        });
      },
      Math.max(MIN_REFRESH_DELAY_MS, delayMs)
    );
  }

  private clearTimer(): void {
    if (this.refreshTimer !== null) {
      clearTimeout(this.refreshTimer);
      this.refreshTimer = null;
    }
  }

  private onAuthRejected(): void {
    // A 401 while no shop is open belongs to the staff session, not to us.
    if (!this.active) return;
    if (this.current !== null && this.current.token === this.remintedAfterRejection) {
      console.warn('[ShopSessionService] A freshly minted shop token was rejected; not retrying.');
      return;
    }
    this.current = null;
    this.clearStored();
    // The new token reaches the worker through holdCapability(), and the worker
    // pulls as soon as its credential changes — no separate forceSync needed.
    this.mint('rejected').catch((err: unknown) => {
      console.warn('[ShopSessionService] Re-mint after a rejected token failed:', err);
    });
  }

  private isStale(session: StoredShopSession): boolean {
    return session.expiresAt - Date.now() < SHOP_SESSION_STALE_MARGIN_MS;
  }

  // Storage access is guarded throughout: private browsing, blocked site data or a
  // quota error make sessionStorage throw, and the shop must still work — it just
  // mints once per page load instead of reusing.

  private readStored(storeId: string): StoredShopSession | null {
    try {
      const raw = sessionStorage.getItem(SHOP_SESSION_STORAGE_KEY);
      if (!raw) return null;
      const parsed = JSON.parse(raw) as Partial<StoredShopSession>;
      if (
        parsed.storeId !== storeId ||
        typeof parsed.token !== 'string' ||
        typeof parsed.expiresAt !== 'number'
      ) {
        return null;
      }
      return { storeId, token: parsed.token, expiresAt: parsed.expiresAt };
    } catch {
      return null;
    }
  }

  private writeStored(session: StoredShopSession): void {
    try {
      sessionStorage.setItem(SHOP_SESSION_STORAGE_KEY, JSON.stringify(session));
    } catch {
      // In-memory only for this page load — see the note above readStored().
    }
  }

  private clearStored(): void {
    try {
      sessionStorage.removeItem(SHOP_SESSION_STORAGE_KEY);
    } catch {
      // Nothing persisted to clear.
    }
  }
}

/**
 * When the token expires, in epoch ms: the server's `expiresAt` when it sent a
 * parseable one, else the JWT's own `exp`, else a short fallback lifetime.
 *
 * The `exp` decode is a scheduling hint only — the API verifies the signature.
 */
function expiryOf(token: string, expiresAt: unknown): number {
  if (typeof expiresAt === 'string') {
    const parsed = Date.parse(expiresAt);
    if (Number.isFinite(parsed)) return parsed;
  }
  try {
    const payload = token.split('.')[1];
    if (payload) {
      const normalized = payload.replace(/-/g, '+').replace(/_/g, '/');
      const padded = normalized.padEnd(
        normalized.length + ((4 - (normalized.length % 4)) % 4),
        '='
      );
      const claims = JSON.parse(atob(padded)) as { exp?: unknown };
      if (typeof claims.exp === 'number' && Number.isFinite(claims.exp)) return claims.exp * 1000;
    }
  } catch {
    // Opaque or malformed — fall through to the fallback lifetime.
  }
  return Date.now() + FALLBACK_LIFETIME_MS;
}
