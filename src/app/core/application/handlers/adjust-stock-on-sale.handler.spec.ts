import { TestBed } from '@angular/core/testing';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { DomainEvent, DomainEventType, OutboxStatus } from '@core/domain/events/domain-event';
import { ProductBuilder } from '@core/domain/entities/product.builder';
import { AngularAuthorizationService } from '@core/application/auth/angular-authorization.service';
import { DexieDatabase } from '@core/infrastructure/database/dexie-database.service';
import { DexieProductRepository } from '@core/infrastructure/repositories/dexie-product.repository';
import { PRODUCT_REPOSITORY } from '@core/infrastructure/factories/repository.factory';
import { AuditLogService } from '@core/infrastructure/audit/audit-log.service';
import { ToastService } from '@shared/ui/toast/toast.service';
import {
  EVENT_HANDLERS,
  OUTBOX_CLOCK,
  OutboxDispatcherService,
  TerminalHandlerError,
} from '@core/infrastructure/messaging/outbox-dispatcher.service';
import {
  DexieSaleOutboxAdapter,
  SALE_OUTBOX_RETRY_DELAY,
} from '@core/infrastructure/messaging/dexie-sale-outbox.adapter';
import {
  ADJUST_STOCK_ON_SALE_HANDLER,
  AdjustStockOnSaleHandler,
} from './adjust-stock-on-sale.handler';

type SaleCompleted = DomainEvent<typeof DomainEventType.SALE_COMPLETED>;

/**
 * Integration: real Dexie (fake-indexeddb), the real product repository and use case,
 * and the real dispatcher. The point of #354 is what lands in IndexedDB.
 */
describe('AdjustStockOnSaleHandler', () => {
  let db: DexieDatabase;
  let handler: AdjustStockOnSaleHandler;
  let dispatcher: OutboxDispatcherService;
  let audit: { log: ReturnType<typeof vi.fn> };

  function sale(items: { productId: string; quantity: number }[], id = 'evt-1'): SaleCompleted {
    return {
      id,
      type: DomainEventType.SALE_COMPLETED,
      aggregateId: 'TXN-1',
      payload: {
        transactionId: 'TXN-1',
        items: items.map((item) => ({ ...item, unitPrice: 1 })),
        amount: 1,
        method: 'cash',
        occurredAt: '2026-10-04T10:00:00.000Z',
      },
      attempts: 0,
      createdAt: new Date('2026-10-04T10:00:00.000Z'),
    };
  }

  async function seed(id: string, stock: number) {
    await TestBed.inject(DexieProductRepository).create(
      new ProductBuilder()
        .withId(id)
        .withName(id)
        .withPrice(1)
        .withSku(`SKU-${id}`)
        .withCategory('Feed')
        .withStock(stock)
        .build()
    );
  }

  const stockOf = async (id: string) => (await db.products.get(id))?.quantity;
  const receiptOf = (eventId: string) =>
    db.outboxReceipts.get([eventId, ADJUST_STOCK_ON_SALE_HANDLER]);

  beforeEach(() => {
    audit = { log: vi.fn().mockResolvedValue(undefined) };
    TestBed.configureTestingModule({
      providers: [
        { provide: PRODUCT_REPOSITORY, useExisting: DexieProductRepository },
        { provide: EVENT_HANDLERS, useExisting: AdjustStockOnSaleHandler, multi: true },
        { provide: OUTBOX_CLOCK, useValue: () => Date.parse('2026-10-04T10:00:00.000Z') },
        { provide: SALE_OUTBOX_RETRY_DELAY, useValue: () => 0 },
        { provide: AuditLogService, useValue: audit },
        { provide: ToastService, useValue: { error: vi.fn() } },
        { provide: AngularAuthorizationService, useValue: { can: () => false } },
      ],
    });
    db = TestBed.inject(DexieDatabase);
    handler = TestBed.inject(AdjustStockOnSaleHandler);
    dispatcher = TestBed.inject(OutboxDispatcherService);
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    vi.spyOn(Math, 'random').mockReturnValue(0);
  });

  afterEach(async () => {
    await dispatcher.drain();
    dispatcher.stop();
    vi.restoreAllMocks();
    await db.delete();
    TestBed.resetTestingModule();
  });

  it('is a blocking SaleCompleted handler', () => {
    expect(handler.eventType).toBe(DomainEventType.SALE_COMPLETED);
    expect(handler.blocking).toBe(true);
    expect(handler.name).toBe('adjust-stock-on-sale');
  });

  it('decrements stock once even when the same event runs twice', async () => {
    await seed('oats', 10);
    const event = sale([{ productId: 'oats', quantity: 3 }]);

    await handler.handle(event);
    await handler.handle(event);

    expect(await stockOf('oats')).toBe(7);
    expect((await receiptOf('evt-1'))?.status).toBe(OutboxStatus.HANDLED);
  });

  it('writes the decrement and the receipt atomically', async () => {
    await seed('oats', 10);
    vi.spyOn(db.outboxReceipts, 'put').mockRejectedValueOnce(new Error('QuotaExceededError'));

    await expect(handler.handle(sale([{ productId: 'oats', quantity: 3 }]))).rejects.toThrow(
      'QuotaExceededError'
    );

    // The receipt write failed, so the decrement rolled back with it.
    expect(await stockOf('oats')).toBe(10);
    expect(await receiptOf('evt-1')).toBeUndefined();
  });

  it('keeps the other decrements and fails terminally when a product is missing', async () => {
    await seed('oats', 10);

    const run = handler.handle(
      sale([
        { productId: 'oats', quantity: 2 },
        { productId: 'ghost', quantity: 1 },
      ])
    );

    await expect(run).rejects.toBeInstanceOf(TerminalHandlerError);
    await expect(run).rejects.toThrow(/ghost/);
    expect(await stockOf('oats')).toBe(8);
    const receipt = await receiptOf('evt-1');
    expect(receipt?.status).toBe(OutboxStatus.DEAD);
    expect(receipt?.lastError).toContain('ghost');
  });

  it('treats a sale that would take stock below zero as terminal', async () => {
    await seed('oats', 1);

    await expect(handler.handle(sale([{ productId: 'oats', quantity: 5 }]))).rejects.toBeInstanceOf(
      TerminalHandlerError
    );
    expect(await stockOf('oats')).toBe(1);
  });

  it('rolls back every decrement on a retryable failure', async () => {
    await seed('oats', 10);
    await seed('hay', 10);
    const update = db.products.update.bind(db.products);
    vi.spyOn(db.products, 'update').mockImplementation(((key, changes) =>
      key === 'hay'
        ? Promise.reject(new Error('DatabaseClosedError'))
        : update(key, changes)) as typeof db.products.update);

    await expect(
      handler.handle(
        sale([
          { productId: 'oats', quantity: 2 },
          { productId: 'hay', quantity: 1 },
        ])
      )
    ).rejects.not.toBeInstanceOf(TerminalHandlerError);

    expect(await stockOf('oats')).toBe(10);
    expect(await receiptOf('evt-1')).toBeUndefined();
  });

  describe('through the dispatcher and the sale outbox', () => {
    const outboxEvent = (items: { productId: string; quantity: number }[]) => ({
      transactionId: 'TXN-1',
      correlationId: 'corr-1',
      payload: {
        transactionId: 'TXN-1',
        items: items.map((item) => ({ ...item, unitPrice: 1 })),
        amount: 1,
        method: 'cash',
        occurredAt: '2026-10-04T10:00:00.000Z',
      },
      appliedInline: [] as string[],
      fallbackInline: [ADJUST_STOCK_ON_SALE_HANDLER],
    });
    const writeRow = () => db.transactions.add({ id: 'TXN-1' } as never);

    it('has taken stock off by the time a recorded sale resolves', async () => {
      await seed('oats', 10);
      const outbox = TestBed.inject(DexieSaleOutboxAdapter);

      expect(await outbox.record(outboxEvent([{ productId: 'oats', quantity: 4 }]), writeRow)).toBe(
        'recorded'
      );

      // No drain, no wait: blocking means the first attempt is already done.
      expect(await stockOf('oats')).toBe(6);
    });

    it('marks the event dead after a terminal failure and never retries it', async () => {
      const outbox = TestBed.inject(DexieSaleOutboxAdapter);
      const handle = vi.spyOn(handler, 'handle');

      await outbox.record(outboxEvent([{ productId: 'ghost', quantity: 1 }]), writeRow);
      await dispatcher.drain();
      await dispatcher.drain();

      const [row] = await db.outbox.toArray();
      expect(row.status).toBe(OutboxStatus.DEAD);
      expect(handle).toHaveBeenCalledTimes(1);
      expect(audit.log).toHaveBeenCalledWith(
        expect.objectContaining({
          entityId: 'TXN-1',
          errorMessage: expect.stringContaining('ghost'),
        })
      );
    });

    it('never decrements twice when a deferred record lands after the inline fallback', async () => {
      await seed('oats', 10);
      const outbox = TestBed.inject(DexieSaleOutboxAdapter);
      const add = db.outbox.add.bind(db.outbox);
      vi.spyOn(db.outbox, 'add')
        .mockRejectedValueOnce(new Error('IndexedDB unavailable'))
        .mockImplementation(((row, key) => add(row, key)) as typeof db.outbox.add);

      const outcome = await outbox.record(
        outboxEvent([{ productId: 'oats', quantity: 4 }]),
        writeRow
      );
      expect(outcome).toBe('deferred');
      // What PosFacade does on 'deferred': take stock off inline.
      await db.products.update('oats', { quantity: 6 });

      await vi.waitFor(async () => expect(await db.outbox.count()).toBe(1));
      await dispatcher.drain();

      expect(await stockOf('oats')).toBe(6);
      const [row] = await db.outbox.toArray();
      expect((await receiptOf(row.id))?.status).toBe(OutboxStatus.HANDLED);
    });
  });
});
