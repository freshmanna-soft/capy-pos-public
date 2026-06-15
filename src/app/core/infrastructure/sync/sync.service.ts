import { Injectable, inject, signal, computed, OnDestroy } from '@angular/core';
import { DexieDatabase } from '@core/infrastructure/database/dexie-database.service';
import {
  SyncWorkerCommand,
  SyncWorkerEvent,
  SyncWorkerConfig,
  SyncStatus,
  SyncStatusReport,
  WorkerCircuitState,
  SyncedProduct,
  PushProductPayload,
  PushResult,
  DEFAULT_SYNC_CONFIG,
} from './sync.types';

/**
 * Sync Service
 * Manages the background sync web worker from the Angular main thread.
 * Handles worker lifecycle, message passing, and writing synced data to Dexie.
 *
 * Architecture:
 * - Worker fetches data from AWS API (with circuit breaker + retry)
 * - Worker posts synced data back to main thread
 * - This service writes the data to local Dexie (IndexedDB)
 * - Components can observe sync status via signals
 */
@Injectable({
  providedIn: 'root',
})
export class SyncService implements OnDestroy {
  private readonly db = inject(DexieDatabase);
  private worker: Worker | null = null;

  // ─── Reactive State (Signals) ───────────────────────────────────────────

  private readonly _status = signal<SyncStatus>(SyncStatus.IDLE);
  private readonly _circuitState = signal<WorkerCircuitState>(WorkerCircuitState.CLOSED);
  private readonly _lastSyncTime = signal<string | null>(null);
  private readonly _lastError = signal<string | null>(null);
  private readonly _totalSyncs = signal<number>(0);
  private readonly _totalFailures = signal<number>(0);
  private readonly _isHealthy = signal<boolean>(false);
  private readonly _productsSynced = signal<number>(0);

  // ─── Public Computed Signals ────────────────────────────────────────────

  readonly status = this._status.asReadonly();
  readonly circuitState = this._circuitState.asReadonly();
  readonly lastSyncTime = this._lastSyncTime.asReadonly();
  readonly lastError = this._lastError.asReadonly();
  readonly totalSyncs = this._totalSyncs.asReadonly();
  readonly totalFailures = this._totalFailures.asReadonly();
  readonly isHealthy = this._isHealthy.asReadonly();
  readonly productsSynced = this._productsSynced.asReadonly();

  readonly isSyncing = computed(() => this._status() === SyncStatus.SYNCING);
  readonly isCircuitOpen = computed(() => this._circuitState() === WorkerCircuitState.OPEN);
  readonly hasError = computed(() => this._lastError() !== null);

  // ─── Worker Lifecycle ───────────────────────────────────────────────────

  /**
   * Start the sync worker with optional custom configuration
   */
  start(config?: Partial<SyncWorkerConfig>): void {
    if (this.worker) {
      console.warn('[SyncService] Worker already running. Stop first.');
      return;
    }

    if (typeof Worker === 'undefined') {
      console.warn('[SyncService] Web Workers not supported in this environment.');
      return;
    }

    try {
      this.worker = new Worker(new URL('./sync.worker', import.meta.url), { type: 'module' });

      this.worker.onmessage = (event: MessageEvent<SyncWorkerEvent>) => {
        this.handleWorkerEvent(event.data);
      };

      this.worker.onerror = (error: ErrorEvent) => {
        console.error('[SyncService] Worker error:', error.message);
        this._status.set(SyncStatus.FAILED);
        this._lastError.set(error.message);
      };

      // Send start command with merged config
      const finalConfig: SyncWorkerConfig = { ...DEFAULT_SYNC_CONFIG, ...config };
      this.postCommand({ type: 'START_SYNC', config: finalConfig });

      console.log('[SyncService] Worker started with config:', finalConfig.apiBaseUrl);
    } catch (error) {
      console.error('[SyncService] Failed to create worker:', error);
      this._lastError.set(error instanceof Error ? error.message : 'Worker creation failed');
    }
  }

  /**
   * Stop the sync worker
   */
  stop(): void {
    if (this.worker) {
      this.postCommand({ type: 'STOP_SYNC' });
      this.worker.terminate();
      this.worker = null;
      this._status.set(SyncStatus.IDLE);
      console.log('[SyncService] Worker stopped.');
    }
  }

  /**
   * Force an immediate sync cycle
   */
  forceSync(): void {
    this.postCommand({ type: 'FORCE_SYNC' });
  }

  /**
   * Get current sync status from worker
   */
  requestStatus(): void {
    this.postCommand({ type: 'GET_STATUS' });
  }

  /**
   * Reset the circuit breaker (e.g., after fixing network issues)
   */
  resetCircuitBreaker(): void {
    this.postCommand({ type: 'RESET_CIRCUIT_BREAKER' });
  }

  /**
   * Update worker configuration at runtime
   */
  updateConfig(config: Partial<SyncWorkerConfig>): void {
    this.postCommand({ type: 'UPDATE_CONFIG', config });
  }

  /**
   * Push products to the remote API.
   * Sends products to the worker which POSTs them individually.
   * Returns immediately — results come back via PUSH_COMPLETED event.
   */
  pushProducts(products: PushProductPayload[]): void {
    if (!products.length) {
      console.warn('[SyncService] No products to push.');
      return;
    }

    if (!this.worker) {
      console.error('[SyncService] Worker not running. Call start() first.');
      return;
    }

    console.log(`[SyncService] Queuing ${products.length} product(s) for push...`);
    this.postCommand({ type: 'PUSH_PRODUCTS', products });
  }

  /**
   * Convenience: push a single product to the API
   */
  pushProduct(product: PushProductPayload): void {
    this.pushProducts([product]);
  }

  /**
   * Check if worker is running
   */
  isRunning(): boolean {
    return this.worker !== null;
  }

  ngOnDestroy(): void {
    this.stop();
  }

  // ─── Private Methods ────────────────────────────────────────────────────

  private postCommand(command: SyncWorkerCommand): void {
    if (this.worker) {
      this.worker.postMessage(command);
    }
  }

  private handleWorkerEvent(event: SyncWorkerEvent): void {
    switch (event.type) {
      case 'SYNC_STARTED':
        this._status.set(SyncStatus.SYNCING);
        break;

      case 'SYNC_COMPLETED':
        this._status.set(SyncStatus.SUCCESS);
        this._lastSyncTime.set(event.data.timestamp);
        this._totalSyncs.update((n) => n + 1);
        this._lastError.set(null);
        console.log('[SyncService] Sync completed:', event.data);
        break;

      case 'SYNC_FAILED':
        this._lastError.set(event.error);
        console.warn(
          `[SyncService] Sync attempt ${event.attempt}/${event.maxAttempts} failed:`,
          event.error
        );
        break;

      case 'SYNC_STATUS':
        this.applyStatusReport(event.status);
        break;

      case 'PRODUCTS_SYNCED':
        this.writeProductsToDexie(event.products);
        break;

      case 'TRANSACTIONS_SYNCED':
        console.log(`[SyncService] ${event.count} transactions available on API.`);
        break;

      case 'CIRCUIT_STATE_CHANGED':
        this._circuitState.set(event.state);
        if (event.state === WorkerCircuitState.OPEN) {
          this._status.set(SyncStatus.CIRCUIT_OPEN);
        }
        console.log(`[SyncService] Circuit "${event.circuit}" → ${event.state}`);
        break;

      case 'HEALTH_CHECK':
        this._isHealthy.set(event.healthy);
        console.log(
          `[SyncService] Health check: ${event.healthy ? 'OK' : 'FAILED'} (${event.apiUrl})`
        );
        break;

      case 'PUSH_COMPLETED':
        console.log(
          `[SyncService] Push completed. Pushed: ${event.pushed}, Failed: ${event.failed}`
        );
        if (event.failed > 0) {
          const failedIds = event.results
            .filter((r: PushResult) => !r.success)
            .map((r: PushResult) => r.productId);
          console.warn('[SyncService] Failed to push products:', failedIds);
        }
        break;

      case 'ERROR':
        this._status.set(SyncStatus.FAILED);
        this._lastError.set(event.error);
        this._totalFailures.update((n) => n + 1);
        console.error('[SyncService] Worker error:', event.error, event.details);
        break;
    }
  }

  private applyStatusReport(report: SyncStatusReport): void {
    this._status.set(report.status);
    this._circuitState.set(report.circuitState);
    this._lastError.set(report.lastError ?? null);
    if (report.lastSyncTime) {
      this._lastSyncTime.set(report.lastSyncTime);
    }
  }

  /**
   * Write synced products from API into local Dexie database.
   * Uses bulkPut to upsert (insert or update).
   *
   * Note: The AWS API returns a minimal product shape:
   *   { id, name, price, category, stock }
   * We map this to the full IProductDB schema, filling defaults for missing fields.
   * Existing local records are merged (not overwritten) to preserve local-only data.
   */
  private async writeProductsToDexie(products: SyncedProduct[]): Promise<void> {
    if (!products.length) return;

    try {
      const now = new Date();
      const dbRecords = await Promise.all(
        products.map(async (p) => {
          // Try to get existing local record to preserve local-only fields
          const existing = await this.db.products.get(p.id);

          return {
            id: p.id,
            name: p.name,
            description: p.description ?? existing?.description ?? '',
            sku: p.sku ?? existing?.sku ?? `API-${p.id}`,
            barcode: p.barcode ?? existing?.barcode,
            category: p.category,
            price: p.price,
            cost: p.cost ?? existing?.cost ?? 0,
            // API uses "stock", SyncedProduct uses "quantity" — handle both
            quantity: p.quantity ?? p.stock ?? existing?.quantity ?? 0,
            minStockLevel: p.minStockLevel ?? existing?.minStockLevel ?? 10,
            maxStockLevel: p.maxStockLevel ?? existing?.maxStockLevel,
            unit: p.unit ?? existing?.unit ?? 'piece',
            taxRate: p.taxRate ?? existing?.taxRate ?? 0.08,
            isActive: p.isActive ?? existing?.isActive ?? true,
            imageUrl: p.imageUrl ?? existing?.imageUrl,
            createdAt: p.createdAt ? new Date(p.createdAt) : (existing?.createdAt ?? now),
            updatedAt: p.updatedAt ? new Date(p.updatedAt) : now,
          };
        })
      );

      await this.db.products.bulkPut(dbRecords);
      this._productsSynced.set(products.length);

      console.log(`[SyncService] Wrote ${products.length} products to Dexie.`);
    } catch (error) {
      console.error('[SyncService] Failed to write products to Dexie:', error);
    }
  }
}
