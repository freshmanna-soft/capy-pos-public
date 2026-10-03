/**
 * Event Bus Event Catalog
 *
 * Central, typed constants for the events the app publishes to the
 * EventBusService. Keeping types/sources here avoids magic strings at the
 * call sites and gives the agent-monitor "Event Bus Activity" panel a stable
 * vocabulary to group by (byType / bySource / byPriority).
 */
import type { EventBusMessage } from './event-bus.service';
import type { PaymentMethod } from '@core/application/dtos/payment.dto';
import type { AddToCartRejection } from '@core/application/facades/pos.facade';
import type { CustomerTier } from '@core/domain/entities/customer.entity';
import type { SyncResult, WorkerCircuitState } from '@core/infrastructure/sync/sync.types';

/** Who emitted the event (groups the "By Source" breakdown). */
export const EventSource = {
  POS_FACADE: 'PosFacade',
  CLERK_FACADE: 'ClerkFacade',
  SYNC_SERVICE: 'SyncService',
  INVENTORY: 'InventoryManagement',
} as const;
export type EventSource = (typeof EventSource)[keyof typeof EventSource];

/** What happened (groups the "By Type" breakdown). */
export const EventType = {
  // POS / cart
  CART_ITEM_ADDED: 'cart.item.added',
  CART_ITEM_REMOVED: 'cart.item.removed',
  TRANSACTION_COMPLETED: 'transaction.completed',
  // AI clerk (camera recognition)
  CLERK_ITEM_RECOGNIZED: 'clerk.item.recognized',
  CLERK_ITEM_REJECTED: 'clerk.item.rejected',
  /**
   * Something the cashier named was taken back off the sale.
   *
   * Its own event because `decreaseQuantity` publishes nothing, so without this a
   * spoken removal would be the one clerk action that left no trace on the bus.
   */
  CLERK_ITEM_REMOVED: 'clerk.item.removed',
  // Loyalty
  /**
   * A customer's card was attached to the sale in progress.
   *
   * Carries the customer id and tier only. The name and the code itself stay off
   * the bus: this feeds the agent-monitor panel, which is not a place to publish
   * who is standing at the till.
   */
  CUSTOMER_ATTACHED: 'customer.attached',
  LOYALTY_POINTS_AWARDED: 'loyalty.points.awarded',
  // Sync lifecycle
  SYNC_COMPLETED: 'sync.completed',
  SYNC_PUSH_COMPLETED: 'sync.push.completed',
  SYNC_PUSH_FAILED: 'sync.push.failed',
  SYNC_ERROR: 'sync.error',
  CIRCUIT_STATE_CHANGED: 'sync.circuit.changed',
  // Inventory CRUD
  PRODUCT_CREATED: 'product.created',
  PRODUCT_UPDATED: 'product.updated',
  PRODUCT_DELETED: 'product.deleted',
} as const;
export type EventType = (typeof EventType)[keyof typeof EventType];

export type EventPriority = EventBusMessage['priority'];

/** A spoken or barcode add the AI clerk could not turn into a cart line. */
export type ClerkRejection =
  | { reason: 'unknown-barcode'; barcode: string }
  | { reason: AddToCartRejection; productId: string }
  | { reason: 'operator-rejected' }
  | { reason: 'unknown-spoken-name' | 'not-in-cart'; heard: string };

/** How the clerk was sure enough to add an item without asking. */
export interface ClerkRecognitionMeta {
  confidence: number;
  auto: boolean;
  barcode?: string;
}

/**
 * The payload each event type carries.
 *
 * `busEvent()` and `subscribeToType()` both key off this map, so publishing a
 * payload that does not match its type is a compile error, and a subscriber
 * reads typed fields instead of casting `unknown`. Adding an `EventType` without
 * an entry here fails `tsc`: `EventPayloadMap[K]` cannot index a missing key.
 */
export interface EventPayloadMap {
  [EventType.CART_ITEM_ADDED]: { productId: string; name: string; price: number };
  [EventType.CART_ITEM_REMOVED]: { productId: string };
  [EventType.TRANSACTION_COMPLETED]: { itemCount: number; amount: number; method: PaymentMethod };
  [EventType.CLERK_ITEM_RECOGNIZED]: ClerkRecognitionMeta & {
    productId: string;
    name: string;
    quantity: number;
  };
  [EventType.CLERK_ITEM_REJECTED]: ClerkRejection;
  [EventType.CLERK_ITEM_REMOVED]: { productId: string; name: string; quantity: number };
  [EventType.CUSTOMER_ATTACHED]: { customerId: string; tier: CustomerTier };
  [EventType.LOYALTY_POINTS_AWARDED]: {
    customerId: string;
    points: number;
    /** Null when the award result could not read the customer back. */
    balance: number | null;
    tier: CustomerTier | null;
    promoted: boolean;
  };
  [EventType.SYNC_COMPLETED]: SyncResult;
  /**
   * Two publishers, two shapes: the sync worker reports a failed product push
   * batch, the inventory screen a single soft-delete that did not reach the API.
   */
  [EventType.SYNC_PUSH_FAILED]:
    | { pushed: number; failed: number; failedIds: string[] }
    | { productId: string; operation: 'soft-delete' };
  [EventType.SYNC_PUSH_COMPLETED]: { pushed: number };
  [EventType.SYNC_ERROR]: { error: string; details?: string };
  [EventType.CIRCUIT_STATE_CHANGED]: { circuit: string; state: WorkerCircuitState };
  [EventType.PRODUCT_CREATED]: { id: string; name: string };
  /** `name` is absent when the update did not rename the product. */
  [EventType.PRODUCT_UPDATED]: { id: string; name?: string };
  [EventType.PRODUCT_DELETED]: { id: string; name: string };
}

/** A bus message whose payload is the one its type declares. */
export type TypedBusMessage<K extends EventType> = EventBusMessage<EventPayloadMap[K]> & {
  type: K;
};

/** What `publish()` accepts: everything except the id and timestamp it stamps. */
export type PublishableEvent<K extends EventType = EventType> = Omit<
  TypedBusMessage<K>,
  'id' | 'timestamp'
>;

export interface BusEventOptions {
  priority?: EventPriority;
  /** Ties together every event caused by one business action, e.g. a sale. */
  correlationId?: string;
  /** The id of the event that directly caused this one. */
  causationId?: string;
  metadata?: Record<string, unknown>;
}

/**
 * Build a publishable event-bus message. The payload is checked against
 * `EventPayloadMap[type]`, so call sites stay one-liners and cannot drift from
 * what subscribers expect.
 */
export function busEvent<K extends EventType>(
  type: K,
  source: EventSource,
  payload: EventPayloadMap[K],
  options: BusEventOptions = {}
): PublishableEvent<K> {
  const { priority = 'normal', correlationId, causationId, metadata } = options;
  return { type, source, payload, priority, correlationId, causationId, metadata };
}
