/// <reference lib="webworker" />

/**
 * Sync Web Worker
 * Runs in a background thread to sync local Dexie data with AWS APIs.
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
  DEFAULT_SYNC_CONFIG,
} from './sync.types';

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
      this.onFailure();
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
    let lastError: unknown;

    for (let attempt = 1; attempt <= this.config.maxAttempts; attempt++) {
      try {
        return await fn();
      } catch (error) {
        lastError = error;

        if (!this.isRetryable(error)) {
          throw error;
        }

        if (attempt < this.config.maxAttempts) {
          const delay = this.calculateDelay(attempt);
          console.log(
            `[Worker:Retry:${operationName}] Attempt ${attempt}/${this.config.maxAttempts} failed. Retrying in ${delay}ms...`
          );

          postEvent({
            type: 'SYNC_FAILED',
            error: error instanceof Error ? error.message : String(error),
            attempt,
            maxAttempts: this.config.maxAttempts,
          });

          await this.delay(delay);
        }
      }
    }

    throw lastError;
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
let totalSyncs = 0;
let totalFailures = 0;
let lastSyncTime: string | undefined;
let lastError: string | undefined;

let circuitBreaker: WorkerCircuitBreaker;
let retry: WorkerRetry;

// ─── Helper: Post event to main thread ──────────────────────────────────────

function postEvent(event: SyncWorkerEvent): void {
  self.postMessage(event);
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
        ...((options.headers as Record<string, string>) || {}),
      },
    });

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }

    return response;
  } finally {
    clearTimeout(timeoutId);
  }
}

// ─── Sync Operations ────────────────────────────────────────────────────────

async function syncProducts(): Promise<SyncedProduct[]> {
  const url = `${config.apiBaseUrl}${config.endpoints.products}`;
  const response = await fetchWithTimeout(url);
  const data = await response.json();

  // API may return { products: [...] } or just [...]
  const products: SyncedProduct[] = Array.isArray(data) ? data : data.products || data.Items || [];

  return products;
}

async function syncTransactions(): Promise<number> {
  const url = `${config.apiBaseUrl}${config.endpoints.transactions}`;
  const response = await fetchWithTimeout(url);
  const data = await response.json();

  const transactions = Array.isArray(data) ? data : data.transactions || data.Items || [];

  return transactions.length;
}

async function checkHealth(): Promise<boolean> {
  try {
    const url = `${config.apiBaseUrl}${config.endpoints.health}`;
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

    // Sync transactions
    let transactionCount = 0;
    try {
      transactionCount = await circuitBreaker.execute(() =>
        retry.execute('sync-transactions', () => syncTransactions())
      );
      postEvent({ type: 'TRANSACTIONS_SYNCED', count: transactionCount });
    } catch (txError) {
      // Transactions sync failure is non-fatal
      console.warn('[Worker:Sync] Transaction sync failed:', txError);
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
  }
}

// ─── PUSH Operations (Local → API) ─────────────────────────────────────────

async function pushProducts(products: PushProductPayload[]): Promise<void> {
  if (!products.length) return;

  const url = `${config.apiBaseUrl}${config.endpoints.products}`;
  const results: PushResult[] = [];
  let pushed = 0;
  let failed = 0;

  console.log(`[Worker:Push] Pushing ${products.length} product(s) to API...`);

  for (const product of products) {
    try {
      const response = await circuitBreaker.execute(() =>
        retry.execute(`push-product-${product.id}`, async () => {
          const controller = new AbortController();
          const timeoutId = setTimeout(() => controller.abort(), 15000);

          try {
            const res = await fetch(url, {
              method: 'POST',
              signal: controller.signal,
              headers: { 'Content-Type': 'application/json' },
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
  }

  postEvent({ type: 'PUSH_COMPLETED', pushed, failed, results });

  console.log(`[Worker:Push] Done. Pushed: ${pushed}, Failed: ${failed}`);
}

// ─── Worker Lifecycle ───────────────────────────────────────────────────────

function startSync(cfg: SyncWorkerConfig): void {
  config = cfg;

  // Initialize circuit breaker and retry for worker context
  circuitBreaker = new WorkerCircuitBreaker('api-sync', config.circuitBreaker);
  retry = new WorkerRetry(config.retry);

  // Initial health check
  checkHealth().then((healthy) => {
    postEvent({ type: 'HEALTH_CHECK', healthy, apiUrl: config.apiBaseUrl });
  });

  // Perform initial sync immediately
  performSync();

  // Set up periodic sync
  if (syncInterval) {
    clearInterval(syncInterval);
  }
  syncInterval = setInterval(() => performSync(), config.syncIntervalMs);

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
      performSync();
      break;

    case 'GET_STATUS':
      getStatus();
      break;

    case 'RESET_CIRCUIT_BREAKER':
      circuitBreaker?.reset();
      break;

    case 'UPDATE_CONFIG':
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
        syncInterval = setInterval(() => performSync(), config.syncIntervalMs);
      }
      break;

    case 'PUSH_PRODUCTS':
      pushProducts(command.products);
      break;
  }
});

console.log('[Worker:Sync] Web Worker initialized and ready.');
