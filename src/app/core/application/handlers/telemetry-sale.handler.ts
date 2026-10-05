import { Injectable, inject } from '@angular/core';
import { DomainEvent, DomainEventType, OutboxStatus } from '@core/domain/events/domain-event';
import { DexieDatabase } from '@core/infrastructure/database/dexie-database.service';
import {
  EventHandler,
  OUTBOX_CLOCK,
} from '@core/infrastructure/messaging/outbox-dispatcher.service';
import { TelemetryService } from '@core/infrastructure/telemetry/telemetry.service';

/** The receipt key. Stable across releases: renaming it re-runs every old sale. */
export const TELEMETRY_SALE_HANDLER = 'telemetry-sale';

/** Left on the receipt while recording; only a crash mid-record leaves it behind. */
export const TELEMETRY_IN_FLIGHT = `${TELEMETRY_SALE_HANDLER}: in flight`;

type SaleCompleted = typeof DomainEventType.SALE_COMPLETED;

/**
 * Records a sale's payment metrics (#356): resilient, but controlled.
 *
 * Resilient: a recording that fails (an exporter outage, say) throws, so the
 * dispatcher retries it with backoff. Controlled: those retries stop at the
 * dispatcher's attempt cap, after which the event is dead and reported, never
 * retried forever.
 *
 * And never counted twice, since a counter cannot be deduplicated downstream. Before
 * recording, the receipt is marked in flight. A normal outcome replaces that mark:
 * the dispatcher writes `handled` on success and `failed` on a caught failure. The
 * mark survives only if the tab died mid-record, so a later run that finds it
 * assumes the data point went out and skips it. That crash is the one case that
 * can lose a data point.
 */
@Injectable({ providedIn: 'root' })
export class TelemetrySaleHandler implements EventHandler<SaleCompleted> {
  readonly name = TELEMETRY_SALE_HANDLER;
  readonly eventType = DomainEventType.SALE_COMPLETED;

  private readonly db = inject(DexieDatabase);
  private readonly telemetry = inject(TelemetryService);
  private readonly now = inject(OUTBOX_CLOCK);

  async handle(event: DomainEvent<SaleCompleted>): Promise<void> {
    const receipt = await this.db.outboxReceipts.get([event.id, this.name]);
    if (receipt?.status === OutboxStatus.HANDLED) return;
    // A previous run died between marking and finishing: it may have recorded.
    if (receipt?.lastError === TELEMETRY_IN_FLIGHT) return;

    await this.db.outboxReceipts.put({
      eventId: event.id,
      handler: this.name,
      status: OutboxStatus.PENDING,
      nextAttemptAt: 0,
      lastError: TELEMETRY_IN_FLIGHT,
      updatedAt: new Date(this.now()),
    });

    const { method, amount } = event.payload;
    // Throws on failure; the dispatcher then overwrites the mark with `failed` and
    // retries with backoff, up to its attempt cap. The gauge goes first: it holds a
    // latest value, so a retry re-recording it is harmless, whereas the counter, last,
    // is only ever recorded on the attempt that succeeds.
    this.telemetry.recordGauge('payment.amount', amount, { method });
    this.telemetry.recordCounter('payments.processed', 1, { method });
  }
}
