/**
 * Domain events — facts about the business that must outlive the tab that saw them.
 *
 * Distinct from the in-memory event bus (`EventBusService`), which is observe-only and
 * forgets everything on reload. A domain event is written to the Dexie `outbox` in the
 * same breath as the state change it describes, and the outbox dispatcher keeps running
 * its handlers until each one has succeeded (Epic #349, #351).
 */
export const DomainEventType = {
  SALE_COMPLETED: 'sale.completed',
  /**
   * A product was created or edited locally and the server copy must catch up.
   *
   * Carries only the id: the handler reads the product row when it runs, so a retry
   * an hour later sends the product as it is *then*, not as it was at the first try,
   * and three quick edits collapse into three identical idempotent upserts.
   */
  PRODUCT_UPSERTED: 'product.upserted',
} as const;
export type DomainEventType = (typeof DomainEventType)[keyof typeof DomainEventType];

/** Lifecycle of an outbox row, and of each handler's receipt for it. */
export const OutboxStatus = {
  PENDING: 'pending',
  HANDLED: 'handled',
  /** At least one handler threw; the row is rescheduled with backoff. */
  FAILED: 'failed',
  /** Gave up after the attempt limit. Surfaced to people, never retried automatically. */
  DEAD: 'dead',
} as const;
export type OutboxStatus = (typeof OutboxStatus)[keyof typeof OutboxStatus];

export interface SaleCompletedPayload {
  transactionId: string;
  items: { productId: string; quantity: number; unitPrice: number }[];
  amount: number;
  method: string;
  customerId?: string;
  /**
   * The customer's tier at the moment of the sale, so a retried award is priced the
   * same as the first attempt and matches the receipt (Epic #349, decision 4).
   */
  customerTier?: string;
  occurredAt: string;
}

export interface ProductUpsertedPayload {
  productId: string;
}

export interface DomainEventPayloadMap {
  [DomainEventType.SALE_COMPLETED]: SaleCompletedPayload;
  [DomainEventType.PRODUCT_UPSERTED]: ProductUpsertedPayload;
}

/** An event as handlers see it: the outbox row with its payload already parsed. */
export interface DomainEvent<K extends DomainEventType = DomainEventType> {
  id: string;
  type: K;
  aggregateId: string;
  payload: DomainEventPayloadMap[K];
  /** Shared by every event one business action caused, e.g. a sale (#352). */
  correlationId?: string;
  attempts: number;
  createdAt: Date;
}
