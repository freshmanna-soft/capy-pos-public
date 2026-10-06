import { Injectable, InjectionToken, OnDestroy, inject } from '@angular/core';
import { DomainEventType, OutboxStatus } from '@core/domain/events/domain-event';
import type {
  SaleCompletedOutboxEvent,
  SaleOutboxPort,
  SaleRecordOutcome,
} from '@core/application/ports/sale-outbox.port';
import { DexieDatabase } from '@core/infrastructure/database/dexie-database.service';
import {
  OUTBOX_CLOCK,
  OUTBOX_MAX_ATTEMPTS,
  OutboxDispatcherService,
  newOutboxRow,
  outboxBackoffMs,
} from './outbox-dispatcher.service';

/**
 * How long to wait before retry number `failures` of a deferred sale write.
 * Injectable so tests need neither fake timers (which stall IndexedDB) nor minutes.
 */
export const SALE_OUTBOX_RETRY_DELAY = new InjectionToken<(failures: number) => number>(
  'SALE_OUTBOX_RETRY_DELAY',
  { providedIn: 'root', factory: () => (failures: number) => outboxBackoffMs(failures) }
);

/**
 * Writes a sale's transaction row and its `SaleCompleted` outbox event in one Dexie
 * transaction (#352).
 *
 * When that write fails, the sale still stands. The event is kept in memory and the
 * whole atomic write is retried with the dispatcher's backoff (Epic #349, decision 2).
 * A tab closed before a retry succeeds loses it; that was the accepted trade-off.
 */
@Injectable({ providedIn: 'root' })
export class DexieSaleOutboxAdapter implements SaleOutboxPort, OnDestroy {
  private readonly db = inject(DexieDatabase);
  private readonly dispatcher = inject(OutboxDispatcherService);
  private readonly now = inject(OUTBOX_CLOCK);
  private readonly retryDelay = inject(SALE_OUTBOX_RETRY_DELAY);
  private readonly retries = new Set<ReturnType<typeof setTimeout>>();

  async record(
    event: SaleCompletedOutboxEvent,
    writeTransaction: () => Promise<unknown>
  ): Promise<SaleRecordOutcome> {
    try {
      return await this.write(event, writeTransaction, event.appliedInline);
    } catch (error) {
      console.error(
        `[SaleOutbox] Could not record sale ${event.transactionId}; retrying in the background:`,
        error
      );
      this.scheduleRetry(event, writeTransaction, 0);
      return 'deferred';
    }
  }

  ngOnDestroy(): void {
    for (const timer of this.retries) clearTimeout(timer);
    this.retries.clear();
  }

  /**
   * Both rows or neither. A duplicate transaction id means a retried checkout.
   * `inline` names the handlers already applied by the caller; they get receipts.
   */
  private async write(
    event: SaleCompletedOutboxEvent,
    writeTransaction: () => Promise<unknown>,
    inline: readonly string[]
  ): Promise<'recorded' | 'already-recorded'> {
    const at = new Date(this.now());
    const row = newOutboxRow(
      DomainEventType.SALE_COMPLETED,
      event.transactionId,
      event.payload,
      at,
      event.correlationId
    );
    try {
      await this.db.transaction(
        'rw',
        [this.db.transactions, this.db.outbox, this.db.outboxReceipts],
        async () => {
          await writeTransaction();
          await this.db.outbox.add(row);
          if (inline.length > 0) {
            await this.db.outboxReceipts.bulkPut(
              inline.map((handler) => ({
                eventId: row.id,
                handler,
                status: OutboxStatus.HANDLED,
                nextAttemptAt: 0,
                updatedAt: at,
              }))
            );
          }
        }
      );
    } catch (error) {
      if (isConstraintError(error)) return 'already-recorded';
      throw error;
    }
    // Only after the commit: a dispatch inside the transaction would see no row.
    // Waits for blocking handlers (stock, #354), so the till shows updated stock.
    await this.dispatcher.dispatch(row.id);
    return 'recorded';
  }

  private scheduleRetry(
    event: SaleCompletedOutboxEvent,
    writeTransaction: () => Promise<unknown>,
    failures: number
  ): void {
    const timer = setTimeout(async () => {
      this.retries.delete(timer);
      try {
        // By now the caller has applied its fallback side effects inline.
        await this.write(event, writeTransaction, [
          ...event.appliedInline,
          ...(event.fallbackInline ?? []),
        ]);
      } catch (error) {
        const attempts = failures + 1;
        if (attempts >= OUTBOX_MAX_ATTEMPTS) {
          console.error(
            `[SaleOutbox] Gave up recording sale ${event.transactionId} after ${attempts} retries:`,
            error
          );
          return;
        }
        this.scheduleRetry(event, writeTransaction, attempts);
      }
    }, this.retryDelay(failures));
    this.retries.add(timer);
  }
}

/**
 * Dexie surfaces a duplicate key as `ConstraintError`, either directly or as the
 * inner error of the aborted transaction.
 */
function isConstraintError(error: unknown): boolean {
  const named = (value: unknown): boolean =>
    typeof value === 'object' &&
    value !== null &&
    (value as { name?: unknown }).name === 'ConstraintError';
  return named(error) || named((error as { inner?: unknown } | null)?.inner);
}
