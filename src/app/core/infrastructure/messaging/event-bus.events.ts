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
