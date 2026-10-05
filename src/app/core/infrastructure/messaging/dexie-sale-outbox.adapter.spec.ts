import { TestBed } from '@angular/core/testing';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { DomainEvent, DomainEventType, OutboxStatus } from '@core/domain/events/domain-event';
import type { SaleCompletedOutboxEvent } from '@core/application/ports/sale-outbox.port';
import { AngularAuthorizationService } from '@core/application/auth/angular-authorization.service';
import {
  DexieDatabase,
  ITransactionDB,
} from '@core/infrastructure/database/dexie-database.service';
import { AuditLogService } from '@core/infrastructure/audit/audit-log.service';
import { ToastService } from '@shared/ui/toast/toast.service';
import {
  EVENT_HANDLERS,
  EventHandler,
  OUTBOX_CLOCK,
  OUTBOX_MAX_ATTEMPTS,
  OutboxDispatcherService,
} from './outbox-dispatcher.service';
import { DexieSaleOutboxAdapter, SALE_OUTBOX_RETRY_DELAY } from './dexie-sale-outbox.adapter';

const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

function saleEvent(overrides: Partial<SaleCompletedOutboxEvent> = {}): SaleCompletedOutboxEvent {
  return {
    transactionId: 'TXN-1',
    correlationId: 'sale-corr-1',
    payload: {
      transactionId: 'TXN-1',
      items: [{ productId: 'p1', quantity: 2, unitPrice: 3 }],
      amount: 6.51,
      method: 'cash',
      occurredAt: '2026-10-03T10:00:00.000Z',
    },
    appliedInline: [],
    ...overrides,
  };
}

describe('DexieSaleOutboxAdapter', () => {
  let db: DexieDatabase;
  let adapter: DexieSaleOutboxAdapter;
  let dispatcher: OutboxDispatcherService;

  function setup(handlers: EventHandler[] = []) {
    TestBed.configureTestingModule({
      providers: [
        ...handlers.map((h) => ({ provide: EVENT_HANDLERS, useValue: h, multi: true })),
        { provide: OUTBOX_CLOCK, useValue: () => Date.parse('2026-10-03T10:00:00.000Z') },
        { provide: AuditLogService, useValue: { log: vi.fn().mockResolvedValue(undefined) } },
        { provide: ToastService, useValue: { error: vi.fn() } },
        { provide: AngularAuthorizationService, useValue: { can: () => false } },
        { provide: SALE_OUTBOX_RETRY_DELAY, useValue: () => 0 },
      ],
    });
    db = TestBed.inject(DexieDatabase);
    dispatcher = TestBed.inject(OutboxDispatcherService);
    adapter = TestBed.inject(DexieSaleOutboxAdapter);
  }

  /** What `PersistTransactionUseCase` hands in: a write to the transactions table. */
  const writeRow =
    (id = 'TXN-1') =>
    () =>
      db.transactions.add({ id, status: 'completed' } as unknown as ITransactionDB);

  beforeEach(() => {
    vi.spyOn(Math, 'random').mockReturnValue(0);
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
  });

  afterEach(async () => {
    adapter?.ngOnDestroy();
    // Let the post-commit dispatch finish before the database goes away.
    await dispatcher?.drain();
    dispatcher?.stop();
    vi.restoreAllMocks();
    if (db) await db.delete();
    TestBed.resetTestingModule();
  });

  it('writes the transaction row and a SaleCompleted event together', async () => {
    setup();

    expect(await adapter.record(saleEvent(), writeRow())).toBe('recorded');

    expect(await db.transactions.get('TXN-1')).toBeDefined();
    const rows = await db.outbox.toArray();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      type: DomainEventType.SALE_COMPLETED,
      aggregateId: 'TXN-1',
      correlationId: 'sale-corr-1',
    });
    expect(rows[0].id).toMatch(UUID_V4);
    expect(JSON.parse(rows[0].payload)).toEqual(saleEvent().payload);
  });

  it('writes neither row when the outbox write fails', async () => {
    setup();
    vi.spyOn(db.outbox, 'add').mockRejectedValueOnce(new Error('QuotaExceededError'));

    expect(await adapter.record(saleEvent(), writeRow())).toBe('deferred');

    expect(await db.transactions.get('TXN-1')).toBeUndefined();
    expect(await db.outbox.count()).toBe(0);
  });

  it('treats a retried checkout with the same transaction id as already recorded', async () => {
    setup();
    await adapter.record(saleEvent(), writeRow());

    expect(await adapter.record(saleEvent({ correlationId: 'sale-corr-2' }), writeRow())).toBe(
      'already-recorded'
    );

    const rows = await db.outbox.toArray();
    expect(rows).toHaveLength(1);
    expect(rows[0].correlationId).toBe('sale-corr-1');
  });

  it('retries a deferred write in the background until both rows land', async () => {
    setup();
    const add = db.outbox.add.bind(db.outbox);
    let failuresLeft = 2;
    vi.spyOn(db.outbox, 'add').mockImplementation(((row, key) =>
      failuresLeft-- > 0
        ? Promise.reject(new Error('IndexedDB unavailable'))
        : add(row, key)) as typeof db.outbox.add);

    expect(await adapter.record(saleEvent(), writeRow())).toBe('deferred');

    await vi.waitFor(async () => expect(await db.outbox.count()).toBe(1));
    expect(await db.transactions.get('TXN-1')).toBeDefined();
    expect(db.outbox.add).toHaveBeenCalledTimes(3);
  });

  it(`stops retrying after ${OUTBOX_MAX_ATTEMPTS} failed retries`, async () => {
    setup();
    const add = vi.spyOn(db.outbox, 'add').mockRejectedValue(new Error('IndexedDB unavailable'));

    await adapter.record(saleEvent(), writeRow());

    // The first try plus OUTBOX_MAX_ATTEMPTS retries, then it gives up and says so.
    await vi.waitFor(() =>
      expect(console.error).toHaveBeenCalledWith(
        expect.stringContaining(`after ${OUTBOX_MAX_ATTEMPTS} retries`),
        expect.anything()
      )
    );
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(add).toHaveBeenCalledTimes(1 + OUTBOX_MAX_ATTEMPTS);
  });

  it('never re-applies a side effect that already ran inline, even after a retry', async () => {
    const stock = vi.fn<(event: DomainEvent) => Promise<void>>().mockResolvedValue(undefined);
    const loyalty = vi.fn<(event: DomainEvent) => Promise<void>>().mockResolvedValue(undefined);
    setup([
      { name: 'adjust-stock', eventType: DomainEventType.SALE_COMPLETED, handle: stock },
      { name: 'award-loyalty', eventType: DomainEventType.SALE_COMPLETED, handle: loyalty },
    ]);
    const add = db.outbox.add.bind(db.outbox);
    vi.spyOn(db.outbox, 'add')
      .mockRejectedValueOnce(new Error('IndexedDB unavailable'))
      .mockImplementation(((row, key) => add(row, key)) as typeof db.outbox.add);

    expect(await adapter.record(saleEvent({ appliedInline: ['adjust-stock'] }), writeRow())).toBe(
      'deferred'
    );
    await vi.waitFor(async () => expect(await db.outbox.count()).toBe(1));
    await dispatcher.drain();

    expect(stock).not.toHaveBeenCalled();
    expect(loyalty).toHaveBeenCalledTimes(1);
    const [row] = await db.outbox.toArray();
    expect(row.status).toBe(OutboxStatus.HANDLED);
    expect(loyalty.mock.calls[0][0].correlationId).toBe('sale-corr-1');
  });

  it('dispatches the event once the write has committed', async () => {
    const handle = vi.fn<(event: DomainEvent) => Promise<void>>().mockResolvedValue(undefined);
    setup([{ name: 'h', eventType: DomainEventType.SALE_COMPLETED, handle }]);

    await adapter.record(saleEvent(), writeRow());
    await dispatcher.drain();

    expect(handle).toHaveBeenCalledTimes(1);
    expect(handle.mock.calls[0][0]).toMatchObject({
      aggregateId: 'TXN-1',
      correlationId: 'sale-corr-1',
    });
  });
});
