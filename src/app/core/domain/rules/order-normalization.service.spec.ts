import { describe, it, expect, beforeEach } from 'vitest';
import { OrderNormalizationService } from '@core/domain/rules/order-normalization.service';
import {
  IOrderNormalizationService,
  OrderAheadOrder,
  OrderChannel,
  PosRegisterOrder,
  UberEatsOrder,
} from '@core/domain/rules/order-normalization.service.interface';

describe('OrderNormalizationService', () => {
  let service: IOrderNormalizationService;

  beforeEach(() => {
    service = new OrderNormalizationService();
  });

  const validPosOrder = (): PosRegisterOrder => ({
    receiptNumber: 'R-1001',
    customerName: 'Marco',
    placedAt: '2026-07-27T10:00:00.000Z',
    lines: [
      { sku: 'ESP-001', name: 'Espresso', qty: 2, unitPrice: 3.5, note: 'extra hot' },
      { sku: 'CRO-001', name: 'Croissant', qty: 1, unitPrice: 3.25 },
    ],
  });

  const validUberEatsOrder = (): UberEatsOrder => ({
    display_id: 'UE-88',
    placed_at: '2026-07-27T11:30:00.000Z',
    special_instructions: 'Leave at door',
    eater: { first_name: 'Dana', last_name: 'Lopez' },
    items: [{ title: 'Latte', quantity: 3, price: { unit_amount: 475, currency_code: 'USD' } }],
  });

  const validOrderAheadOrder = (): OrderAheadOrder => ({
    orderNumber: 'OA-7',
    requestedFor: '2026-07-27T12:15:00.000Z',
    customer: { fullName: 'Lena Ortiz' },
    lineItems: [
      { productSku: 'CAP-001', label: 'Cappuccino', count: 2, priceEach: 4.5 },
      { label: 'Muffin', count: 1, priceEach: 3.75, instructions: 'gluten free' },
    ],
  });

  describe('normalizePosOrder', () => {
    it('should normalize a POS order into the unified model', () => {
      const result = service.normalizePosOrder(validPosOrder());

      expect(result.channel).toBe(OrderChannel.POS_REGISTER);
      expect(result.externalId).toBe('R-1001');
      expect(result.customerName).toBe('Marco');
      expect(result.currency).toBe('USD');
      expect(result.placedAt.toISOString()).toBe('2026-07-27T10:00:00.000Z');
      expect(result.items).toHaveLength(2);
      // 2 * 3.50 + 1 * 3.25
      expect(result.subtotal).toBe(10.25);
    });

    it('should compute line subtotals and preserve notes and sku', () => {
      const result = service.normalizePosOrder(validPosOrder());

      expect(result.items[0]).toEqual({
        sku: 'ESP-001',
        name: 'Espresso',
        quantity: 2,
        unitPrice: 3.5,
        subtotal: 7,
        notes: 'extra hot',
      });
      expect(result.items[1].notes).toBeUndefined();
    });

    it('should honour an explicit currency', () => {
      const result = service.normalizePosOrder({ ...validPosOrder(), currency: 'EUR' });
      expect(result.currency).toBe('EUR');
    });

    it('should map an absent customer name to null', () => {
      const order = { ...validPosOrder(), customerName: '   ' };
      expect(service.normalizePosOrder(order).customerName).toBeNull();
    });

    it('should accept a Date instance for placedAt', () => {
      const when = new Date('2026-07-27T09:00:00.000Z');
      const result = service.normalizePosOrder({ ...validPosOrder(), placedAt: when });
      expect(result.placedAt.getTime()).toBe(when.getTime());
    });

    it('should throw for an empty receipt number', () => {
      expect(() => service.normalizePosOrder({ ...validPosOrder(), receiptNumber: '' })).toThrow(
        '[OrderNormalizationService] Receipt number is required'
      );
    });

    it('should throw for an empty line list', () => {
      expect(() => service.normalizePosOrder({ ...validPosOrder(), lines: [] })).toThrow(
        '[OrderNormalizationService] Order lines cannot be empty'
      );
    });

    it('should throw for a non-positive quantity', () => {
      const order = validPosOrder();
      order.lines[0].qty = 0;
      expect(() => service.normalizePosOrder(order)).toThrow(
        '[OrderNormalizationService] Item quantity must be positive'
      );
    });

    it('should throw for a negative unit price', () => {
      const order = validPosOrder();
      order.lines[0].unitPrice = -1;
      expect(() => service.normalizePosOrder(order)).toThrow(
        '[OrderNormalizationService] Item unit price must be non-negative'
      );
    });

    it('should throw for an invalid date', () => {
      expect(() =>
        service.normalizePosOrder({ ...validPosOrder(), placedAt: 'not-a-date' })
      ).toThrow('[OrderNormalizationService] placedAt must be a valid date');
    });
  });

  describe('normalizeUberEatsOrder', () => {
    it('should normalize an Uber Eats order and convert cents to major units', () => {
      const result = service.normalizeUberEatsOrder(validUberEatsOrder());

      expect(result.channel).toBe(OrderChannel.UBER_EATS);
      expect(result.externalId).toBe('UE-88');
      expect(result.customerName).toBe('Dana Lopez');
      expect(result.currency).toBe('USD');
      expect(result.notes).toBe('Leave at door');
      expect(result.items[0].sku).toBeNull();
      expect(result.items[0].unitPrice).toBe(4.75);
      // 3 * 4.75
      expect(result.items[0].subtotal).toBe(14.25);
      expect(result.subtotal).toBe(14.25);
    });

    it('should derive currency from the first item', () => {
      const order = validUberEatsOrder();
      order.items[0].price.currency_code = 'GBP';
      expect(service.normalizeUberEatsOrder(order).currency).toBe('GBP');
    });

    it('should join only the names that are present', () => {
      const order = validUberEatsOrder();
      order.eater = { first_name: 'Solo' };
      expect(service.normalizeUberEatsOrder(order).customerName).toBe('Solo');
    });

    it('should map a missing eater to a null customer name', () => {
      const order = validUberEatsOrder();
      delete order.eater;
      expect(service.normalizeUberEatsOrder(order).customerName).toBeNull();
    });

    it('should omit notes when there are no special instructions', () => {
      const order = validUberEatsOrder();
      delete order.special_instructions;
      expect(service.normalizeUberEatsOrder(order).notes).toBeUndefined();
    });

    it('should throw for an empty display_id', () => {
      expect(() =>
        service.normalizeUberEatsOrder({ ...validUberEatsOrder(), display_id: '' })
      ).toThrow('[OrderNormalizationService] Uber Eats display_id is required');
    });

    it('should throw for a whitespace-only display_id', () => {
      expect(() =>
        service.normalizeUberEatsOrder({ ...validUberEatsOrder(), display_id: '   ' })
      ).toThrow('[OrderNormalizationService] Uber Eats display_id cannot be empty');
    });

    it('should throw for an empty item list', () => {
      expect(() => service.normalizeUberEatsOrder({ ...validUberEatsOrder(), items: [] })).toThrow(
        '[OrderNormalizationService] Uber Eats items cannot be empty'
      );
    });
  });

  describe('normalizeOrderAheadOrder', () => {
    it('should normalize an order-ahead submission', () => {
      const result = service.normalizeOrderAheadOrder(validOrderAheadOrder());

      expect(result.channel).toBe(OrderChannel.ORDER_AHEAD);
      expect(result.externalId).toBe('OA-7');
      expect(result.customerName).toBe('Lena Ortiz');
      expect(result.currency).toBe('USD');
      // 2 * 4.50 + 1 * 3.75
      expect(result.subtotal).toBe(12.75);
      expect(result.items[0].sku).toBe('CAP-001');
      expect(result.items[1].sku).toBeNull();
      expect(result.items[1].notes).toBe('gluten free');
    });

    it('should throw for an empty order number', () => {
      expect(() =>
        service.normalizeOrderAheadOrder({ ...validOrderAheadOrder(), orderNumber: '' })
      ).toThrow('[OrderNormalizationService] Order number is required');
    });

    it('should throw for an empty line-item list', () => {
      expect(() =>
        service.normalizeOrderAheadOrder({ ...validOrderAheadOrder(), lineItems: [] })
      ).toThrow('[OrderNormalizationService] Line items cannot be empty');
    });
  });

  it('should produce the same unified shape across every channel', () => {
    const pos = service.normalizePosOrder(validPosOrder());
    const uber = service.normalizeUberEatsOrder(validUberEatsOrder());
    const ahead = service.normalizeOrderAheadOrder(validOrderAheadOrder());

    for (const order of [pos, uber, ahead]) {
      expect(Object.keys(order).sort()).toEqual(
        expect.arrayContaining([
          'channel',
          'externalId',
          'customerName',
          'items',
          'subtotal',
          'currency',
          'placedAt',
        ])
      );
      expect(order.placedAt).toBeInstanceOf(Date);
      expect(typeof order.subtotal).toBe('number');
    }
  });
});

// Made with Bob
