/// <reference lib="webworker" />

/**
 * Sync Web Worker
 * Runs in a background thread to sync local Dexie data with the sync backend —
 * IBM Code Engine `capy-pos-api` since #224 (`infra/pos-api`).
 * Implements Circuit Breaker + Retry with Exponential Backoff patterns.
 *
 * Uses native fetch() (no Angular HttpClient available in worker context).
 */

import {
  SyncWorkerCommand,
  SyncWorkerConfig,
  SyncWorkerEvent,
  SyncStatus,
  SyncDirection,
  WorkerCircuitState,
  SyncedProduct,
  PushProductPayload,
  PushResult,
  PushEventPayload,
  EventAck,
  DEFAULT_SYNC_CONFIG,
} from './sync.types';

// ─── HTTP status errors ─────────────────────────────────────────────────────

/**
 * A non-2xx answer from the API, keeping the status as a number.
 *
 * The message stays `HTTP <status>: <text>` because `WorkerRetry.isRetryable`
 * classifies on it; the numeric status is what lets the breaker and the pull tell
 * a refused credential apart from an outage without parsing that string.
 */
class HttpStatusError extends Error {
  constructor(
    readonly status: number,
    statusText: string
  ) {
    super(`HTTP ${status}: ${statusText}`);
    this.name = 'HttpStatusError';
  }
}

/**
 * A 401 means the API is up and answering — it just refused this token. Counting
 * that toward the breaker would open the circuit on a credential problem and then
 * stall the first pull after a fresh token arrives for the breaker timeout.
 */
function isCredentialRejection(error: unknown): error is HttpStatusError {
  return error instanceof HttpStatusError && error.status === 401;
}

// ─── Worker Circuit Breaker ─────────────────────────────────────────────────

class WorkerCircuitBreaker {
  private state: WorkerCircuitState = WorkerCircuitState.CLOSED;
  private failures = 0;
  private successes = 0;
  private consecutiveFailures = 0;
  private consecutiveSuccesses = 0;
  private nextAttemptTime: number | null = null;
  private failureTimestamps: number[] = [];

  constructor(
    private readonly name: string,
    private config: {
      failureThreshold: number;
      successThreshold: number;
      timeout: number;
      monitoringPeriod: number;
    }
  ) {}

  async execute<T>(fn: () => Promise<T>): Promise<T> {
    if (this.state === WorkerCircuitState.OPEN) {
      if (this.shouldAttemptReset()) {
        this.state = WorkerCircuitState.HALF_OPEN;
        this.notifyStateChange();
        console.log(`[Worker:CircuitBreaker:${this.name}] → HALF_OPEN`);
      } else {
        throw new Error(`Circuit breaker OPEN for ${this.name}`);
      }
    }

    try {
      const result = await fn();
      this.onSuccess();
      return result;
    } catch (error) {
      // Neither a success nor a failure of the service — see isCredentialRejection.
      if (!isCredentialRejection(error)) this.onFailure();
      throw error;
    }
  }

  getState(): WorkerCircuitState {
    return this.state;
  }

  reset(): void {
    this.state = WorkerCircuitState.CLOSED;
    this.failures = 0;
    this.successes = 0;
    this.consecutiveFailures = 0;
    this.consecutiveSuccesses = 0;
    this.failureTimestamps = [];
    this.nextAttemptTime = null;
    this.notifyStateChange();
    console.log(`[Worker:CircuitBreaker:${this.name}] Reset → CLOSED`);
  }

  updateConfig(config: Partial<typeof this.config>): void {
    this.config = { ...this.config, ...config };
  }

  private onSuccess(): void {
    this.successes++;
    this.consecutiveSuccesses++;
    this.consecutiveFailures = 0;

    if (
      this.state === WorkerCircuitState.HALF_OPEN &&
      this.consecutiveSuccesses >= this.config.successThreshold
    ) {
      this.state = WorkerCircuitState.CLOSED;
      this.failures = 0;
      this.failureTimestamps = [];
      this.notifyStateChange();
      console.log(`[Worker:CircuitBreaker:${this.name}] Recovery → CLOSED`);
    }
  }

  private onFailure(): void {
    this.failures++;
    this.consecutiveFailures++;
    this.consecutiveSuccesses = 0;

    const now = Date.now();
    this.failureTimestamps.push(now);
    this.failureTimestamps = this.failureTimestamps.filter(
      (ts) => now - ts < this.config.monitoringPeriod
    );

    if (this.state === WorkerCircuitState.HALF_OPEN) {
      this.state = WorkerCircuitState.OPEN;
      this.nextAttemptTime = Date.now() + this.config.timeout;
      this.notifyStateChange();
      console.log(`[Worker:CircuitBreaker:${this.name}] Failure in HALF_OPEN → OPEN`);
    } else if (
      this.state === WorkerCircuitState.CLOSED &&
      this.failureTimestamps.length >= this.config.failureThreshold
    ) {
      this.state = WorkerCircuitState.OPEN;
      this.nextAttemptTime = Date.now() + this.config.timeout;
      this.notifyStateChange();
      console.log(`[Worker:CircuitBreaker:${this.name}] Threshold reached → OPEN`);
    }
  }

  private shouldAttemptReset(): boolean {
    if (this.nextAttemptTime === null) return true;
    return Date.now() >= this.nextAttemptTime;
  }

  private notifyStateChange(): void {
    postEvent({
      type: 'CIRCUIT_STATE_CHANGED',
      state: this.state,
      circuit: this.name,
    });
  }
}

// ─── Worker Retry with Exponential Backoff ──────────────────────────────────

class WorkerRetry {
  constructor(
    private config: {
      maxAttempts: number;
      initialDelay: number;
      maxDelay: number;
      backoffMultiplier: number;
    }
  ) {}

  async execute<T>(operationName: string, fn: () => Promise<T>): Promise<T> {
    const attempt = async (attemptNumber: number): Promise<T> => {
      try {
        return await fn();
      } catch (error) {
        if (!this.isRetryable(error) || attemptNumber >= this.config.maxAttempts) {
          throw error;
        }

        const delay = this.calculateDelay(attemptNumber);
        console.log(
          `[Worker:Retry:${operationName}] Attempt ${attemptNumber}/${this.config.maxAttempts} failed. Retrying in ${delay}ms...`
        );

        postEvent({
          type: 'SYNC_FAILED',
          error: error instanceof Error ? error.message : String(error),
          attempt: attemptNumber,
          maxAttempts: this.config.maxAttempts,
        });

        await this.delay(delay);
        return attempt(attemptNumber + 1);
      }
    };

    return attempt(1);
  }

  updateConfig(config: Partial<typeof this.config>): void {
    this.config = { ...this.config, ...config };
  }

  private calculateDelay(attempt: number): number {
    // Exponential backoff: initialDelay * multiplier^(attempt-1)
    let delay = this.config.initialDelay * Math.pow(this.config.backoffMultiplier, attempt - 1);

    // Cap at maxDelay
    delay = Math.min(delay, this.config.maxDelay);

    // Add jitter (±25%) to prevent thundering herd
    const jitter = delay * 0.25 * (Math.random() * 2 - 1);
    delay = Math.max(0, delay + jitter);

    return Math.floor(delay);
  }

  private isRetryable(error: unknown): boolean {
    const message = error instanceof Error ? error.message : String(error);
    const nonRetryable = ['unauthorized', 'forbidden', 'bad request', '400', '401', '403'];
    return !nonRetryable.some((pattern) => message.toLowerCase().includes(pattern));
  }

  private delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}

// ─── Worker State ───────────────────────────────────────────────────────────

let config: SyncWorkerConfig = DEFAULT_SYNC_CONFIG;
let syncInterval: ReturnType<typeof setInterval> | null = null;
let isSyncing = false;
/**
 * Set when a new credential arrives while a cycle is already running. That cycle
 * went out with the old token, so its result says nothing about the new one; one
 * follow-up cycle runs as soon as it finishes instead of waiting for the interval.
 */
let resyncRequested = false;
let totalSyncs = 0;
let totalFailures = 0;
let lastSyncTime: string | undefined;
let lastError: string | undefined;

let circuitBreaker: WorkerCircuitBreaker;
let retry: WorkerRetry;

// ─── Helper: Post event to main thread ──────────────────────────────────────

function serialForEach<T>(
  items: readonly T[],
  work: (item: T) => Promise<void>,
  index = 0
): Promise<void> {
  if (index >= items.length) return Promise.resolve();
  return work(items[index]).then(() => serialForEach(items, work, index + 1));
}

function postEvent(event: SyncWorkerEvent): void {
  self.postMessage(event);
}

/**
 * Pull the X-Ray trace ID off a response so failures can be traced back to
 * CloudWatch/X-Ray. Requires the API to send `Access-Control-Expose-Headers:
 * X-Trace-Id` (otherwise the browser hides the header). Returns undefined when
 * absent or set to the backend's "unavailable" sentinel.
 */
function readTraceId(res: Response): string | undefined {
  const value = res.headers.get('X-Trace-Id');
  return value && value !== 'unavailable' ? value : undefined;
}

// ─── API Authorization ──────────────────────────────────────────────────────

/**
 * The operator's session token, or null when nobody is signed in.
 *
 * Trimmed because a whitespace-only value is the same absence of a credential as an
 * empty string, and `Bearer    ` is a malformed one.
 */
function sessionToken(): string | null {
  const token = config.sessionToken?.trim();
  return token || null;
}

/**
 * Read the token kind without treating the browser-side decode as authorization.
 * The API still verifies the signature and permissions; this hint only prevents
 * staff-only background pulls for capability tokens when route state is catching up.
 */
function sessionTokenType(): string | null {
  const token = sessionToken();
  if (!token) return null;

  try {
    const payload = token.split('.')[1];
    if (!payload) return null;

    const normalized = payload.replaceAll('-', '+').replaceAll('_', '/');
    const padded = normalized.padEnd(normalized.length + ((4 - (normalized.length % 4)) % 4), '=');
    const bytes = Uint8Array.from(atob(padded), (char) => char.codePointAt(0) ?? 0);
    const claims = JSON.parse(new TextDecoder().decode(bytes)) as { type?: unknown };
    return typeof claims.type === 'string' ? claims.type : null;
  } catch {
    // Invalid/opaque tokens are left to the API; this helper must never block a
    // normal staff session because its token format is not browser-decodable.
    return null;
  }
}

function shouldSkipTransactionPull(): boolean {
  return (
    config.kioskMode === true ||
    sessionTokenType() === 'shop-session' ||
    sessionTokenType() === 'kiosk-device'
  );
}

/**
 * The `Authorization` header every guarded route requires (issues #206, #224), or
 * nothing when nobody is signed in.
 *
 * Returning `{}` rather than `Bearer undefined` matters: a malformed credential is
 * denied the same way a wrong one is, so it presents as "the token is wrong" when
 * the truth is "there is no token", which is a materially harder thing to debug.
 * The value is never compiled in — `SyncSessionCredentialService` pushes the live
 * session token across on every change. See `SyncWorkerConfig.sessionToken`.
 */
function authHeaders(): Record<string, string> {
  const token = sessionToken();
  return token ? { Authorization: `Bearer ${token}` } : {};
}

/**
 * Refuse a push that has no credential to present, reporting every item as failed.
 *
 * The pull can simply skip and retry on the next tick (#224). A push cannot: the
 * items are pending local writes, and `SyncService.pushUpdateAsync` is *awaiting* a
 * `PUSH_COMPLETED` result keyed by product id. Returning silently would leave that
 * promise unsettled until its own 20s timeout, which then rejects with "timed out"
 * — blaming the network for a missing session. So the guard settles the results
 * itself, immediately and with the real reason.
 *
 * The point it shares with the pull guard is what it *doesn't* do: no request goes
 * out. Every one would 401, and each 401 is a `circuitBreaker.execute` failure
 * against a threshold of 5, so a handful of unauthenticated pushes would leave the
 * circuit open and stall the first real sync after sign-in for the breaker timeout.
 */
function refuseUnauthorizedPush(productIds: string[], action: string): boolean {
  if (sessionToken() !== null) return false;

  // In kiosk/shop context the absence of an operator session is expected and
  // harmless — stock decrements will flush on the next authorised staff login.
  // Use info instead of warn so the browser console stays clean for operators.
  const log = config.kioskMode ? console.info : console.warn;
  log(`[Worker:Push] No operator session — refusing to ${action} ${productIds.length} product(s).`);

  postEvent({
    type: 'PUSH_COMPLETED',
    pushed: 0,
    failed: productIds.length,
    results: productIds.map((productId) => ({
      productId,
      success: false,
      error: 'No operator session — sign in before syncing changes.',
    })),
  });

  return true;
}

// ─── API Fetch with timeout ─────────────────────────────────────────────────

async function fetchWithTimeout(
  url: string,
  options: RequestInit = {},
  timeoutMs = 15000
): Promise<Response> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(url, {
      ...options,
      signal: controller.signal,
      headers: {
        'Content-Type': 'application/json',
        ...(options.headers as Record<string, string>),
      },
    });

    if (!response.ok) {
      throw new HttpStatusError(response.status, response.statusText);
    }

    return response;
  } finally {
    clearTimeout(timeoutId);
  }
}

/**
 * `fetchWithTimeout` for the authorized routes — everything except the health
 * probe, which is deliberately left unauthenticated so the connectivity signal
 * does not depend on the token being current.
 *
 * Caller-supplied headers win over the token so a call can override it explicitly;
 * nothing does today.
 */
function fetchAuthorized(
  url: string,
  options: RequestInit = {},
  timeoutMs?: number
): Promise<Response> {
  return fetchWithTimeout(
    url,
    {
      ...options,
      headers: { ...authHeaders(), ...(options.headers as Record<string, string>) },
    },
    timeoutMs
  );
}

// ─── Sync Operations ────────────────────────────────────────────────────────

async function syncProducts(): Promise<SyncedProduct[]> {
  const url = `${config.apiBaseUrl}${config.endpoints.products}`;
  const response = await fetchAuthorized(url);
  const data = await response.json();

  // API may return { products: [...] } or just [...]
  const products: SyncedProduct[] = Array.isArray(data) ? data : data.products || data.Items || [];

  return products;
}

async function syncTransactions(): Promise<number> {
  const url = `${config.apiBaseUrl}${config.endpoints.transactions}`;
  const response = await fetchAuthorized(url);
  const data = await response.json();

  const transactions = Array.isArray(data) ? data : data.transactions || data.Items || [];

  return transactions.length;
}

async function checkHealth(): Promise<boolean> {
  try {
    const url = `${config.apiBaseUrl}${config.endpoints.health}`;
    // Unauthenticated on purpose (#206): `GET /api/health` is the one route outside
    // the auth boundary, and this is the worker's connectivity probe. Attaching a
    // credential would make a simple GET preflighted and would couple "is the API
    // reachable?" to "is our token current?" — the probe has to answer the first
    // question when the answer to the second is no.
    const response = await fetchWithTimeout(url, {}, 5000);
    const data = await response.json();
    return data.status === 'healthy' || response.ok;
  } catch {
    return false;
  }
}

// ─── Main Sync Cycle ────────────────────────────────────────────────────────

async function performSync(): Promise<void> {
  if (isSyncing) {
    console.log('[Worker:Sync] Already syncing, skipping...');
    return;
  }

  if (sessionToken() === null) {
    console.log('[Worker:Sync] No operator or device session — deferring sync.');
    return;
  }

  isSyncing = true;
  const startTime = Date.now();

  postEvent({ type: 'SYNC_STARTED' });

  try {
    // Use circuit breaker + retry together
    const products = await circuitBreaker.execute(() =>
      retry.execute('sync-products', () => syncProducts())
    );

    // Notify main thread with synced products (main thread writes to Dexie)
    postEvent({ type: 'PRODUCTS_SYNCED', products });

    // Anonymous shop and kiosk sessions may read products, but they must not read
    // transaction history. Their capability token intentionally lacks
    // `sale:view_transactions`, so skip this request instead of turning an expected
    // 403 into repeated console noise and circuit-breaker failures. Staff sessions
    // retain the transaction pull.
    let transactionCount = 0;
    if (!shouldSkipTransactionPull()) {
      try {
        transactionCount = await circuitBreaker.execute(() =>
          retry.execute('sync-transactions', () => syncTransactions())
        );
        postEvent({ type: 'TRANSACTIONS_SYNCED', count: transactionCount });
      } catch (txError) {
        // Transactions sync failure is non-fatal
        console.warn('[Worker:Sync] Transaction sync failed:', txError);
      }
    }

    const duration = Date.now() - startTime;
    totalSyncs++;
    lastSyncTime = new Date().toISOString();
    lastError = undefined;

    postEvent({
      type: 'SYNC_COMPLETED',
      data: {
        productssynced: products.length,
        transactionsSynced: transactionCount,
        duration,
        timestamp: lastSyncTime,
        direction: SyncDirection.PULL,
      },
    });

    console.log(
      `[Worker:Sync] Completed in ${duration}ms. Products: ${products.length}, Transactions: ${transactionCount}`
    );
  } catch (error) {
    totalFailures++;
    lastError = error instanceof Error ? error.message : String(error);

    // Told apart from the generic ERROR below so the main thread can fix the cause
    // (mint a fresh token) instead of only reporting it. ERROR still follows, so the
    // sync status and its listeners see the failure exactly as before.
    if (isCredentialRejection(error)) {
      postEvent({
        type: 'AUTH_REJECTED',
        status: error.status,
        endpoint: config.endpoints.products,
      });
    }

    const circuitState = circuitBreaker.getState();
    if (circuitState === WorkerCircuitState.OPEN) {
      postEvent({
        type: 'SYNC_STATUS',
        status: {
          status: SyncStatus.CIRCUIT_OPEN,
          lastSyncTime,
          lastError,
          circuitState,
          retryAttempt: 0,
          totalSyncs,
          totalFailures,
        },
      });
    } else {
      postEvent({
        type: 'ERROR',
        error: lastError,
        details: `Sync failed after retries. Circuit: ${circuitState}`,
      });
    }

    console.error('[Worker:Sync] Failed:', lastError);
  } finally {
    isSyncing = false;
    if (resyncRequested) {
      resyncRequested = false;
      void performSync();
    }
  }
}

/**
 * A new non-empty credential means the next pull can succeed where the last one
 * could not (first shop token, a re-minted one after a 401, a sign-in). Waiting
 * for the interval left a first-time shop visitor on "No products found" for up
 * to 30s, so pull now — or right after the cycle already in flight.
 */
function syncForNewCredential(previous: string | undefined): void {
  const token = sessionToken();
  if (token === null || token === previous?.trim()) return;
  // Not started, or stopped: the worker owns no schedule to run this on.
  if (syncInterval === null) return;
  if (isSyncing) {
    resyncRequested = true;
    return;
  }
  void performSync();
}

// ─── PUSH Operations (Local → API) ─────────────────────────────────────────

async function pushProducts(products: PushProductPayload[]): Promise<void> {
  if (!products.length) return;
  const ids = products.map((p) => p.id);
  if (refuseUnauthorizedPush(ids, 'create')) return;

  const url = `${config.apiBaseUrl}${config.endpoints.products}`;
  const results: PushResult[] = [];
  let pushed = 0;
  let failed = 0;

  console.log(`[Worker:Push] Pushing ${products.length} product(s) to API...`);

  await serialForEach(products, async (product) => {
    try {
      const response = await circuitBreaker.execute(() =>
        retry.execute(`push-product-${product.id}`, async () => {
          const controller = new AbortController();
          const timeoutId = setTimeout(() => controller.abort(), 15000);

          try {
            const res = await fetch(url, {
              method: 'POST',
              signal: controller.signal,
              headers: { ...authHeaders(), 'Content-Type': 'application/json' },
              body: JSON.stringify(product),
            });

            // 201 = created, 409 = already exists (both are "success" for push)
            if (res.status === 201 || res.status === 409) {
              return res;
            }

            // 4xx errors are non-retryable
            if (res.status >= 400 && res.status < 500) {
              throw new Error(`HTTP ${res.status}: ${res.statusText} (non-retryable)`);
            }

            // 5xx errors are retryable
            throw new Error(`HTTP ${res.status}: ${res.statusText}`);
          } finally {
            clearTimeout(timeoutId);
          }
        })
      );

      pushed++;
      results.push({
        productId: product.id,
        success: true,
        status: response.status,
      });

      console.log(`[Worker:Push] ✓ Product ${product.id} pushed (${response.status})`);
    } catch (error) {
      failed++;
      const errorMsg = error instanceof Error ? error.message : String(error);
      results.push({
        productId: product.id,
        success: false,
        error: errorMsg,
      });

      console.warn(`[Worker:Push] ✗ Product ${product.id} failed: ${errorMsg}`);
    }
  });

  postEvent({ type: 'PUSH_COMPLETED', pushed, failed, results });

  console.log(`[Worker:Push] Done. Pushed: ${pushed}, Failed: ${failed}`);
}

async function pushUpdates(products: PushProductPayload[]): Promise<void> {
  if (!products.length) return;
  const ids = products.map((p) => p.id);
  if (refuseUnauthorizedPush(ids, 'update')) return;

  const base = `${config.apiBaseUrl}${config.endpoints.products}`;
  const results: PushResult[] = [];
  let pushed = 0;
  let failed = 0;

  console.log(`[Worker:Push] Updating ${products.length} product(s) on API...`);

  await serialForEach(products, async (product) => {
    const { id, ...changes } = product;
    delete changes.stock;
    // Physical stock is now server-authoritative because checkout reservations are
    // persisted there. Retrying an offline client's stale absolute value could erase
    // completed sales or strand reservations, so generic sync updates never send it.
    // A future stock-adjustment endpoint must carry an idempotent delta/version.
    // Captured as soon as a response lands so the trace ID survives even when
    // a non-2xx status makes us throw past the response below.
    let traceId: string | undefined;
    try {
      const response = await circuitBreaker.execute(() =>
        retry.execute(`update-product-${id}`, async () => {
          const controller = new AbortController();
          const timeoutId = setTimeout(() => controller.abort(), 15000);

          try {
            const res = await fetch(`${base}/${id}`, {
              method: 'PATCH',
              signal: controller.signal,
              headers: { ...authHeaders(), 'Content-Type': 'application/json' },
              body: JSON.stringify(changes),
            });
            traceId = readTraceId(res);

            if (res.status === 200) {
              return res;
            }
            // 4xx (incl. 404 missing) are non-retryable; 5xx are retryable.
            if (res.status >= 400 && res.status < 500) {
              throw new Error(`HTTP ${res.status}: ${res.statusText} (non-retryable)`);
            }
            throw new Error(`HTTP ${res.status}: ${res.statusText}`);
          } finally {
            clearTimeout(timeoutId);
          }
        })
      );

      pushed++;
      results.push({ productId: id, success: true, status: response.status, traceId });
      console.log(`[Worker:Push] ✓ Product ${id} updated (${response.status})`);
    } catch (error) {
      failed++;
      const errorMsg = error instanceof Error ? error.message : String(error);
      results.push({ productId: id, success: false, error: errorMsg, traceId });
      console.warn(
        `[Worker:Push] ✗ Product ${id} update failed: ${errorMsg} [trace: ${traceId ?? 'none'}]`
      );
    }
  });

  postEvent({ type: 'PUSH_COMPLETED', pushed, failed, results });
  console.log(`[Worker:Push] Update done. Updated: ${pushed}, Failed: ${failed}`);
}

/**
 * Make the server's copy of each product match the local one: POST it, and when the
 * server already has it (409) PATCH the mutable fields instead.
 *
 * This is what the outbox's product handler drives. Create-then-patch rather than
 * patch-then-create because the products that most need this are the ones the server
 * has never seen — every product saved in Inventory before the outbox existed.
 * The PATCH leaves stock out for the same reason `pushUpdates` does; the POST sends
 * it, because a product the server is meeting for the first time has no other stock.
 */
async function pushUpserts(products: PushProductPayload[]): Promise<void> {
  if (!products.length) return;
  const ids = products.map((p) => p.id);
  if (refuseUnauthorizedPush(ids, 'upsert')) return;

  const base = `${config.apiBaseUrl}${config.endpoints.products}`;
  const results: PushResult[] = [];
  let pushed = 0;
  let failed = 0;

  await serialForEach(products, async (product) => {
    const { id, ...changes } = product;
    delete changes.stock;
    // PATCH refuses an empty string for any text field (400), and most products have
    // no description; POST accepts one, so only the PATCH body drops it.
    if (!changes.description?.trim()) delete changes.description;
    let traceId: string | undefined;

    const send = (key: string, url: string, init: RequestInit, ok: number[]) =>
      circuitBreaker.execute(() =>
        retry.execute(key, async () => {
          const controller = new AbortController();
          const timeoutId = setTimeout(() => controller.abort(), 15000);
          try {
            const res = await fetch(url, {
              ...init,
              signal: controller.signal,
              headers: { ...authHeaders(), 'Content-Type': 'application/json' },
            });
            traceId = readTraceId(res);
            if (ok.includes(res.status)) return res;
            if (res.status >= 400 && res.status < 500) {
              throw new Error(`HTTP ${res.status}: ${res.statusText} (non-retryable)`);
            }
            throw new Error(`HTTP ${res.status}: ${res.statusText}`);
          } finally {
            clearTimeout(timeoutId);
          }
        })
      );

    try {
      let response = await send(
        `upsert-create-product-${id}`,
        base,
        { method: 'POST', body: JSON.stringify(product) },
        [201, 409]
      );
      if (response.status === 409) {
        response = await send(
          `upsert-update-product-${id}`,
          `${base}/${id}`,
          { method: 'PATCH', body: JSON.stringify(changes) },
          [200]
        );
      }

      pushed++;
      results.push({ productId: id, success: true, status: response.status, traceId });
      console.log(`[Worker:Push] ✓ Product ${id} upserted (${response.status})`);
    } catch (error) {
      failed++;
      const errorMsg = error instanceof Error ? error.message : String(error);
      results.push({ productId: id, success: false, error: errorMsg, traceId });
      console.warn(
        `[Worker:Push] ✗ Product ${id} upsert failed: ${errorMsg} [trace: ${traceId ?? 'none'}]`
      );
    }
  });

  postEvent({ type: 'PUSH_COMPLETED', pushed, failed, results });
}

/**
 * Send a batch of outbox events to `POST /api/events` and report pos-api's verdict on
 * each (#359). The outbox's sale handler drives this, one event at a time.
 *
 * Answers it can't act on are not failures of the server, and stay outside the circuit
 * breaker: a 401 or 403 (session expired or wrong token) or a 404 (EVENTS_INGEST_ENABLED
 * still off) comes back as `retryLater`, so the outbox parks the event and tries again,
 * and the breaker that guards the product sync is never tripped by it. Only network
 * faults and 5xx count against the breaker, as for every other push.
 */
async function pushEvents(requestId: string, events: PushEventPayload[]): Promise<void> {
  if (sessionToken() === null) {
    postEvent({
      type: 'EVENTS_FAILED',
      requestId,
      error: 'No session; events sync after sign-in.',
      retryLater: true,
    });
    return;
  }

  const url = `${config.apiBaseUrl}${config.endpoints.events ?? '/api/events'}`;
  try {
    const response = await circuitBreaker.execute(() =>
      retry.execute(`push-events-${requestId}`, async () => {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 15000);
        try {
          const res = await fetch(url, {
            method: 'POST',
            signal: controller.signal,
            headers: { ...authHeaders(), 'Content-Type': 'application/json' },
            body: JSON.stringify({ events }),
          });
          if (res.status >= 500) throw new Error(`HTTP ${res.status}: ${res.statusText}`);
          return res;
        } finally {
          clearTimeout(timeoutId);
        }
      })
    );

    if (response.status === 401 || response.status === 403 || response.status === 404) {
      postEvent({
        type: 'EVENTS_FAILED',
        requestId,
        error: `pos-api answered ${response.status}; events wait and retry.`,
        retryLater: true,
      });
      return;
    }
    if (!response.ok) {
      postEvent({
        type: 'EVENTS_FAILED',
        requestId,
        error: `HTTP ${response.status}: ${response.statusText}`,
        retryLater: false,
      });
      return;
    }
    const body = (await response.json()) as { results?: EventAck[] };
    postEvent({ type: 'EVENTS_ACKED', requestId, results: body.results ?? [] });
  } catch (error) {
    postEvent({
      type: 'EVENTS_FAILED',
      requestId,
      error: error instanceof Error ? error.message : String(error),
      retryLater: false,
    });
  }
}

async function pushDeletes(productIds: string[]): Promise<void> {
  if (!productIds.length) return;
  if (refuseUnauthorizedPush(productIds, 'delete')) return;

  const base = `${config.apiBaseUrl}${config.endpoints.products}`;
  const results: PushResult[] = [];
  let pushed = 0;
  let failed = 0;

  console.log(`[Worker:Push] Deleting ${productIds.length} product(s) on API...`);

  await serialForEach(productIds, async (id) => {
    // Captured as soon as a response lands so the trace ID survives even when
    // a non-2xx status makes us throw past the response below.
    let traceId: string | undefined;
    try {
      const response = await circuitBreaker.execute(() =>
        retry.execute(`delete-product-${id}`, async () => {
          const controller = new AbortController();
          const timeoutId = setTimeout(() => controller.abort(), 15000);

          try {
            const res = await fetch(`${base}/${id}`, {
              method: 'DELETE',
              signal: controller.signal,
              headers: authHeaders(),
            });
            traceId = readTraceId(res);

            // 200 = deleted, 404 = already gone (both "success" for an idempotent delete)
            if (res.status === 200 || res.status === 204 || res.status === 404) {
              return res;
            }
            if (res.status >= 400 && res.status < 500) {
              throw new Error(`HTTP ${res.status}: ${res.statusText} (non-retryable)`);
            }
            throw new Error(`HTTP ${res.status}: ${res.statusText}`);
          } finally {
            clearTimeout(timeoutId);
          }
        })
      );

      pushed++;
      results.push({ productId: id, success: true, status: response.status, traceId });
      console.log(`[Worker:Push] ✓ Product ${id} deleted (${response.status})`);
    } catch (error) {
      failed++;
      const errorMsg = error instanceof Error ? error.message : String(error);
      results.push({ productId: id, success: false, error: errorMsg, traceId });
      console.warn(
        `[Worker:Push] ✗ Product ${id} delete failed: ${errorMsg} [trace: ${traceId ?? 'none'}]`
      );
    }
  });

  postEvent({ type: 'PUSH_COMPLETED', pushed, failed, results });
  console.log(`[Worker:Push] Delete done. Deleted: ${pushed}, Failed: ${failed}`);
}

// ─── Worker Lifecycle ───────────────────────────────────────────────────────

function startSync(cfg: SyncWorkerConfig): void {
  config = cfg;

  // Initialize circuit breaker and retry for worker context
  circuitBreaker = new WorkerCircuitBreaker('api-sync', config.circuitBreaker);
  retry = new WorkerRetry(config.retry);

  // Initial health check
  void checkHealth().then((healthy) => {
    postEvent({ type: 'HEALTH_CHECK', healthy, apiUrl: config.apiBaseUrl });
  });

  // Perform initial sync immediately. performSync owns its failure reporting.
  void performSync();

  // Set up periodic sync
  if (syncInterval) {
    clearInterval(syncInterval);
  }
  syncInterval = setInterval(() => void performSync(), config.syncIntervalMs);

  console.log(
    `[Worker:Sync] Started. Interval: ${config.syncIntervalMs}ms, API: ${config.apiBaseUrl}`
  );
}

function stopSync(): void {
  if (syncInterval) {
    clearInterval(syncInterval);
    syncInterval = null;
  }
  console.log('[Worker:Sync] Stopped.');
}

function getStatus(): void {
  postEvent({
    type: 'SYNC_STATUS',
    status: {
      status: isSyncing ? SyncStatus.SYNCING : SyncStatus.IDLE,
      lastSyncTime,
      lastError,
      circuitState: circuitBreaker?.getState() ?? WorkerCircuitState.CLOSED,
      retryAttempt: 0,
      totalSyncs,
      totalFailures,
      nextSyncIn: syncInterval ? config.syncIntervalMs : undefined,
    },
  });
}

// ─── Message Handler ────────────────────────────────────────────────────────

addEventListener('message', (event: MessageEvent<SyncWorkerCommand>) => {
  const command = event.data;

  switch (command.type) {
    case 'START_SYNC':
      startSync(command.config);
      break;

    case 'STOP_SYNC':
      stopSync();
      break;

    case 'FORCE_SYNC':
      void performSync();
      break;

    case 'GET_STATUS':
      getStatus();
      break;

    case 'RESET_CIRCUIT_BREAKER':
      circuitBreaker?.reset();
      break;

    case 'UPDATE_CONFIG': {
      const previousToken = config.sessionToken;
      config = { ...config, ...command.config };
      if (command.config.circuitBreaker) {
        circuitBreaker?.updateConfig(command.config.circuitBreaker);
      }
      if (command.config.retry) {
        retry?.updateConfig(command.config.retry);
      }
      // Restart interval if syncIntervalMs changed
      if (command.config.syncIntervalMs && syncInterval) {
        clearInterval(syncInterval);
        syncInterval = setInterval(() => void performSync(), config.syncIntervalMs);
      }
      if (command.config.sessionToken !== undefined) {
        syncForNewCredential(previousToken);
      }
      break;
    }

    case 'PUSH_PRODUCTS':
      void pushProducts(command.products);
      break;

    case 'PUSH_UPDATE_PRODUCTS':
      void pushUpdates(command.products);
      break;

    case 'PUSH_UPSERT_PRODUCTS':
      void pushUpserts(command.products);
      break;

    case 'PUSH_DELETE_PRODUCTS':
      void pushDeletes(command.productIds);
      break;

    case 'PUSH_EVENTS':
      void pushEvents(command.requestId, command.events);
      break;
  }
});

console.log('[Worker:Sync] Web Worker initialized and ready.');
