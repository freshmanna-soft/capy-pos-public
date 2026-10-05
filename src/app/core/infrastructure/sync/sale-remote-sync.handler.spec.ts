import { TestBed } from '@angular/core/testing';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { signal } from '@angular/core';
import { DomainEvent, DomainEventType, OutboxStatus } from '@core/domain/events/domain-event';
import { AngularAuthorizationService } from '@core/application/auth/angular-authorization.service';
import { DexieDatabase } from '@core/infrastructure/database/dexie-database.service';
import { AuditLogService } from '@core/infrastructure/audit/audit-log.service';
import { ToastService } from '@shared/ui/toast/toast.service';
import {
  EVENT_HANDLERS,
  OUTBOX_CLOCK,
  OutboxDispatcherService,
  RetryLaterError,
  TerminalHandlerError,
} from '@core/infrastructure/messaging/outbox-dispatcher.service';
import { SALE_REMOTE_SYNC_HANDLER, SaleRemoteSyncHandler } from './sale-remote-sync.handler';
import { EventPushOutcome, SyncService } from './sync.service';
import { SyncSessionCredentialService } from './sync-session-credential.service';

type SaleCompleted = DomainEvent<typeof DomainEventType.SALE_COMPLETED>;

const PAYLOAD = {
  transactionId: 'TXN-1',
  items: [{ productId: 'oats', quantity: 2, unitPrice: 2 }],
  amount: 4,
  method: 'cash',
  occurredAt: '2026-10-05T10:00:00.000Z',
};

function sale(): SaleCompleted {
  return {
    id: 'evt-1',
    type: DomainEventType.SALE_COMPLETED,
    aggregateId: 'TXN-1',
    payload: PAYLOAD,
    correlationId: 'corr-1',
    attempts: 0,
    createdAt: new Date('2026-10-05T10:00:00.000Z'),
  };
}

const acked = (status: string, eventId = 'evt-1'): EventPushOutcome => ({
  ok: true,
  results: [{ eventId, status: status as never }],
});

/** pos-api's answer for whichever event it was sent, as the real endpoint does. */
const echo =
  (status: string) =>
  async (events: { eventId: string }[]): Promise<EventPushOutcome> =>
    acked(status, events[0].eventId);

describe('SaleRemoteSyncHandler', () => {
  let sync: { isRunning: ReturnType<typeof vi.fn>; pushEventsAsync: ReturnType<typeof vi.fn> };
  let token: ReturnType<typeof signal<string>>;
  let audit: { log: ReturnType<typeof vi.fn> };
  let clock: number;
  /** Set only by tests that build the real dispatcher, so teardown touches nothing else. */
  let dispatcherTest: { db: DexieDatabase; dispatcher: OutboxDispatcherService } | null;

  function setup(withDispatcher = false) {
    TestBed.configureTestingModule({
      providers: [
        { provide: SyncService, useValue: sync },
        { provide: SyncSessionCredentialService, useValue: { token } },
        ...(withDispatcher
          ? [
              { provide: EVENT_HANDLERS, useExisting: SaleRemoteSyncHandler, multi: true },
              { provide: OUTBOX_CLOCK, useValue: () => clock },
              { provide: AuditLogService, useValue: audit },
              { provide: ToastService, useValue: { error: vi.fn() } },
              { provide: AngularAuthorizationService, useValue: { can: () => true } },
            ]
          : []),
      ],
    });
    return TestBed.inject(SaleRemoteSyncHandler);
  }

  beforeEach(() => {
    sync = {
      isRunning: vi.fn().mockReturnValue(true),
      pushEventsAsync: vi.fn(echo('applied')),
    };
    token = signal('header.payload.signature');
    audit = { log: vi.fn().mockResolvedValue(undefined) };
    clock = Date.parse('2026-10-05T10:00:00.000Z');
    dispatcherTest = null;
    vi.spyOn(Math, 'random').mockReturnValue(0);
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    if (dispatcherTest) {
      dispatcherTest.dispatcher.stop();
      await dispatcherTest.db.delete();
    }
    TestBed.resetTestingModule();
  });

  it('is a non-blocking SaleCompleted handler with a stable name', () => {
    const handler = setup();
    expect(handler.name).toBe(SALE_REMOTE_SYNC_HANDLER);
    expect(handler.eventType).toBe(DomainEventType.SALE_COMPLETED);
    expect((handler as { blocking?: boolean }).blocking).toBeFalsy();
  });

  it('sends the event as POST /api/events takes it', async () => {
    await setup().handle(sale());

    expect(sync.pushEventsAsync).toHaveBeenCalledWith([
      { eventId: 'evt-1', type: 'sale.completed', correlationId: 'corr-1', payload: PAYLOAD },
    ]);
  });

  it.each(['applied', 'duplicate'])('treats %s as delivered', async (status) => {
    sync.pushEventsAsync.mockResolvedValue(acked(status));
    await expect(setup().handle(sale())).resolves.toBeUndefined();
  });

  it.each(['rejected', 'conflict'])('gives up on %s for good', async (status) => {
    sync.pushEventsAsync.mockResolvedValue(acked(status));
    await expect(setup().handle(sale())).rejects.toBeInstanceOf(TerminalHandlerError);
  });

  it('retries when pos-api asks for a resend, or a request fails', async () => {
    sync.pushEventsAsync.mockResolvedValueOnce(acked('retry'));
    const handler = setup();
    await expect(handler.handle(sale())).rejects.not.toBeInstanceOf(RetryLaterError);

    sync.pushEventsAsync.mockResolvedValueOnce({ ok: false, retryLater: false, error: 'HTTP 400' });
    const failed = handler.handle(sale());
    await expect(failed).rejects.toThrow('HTTP 400');
    await expect(failed).rejects.not.toBeInstanceOf(TerminalHandlerError);
  });

  it('parks the event when the worker says to try later (401, 404, timeout)', async () => {
    sync.pushEventsAsync.mockResolvedValue({ ok: false, retryLater: true, error: '401' });
    await expect(setup().handle(sale())).rejects.toBeInstanceOf(RetryLaterError);
  });

  it('treats an answer without a verdict for this event as a retry', async () => {
    sync.pushEventsAsync.mockResolvedValue(acked('applied', 'someone-else'));
    const run = setup().handle(sale());
    await expect(run).rejects.toThrow(/without a verdict/);
  });

  it.each([
    ['the worker is not running', () => sync.isRunning.mockReturnValue(false)],
    ['nobody is signed in', () => token.set('')],
    ['the browser is offline', () => vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false)],
  ])('parks the event without sending when %s', async (_reason, arrange) => {
    arrange();
    await expect(setup().handle(sale())).rejects.toBeInstanceOf(RetryLaterError);
    expect(sync.pushEventsAsync).not.toHaveBeenCalled();
  });

  describe('through the outbox dispatcher', () => {
    async function recordSale() {
      if (!sync.pushEventsAsync.getMockImplementation()) {
        sync.pushEventsAsync.mockImplementation(echo('applied'));
      }
      setup(true);
      const dispatcher = TestBed.inject(OutboxDispatcherService);
      const id = await dispatcher.record(DomainEventType.SALE_COMPLETED, 'TXN-1', PAYLOAD);
      await dispatcher.drain();
      const db = TestBed.inject(DexieDatabase);
      dispatcherTest = { db, dispatcher };
      return { id, dispatcher, db };
    }

    it('marks the event delivered only after the server acks it', async () => {
      const { id, db } = await recordSale();

      expect((await db.outbox.get(id))?.status).toBe(OutboxStatus.HANDLED);
      expect((await db.outboxReceipts.get([id, SALE_REMOTE_SYNC_HANDLER]))?.status).toBe(
        OutboxStatus.HANDLED
      );
    });

    it('resends after an unacknowledged attempt, and a duplicate verdict completes it', async () => {
      sync.pushEventsAsync
        .mockResolvedValueOnce({ ok: false, retryLater: false, error: 'connection reset' })
        .mockImplementationOnce(echo('duplicate'));

      const { id, dispatcher, db } = await recordSale();
      expect((await db.outbox.get(id))?.status).toBe(OutboxStatus.FAILED);

      clock += 10 * 60_000;
      await dispatcher.drain();

      expect(sync.pushEventsAsync).toHaveBeenCalledTimes(2);
      expect((await db.outbox.get(id))?.status).toBe(OutboxStatus.HANDLED);
    });

    it('sends a rejected event to dead and reports it, never retrying it', async () => {
      sync.pushEventsAsync.mockImplementation(echo('rejected'));

      const { id, dispatcher, db } = await recordSale();
      clock += 10 * 60_000;
      await dispatcher.drain();

      expect((await db.outbox.get(id))?.status).toBe(OutboxStatus.DEAD);
      expect(sync.pushEventsAsync).toHaveBeenCalledTimes(1);
      expect(audit.log).toHaveBeenCalledWith(expect.objectContaining({ entityId: 'TXN-1' }));
    });
  });
});
