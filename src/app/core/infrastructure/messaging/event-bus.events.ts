/**
 * Event Bus Event Catalog
 *
 * Central, typed constants for the events the app publishes to the
 * EventBusService. Keeping types/sources here avoids magic strings at the
 * call sites and gives the agent-monitor "Event Bus Activity" panel a stable
 * vocabulary to group by (byType / bySource / byPriority).
 */
import { EventBusMessage } from './event-bus.service';

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

/**
 * Build a publishable event-bus message. Thin wrapper over the
 * `Omit<EventBusMessage,'id'|'timestamp'>` shape `publish()` expects, so call
 * sites stay one-liners and consistently typed.
 */
export function busEvent<T>(
  type: EventType,
  source: EventSource,
  payload: T,
  priority: EventPriority = 'normal',
  metadata?: Record<string, unknown>
): Omit<EventBusMessage<T>, 'id' | 'timestamp'> {
  return { type, source, payload, priority, metadata };
}
