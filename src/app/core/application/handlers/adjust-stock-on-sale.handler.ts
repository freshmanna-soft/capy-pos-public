import { Injectable, inject } from '@angular/core';
import { DomainEvent, DomainEventType, OutboxStatus } from '@core/domain/events/domain-event';
import {
  AdjustStockOnSaleUseCase,
  FailedAdjustmentDetail,
} from '@core/application/use-cases/adjust-stock-on-sale.use-case';
import { DexieDatabase } from '@core/infrastructure/database/dexie-database.service';
import {
  EventHandler,
  OUTBOX_CLOCK,
  TerminalHandlerError,
} from '@core/infrastructure/messaging/outbox-dispatcher.service';

/** The receipt key. Stable across releases: renaming it re-runs every old sale. */
export const ADJUST_STOCK_ON_SALE_HANDLER = 'adjust-stock-on-sale';

/**
 * Failures no retry can fix: the product is gone, or the sale would take its stock
 * below zero. Matched on the messages `DexieProductRepository.adjustStock` and
 * `Product.updateStock` throw; anything else (IndexedDB trouble) is worth retrying.
 */
const TERMINAL_STOCK_FAILURE = /not found|Insufficient stock/;

type SaleCompleted = typeof DomainEventType.SALE_COMPLETED;

/** `oats (Insufficient stock), ghost (Product with id ghost not found)` */
function describeFailures(failures: readonly FailedAdjustmentDetail[]): string {
  return failures.map((failure) => failure.productId + ' (' + failure.error + ')').join(', ');
}

/**
 * Takes a completed sale's items off stock (#354).
 *
 * Blocking: the POS terminal refreshes stock the moment `checkout()` resolves, so the
 * first attempt has to have finished by then.
 *
 * The decrement and this handler's receipt are written in one Dexie transaction, so a
 * crash in between can neither lose the decrement nor apply it twice: a second run
 * finds the receipt and does nothing.
 *
 * One missing product does not undo the rest of the sale's decrements. The sale
 * happened; the products that still exist did leave the shelf. The missing ones are
 * recorded as a terminal failure and never retried. Any other failure rolls the whole
 * decrement back, and the dispatcher retries it.
 */
@Injectable({ providedIn: 'root' })
export class AdjustStockOnSaleHandler implements EventHandler<SaleCompleted> {
  readonly name = ADJUST_STOCK_ON_SALE_HANDLER;
  readonly eventType = DomainEventType.SALE_COMPLETED;
  readonly blocking = true;

  private readonly db = inject(DexieDatabase);
  private readonly adjustStock = inject(AdjustStockOnSaleUseCase);
  private readonly now = inject(OUTBOX_CLOCK);

  async handle(event: DomainEvent<SaleCompleted>): Promise<void> {
    const terminal = await this.db.transaction(
      'rw',
      [this.db.products, this.db.outboxReceipts],
      async () => {
        const receipt = await this.db.outboxReceipts.get([event.id, this.name]);
        if (receipt?.status === OutboxStatus.HANDLED || receipt?.status === OutboxStatus.DEAD) {
          return null;
        }

        const result = await this.adjustStock.execute(
          event.payload.items.map(({ productId, quantity }) => ({ productId, quantity }))
        );
        const retryable = result.failedAdjustments.filter(
          (failure) => !TERMINAL_STOCK_FAILURE.test(failure.error)
        );
        if (retryable.length > 0) {
          // Throwing aborts the transaction, so none of this sale's decrements stick.
          throw new Error(`Stock not adjusted: ${describeFailures(retryable)}`);
        }

        const lost = result.failedAdjustments;
        const message =
          lost.length === 0 ? undefined : `Stock not adjusted for ${describeFailures(lost)}`;
        await this.db.outboxReceipts.put({
          eventId: event.id,
          handler: this.name,
          status: message === undefined ? OutboxStatus.HANDLED : OutboxStatus.DEAD,
          nextAttemptAt: 0,
          ...(message === undefined ? {} : { lastError: `${this.name}: ${message}` }),
          updatedAt: new Date(this.now()),
        });
        return message ?? null;
      }
    );

    if (terminal !== null) throw new TerminalHandlerError(terminal);
  }
}
