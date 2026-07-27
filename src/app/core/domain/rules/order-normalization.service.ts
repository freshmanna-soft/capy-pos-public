import { Injectable } from '@angular/core';
import { BaseDomainService } from '@core/domain/rules/base-domain.service';
import {
  IOrderNormalizationService,
  NormalizedOrder,
  NormalizedOrderItem,
  OrderAheadOrder,
  OrderChannel,
  PosRegisterOrder,
  UberEatsOrder,
} from '@core/domain/rules/order-normalization.service.interface';

const DEFAULT_CURRENCY = 'USD';
const CENTS_PER_UNIT = 100;

/**
 * Order Normalization Service Implementation
 *
 * Maps channel-specific order payloads onto the unified {@link NormalizedOrder}
 * model so downstream fulfillment, dispatch, and inventory sync never have to
 * know which channel an order came from.
 *
 * @class OrderNormalizationService
 * @extends BaseDomainService
 * @implements IOrderNormalizationService
 */
@Injectable({ providedIn: 'root' })
export class OrderNormalizationService
  extends BaseDomainService
  implements IOrderNormalizationService
{
  constructor() {
    super('OrderNormalizationService');
  }

  /**
   * Normalize an in-store POS register order.
   */
  normalizePosOrder(order: PosRegisterOrder): NormalizedOrder {
    this.validateRequired(order, 'POS order');
    this.validateNotEmpty(order.receiptNumber, 'Receipt number');
    this.validateArrayNotEmpty(order.lines, 'Order lines');

    const items = order.lines.map((line) =>
      this.buildItem({
        sku: line.sku,
        name: line.name,
        quantity: line.qty,
        unitPrice: line.unitPrice,
        notes: line.note,
      })
    );

    return this.assemble({
      channel: OrderChannel.POS_REGISTER,
      externalId: order.receiptNumber,
      customerName: this.cleanName(order.customerName),
      items,
      currency: order.currency?.trim() || DEFAULT_CURRENCY,
      placedAt: this.parseDate(order.placedAt, 'placedAt'),
    });
  }

  /**
   * Normalize an incoming Uber Eats webhook order.
   */
  normalizeUberEatsOrder(order: UberEatsOrder): NormalizedOrder {
    this.validateRequired(order, 'Uber Eats order');
    this.validateNotEmpty(order.display_id, 'Uber Eats display_id');
    this.validateArrayNotEmpty(order.items, 'Uber Eats items');

    const items = order.items.map((item) =>
      this.buildItem({
        // Uber Eats identifies items by display title only — no internal SKU.
        sku: null,
        name: item.title,
        quantity: item.quantity,
        // Uber Eats amounts arrive in minor units (cents).
        unitPrice: item.price.unit_amount / CENTS_PER_UNIT,
      })
    );

    const currency = order.items[0]?.price.currency_code?.trim() || DEFAULT_CURRENCY;

    return this.assemble({
      channel: OrderChannel.UBER_EATS,
      externalId: order.display_id,
      customerName: this.joinName(order.eater?.first_name, order.eater?.last_name),
      items,
      currency,
      placedAt: this.parseDate(order.placed_at, 'placed_at'),
      notes: this.cleanNotes(order.special_instructions),
    });
  }

  /**
   * Normalize an order-ahead web form submission.
   */
  normalizeOrderAheadOrder(order: OrderAheadOrder): NormalizedOrder {
    this.validateRequired(order, 'Order-ahead order');
    this.validateNotEmpty(order.orderNumber, 'Order number');
    this.validateRequired(order.customer, 'Customer');
    this.validateArrayNotEmpty(order.lineItems, 'Line items');

    const items = order.lineItems.map((line) =>
      this.buildItem({
        sku: line.productSku ?? null,
        name: line.label,
        quantity: line.count,
        unitPrice: line.priceEach,
        notes: line.instructions,
      })
    );

    return this.assemble({
      channel: OrderChannel.ORDER_AHEAD,
      externalId: order.orderNumber,
      customerName: this.cleanName(order.customer.fullName),
      items,
      currency: order.currency?.trim() || DEFAULT_CURRENCY,
      placedAt: this.parseDate(order.requestedFor, 'requestedFor'),
    });
  }

  /**
   * Build and validate a single normalized line item, computing its subtotal.
   */
  private buildItem(params: {
    sku: string | null;
    name: string;
    quantity: number;
    unitPrice: number;
    notes?: string;
  }): NormalizedOrderItem {
    this.validateNotEmpty(params.name, 'Item name');
    this.validatePositive(params.quantity, 'Item quantity');
    this.validateNonNegative(params.unitPrice, 'Item unit price');

    const item: NormalizedOrderItem = {
      sku: params.sku && params.sku.trim().length > 0 ? params.sku : null,
      name: params.name.trim(),
      quantity: params.quantity,
      unitPrice: this.round2(params.unitPrice),
      subtotal: this.round2(params.unitPrice * params.quantity),
    };

    const notes = this.cleanNotes(params.notes);
    if (notes !== undefined) {
      item.notes = notes;
    }

    return item;
  }

  /**
   * Assemble the final normalized order, deriving the order-level subtotal
   * from its line items.
   */
  private assemble(params: {
    channel: OrderChannel;
    externalId: string;
    customerName: string | null;
    items: NormalizedOrderItem[];
    currency: string;
    placedAt: Date;
    notes?: string;
  }): NormalizedOrder {
    const subtotal = this.round2(params.items.reduce((sum, item) => sum + item.subtotal, 0));

    const order: NormalizedOrder = {
      channel: params.channel,
      externalId: params.externalId.trim(),
      customerName: params.customerName,
      items: params.items,
      subtotal,
      currency: params.currency,
      placedAt: params.placedAt,
    };

    if (params.notes !== undefined) {
      order.notes = params.notes;
    }

    return order;
  }

  /**
   * Parse a Date or ISO date string into a Date, rejecting invalid values.
   */
  private parseDate(value: Date | string, paramName: string): Date {
    this.validateRequired(value, paramName);
    const date = value instanceof Date ? value : new Date(value);
    this.validateInput(!Number.isNaN(date.getTime()), `${paramName} must be a valid date`);
    return date;
  }

  /**
   * Combine first and last name into a single display name, or null when
   * neither is present.
   */
  private joinName(first?: string, last?: string): string | null {
    const parts = [first, last]
      .map((part) => part?.trim())
      .filter((part): part is string => !!part && part.length > 0);
    return parts.length > 0 ? parts.join(' ') : null;
  }

  /**
   * Trim a customer name, returning null when empty or absent.
   */
  private cleanName(name?: string): string | null {
    const trimmed = name?.trim();
    return trimmed && trimmed.length > 0 ? trimmed : null;
  }

  /**
   * Trim free-text notes, returning undefined when empty or absent so the
   * optional field is omitted rather than set to an empty string.
   */
  private cleanNotes(notes?: string): string | undefined {
    const trimmed = notes?.trim();
    return trimmed && trimmed.length > 0 ? trimmed : undefined;
  }

  /**
   * Round a monetary amount to two decimal places, guarding against
   * floating-point drift when summing line items.
   */
  private round2(amount: number): number {
    return Math.round((amount + Number.EPSILON) * 100) / 100;
  }
}

// Made with Bob
