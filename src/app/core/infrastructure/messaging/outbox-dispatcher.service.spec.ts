import { TestBed } from '@angular/core/testing';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { DomainEvent, DomainEventType, OutboxStatus } from '@core/domain/events/domain-event';
import { Permission } from '@core/domain/auth';
import { AngularAuthorizationService } from '@core/application/auth/angular-authorization.service';
import { DexieDatabase } from '@core/infrastructure/database/dexie-database.service';
import { AuditLogService, AuditStatus } from '@core/infrastructure/audit/audit-log.service';
import { ToastService } from '@shared/ui/toast/toast.service';
import {
  DOMAIN_EVENT_OUTBOX,
  EVENT_HANDLERS,
  EventHandler,
  OUTBOX_CLOCK,
  OUTBOX_MAX_ATTEMPTS,
  OutboxDispatcherService,
  RetryLaterError,
  outboxBackoffMs,
} from './outbox-dispatcher.service';

const UPSERTED = DomainEventType.PRODUCT_UPSERTED;

/** A handler whose behaviour each test scripts. */
function scriptedHandler(name: string, blocking = false) {
  const handle = vi.fn<(event: DomainEvent) => Promise<void>>().mockResolvedValue(undefined);
  const handler: EventHandler = { name, eventType: UPSERTED, blocking, handle };
  return { handler, handle };
}

/**
 * Wait for the dispatch `record()` starts on its own. Work is serialized, so a drain
 * queued behind it resolves once it is done — and finds nothing else due, because a
 * failed or deferred event is always rescheduled into the future.
 */
const settle = (outbox: OutboxDispatcherService) => outbox.drain();

describe('OutboxDispatcherService', () => {
  let db: DexieDatabase;
  let clock: number;
  let audit: { log: ReturnType<typeof vi.fn> };
  let toast: { error: ReturnType<typeof vi.fn> };
  let canManage: boolean;

  function setup(handlers: EventHandler[]): OutboxDispatcherService {
    TestBed.configureTestingModule({
      providers: [
        ...handlers.map((h) => ({ provide: EVENT_HANDLERS, useValue: h, multi: true })),
        { provide: OUTBOX_CLOCK, useValue: () => clock },
        { provide: AuditLogService, useValue: audit },
        { provide: ToastService, useValue: toast },
        {
          provide: AngularAuthorizationService,
          useValue: { can: (p: Permission) => p === Permission.MANAGE_INVENTORY && canManage },
        },
      ],
    });
    db = TestBed.inject(DexieDatabase);
    return TestBed.inject(OutboxDispatcherService);
  }

  beforeEach(() => {
    db = undefined as unknown as DexieDatabase;
    clock = 1_000_000;
    audit = { log: vi.fn().mockResolvedValue(undefined) };
    toast = { error: vi.fn() };
    canManage = true;
    vi.spyOn(Math, 'random').mockReturnValue(0);
  });

  afterEach(async () => {
    if (db) {
      TestBed.inject(OutboxDispatcherService).stop();
      await db.delete();
    }
    vi.restoreAllMocks();
    TestBed.resetTestingModule();
  });

  it('is what DOMAIN_EVENT_OUTBOX resolves to', () => {
    const outbox = setup([]);
    expect(TestBed.inject(DOMAIN_EVENT_OUTBOX)).toBe(outbox);
  });

  it('records an event and runs its handler, then marks it handled', async () => {
    const { handler, handle } = scriptedHandler('h');
    const outbox = setup([handler]);

    const id = await outbox.record(UPSERTED, 'p1', { productId: 'p1' });
    await outbox.flush('p1');

    expect(handle).toHaveBeenCalledTimes(1);
    expect(handle.mock.calls[0][0]).toMatchObject({
      id,
      type: UPSERTED,
      aggregateId: 'p1',
      payload: { productId: 'p1' },
    });
    expect((await db.outbox.get(id))?.status).toBe(OutboxStatus.HANDLED);
  });

  it('does not wait for non-blocking handlers before record resolves', async () => {
    let release!: () => void;
    const { handler, handle } = scriptedHandler('slow');
    handle.mockReturnValue(new Promise<void>((r) => (release = r)));
    const outbox = setup([handler]);

    const id = await outbox.record(UPSERTED, 'p1', { productId: 'p1' });
    expect((await db.outbox.get(id))?.status).toBe(OutboxStatus.PENDING);

    release();
    await outbox.flush('p1');
    expect((await db.outbox.get(id))?.status).toBe(OutboxStatus.HANDLED);
  });

  it('waits for blocking handlers before record resolves', async () => {
    const { handler } = scriptedHandler('stock', true);
    const outbox = setup([handler]);

    const id = await outbox.record(UPSERTED, 'p1', { productId: 'p1' });
    expect((await db.outbox.get(id))?.status).toBe(OutboxStatus.HANDLED);
  });

  it('reschedules a throwing handler with backoff and counts the attempt', async () => {
    const { handler, handle } = scriptedHandler('h');
    handle.mockRejectedValue(new Error('HTTP 503'));
    const outbox = setup([handler]);

    const id = await outbox.record(UPSERTED, 'p1', { productId: 'p1' });
    await settle(outbox);

    const row = await db.outbox.get(id);
    expect(row?.status).toBe(OutboxStatus.FAILED);
    expect(row?.attempts).toBe(1);
    expect(row?.nextAttemptAt).toBe(clock + outboxBackoffMs(1, () => 0));
    expect(row?.lastError).toBe('HTTP 503');
  });

  it('drains only events whose retry time has come', async () => {
    const { handler, handle } = scriptedHandler('h');
    handle.mockRejectedValueOnce(new Error('boom'));
    const outbox = setup([handler]);

    await outbox.record(UPSERTED, 'p1', { productId: 'p1' });
    await settle(outbox);
    expect(handle).toHaveBeenCalledTimes(1);

    await outbox.drain();
    expect(handle).toHaveBeenCalledTimes(1); // backoff not yet elapsed

    clock += outboxBackoffMs(1, () => 0);
    await outbox.drain();
    expect(handle).toHaveBeenCalledTimes(2);
  });

  it('never invokes a handler again once its receipt says handled', async () => {
    const ok = scriptedHandler('ok');
    const flaky = scriptedHandler('flaky');
    flaky.handle.mockRejectedValueOnce(new Error('first try fails'));
    const outbox = setup([ok.handler, flaky.handler]);

    const id = await outbox.record(UPSERTED, 'p1', { productId: 'p1' });
    await settle(outbox);
    expect((await db.outbox.get(id))?.status).toBe(OutboxStatus.FAILED);
    await outbox.flush('p1');

    expect(ok.handle).toHaveBeenCalledTimes(1);
    expect(flaky.handle).toHaveBeenCalledTimes(2);
    expect((await db.outbox.get(id))?.status).toBe(OutboxStatus.HANDLED);
  });

  it('parks a RetryLaterError without spending an attempt', async () => {
    const { handler, handle } = scriptedHandler('h');
    handle.mockRejectedValue(new RetryLaterError('Nobody is signed in'));
    const outbox = setup([handler]);

    const id = await outbox.record(UPSERTED, 'p1', { productId: 'p1' });
    for (let i = 0; i < OUTBOX_MAX_ATTEMPTS + 2; i++) {
      await expect(outbox.flush('p1')).rejects.toThrow('Nobody is signed in');
    }

    const row = await db.outbox.get(id);
    expect(row?.status).toBe(OutboxStatus.PENDING);
    expect(row?.attempts).toBe(0);
    expect(row?.nextAttemptAt).toBeGreaterThan(clock);
  });

  it(`marks an event dead after ${OUTBOX_MAX_ATTEMPTS} failures and reports it`, async () => {
    const { handler, handle } = scriptedHandler('h');
    handle.mockRejectedValue(new Error('HTTP 400: bad category'));
    const outbox = setup([handler]);

    const id = await outbox.record(UPSERTED, 'p1', { productId: 'p1' });
    await settle(outbox); // attempt 1
    for (let i = 1; i < OUTBOX_MAX_ATTEMPTS; i++) {
      await expect(outbox.flush('p1')).rejects.toThrow();
    }

    const row = await db.outbox.get(id);
    expect(row?.status).toBe(OutboxStatus.DEAD);
    expect(row?.attempts).toBe(OUTBOX_MAX_ATTEMPTS);
    expect(await outbox.getStatistics()).toMatchObject({ dead: 1, pending: 0, failed: 0 });

    expect(audit.log).toHaveBeenCalledWith(
      expect.objectContaining({
        agentName: 'OutboxDispatcher',
        entityId: 'p1',
        status: AuditStatus.FAILURE,
        errorMessage: 'HTTP 400: bad category',
      })
    );
    expect(toast.error).toHaveBeenCalledTimes(1);

    // Dead is final: no more automatic runs, and later flushes are not failed by it.
    clock += 24 * 60 * 60_000;
    await outbox.drain();
    expect(handle).toHaveBeenCalledTimes(OUTBOX_MAX_ATTEMPTS);
    await expect(outbox.flush('p1')).resolves.toBeUndefined();
  });

  it('does not toast a dead event to someone who cannot manage inventory', async () => {
    canManage = false;
    const { handler, handle } = scriptedHandler('h');
    handle.mockRejectedValue(new Error('nope'));
    const outbox = setup([handler]);

    await outbox.record(UPSERTED, 'p1', { productId: 'p1' });
    for (let i = 0; i < OUTBOX_MAX_ATTEMPTS; i++) {
      await outbox.flush('p1').catch(() => undefined);
    }

    expect(audit.log).toHaveBeenCalled();
    expect(toast.error).not.toHaveBeenCalled();
  });

  it('marks an event with no handlers handled', async () => {
    const outbox = setup([]);
    const id = await outbox.record(DomainEventType.SALE_COMPLETED, 't1', {
      transactionId: 't1',
      items: [],
      amount: 0,
      method: 'cash',
      occurredAt: new Date(clock).toISOString(),
    });
    await outbox.flush('t1');
    expect((await db.outbox.get(id))?.status).toBe(OutboxStatus.HANDLED);
  });

  it('runs work under the cross-tab lock when the Web Locks API exists', async () => {
    const request = vi.fn((_name: string, cb: () => Promise<unknown>) => cb());
    vi.stubGlobal('navigator', { ...navigator, locks: { request } });
    const { handler } = scriptedHandler('h');
    const outbox = setup([handler]);

    await outbox.record(UPSERTED, 'p1', { productId: 'p1' });
    await outbox.flush('p1');

    expect(request).toHaveBeenCalledWith('capy-outbox', expect.any(Function));
    vi.unstubAllGlobals();
  });

  it('caps the backoff at five minutes', () => {
    expect(outboxBackoffMs(0, () => 0)).toBe(1_000);
    expect(outboxBackoffMs(3, () => 0)).toBe(8_000);
    expect(outboxBackoffMs(20, () => 0)).toBe(300_000);
    expect(outboxBackoffMs(20, () => 0.999)).toBeLessThan(360_000);
  });
});
