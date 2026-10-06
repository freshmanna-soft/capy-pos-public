import { InjectionToken } from '@angular/core';
import type { SaleCompletedPayload } from '@core/domain/events/domain-event';

/**
 * The `SaleCompleted` event a checkout records alongside its transaction row (#352).
 */
export interface SaleCompletedOutboxEvent {
  /** The local transaction id, which is also the event's `aggregateId`. */
  transactionId: string;
  /** Shared by every event this sale caused, outbox and bus alike. */
  correlationId: string;
  payload: SaleCompletedPayload;
  /**
   * Handlers whose side effect the caller has already applied inline. Their
   * receipts are written in the same transaction as the event, so the dispatcher
   * never applies them a second time. Empty while every side effect still runs
   * inline and no `SaleCompleted` handler exists; #354 and #355 fill it in.
   */
  appliedInline: readonly string[];
  /**
   * Handlers whose side effect the caller applies inline only if this record comes
   * back `deferred` (#354). A retry that later lands writes their receipts too, so
   * the effect is never applied twice.
   */
  fallbackInline?: readonly string[];
}

/**
 * How a sale's local record went.
 *
 * - `recorded`: the transaction row and its event were written together.
 * - `already-recorded`: a row with this transaction id existed, so a retried
 *   checkout wrote nothing new.
 * - `deferred`: the local write failed (quota, IndexedDB unavailable). The sale
 *   still stands; the write is retried in the background (Epic #349, decision 2).
 */
export type SaleRecordOutcome = 'recorded' | 'already-recorded' | 'deferred';

/**
 * Records a sale and its `SaleCompleted` event atomically: both rows are written,
 * or neither is. Never rejects, because a sale must not fail on its local record.
 */
export interface SaleOutboxPort {
  /**
   * Run `writeTransaction` and add the event inside one local transaction.
   * `writeTransaction` must only touch the local transactions table, and must be
   * safe to run again: a deferred record calls it on every retry.
   */
  record(
    event: SaleCompletedOutboxEvent,
    writeTransaction: () => Promise<unknown>
  ): Promise<SaleRecordOutcome>;
}

export const SALE_OUTBOX = new InjectionToken<SaleOutboxPort>('SALE_OUTBOX');
