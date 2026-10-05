import { TestBed } from '@angular/core/testing';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { DomainEvent, DomainEventType, OutboxStatus } from '@core/domain/events/domain-event';
import { Customer, CustomerStatus, CustomerTier } from '@core/domain/entities/customer.entity';
import { AngularAuthorizationService } from '@core/application/auth/angular-authorization.service';
import { DexieDatabase } from '@core/infrastructure/database/dexie-database.service';
import { DexieCustomerRepository } from '@core/infrastructure/repositories/dexie-customer.repository';
import { CUSTOMER_REPOSITORY } from '@core/infrastructure/factories/repository.factory';
import { AuditLogService } from '@core/infrastructure/audit/audit-log.service';
import { EventBusService } from '@core/infrastructure/messaging/event-bus.service';
import { EventType } from '@core/infrastructure/messaging/event-bus.events';
import { ToastService } from '@shared/ui/toast/toast.service';
import {
  EVENT_HANDLERS,
  EventHandler,
  OUTBOX_CLOCK,
  OutboxDispatcherService,
} from '@core/infrastructure/messaging/outbox-dispatcher.service';
import {
  AWARD_LOYALTY_POINTS_HANDLER,
  AwardLoyaltyPointsHandler,
  loyaltyLedgerId,
} from './award-loyalty-points.handler';

type SaleCompleted = DomainEvent<typeof DomainEventType.SALE_COMPLETED>;

/**
 * Integration: real Dexie (fake-indexeddb), the real customer repository, loyalty
 * rules and use case. What #355 promises is what ends up in IndexedDB.
 */
describe('AwardLoyaltyPointsHandler', () => {
  let db: DexieDatabase;
  let handler: AwardLoyaltyPointsHandler;
  let bus: EventBusService;

  function sale(
    overrides: Partial<SaleCompleted['payload']> = {},
    { id = 'evt-1', correlationId = 'corr-1' } = {}
  ): SaleCompleted {
    return {
      id,
      type: DomainEventType.SALE_COMPLETED,
      aggregateId: 'TXN-1',
      payload: {
        transactionId: 'TXN-1',
        items: [{ productId: 'oats', quantity: 1, unitPrice: 40 }],
        amount: 40,
        method: 'cash',
        customerId: 'marco',
        customerTier: CustomerTier.BRONZE,
        occurredAt: '2026-10-04T10:00:00.000Z',
        ...overrides,
      },
      correlationId,
      attempts: 0,
      createdAt: new Date('2026-10-04T10:00:00.000Z'),
    };
  }

  async function seed(
    overrides: { id?: string; status?: CustomerStatus; points?: number; tier?: CustomerTier } = {}
  ) {
    await TestBed.inject(DexieCustomerRepository).create(
      new Customer({
        id: overrides.id ?? 'marco',
        name: 'Marco Rossi',
        email: `${overrides.id ?? 'marco'}@example.com`,
        phone: '+1234567890',
        status: overrides.status ?? CustomerStatus.ACTIVE,
        loyaltyPoints: overrides.points ?? 0,
        tier: overrides.tier ?? CustomerTier.BRONZE,
        loyaltyCode: 'CAPY-B3KMNPQR',
      })
    );
  }

  const pointsOf = async (id = 'marco') => (await db.customers.get(id))?.loyaltyPoints;
  const awardsPublished = () =>
    vi
      .mocked(bus.publish)
      .mock.calls.map(([message]) => message)
      .filter((message) => message.type === EventType.LOYALTY_POINTS_AWARDED);

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [
        { provide: CUSTOMER_REPOSITORY, useExisting: DexieCustomerRepository },
        { provide: OUTBOX_CLOCK, useValue: () => Date.parse('2026-10-04T10:00:00.000Z') },
        { provide: AuditLogService, useValue: { log: vi.fn().mockResolvedValue(undefined) } },
        { provide: ToastService, useValue: { error: vi.fn() } },
        { provide: AngularAuthorizationService, useValue: { can: () => false } },
      ],
    });
    db = TestBed.inject(DexieDatabase);
    handler = TestBed.inject(AwardLoyaltyPointsHandler);
    bus = TestBed.inject(EventBusService);
    vi.spyOn(bus, 'publish');
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    await db.delete();
    TestBed.resetTestingModule();
  });

  it('is a non-blocking SaleCompleted handler', () => {
    expect(handler.eventType).toBe(DomainEventType.SALE_COMPLETED);
    expect((handler as EventHandler).blocking).toBeFalsy();
    expect(handler.name).toBe(AWARD_LOYALTY_POINTS_HANDLER);
  });

  it('awards the points once and leaves a ledger row keyed by the event', async () => {
    await seed();

    await handler.handle(sale());

    expect(await pointsOf()).toBe(400);
    expect(await db.loyaltyTransactions.get(loyaltyLedgerId('evt-1'))).toMatchObject({
      customerId: 'marco',
      transactionId: 'TXN-1',
      points: 400,
      type: 'EARNED',
    });
  });

  it('awards once when the same event is delivered twice', async () => {
    await seed();

    await handler.handle(sale());
    await handler.handle(sale());

    expect(await pointsOf()).toBe(400);
    expect(await db.loyaltyTransactions.count()).toBe(1);
  });

  it('rolls the points back with a failed ledger write, then awards once on replay', async () => {
    await seed();
    vi.spyOn(db.loyaltyTransactions, 'add').mockRejectedValueOnce(new Error('QuotaExceededError'));

    await expect(handler.handle(sale())).rejects.toThrow('QuotaExceededError');
    expect(await pointsOf()).toBe(0);

    await handler.handle(sale());
    await handler.handle(sale());
    expect(await pointsOf()).toBe(400);
  });

  it('prices points at the tier held at the time of sale, not the current one', async () => {
    // Promoted to gold since the sale: a retry must still earn the bronze rate.
    await seed({ tier: CustomerTier.GOLD, points: 6000 });

    await handler.handle(sale({ customerTier: CustomerTier.BRONZE }));

    expect(await pointsOf()).toBe(6400);
  });

  it('falls back to the current tier when the sale carried none', async () => {
    await seed({ tier: CustomerTier.GOLD, points: 6000 });

    await handler.handle(sale({ customerTier: undefined }));

    expect(await pointsOf()).toBe(6600);
  });

  it('throws on award-failed so the dispatcher retries, and writes nothing', async () => {
    await seed();
    vi.spyOn(db.customers, 'update').mockRejectedValueOnce(new Error('DatabaseClosedError'));

    await expect(handler.handle(sale())).rejects.toThrow('DatabaseClosedError');

    expect(await pointsOf()).toBe(0);
    expect(await db.loyaltyTransactions.count()).toBe(0);
    expect(awardsPublished()).toHaveLength(0);
  });

  it.each([
    ['customer-not-found', async () => undefined, sale({ customerId: 'nobody' })],
    ['customer-blocked', () => seed({ status: CustomerStatus.BLOCKED }), sale()],
    ['below-minimum-spend', () => seed(), sale({ amount: 0.5 })],
    ['invalid-amount', () => seed(), sale({ amount: -3 })],
  ])('treats %s as handled: no write, no retry', async (_reason, arrange, event) => {
    await arrange();

    await expect(handler.handle(event)).resolves.toBeUndefined();

    expect(await db.loyaltyTransactions.count()).toBe(0);
    expect(awardsPublished()).toHaveLength(0);
  });

  it('writes nothing for an anonymous sale', async () => {
    await seed();

    await handler.handle(sale({ customerId: undefined, customerTier: undefined }));

    expect(await pointsOf()).toBe(0);
    expect(await db.loyaltyTransactions.count()).toBe(0);
  });

  it('publishes the award once, with the correlation id, and not on a replay', async () => {
    await seed();

    await handler.handle(sale());
    await handler.handle(sale());

    const published = awardsPublished();
    expect(published).toHaveLength(1);
    expect(published[0]).toMatchObject({
      correlationId: 'corr-1',
      payload: { customerId: 'marco', points: 400, balance: 400, promoted: false },
    });
  });

  it('runs through the dispatcher without blocking and ends handled', async () => {
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      providers: [
        { provide: CUSTOMER_REPOSITORY, useExisting: DexieCustomerRepository },
        { provide: EVENT_HANDLERS, useExisting: AwardLoyaltyPointsHandler, multi: true },
        { provide: OUTBOX_CLOCK, useValue: () => Date.parse('2026-10-04T10:00:00.000Z') },
        { provide: AuditLogService, useValue: { log: vi.fn().mockResolvedValue(undefined) } },
        { provide: ToastService, useValue: { error: vi.fn() } },
        { provide: AngularAuthorizationService, useValue: { can: () => false } },
      ],
    });
    db = TestBed.inject(DexieDatabase);
    const dispatcher = TestBed.inject(OutboxDispatcherService);
    await seed();

    const id = await dispatcher.record(DomainEventType.SALE_COMPLETED, 'TXN-1', sale().payload);
    await dispatcher.drain();

    expect(await pointsOf()).toBe(400);
    expect((await db.outbox.get(id))?.status).toBe(OutboxStatus.HANDLED);
    expect((await db.outboxReceipts.get([id, AWARD_LOYALTY_POINTS_HANDLER]))?.status).toBe(
      OutboxStatus.HANDLED
    );
    dispatcher.stop();
  });
});
