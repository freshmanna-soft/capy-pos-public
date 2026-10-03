import { Injectable, InjectionToken, OnDestroy, inject } from '@angular/core';
import Dexie from 'dexie';
import {
  DomainEvent,
  DomainEventPayloadMap,
  DomainEventType,
  OutboxStatus,
} from '@core/domain/events/domain-event';
import { IDomainEventOutbox } from '@core/domain/interfaces/domain-event-outbox.interface';
import { generateUUID } from '@core/domain/utils/uuid';
import { Permission } from '@core/domain/auth';
import { AngularAuthorizationService } from '@core/application/auth/angular-authorization.service';
import {
  DexieDatabase,
  IOutboxEventDB,
} from '@core/infrastructure/database/dexie-database.service';
import {
  AuditAction,
  AuditLogService,
  AuditStatus,
} from '@core/infrastructure/audit/audit-log.service';
import { ToastService } from '@shared/ui/toast/toast.service';

/**
 * Something that reacts to one type of domain event (Epic #349, #353).
 *
 * `handle` must be idempotent: a crash between the side effect and its receipt being
 * written runs it again. It must also never await `IDomainEventOutbox.record` — the
 * dispatcher runs one batch at a time, so a handler waiting on another dispatch waits
 * on itself.
 */
export interface EventHandler<K extends DomainEventType = DomainEventType> {
  /** Stable across releases: it is the receipt key. Renaming re-runs every old event. */
  readonly name: string;
  readonly eventType: K;
  /** When true, `record` resolves only after this handler has run once. */
  readonly blocking?: boolean;
  handle(event: DomainEvent<K>): Promise<void>;
}

export const EVENT_HANDLERS = new InjectionToken<EventHandler[]>('EVENT_HANDLERS');

/** Injectable clock so backoff can be tested without waiting minutes. */
export const OUTBOX_CLOCK = new InjectionToken<() => number>('OUTBOX_CLOCK', {
  providedIn: 'root',
  factory: () => () => Date.now(),
});

/**
 * The outbox as the application layer sees it. A factory rather than a provider entry
 * so every injector — including a TestBed that never heard of the outbox — gets one.
 */
export const DOMAIN_EVENT_OUTBOX = new InjectionToken<IDomainEventOutbox>('DOMAIN_EVENT_OUTBOX', {
  providedIn: 'root',
  factory: () => inject(OutboxDispatcherService),
});

/**
 * Thrown by a handler that cannot run *yet* — offline, nobody signed in, the sync
 * worker not started. The event is retried later without spending an attempt, so a
 * till left signed out over lunch does not wake up to a pile of dead events.
 */
export class RetryLaterError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'RetryLaterError';
  }
}

export const OUTBOX_MAX_ATTEMPTS = 10;
export const OUTBOX_DRAIN_INTERVAL_MS = 30_000;
/** How long a RetryLaterError parks an event. Matches the drain interval. */
const DEFER_DELAY_MS = OUTBOX_DRAIN_INTERVAL_MS;
const BACKOFF_BASE_MS = 1_000;
const BACKOFF_CAP_MS = 5 * 60_000;
const LOCK_NAME = 'capy-outbox';

/** `min(1s·2^n, 5min)` plus up to 20% jitter, so tabs that failed together don't retry together. */
export function outboxBackoffMs(attempts: number, random: () => number = Math.random): number {
  const base = Math.min(BACKOFF_BASE_MS * 2 ** attempts, BACKOFF_CAP_MS);
  return base + Math.floor(random() * base * 0.2);
}

export interface OutboxStatistics {
  pending: number;
  failed: number;
  handled: number;
  dead: number;
}

/** Statuses a drain or flush still has work for. */
const UNFINISHED: readonly OutboxStatus[] = [OutboxStatus.PENDING, OutboxStatus.FAILED];

/**
 * Runs outbox events through their handlers until each one succeeds or gives up.
 *
 * Triggers: right after `record`, at startup (`start`), when the browser comes back
 * online, and every 30s. Work is serialized within the tab and, where the Web Locks
 * API exists, across tabs, so two open tills never push the same event twice at once.
 */
@Injectable({ providedIn: 'root' })
export class OutboxDispatcherService implements IDomainEventOutbox, OnDestroy {
  private readonly db = inject(DexieDatabase);
  private readonly handlers = inject(EVENT_HANDLERS, { optional: true }) ?? [];
  private readonly now = inject(OUTBOX_CLOCK);
  private readonly auditLog = inject(AuditLogService);
  private readonly toast = inject(ToastService);
  private readonly authz = inject(AngularAuthorizationService);

  /** Tail of the in-tab work queue. Never rejects, so one failed batch can't wedge it. */
  private queue: Promise<unknown> = Promise.resolve();
  private interval: ReturnType<typeof setInterval> | null = null;
  private readonly onOnline = (): void => void this.drain();

  /** Begin the background triggers and drain whatever a previous session left. */
  start(): void {
    if (this.interval !== null) return;
    this.interval = setInterval(() => void this.drain(), OUTBOX_DRAIN_INTERVAL_MS);
    if (typeof window !== 'undefined') {
      window.addEventListener('online', this.onOnline);
    }
    void this.drain();
  }

  stop(): void {
    if (this.interval !== null) {
      clearInterval(this.interval);
      this.interval = null;
    }
    if (typeof window !== 'undefined') {
      window.removeEventListener('online', this.onOnline);
    }
  }

  ngOnDestroy(): void {
    this.stop();
  }

  async record<K extends DomainEventType>(
    type: K,
    aggregateId: string,
    payload: DomainEventPayloadMap[K]
  ): Promise<string> {
    const at = new Date(this.now());
    const row: IOutboxEventDB = {
      id: generateUUID(),
      type,
      aggregateId,
      payload: JSON.stringify(payload),
      status: OutboxStatus.PENDING,
      attempts: 0,
      nextAttemptAt: at.getTime(),
      createdAt: at,
      updatedAt: at,
    };
    await this.db.outbox.add(row);

    const dispatched = this.serialize(() => this.process(row.id));
    if (this.handlersFor(type).some((h) => h.blocking)) {
      await dispatched;
    } else {
      dispatched.catch((error) => console.warn('[Outbox] Dispatch after record failed:', error));
    }
    return row.id;
  }

  async flush(aggregateId: string): Promise<void> {
    // Judged only on the events this flush ran: an event that died weeks ago has been
    // reported already and must not fail every later flush of the same aggregate.
    const ids = await this.serialize(async () => {
      const rows = await this.unfinishedFor(aggregateId);
      for (const row of rows) await this.process(row.id);
      return rows.map((row) => row.id);
    });

    const after = await this.db.outbox.bulkGet(ids);
    const stuck = after.find((row) => row !== undefined && row.status !== OutboxStatus.HANDLED);
    if (stuck) {
      throw new Error(stuck.lastError ?? `Event ${stuck.id} has not been handled yet.`);
    }
  }

  /** Process every event whose retry time has come. Never throws. */
  async drain(): Promise<void> {
    try {
      await this.serialize(async () => {
        const now = this.now();
        for (const status of UNFINISHED) {
          const due = await this.db.outbox
            .where('[status+nextAttemptAt]')
            .between([status, Dexie.minKey], [status, now], true, true)
            .toArray();
          for (const row of due) await this.process(row.id);
        }
      });
    } catch (error) {
      console.warn('[Outbox] Drain failed:', error);
    }
  }

  async getStatistics(): Promise<OutboxStatistics> {
    const count = (status: OutboxStatus) => this.db.outbox.where('status').equals(status).count();
    const [pending, failed, handled, dead] = await Promise.all([
      count(OutboxStatus.PENDING),
      count(OutboxStatus.FAILED),
      count(OutboxStatus.HANDLED),
      count(OutboxStatus.DEAD),
    ]);
    return { pending, failed, handled, dead };
  }

  // ─── Private ─────────────────────────────────────────────────────────────

  private handlersFor(type: string): EventHandler[] {
    return this.handlers.filter((h) => h.eventType === type);
  }

  private unfinishedFor(aggregateId: string): Promise<IOutboxEventDB[]> {
    return this.db.outbox
      .where('aggregateId')
      .equals(aggregateId)
      .filter((row) => UNFINISHED.includes(row.status))
      .sortBy('createdAt');
  }

  /** Queue work behind whatever this tab is already doing, under the cross-tab lock. */
  private serialize<T>(work: () => Promise<T>): Promise<T> {
    const locks = typeof navigator !== 'undefined' ? navigator.locks : undefined;
    const run = (): Promise<T> => (locks ? (locks.request(LOCK_NAME, work) as Promise<T>) : work());
    const next = this.queue.then(run);
    this.queue = next.catch(() => undefined);
    return next;
  }

  /**
   * Run every handler that has no `handled` receipt for this event yet, writing a
   * receipt for each. Returns the last real failure and the last deferral, if any.
   */
  private async runHandlers(
    row: IOutboxEventDB
  ): Promise<{ failure: Error | null; deferral: RetryLaterError | null }> {
    const event: DomainEvent = {
      id: row.id,
      type: row.type as DomainEventType,
      aggregateId: row.aggregateId,
      payload: JSON.parse(row.payload),
      attempts: row.attempts,
      createdAt: row.createdAt,
    };

    let failure: Error | null = null;
    let deferral: RetryLaterError | null = null;

    for (const handler of this.handlersFor(row.type)) {
      const receipt = await this.db.outboxReceipts.get([row.id, handler.name]);
      if (receipt?.status === OutboxStatus.HANDLED) continue;

      const base = { eventId: row.id, handler: handler.name, nextAttemptAt: 0 };
      try {
        await handler.handle(event);
        await this.db.outboxReceipts.put({
          ...base,
          status: OutboxStatus.HANDLED,
          updatedAt: new Date(this.now()),
        });
      } catch (error) {
        const err = error instanceof Error ? error : new Error(String(error));
        if (err instanceof RetryLaterError) deferral = err;
        else failure = err;
        await this.db.outboxReceipts.put({
          ...base,
          status: OutboxStatus.FAILED,
          lastError: `${handler.name}: ${err.message}`,
          updatedAt: new Date(this.now()),
        });
      }
    }

    return { failure, deferral };
  }

  /**
   * Run one event's outstanding handlers and record what happened.
   *
   * Re-reads the row first: it may have been finished by another tab, or by an
   * earlier trigger in this one, since the caller looked.
   */
  private async process(eventId: string): Promise<void> {
    const row = await this.db.outbox.get(eventId);
    if (!row || !UNFINISHED.includes(row.status)) return;

    const { failure, deferral } = await this.runHandlers(row);
    const now = this.now();
    const updatedAt = new Date(now);

    if (!failure && !deferral) {
      await this.db.outbox.update(row.id, {
        status: OutboxStatus.HANDLED,
        lastError: undefined,
        updatedAt,
      });
      return;
    }

    if (!failure && deferral) {
      await this.db.outbox.update(row.id, {
        nextAttemptAt: now + DEFER_DELAY_MS,
        lastError: deferral.message,
        updatedAt,
      });
      return;
    }

    const attempts = row.attempts + 1;
    const lastError = (failure as Error).message;
    if (attempts >= OUTBOX_MAX_ATTEMPTS) {
      await this.db.outbox.update(row.id, {
        status: OutboxStatus.DEAD,
        attempts,
        lastError,
        updatedAt,
      });
      await this.reportDead(row, attempts, lastError);
      return;
    }

    await this.db.outbox.update(row.id, {
      status: OutboxStatus.FAILED,
      attempts,
      nextAttemptAt: now + outboxBackoffMs(attempts),
      lastError,
      updatedAt,
    });
  }

  /**
   * A dead event is a change that will never reach the server on its own. It goes to
   * the audit log, which the agent monitor lists, and to a toast for whoever can fix
   * it (Epic #349, open question 6). Cashiers are not interrupted with it.
   */
  private async reportDead(row: IOutboxEventDB, attempts: number, lastError: string) {
    console.error(
      `[Outbox] Event ${row.id} (${row.type}) is dead after ${attempts} attempts:`,
      lastError
    );

    await this.auditLog.log({
      agentName: 'OutboxDispatcher',
      operation: `handle ${row.type}`,
      entityType: 'DomainEvent',
      entityId: row.aggregateId,
      action: AuditAction.EXECUTE,
      status: AuditStatus.FAILURE,
      errorMessage: lastError,
      metadata: { eventId: row.id, eventType: row.type, attempts },
    });

    if (this.authz.can(Permission.MANAGE_INVENTORY)) {
      this.toast.error(
        `A saved change couldn't reach the server after ${attempts} tries. ` +
          'Details are in the Agent Monitor.'
      );
    }
  }
}
