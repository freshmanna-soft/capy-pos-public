import { TestBed } from '@angular/core/testing';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { SyncService } from './sync.service';
import { DexieDatabase } from '@core/infrastructure/database/dexie-database.service';
import {
  SyncWorkerCommand,
  SyncWorkerEvent,
  SyncStatus,
  WorkerCircuitState,
  SyncDirection,
  PushProductPayload,
  SyncedProduct,
} from './sync.types';

/**
 * Fake Worker that records posted commands and lets tests dispatch
 * worker → main thread events through the service's onmessage handler.
 */
class FakeWorker {
  static instances: FakeWorker[] = [];
  static throwOnConstruct = false;

  onmessage: ((event: MessageEvent<SyncWorkerEvent>) => void) | null = null;
  onerror: ((event: ErrorEvent) => void) | null = null;
  postMessage = vi.fn<(command: SyncWorkerCommand) => void>();
  terminate = vi.fn();

  constructor(
    public url: unknown,
    public options: unknown
  ) {
    if (FakeWorker.throwOnConstruct) {
      throw new Error('boom');
    }
    FakeWorker.instances.push(this);
  }

  /** Simulate a message coming back from the worker. */
  emit(data: SyncWorkerEvent): void {
    this.onmessage?.({ data } as MessageEvent<SyncWorkerEvent>);
  }

  /** Last command posted to the worker. */
  get lastCommand(): SyncWorkerCommand {
    return this.postMessage.mock.calls.at(-1)?.[0] as SyncWorkerCommand;
  }

  commandsOfType<T extends SyncWorkerCommand['type']>(
    type: T
  ): Extract<SyncWorkerCommand, { type: T }>[] {
    return this.postMessage.mock.calls
      .map((call) => call[0])
      .filter((cmd): cmd is Extract<SyncWorkerCommand, { type: T }> => cmd.type === type);
  }
}

describe('SyncService', () => {
  let service: SyncService;
  let mockDb: { products: { get: ReturnType<typeof vi.fn>; bulkPut: ReturnType<typeof vi.fn> } };
  let originalWorker: typeof globalThis.Worker;

  const product: PushProductPayload = {
    id: 'p1',
    name: 'Widget',
    price: 9.99,
    category: 'tools',
    stock: 5,
    isActive: true,
  };

  /** Start the service and return the FakeWorker it created. */
  function start(): FakeWorker {
    service.start();
    return FakeWorker.instances.at(-1) as FakeWorker;
  }

  beforeEach(() => {
    vi.spyOn(console, 'log').mockImplementation(() => undefined);
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    vi.spyOn(console, 'error').mockImplementation(() => undefined);

    FakeWorker.instances = [];
    FakeWorker.throwOnConstruct = false;
    originalWorker = globalThis.Worker;
    globalThis.Worker = FakeWorker as unknown as typeof globalThis.Worker;

    mockDb = {
      products: {
        get: vi.fn().mockResolvedValue(undefined),
        bulkPut: vi.fn().mockResolvedValue(undefined),
      },
    };

    TestBed.configureTestingModule({
      providers: [SyncService, { provide: DexieDatabase, useValue: mockDb }],
    });
    service = TestBed.inject(SyncService);
  });

  afterEach(() => {
    globalThis.Worker = originalWorker;
    vi.restoreAllMocks();
  });

  it('should be created with idle defaults', () => {
    expect(service).toBeTruthy();
    expect(service.status()).toBe(SyncStatus.IDLE);
    expect(service.isRunning()).toBe(false);
    expect(service.hasError()).toBe(false);
  });

  // ─── Lifecycle ──────────────────────────────────────────────────────────

  describe('start', () => {
    it('creates a worker and posts START_SYNC', () => {
      const worker = start();
      expect(service.isRunning()).toBe(true);
      expect(worker.commandsOfType('START_SYNC')).toHaveLength(1);
    });

    it('merges custom config over defaults', () => {
      service.start({ apiBaseUrl: 'https://example.test' });
      const worker = FakeWorker.instances.at(-1) as FakeWorker;
      const cmd = worker.commandsOfType('START_SYNC')[0];
      expect(cmd.config.apiBaseUrl).toBe('https://example.test');
      expect(cmd.config.syncIntervalMs).toBeGreaterThan(0);
    });

    it('warns and no-ops when already running', () => {
      start();
      service.start();
      expect(FakeWorker.instances).toHaveLength(1);
    });

    it('warns when Web Workers are unsupported', () => {
      (globalThis as { Worker?: unknown }).Worker = undefined;
      service.start();
      expect(service.isRunning()).toBe(false);
    });

    it('captures errors thrown while creating the worker', () => {
      FakeWorker.throwOnConstruct = true;
      service.start();
      expect(service.isRunning()).toBe(false);
      expect(service.lastError()).toBe('boom');
    });

    it('routes worker onerror into failed status', () => {
      const worker = start();
      worker.onerror?.({ message: 'worker exploded' } as ErrorEvent);
      expect(service.status()).toBe(SyncStatus.FAILED);
      expect(service.lastError()).toBe('worker exploded');
    });
  });

  describe('stop', () => {
    it('terminates the worker and resets to idle', () => {
      const worker = start();
      service.stop();
      expect(worker.commandsOfType('STOP_SYNC')).toHaveLength(1);
      expect(worker.terminate).toHaveBeenCalled();
      expect(service.isRunning()).toBe(false);
      expect(service.status()).toBe(SyncStatus.IDLE);
    });

    it('is a no-op when no worker is running', () => {
      expect(() => service.stop()).not.toThrow();
    });

    it('rejects in-flight awaited pushes', async () => {
      start();
      const pending = service.pushUpdateAsync(product);
      service.stop();
      await expect(pending).rejects.toThrow('Sync worker stopped before push confirmed');
    });
  });

  it('ngOnDestroy stops the worker', () => {
    const worker = start();
    service.ngOnDestroy();
    expect(worker.terminate).toHaveBeenCalled();
  });

  // ─── Simple command pass-throughs ─────────────────────────────────────────

  describe('command pass-throughs', () => {
    it('forwards commands to the worker', () => {
      const worker = start();
      service.forceSync();
      service.requestStatus();
      service.resetCircuitBreaker();
      service.updateConfig({ syncIntervalMs: 1000 });
      expect(worker.commandsOfType('FORCE_SYNC')).toHaveLength(1);
      expect(worker.commandsOfType('GET_STATUS')).toHaveLength(1);
      expect(worker.commandsOfType('RESET_CIRCUIT_BREAKER')).toHaveLength(1);
      expect(worker.commandsOfType('UPDATE_CONFIG')).toHaveLength(1);
    });

    it('silently drops commands when no worker exists', () => {
      expect(() => service.forceSync()).not.toThrow();
    });
  });

  // ─── Push (fire-and-forget) ───────────────────────────────────────────────

  describe('pushProducts / pushProduct', () => {
    it('posts PUSH_PRODUCTS', () => {
      const worker = start();
      service.pushProducts([product]);
      expect(worker.commandsOfType('PUSH_PRODUCTS')[0].products).toEqual([product]);
    });

    it('warns on empty input', () => {
      const worker = start();
      service.pushProducts([]);
      expect(worker.commandsOfType('PUSH_PRODUCTS')).toHaveLength(0);
    });

    it('errors when worker not running', () => {
      service.pushProducts([product]);
      expect(console.error).toHaveBeenCalled();
    });

    it('pushProduct delegates to pushProducts', () => {
      const worker = start();
      service.pushProduct(product);
      expect(worker.commandsOfType('PUSH_PRODUCTS')[0].products).toEqual([product]);
    });
  });

  describe('pushUpdates / pushUpdate', () => {
    it('posts PUSH_UPDATE_PRODUCTS', () => {
      const worker = start();
      service.pushUpdates([product]);
      expect(worker.commandsOfType('PUSH_UPDATE_PRODUCTS')[0].products).toEqual([product]);
    });

    it('warns on empty input', () => {
      const worker = start();
      service.pushUpdates([]);
      expect(worker.commandsOfType('PUSH_UPDATE_PRODUCTS')).toHaveLength(0);
    });

    it('errors when worker not running', () => {
      service.pushUpdates([product]);
      expect(console.error).toHaveBeenCalled();
    });

    it('pushUpdate delegates to pushUpdates', () => {
      const worker = start();
      service.pushUpdate(product);
      expect(worker.commandsOfType('PUSH_UPDATE_PRODUCTS')[0].products).toEqual([product]);
    });
  });

  describe('pushDeletes / pushDelete', () => {
    it('posts PUSH_DELETE_PRODUCTS', () => {
      const worker = start();
      service.pushDeletes(['p1', 'p2']);
      expect(worker.commandsOfType('PUSH_DELETE_PRODUCTS')[0].productIds).toEqual(['p1', 'p2']);
    });

    it('warns on empty input', () => {
      const worker = start();
      service.pushDeletes([]);
      expect(worker.commandsOfType('PUSH_DELETE_PRODUCTS')).toHaveLength(0);
    });

    it('errors when worker not running', () => {
      service.pushDeletes(['p1']);
      expect(console.error).toHaveBeenCalled();
    });

    it('pushDelete delegates to pushDeletes', () => {
      const worker = start();
      service.pushDelete('p1');
      expect(worker.commandsOfType('PUSH_DELETE_PRODUCTS')[0].productIds).toEqual(['p1']);
    });
  });

  // ─── Push (awaited) ───────────────────────────────────────────────────────

  describe('pushUpdateAsync', () => {
    it('rejects immediately when worker is not running', async () => {
      await expect(service.pushUpdateAsync(product)).rejects.toThrow('Sync worker not running');
    });

    it('resolves when a matching success result arrives', async () => {
      const worker = start();
      const promise = service.pushUpdateAsync(product);
      worker.emit({
        type: 'PUSH_COMPLETED',
        pushed: 1,
        failed: 0,
        results: [{ productId: 'p1', success: true, status: 200 }],
      });
      await expect(promise).resolves.toMatchObject({ productId: 'p1', success: true });
    });

    it('rejects with the result error when the push fails', async () => {
      const worker = start();
      const promise = service.pushUpdateAsync(product);
      worker.emit({
        type: 'PUSH_COMPLETED',
        pushed: 0,
        failed: 1,
        results: [{ productId: 'p1', success: false, error: 'HTTP 500' }],
      });
      await expect(promise).rejects.toThrow('HTTP 500');
    });

    it('rejects with a default message when failure has no error text', async () => {
      const worker = start();
      const promise = service.pushUpdateAsync(product);
      worker.emit({
        type: 'PUSH_COMPLETED',
        pushed: 0,
        failed: 1,
        results: [{ productId: 'p1', success: false }],
      });
      await expect(promise).rejects.toThrow('Push failed for product p1');
    });

    it('times out when no result confirms', async () => {
      vi.useFakeTimers();
      try {
        start();
        const promise = service.pushUpdateAsync(product, 50);
        const assertion = expect(promise).rejects.toThrow('timed out after 50ms');
        await vi.advanceTimersByTimeAsync(60);
        await assertion;
      } finally {
        vi.useRealTimers();
      }
    });

    it('ignores results for products it is not awaiting', async () => {
      const worker = start();
      const promise = service.pushUpdateAsync(product);
      // Result for a different product must not settle this promise.
      worker.emit({
        type: 'PUSH_COMPLETED',
        pushed: 1,
        failed: 0,
        results: [{ productId: 'other', success: true, status: 200 }],
      });
      worker.emit({
        type: 'PUSH_COMPLETED',
        pushed: 1,
        failed: 0,
        results: [{ productId: 'p1', success: true, status: 200 }],
      });
      await expect(promise).resolves.toMatchObject({ productId: 'p1' });
    });
  });

  // ─── Worker event handling ─────────────────────────────────────────────────

  describe('handleWorkerEvent', () => {
    let worker: FakeWorker;

    beforeEach(() => {
      worker = start();
    });

    it('SYNC_STARTED → syncing', () => {
      worker.emit({ type: 'SYNC_STARTED' });
      expect(service.status()).toBe(SyncStatus.SYNCING);
      expect(service.isSyncing()).toBe(true);
    });

    it('SYNC_COMPLETED → success and bumps counters', () => {
      worker.emit({
        type: 'SYNC_COMPLETED',
        data: {
          productssynced: 2,
          transactionsSynced: 0,
          duration: 10,
          timestamp: '2026-06-19T00:00:00.000Z',
          direction: SyncDirection.PULL,
        },
      });
      expect(service.status()).toBe(SyncStatus.SUCCESS);
      expect(service.totalSyncs()).toBe(1);
      expect(service.lastSyncTime()).toBe('2026-06-19T00:00:00.000Z');
      expect(service.lastError()).toBeNull();
    });

    it('SYNC_FAILED → records error', () => {
      worker.emit({ type: 'SYNC_FAILED', error: 'net down', attempt: 1, maxAttempts: 3 });
      expect(service.lastError()).toBe('net down');
    });

    it('SYNC_STATUS applies a full report', () => {
      worker.emit({
        type: 'SYNC_STATUS',
        status: {
          status: SyncStatus.SUCCESS,
          circuitState: WorkerCircuitState.HALF_OPEN,
          lastError: 'prior',
          lastSyncTime: '2026-06-19T01:00:00.000Z',
          retryAttempt: 0,
          totalSyncs: 3,
          totalFailures: 1,
        },
      });
      expect(service.status()).toBe(SyncStatus.SUCCESS);
      expect(service.circuitState()).toBe(WorkerCircuitState.HALF_OPEN);
      expect(service.lastError()).toBe('prior');
      expect(service.lastSyncTime()).toBe('2026-06-19T01:00:00.000Z');
    });

    it('SYNC_STATUS tolerates missing optional fields', () => {
      worker.emit({
        type: 'SYNC_STATUS',
        status: {
          status: SyncStatus.IDLE,
          circuitState: WorkerCircuitState.CLOSED,
          retryAttempt: 0,
          totalSyncs: 0,
          totalFailures: 0,
        },
      });
      expect(service.lastError()).toBeNull();
    });

    it('TRANSACTIONS_SYNCED is logged without state change', () => {
      worker.emit({ type: 'TRANSACTIONS_SYNCED', count: 4 });
      expect(service.status()).toBe(SyncStatus.IDLE);
    });

    it('CIRCUIT_STATE_CHANGED → OPEN flips status to circuit-open', () => {
      worker.emit({
        type: 'CIRCUIT_STATE_CHANGED',
        state: WorkerCircuitState.OPEN,
        circuit: 'products',
      });
      expect(service.circuitState()).toBe(WorkerCircuitState.OPEN);
      expect(service.isCircuitOpen()).toBe(true);
      expect(service.status()).toBe(SyncStatus.CIRCUIT_OPEN);
    });

    it('CIRCUIT_STATE_CHANGED → CLOSED leaves status untouched', () => {
      worker.emit({
        type: 'CIRCUIT_STATE_CHANGED',
        state: WorkerCircuitState.CLOSED,
        circuit: 'products',
      });
      expect(service.circuitState()).toBe(WorkerCircuitState.CLOSED);
      expect(service.status()).toBe(SyncStatus.IDLE);
    });

    it('HEALTH_CHECK updates health flag (both polarities)', () => {
      worker.emit({ type: 'HEALTH_CHECK', healthy: true, apiUrl: 'x' });
      expect(service.isHealthy()).toBe(true);
      worker.emit({ type: 'HEALTH_CHECK', healthy: false, apiUrl: 'x' });
      expect(service.isHealthy()).toBe(false);
    });

    it('PUSH_COMPLETED with failures logs the failed ids', () => {
      worker.emit({
        type: 'PUSH_COMPLETED',
        pushed: 1,
        failed: 1,
        results: [
          { productId: 'ok', success: true },
          { productId: 'bad', success: false, error: 'nope' },
        ],
      });
      expect(console.warn).toHaveBeenCalled();
    });

    it('PUSH_COMPLETED with no failures does not warn about ids', () => {
      (console.warn as ReturnType<typeof vi.fn>).mockClear();
      worker.emit({
        type: 'PUSH_COMPLETED',
        pushed: 1,
        failed: 0,
        results: [{ productId: 'ok', success: true }],
      });
      expect(console.warn).not.toHaveBeenCalled();
    });

    it('ERROR → failed status and failure counter', () => {
      worker.emit({ type: 'ERROR', error: 'kaboom', details: 'stack' });
      expect(service.status()).toBe(SyncStatus.FAILED);
      expect(service.lastError()).toBe('kaboom');
      expect(service.totalFailures()).toBe(1);
    });
  });

  // ─── PRODUCTS_SYNCED → Dexie write ─────────────────────────────────────────

  describe('PRODUCTS_SYNCED writes to Dexie', () => {
    function emitProducts(products: SyncedProduct[]): FakeWorker {
      const worker = start();
      worker.emit({ type: 'PRODUCTS_SYNCED', products });
      return worker;
    }

    it('ignores an empty product list', async () => {
      emitProducts([]);
      await Promise.resolve();
      expect(mockDb.products.bulkPut).not.toHaveBeenCalled();
    });

    it('fills defaults for a minimal product with no existing record', async () => {
      mockDb.products.get.mockResolvedValue(undefined);
      emitProducts([{ id: 'a', name: 'Minimal', category: 'c', price: 1, stock: 7 }]);
      await vi.waitFor(() => expect(mockDb.products.bulkPut).toHaveBeenCalled());

      const [records] = mockDb.products.bulkPut.mock.calls[0];
      expect(records[0]).toMatchObject({
        id: 'a',
        sku: 'API-a',
        quantity: 7,
        taxRate: 0.08,
        isActive: true,
      });
      expect(service.productsSynced()).toBe(1);
    });

    it('merges over an existing local record and honors provided fields', async () => {
      mockDb.products.get.mockResolvedValue({
        id: 'b',
        description: 'local-desc',
        sku: 'LOCAL-SKU',
        cost: 3,
        quantity: 99,
        unit: 'box',
        isActive: false,
      });
      emitProducts([
        {
          id: 'b',
          name: 'Full',
          category: 'c',
          price: 2,
          quantity: 11,
          minStockLevel: 1,
          maxStockLevel: 50,
          taxRate: 0.2,
          isActive: true,
          imageUrl: 'http://img',
          createdAt: '2026-01-01T00:00:00.000Z',
          updatedAt: '2026-02-01T00:00:00.000Z',
        },
      ]);
      await vi.waitFor(() => expect(mockDb.products.bulkPut).toHaveBeenCalled());

      const [records] = mockDb.products.bulkPut.mock.calls[0];
      expect(records[0]).toMatchObject({
        id: 'b',
        description: 'local-desc',
        sku: 'LOCAL-SKU',
        quantity: 11,
        taxRate: 0.2,
        isActive: true,
        imageUrl: 'http://img',
      });
      expect(records[0].createdAt).toBeInstanceOf(Date);
      expect(records[0].updatedAt).toBeInstanceOf(Date);
    });

    it('swallows Dexie write errors', async () => {
      mockDb.products.bulkPut.mockRejectedValue(new Error('disk full'));
      emitProducts([{ id: 'c', name: 'X', category: 'c', price: 1 }]);
      await vi.waitFor(() => expect(console.error).toHaveBeenCalled());
      expect(service.productsSynced()).toBe(0);
    });
  });
});
