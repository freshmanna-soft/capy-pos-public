import { TestBed } from '@angular/core/testing';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import Dexie from 'dexie';
import { DomainEvent, DomainEventType, OutboxStatus } from '@core/domain/events/domain-event';
import { AngularAuthorizationService } from '@core/application/auth/angular-authorization.service';
import { DexieDatabase } from '@core/infrastructure/database/dexie-database.service';
import { AuditLogService } from '@core/infrastructure/audit/audit-log.service';
import { TelemetryService } from '@core/infrastructure/telemetry/telemetry.service';
import { ToastService } from '@shared/ui/toast/toast.service';
import {
  EVENT_HANDLERS,
  OUTBOX_CLOCK,
  OUTBOX_MAX_ATTEMPTS,
  OutboxDispatcherService,
} from '@core/infrastructure/messaging/outbox-dispatcher.service';
import { AUDIT_SALE_HANDLER, AuditSaleHandler, saleAuditId } from './audit-sale.handler';
import {
  TELEMETRY_IN_FLIGHT,
  TELEMETRY_SALE_HANDLER,
  TelemetrySaleHandler,
} from './telemetry-sale.handler';

type SaleCompleted = DomainEvent<typeof DomainEventType.SALE_COMPLETED>;

function sale(id = 'evt-1'): SaleCompleted {
  return {
    id,
    type: DomainEventType.SALE_COMPLETED,
    aggregateId: 'TXN-1',
    payload: {
      transactionId: 'TXN-1',
      items: [{ productId: 'oats', quantity: 1, unitPrice: 12.5 }],
      amount: 12.5,
      method: 'card',
      occurredAt: '2026-10-05T10:00:00.000Z',
    },
    correlationId: 'corr-1',
    attempts: 0,
    createdAt: new Date('2026-10-05T10:00:00.000Z'),
  };
}

describe('AuditSaleHandler (real AuditLogService on fake-indexeddb)', () => {
  let audit: AuditLogService;
  let handler: AuditSaleHandler;

  beforeEach(() => {
    TestBed.configureTestingModule({});
    audit = TestBed.inject(AuditLogService);
    handler = TestBed.inject(AuditSaleHandler);
    vi.spyOn(console, 'log').mockImplementation(() => undefined);
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    TestBed.resetTestingModule();
    await Dexie.delete('AuditLogDatabase');
  });

  const rowsFor = async (transactionId: string) =>
    (await audit.query({ entityId: transactionId })).filter(
      (row) => row.entityId === transactionId
    );

  it('writes one audit row keyed by the event, with the correlation id', async () => {
    await handler.handle(sale());

    const row = await audit.getById(saleAuditId('evt-1'));
    expect(row).toMatchObject({
      agentName: 'PaymentAgent',
      operation: 'processPayment',
      entityType: 'Transaction',
      entityId: 'TXN-1',
      metadata: { method: 'card', amount: 12.5, correlationId: 'corr-1' },
    });
  });

  it('creates no second row when the event is re-delivered', async () => {
    await handler.handle(sale());
    await handler.handle(sale());

    expect(await rowsFor('TXN-1')).toHaveLength(1);
  });

  it('throws when the write fails, so the dispatcher retries', async () => {
    const db = (audit as unknown as { db: { auditLogs: { put: () => Promise<never> } } }).db;
    vi.spyOn(db.auditLogs, 'put').mockRejectedValueOnce(new Error('QuotaExceededError'));

    await expect(handler.handle(sale())).rejects.toThrow('QuotaExceededError');
  });

  it('keeps unkeyed log() calls swallowing failures, as before', async () => {
    const db = (audit as unknown as { db: { auditLogs: { add: () => Promise<never> } } }).db;
    vi.spyOn(db.auditLogs, 'add').mockRejectedValueOnce(new Error('QuotaExceededError'));
    vi.spyOn(console, 'error').mockImplementation(() => undefined);

    await expect(
      audit.log({
        agentName: 'X',
        operation: 'y',
        entityType: 'Z',
        entityId: 'z-1',
        action: 'execute' as never,
        status: 'success' as never,
      })
    ).resolves.toBeUndefined();
  });
});

describe('TelemetrySaleHandler (resilient but controlled)', () => {
  let db: DexieDatabase;
  let handler: TelemetrySaleHandler;
  let telemetry: { recordCounter: ReturnType<typeof vi.fn>; recordGauge: ReturnType<typeof vi.fn> };

  beforeEach(() => {
    telemetry = { recordCounter: vi.fn(), recordGauge: vi.fn() };
    TestBed.configureTestingModule({
      providers: [
        { provide: TelemetryService, useValue: telemetry },
        { provide: OUTBOX_CLOCK, useValue: () => Date.parse('2026-10-05T10:00:00.000Z') },
      ],
    });
    db = TestBed.inject(DexieDatabase);
    handler = TestBed.inject(TelemetrySaleHandler);
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    await db.delete();
    TestBed.resetTestingModule();
  });

  const receipt = (eventId = 'evt-1') => db.outboxReceipts.get([eventId, TELEMETRY_SALE_HANDLER]);

  it('records the payment metrics', async () => {
    await handler.handle(sale());

    expect(telemetry.recordCounter).toHaveBeenCalledWith('payments.processed', 1, {
      method: 'card',
    });
    expect(telemetry.recordGauge).toHaveBeenCalledWith('payment.amount', 12.5, {
      method: 'card',
    });
  });

  it('marks the receipt in flight before recording', async () => {
    let markAtRecordTime: Promise<unknown> | null = null;
    telemetry.recordGauge.mockImplementation(() => {
      markAtRecordTime = receipt();
    });

    await handler.handle(sale());

    expect(await markAtRecordTime).toMatchObject({
      status: OutboxStatus.PENDING,
      lastError: TELEMETRY_IN_FLIGHT,
    });
  });

  it('records nothing when the mark cannot be written', async () => {
    vi.spyOn(db.outboxReceipts, 'put').mockRejectedValueOnce(new Error('QuotaExceededError'));

    await expect(handler.handle(sale())).rejects.toThrow('QuotaExceededError');

    expect(telemetry.recordGauge).not.toHaveBeenCalled();
    expect(telemetry.recordCounter).not.toHaveBeenCalled();
  });

  it('throws a recording failure so the dispatcher can retry it', async () => {
    telemetry.recordCounter.mockImplementationOnce(() => {
      throw new Error('exporter down');
    });

    await expect(handler.handle(sale())).rejects.toThrow('exporter down');
  });

  it('skips an event a previous run died recording, rather than risk counting it twice', async () => {
    await db.outboxReceipts.put({
      eventId: 'evt-1',
      handler: TELEMETRY_SALE_HANDLER,
      status: OutboxStatus.PENDING,
      nextAttemptAt: 0,
      lastError: TELEMETRY_IN_FLIGHT,
      updatedAt: new Date(),
    });

    await handler.handle(sale());

    expect(telemetry.recordCounter).not.toHaveBeenCalled();
  });

  it('records once when the event is re-delivered after success', async () => {
    await handler.handle(sale());
    await db.outboxReceipts.put({
      eventId: 'evt-1',
      handler: TELEMETRY_SALE_HANDLER,
      status: OutboxStatus.HANDLED,
      nextAttemptAt: 0,
      updatedAt: new Date(),
    });
    await handler.handle(sale());

    expect(telemetry.recordCounter).toHaveBeenCalledTimes(1);
  });
});

describe('TelemetrySaleHandler through the dispatcher', () => {
  let db: DexieDatabase;
  let dispatcher: OutboxDispatcherService;
  let clock: number;
  let telemetry: { recordCounter: ReturnType<typeof vi.fn>; recordGauge: ReturnType<typeof vi.fn> };

  beforeEach(() => {
    clock = Date.parse('2026-10-05T10:00:00.000Z');
    telemetry = { recordCounter: vi.fn(), recordGauge: vi.fn() };
    vi.spyOn(Math, 'random').mockReturnValue(0);
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    TestBed.configureTestingModule({
      providers: [
        { provide: EVENT_HANDLERS, useExisting: TelemetrySaleHandler, multi: true },
        { provide: TelemetryService, useValue: telemetry },
        { provide: OUTBOX_CLOCK, useValue: () => clock },
        { provide: AuditLogService, useValue: { log: vi.fn().mockResolvedValue(undefined) } },
        { provide: ToastService, useValue: { error: vi.fn() } },
        { provide: AngularAuthorizationService, useValue: { can: () => false } },
      ],
    });
    db = TestBed.inject(DexieDatabase);
    dispatcher = TestBed.inject(OutboxDispatcherService);
  });

  afterEach(async () => {
    dispatcher.stop();
    vi.restoreAllMocks();
    await db.delete();
    TestBed.resetTestingModule();
  });

  /** Run the next retry: jump past the longest backoff and drain. */
  async function retry() {
    clock += 10 * 60_000;
    await dispatcher.drain();
  }

  it('retries a failed recording and counts the sale exactly once', async () => {
    telemetry.recordCounter
      .mockImplementationOnce(() => {
        throw new Error('exporter down');
      })
      .mockImplementationOnce(() => {
        throw new Error('exporter down');
      });

    const id = await dispatcher.record(DomainEventType.SALE_COMPLETED, 'TXN-1', sale().payload);
    await dispatcher.drain();
    expect((await db.outbox.get(id))?.status).toBe(OutboxStatus.FAILED);
    await retry();
    await retry();

    expect((await db.outbox.get(id))?.status).toBe(OutboxStatus.HANDLED);
    // Three attempts, but only the last one's counter landed.
    const landed = telemetry.recordCounter.mock.results.filter((r) => r.type === 'return');
    expect(landed).toHaveLength(1);
    await retry();
    expect(telemetry.recordCounter).toHaveBeenCalledTimes(3);
  });

  it('never double-counts when the gauge fails after nothing was counted', async () => {
    telemetry.recordGauge.mockImplementationOnce(() => {
      throw new Error('exporter down');
    });

    const id = await dispatcher.record(DomainEventType.SALE_COMPLETED, 'TXN-1', sale().payload);
    await dispatcher.drain();
    await retry();

    expect((await db.outbox.get(id))?.status).toBe(OutboxStatus.HANDLED);
    expect(telemetry.recordCounter).toHaveBeenCalledTimes(1);
  });

  it(`gives up after ${OUTBOX_MAX_ATTEMPTS} attempts instead of retrying forever`, async () => {
    telemetry.recordCounter.mockImplementation(() => {
      throw new Error('exporter down');
    });

    const id = await dispatcher.record(DomainEventType.SALE_COMPLETED, 'TXN-1', sale().payload);
    await dispatcher.drain();
    for (let i = 0; i < OUTBOX_MAX_ATTEMPTS + 2; i += 1) await retry();

    expect((await db.outbox.get(id))?.status).toBe(OutboxStatus.DEAD);
    expect(telemetry.recordCounter).toHaveBeenCalledTimes(OUTBOX_MAX_ATTEMPTS);
  });
});

describe('observability handlers through the dispatcher', () => {
  it('both run for a recorded sale and the event ends handled', async () => {
    const telemetry = { recordCounter: vi.fn(), recordGauge: vi.fn() };
    vi.spyOn(console, 'log').mockImplementation(() => undefined);
    TestBed.configureTestingModule({
      providers: [
        { provide: EVENT_HANDLERS, useExisting: AuditSaleHandler, multi: true },
        { provide: EVENT_HANDLERS, useExisting: TelemetrySaleHandler, multi: true },
        { provide: TelemetryService, useValue: telemetry },
        { provide: OUTBOX_CLOCK, useValue: () => Date.parse('2026-10-05T10:00:00.000Z') },
        { provide: ToastService, useValue: { error: vi.fn() } },
        { provide: AngularAuthorizationService, useValue: { can: () => false } },
      ],
    });
    const db = TestBed.inject(DexieDatabase);
    const dispatcher = TestBed.inject(OutboxDispatcherService);
    const audit = TestBed.inject(AuditLogService);

    const id = await dispatcher.record(DomainEventType.SALE_COMPLETED, 'TXN-1', sale().payload);
    await dispatcher.drain();

    expect((await db.outbox.get(id))?.status).toBe(OutboxStatus.HANDLED);
    expect(await audit.getById(saleAuditId(id))).not.toBeNull();
    expect(telemetry.recordCounter).toHaveBeenCalledTimes(1);
    expect((await db.outboxReceipts.get([id, AUDIT_SALE_HANDLER]))?.status).toBe(
      OutboxStatus.HANDLED
    );

    dispatcher.stop();
    vi.restoreAllMocks();
    await db.delete();
    await Dexie.delete('AuditLogDatabase');
    TestBed.resetTestingModule();
  });
});
