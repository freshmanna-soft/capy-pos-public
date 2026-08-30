/**
 * Sync Worker Types
 * Shared interfaces between the main thread and the web worker
 */

/**
 * Sync direction
 */
export enum SyncDirection {
  PULL = 'PULL', // API → Local (Dexie)
  PUSH = 'PUSH', // Local (Dexie) → API
  BIDIRECTIONAL = 'BIDIRECTIONAL',
}

/**
 * Sync status
 */
export enum SyncStatus {
  IDLE = 'IDLE',
  SYNCING = 'SYNCING',
  SUCCESS = 'SUCCESS',
  FAILED = 'FAILED',
  CIRCUIT_OPEN = 'CIRCUIT_OPEN',
}

/**
 * Circuit breaker state (mirrored for worker context)
 */
export enum WorkerCircuitState {
  CLOSED = 'CLOSED',
  OPEN = 'OPEN',
  HALF_OPEN = 'HALF_OPEN',
}

/**
 * Messages from main thread → worker
 */
export type SyncWorkerCommand =
  | { type: 'START_SYNC'; config: SyncWorkerConfig }
  | { type: 'STOP_SYNC' }
  | { type: 'FORCE_SYNC' }
  | { type: 'GET_STATUS' }
  | { type: 'RESET_CIRCUIT_BREAKER' }
  | { type: 'UPDATE_CONFIG'; config: Partial<SyncWorkerConfig> }
  | { type: 'PUSH_PRODUCTS'; products: PushProductPayload[] }
  | { type: 'PUSH_UPDATE_PRODUCTS'; products: PushProductPayload[] }
  | { type: 'PUSH_DELETE_PRODUCTS'; productIds: string[] };

/**
 * Product payload for PUSH sync (local → API)
 */
export interface PushProductPayload {
  id: string;
  name: string;
  price: number;
  category: string;
  stock?: number;
  description?: string;
  isActive?: boolean;
}

/**
 * Messages from worker → main thread
 */
export type SyncWorkerEvent =
  | { type: 'SYNC_STARTED' }
  | { type: 'SYNC_COMPLETED'; data: SyncResult }
  | { type: 'SYNC_FAILED'; error: string; attempt: number; maxAttempts: number }
  | { type: 'SYNC_STATUS'; status: SyncStatusReport }
  | { type: 'PRODUCTS_SYNCED'; products: SyncedProduct[] }
  | { type: 'TRANSACTIONS_SYNCED'; count: number }
  | { type: 'CIRCUIT_STATE_CHANGED'; state: WorkerCircuitState; circuit: string }
  | { type: 'HEALTH_CHECK'; healthy: boolean; apiUrl: string }
  | { type: 'PUSH_COMPLETED'; pushed: number; failed: number; results: PushResult[] }
  | { type: 'ERROR'; error: string; details?: string };

/**
 * Result of pushing a single product to the API
 */
export interface PushResult {
  productId: string;
  success: boolean;
  status?: number;
  error?: string;
  /** X-Ray trace ID from the API response, for tracing failures in CloudWatch. */
  traceId?: string;
}

/**
 * Sync worker configuration
 */
export interface SyncWorkerConfig {
  apiBaseUrl: string;
  /**
   * The operator's session JWT, presented as `Authorization: Bearer <token>` on
   * every request except the health probe (issues #206, #224).
   *
   * #206 built this as a shared service token for `terraform/aws-demo`. #224 chose
   * IBM `pos-api` as the one sync backend, and it authorizes with the session token
   * the till already mints (`SessionIssuer` → `infra/pos-api/src/session-auth.ts`,
   * HS256 over the same secret) — so the credential is per-operator, expires with
   * the session, and carries the `permissions` claim the API checks per route.
   * Nothing is compiled into the bundle: `SyncSessionCredentialService` pushes the
   * live value in via `UPDATE_CONFIG` on every sign-in, sign-out and re-issue.
   *
   * Empty or absent means "nobody is signed in". The worker then sends no
   * `Authorization` header and skips the authorized calls altogether rather than
   * collecting 401s: the pull defers to the next tick and a push reports every item
   * as failed so its awaiting caller settles at once. See `authHeaders`,
   * `performSync` and `refuseUnauthorizedPush` in `sync.worker.ts`.
   */
  sessionToken?: string;
  syncIntervalMs: number; // How often to sync (default: 30s)
  circuitBreaker: {
    failureThreshold: number;
    successThreshold: number;
    timeout: number; // ms before attempting half-open
    monitoringPeriod: number;
  };
  retry: {
    maxAttempts: number;
    initialDelay: number;
    maxDelay: number;
    backoffMultiplier: number;
  };
  endpoints: {
    products: string;
    transactions: string;
    health: string;
  };
}

/**
 * Sync result
 */
export interface SyncResult {
  productssynced: number;
  transactionsSynced: number;
  duration: number; // ms
  timestamp: string;
  direction: SyncDirection;
}

/**
 * Sync status report
 */
export interface SyncStatusReport {
  status: SyncStatus;
  lastSyncTime?: string;
  lastError?: string;
  circuitState: WorkerCircuitState;
  retryAttempt: number;
  totalSyncs: number;
  totalFailures: number;
  nextSyncIn?: number; // ms until next sync
}

/**
 * Product data from API (raw)
 *
 * The sync API returns a minimal shape: { id, name, price, category, stock }
 * Most fields are optional to accommodate the API's lean response.
 * The SyncService fills defaults when writing to Dexie.
 */
export interface SyncedProduct {
  id: string;
  name: string;
  description?: string;
  sku?: string;
  barcode?: string;
  category: string;
  price: number;
  cost?: number;
  quantity?: number;
  stock?: number; // API uses "stock" instead of "quantity"
  minStockLevel?: number;
  maxStockLevel?: number;
  unit?: string;
  taxRate?: number;
  isActive?: boolean;
  imageUrl?: string;
  createdAt?: string;
  updatedAt?: string;
}

/**
 * Default sync configuration
 */
export const DEFAULT_SYNC_CONFIG: SyncWorkerConfig = {
  // IBM Code Engine `capy-pos-api` — the one sync backend as of #224. `app.config.ts`
  // overrides this from `environment.apiUrl`; it is spelled out rather than left on
  // the retired AWS API Gateway host so a caller that forgets to pass a base URL
  // reaches something that exists.
  apiBaseUrl: 'https://capy-pos-api.2e2tmn0h4vl7.us-south.codeengine.appdomain.cloud',
  // Never a committed credential — it arrives at runtime. See SyncWorkerConfig.
  sessionToken: '',
  syncIntervalMs: 30000, // 30 seconds
  circuitBreaker: {
    failureThreshold: 5,
    successThreshold: 2,
    timeout: 60000, // 1 minute
    monitoringPeriod: 120000, // 2 minutes
  },
  retry: {
    maxAttempts: 3,
    initialDelay: 1000,
    maxDelay: 30000,
    backoffMultiplier: 2,
  },
  endpoints: {
    products: '/api/products',
    transactions: '/api/transactions',
    health: '/api/health',
  },
};
