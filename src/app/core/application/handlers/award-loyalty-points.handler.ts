import { Injectable, inject } from '@angular/core';
import { DomainEvent, DomainEventType } from '@core/domain/events/domain-event';
import { CustomerTier } from '@core/domain/entities/customer.entity';
import {
  AwardLoyaltyPointsUseCase,
  LoyaltyAwardResult,
} from '@core/application/use-cases/award-loyalty-points.use-case';
import { DexieDatabase } from '@core/infrastructure/database/dexie-database.service';
import { EventBusService } from '@core/infrastructure/messaging/event-bus.service';
import { EventSource, EventType, busEvent } from '@core/infrastructure/messaging/event-bus.events';
import {
  EventHandler,
  OUTBOX_CLOCK,
} from '@core/infrastructure/messaging/outbox-dispatcher.service';

/** The receipt key. Stable across releases: renaming it re-runs every old sale. */
export const AWARD_LOYALTY_POINTS_HANDLER = 'award-loyalty-points';

type SaleCompleted = typeof DomainEventType.SALE_COMPLETED;

const CUSTOMER_TIERS: ReadonlySet<string> = new Set(Object.values(CustomerTier));

/** The ledger row that marks one sale's award: its idempotency key and audit trail. */
export function loyaltyLedgerId(eventId: string): string {
  return `sale:${eventId}`;
}

/** Thrown inside the transaction so a failed write rolls the ledger row back with it. */
class AwardFailedError extends Error {}

/**
 * Awards a completed sale's loyalty points (#355). Not blocking: nothing on screen
 * waits for the balance, just as when this ran fire-and-forget inside checkout().
 *
 * The points and a `loyaltyTransactions` row keyed `sale:<eventId>` are written in
 * one Dexie transaction (Epic #349, decision 8). A second delivery finds the row and
 * awards nothing, even if the first crashed before the dispatcher wrote its receipt.
 *
 * Points are priced at the tier the customer held when the sale happened, carried on
 * the event, so a retry hours later still earns what the receipt implied (decision 4).
 *
 * `award-failed` is a real fault and is thrown, so the dispatcher retries it. Every
 * other skip — no customer on the card, a blocked account, a sale too small to earn —
 * is an ordinary outcome: the handler returns, and the event is handled.
 */
@Injectable({ providedIn: 'root' })
export class AwardLoyaltyPointsHandler implements EventHandler<SaleCompleted> {
  readonly name = AWARD_LOYALTY_POINTS_HANDLER;
  readonly eventType = DomainEventType.SALE_COMPLETED;

  private readonly db = inject(DexieDatabase);
  private readonly award = inject(AwardLoyaltyPointsUseCase);
  private readonly eventBus = inject(EventBusService);
  private readonly now = inject(OUTBOX_CLOCK);

  async handle(event: DomainEvent<SaleCompleted>): Promise<void> {
    const { customerId, customerTier, amount, transactionId } = event.payload;
    // Anonymous sales are the normal case; there is nobody to award.
    if (!customerId) return;

    const ledgerId = loyaltyLedgerId(event.id);
    const pricingTier =
      customerTier !== undefined && CUSTOMER_TIERS.has(customerTier)
        ? (customerTier as CustomerTier)
        : undefined;

    let result: LoyaltyAwardResult | null;
    try {
      result = await this.db.transaction(
        'rw',
        [this.db.customers, this.db.loyaltyTransactions],
        async () => {
          // A cheap early exit. The guarantee is the ledger add below: a duplicate id
          // raises ConstraintError and rolls this whole transaction back.
          if (await this.db.loyaltyTransactions.get(ledgerId)) return null;

          const outcome = await this.award.execute({
            customerId,
            purchaseAmount: amount,
            ...(pricingTier ? { pricingTier } : {}),
          });
          if (outcome.reason === 'award-failed') {
            throw new AwardFailedError(outcome.error ?? 'Loyalty award failed.');
          }
          if (!outcome.awarded) return outcome;

          await this.db.loyaltyTransactions.add({
            id: ledgerId,
            customerId,
            transactionId,
            points: outcome.points,
            type: 'EARNED',
            description: `Sale ${transactionId}`,
            createdAt: new Date(this.now()),
          });
          return outcome;
        }
      );
    } catch (error) {
      // A concurrent delivery added the row first; its points are the ones that stand.
      if (isConstraintError(error)) return;
      throw error;
    }

    if (result?.awarded) this.publishAward(event, customerId, result);
  }

  /** Only after the commit, and only for a fresh award: a replay announces nothing. */
  private publishAward(
    event: DomainEvent<SaleCompleted>,
    customerId: string,
    result: LoyaltyAwardResult
  ): void {
    this.eventBus.publish(
      busEvent(
        EventType.LOYALTY_POINTS_AWARDED,
        EventSource.POS_FACADE,
        {
          customerId,
          points: result.points,
          balance: result.balance,
          tier: result.tier,
          promoted: result.previousTier !== result.tier,
        },
        event.correlationId === undefined ? {} : { correlationId: event.correlationId }
      )
    );
  }
}

function isConstraintError(error: unknown): boolean {
  const named = (value: unknown): boolean =>
    typeof value === 'object' &&
    value !== null &&
    (value as { name?: unknown }).name === 'ConstraintError';
  return named(error) || named((error as { inner?: unknown } | null)?.inner);
}
