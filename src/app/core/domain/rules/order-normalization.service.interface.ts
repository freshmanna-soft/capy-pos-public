/**
 * Order Normalization Service Interface
 *
 * Defines the contract for normalizing orders that arrive from multiple
 * intake channels (POS register, Uber Eats, order-ahead web form) into a
 * single, unified order model. This is the foundation of Capy-Chow's
 * "Unified Order Intake" epic (#15): downstream fulfillment, courier
 * dispatch, and inventory sync all operate on the normalized shape rather
 * than on channel-specific payloads.
 *
 * @interface IOrderNormalizationService
 */

/**
 * The intake channels a Capy-Chow order can originate from.
 */
export enum OrderChannel {
  POS_REGISTER = 'POS_REGISTER',
  UBER_EATS = 'UBER_EATS',
  ORDER_AHEAD = 'ORDER_AHEAD',
}

/**
 * A single line item on a normalized order.
 *
 * `sku` is nullable because some channels (e.g. Uber Eats) identify items by
 * display title only and cannot be reliably matched to an internal SKU at
 * intake time.
 */
export interface NormalizedOrderItem {
  sku: string | null;
  name: string;
  quantity: number;
  unitPrice: number;
  subtotal: number;
  notes?: string;
}

/**
 * The unified order model shared across every channel.
 *
 * Monetary amounts are expressed as plain numbers in major currency units
 * (e.g. dollars, not cents), matching the convention used by the transaction
 * entity and the pricing/inventory services.
 */
export interface NormalizedOrder {
  channel: OrderChannel;
  /** The source system's own identifier for the order. */
  externalId: string;
  customerName: string | null;
  items: NormalizedOrderItem[];
  subtotal: number;
  currency: string;
  placedAt: Date;
  notes?: string;
}

/**
 * Raw order payload produced by the in-store POS register flow.
 */
export interface PosRegisterOrder {
  receiptNumber: string;
  customerName?: string;
  currency?: string;
  placedAt: Date | string;
  lines: {
    sku: string;
    name: string;
    qty: number;
    unitPrice: number;
    note?: string;
  }[];
}

/**
 * Raw order payload as delivered by the Uber Eats webhook.
 *
 * Uber Eats expresses money in minor units (cents) and identifies items by
 * display title, so no SKU is available at intake time.
 */
export interface UberEatsOrder {
  display_id: string;
  placed_at: string;
  special_instructions?: string;
  eater?: {
    first_name?: string;
    last_name?: string;
  };
  items: {
    title: string;
    quantity: number;
    price: {
      unit_amount: number;
      currency_code: string;
    };
  }[];
}

/**
 * Raw order payload submitted through the order-ahead web form.
 */
export interface OrderAheadOrder {
  orderNumber: string;
  requestedFor: Date | string;
  currency?: string;
  customer: {
    fullName: string;
  };
  lineItems: {
    productSku?: string;
    label: string;
    count: number;
    priceEach: number;
    instructions?: string;
  }[];
}

/**
 * Order Normalization Service Interface
 *
 * Provides channel-specific normalizers that each map a raw order payload
 * onto the shared {@link NormalizedOrder} model.
 */
export interface IOrderNormalizationService {
  /**
   * Normalize an in-store POS register order.
   */
  normalizePosOrder(order: PosRegisterOrder): NormalizedOrder;

  /**
   * Normalize an incoming Uber Eats webhook order.
   */
  normalizeUberEatsOrder(order: UberEatsOrder): NormalizedOrder;

  /**
   * Normalize an order-ahead web form submission.
   */
  normalizeOrderAheadOrder(order: OrderAheadOrder): NormalizedOrder;
}

// Made with Bob
