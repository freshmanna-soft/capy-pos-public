import { describe, it, expect, beforeEach } from 'vitest';
import { InventoryService } from './inventory.service';
import type { IInventoryService } from './inventory.service.interface';

describe('InventoryService', () => {
  let service: IInventoryService;

  beforeEach(() => {
    service = new InventoryService();
  });

  describe('checkAvailability', () => {
    it.each([
      ['P1', 5, 10, true, 10],
      ['P2', 10, 10, true, 10],
      ['P3', 15, 10, false, 10],
      ['P4', 1, 100, true, 100]
    ])(
      'should check availability for productId=%s, requested=%i, stock=%i',
      (productId, requested, stock, expectedAvailable, expectedTotal) => {
        const result = service.checkAvailability(productId, requested, stock);

        expect(result.productId).toBe(productId);
        expect(result.isAvailable).toBe(expectedAvailable);
        expect(result.available).toBe(stock);
        expect(result.total).toBe(expectedTotal);
        expect(result.reserved).toBe(0);
      }
    );

    it('should throw error for empty product ID', () => {
      expect(() => service.checkAvailability('', 5, 10)).toThrow(
        '[InventoryService] Product ID is required'
      );
    });

    it('should throw error for negative requested quantity', () => {
      expect(() => service.checkAvailability('P1', -5, 10)).toThrow(
        '[InventoryService] Requested quantity must be positive'
      );
    });

    it('should throw error for negative current stock', () => {
      expect(() => service.checkAvailability('P1', 5, -10)).toThrow(
        '[InventoryService] Current stock must be non-negative'
      );
    });
  });

  describe('reserveStock', () => {
    it('should reserve stock successfully', () => {
      const result = service.reserveStock('P1', 5, 10, 0, 15);

      expect(result.productId).toBe('P1');
      expect(result.quantity).toBe(5);
      expect(result.reservationId).toMatch(/^RES-P1-\d+-[a-z0-9]+$/);
      expect(result.reservedAt).toBeInstanceOf(Date);
      expect(result.expiresAt).toBeInstanceOf(Date);
      expect(result.expiresAt.getTime() - result.reservedAt.getTime()).toBe(15 * 60000);
    });

    it('should use default duration of 15 minutes', () => {
      const result = service.reserveStock('P1', 5, 10, 0);

      expect(result.expiresAt.getTime() - result.reservedAt.getTime()).toBe(15 * 60000);
    });

    it('should throw error when insufficient stock available', () => {
      expect(() => service.reserveStock('P1', 10, 10, 5)).toThrow(
        '[InventoryService] Insufficient stock available. Requested: 10, Available: 5'
      );
    });

    it('should throw error for empty product ID', () => {
      expect(() => service.reserveStock('', 5, 10, 0)).toThrow(
        '[InventoryService] Product ID is required'
      );
    });

    it('should throw error for negative quantity', () => {
      expect(() => service.reserveStock('P1', -5, 10, 0)).toThrow(
        '[InventoryService] Quantity must be positive'
      );
    });
  });

  describe('releaseReservation', () => {
    it('should release reservation successfully', () => {
      const released = service.releaseReservation('RES-123', 5);

      expect(released).toBe(5);
    });

    it('should throw error for empty reservation ID', () => {
      expect(() => service.releaseReservation('', 5)).toThrow(
        '[InventoryService] Reservation ID is required'
      );
    });

    it('should throw error for negative quantity', () => {
      expect(() => service.releaseReservation('RES-123', -5)).toThrow(
        '[InventoryService] Quantity must be positive'
      );
    });
  });

  describe('adjustStock', () => {
    it.each([
      ['P1', 10, 5, 'Restock', 15],
      ['P2', 10, -3, 'Damage', 7],
      ['P3', 0, 100, 'Initial stock', 100],
      ['P4', 50, -50, 'Sold out', 0]
    ])(
      'should adjust stock for productId=%s, current=%i, adjustment=%i',
      (productId, current, adjustment, reason, expectedNew) => {
        const result = service.adjustStock(productId, current, adjustment, reason);

        expect(result.productId).toBe(productId);
        expect(result.previousQuantity).toBe(current);
        expect(result.newQuantity).toBe(expectedNew);
        expect(result.adjustmentAmount).toBe(adjustment);
        expect(result.reason).toBe(reason);
        expect(result.adjustedAt).toBeInstanceOf(Date);
      }
    );

    it('should throw error when adjustment results in negative stock', () => {
      expect(() => service.adjustStock('P1', 10, -15, 'Test')).toThrow(
        '[InventoryService] Stock adjustment would result in negative stock. Current: 10, Adjustment: -15, Result: -5'
      );
    });

    it('should throw error for empty product ID', () => {
      expect(() => service.adjustStock('', 10, 5, 'Test')).toThrow(
        '[InventoryService] Product ID is required'
      );
    });

    it('should throw error for empty reason', () => {
      expect(() => service.adjustStock('P1', 10, 5, '')).toThrow(
        '[InventoryService] Reason is required'
      );
    });
  });

  describe('checkLowStock', () => {
    it.each([
      ['P1', 5, 10, true],
      ['P2', 10, 10, true],
      ['P3', 11, 10, false],
      ['P4', 0, 5, true],
      ['P5', 100, 20, false]
    ])(
      'should check low stock for productId=%s, stock=%i, threshold=%i',
      (productId, stock, threshold, expectedLow) => {
        const result = service.checkLowStock(productId, stock, threshold);

        expect(result.productId).toBe(productId);
        expect(result.currentStock).toBe(stock);
        expect(result.threshold).toBe(threshold);
        expect(result.isLowStock).toBe(expectedLow);
      }
    );

    it('should throw error for empty product ID', () => {
      expect(() => service.checkLowStock('', 10, 5)).toThrow(
        '[InventoryService] Product ID is required'
      );
    });

    it('should throw error for negative current stock', () => {
      expect(() => service.checkLowStock('P1', -10, 5)).toThrow(
        '[InventoryService] Current stock must be non-negative'
      );
    });

    it('should throw error for negative threshold', () => {
      expect(() => service.checkLowStock('P1', 10, -5)).toThrow(
        '[InventoryService] Threshold must be non-negative'
      );
    });
  });

  describe('calculateAvailableStock', () => {
    it.each([
      [10, 0, 10],
      [10, 5, 5],
      [10, 10, 0],
      [100, 25, 75]
    ])(
      'should calculate available stock for current=%i, reserved=%i',
      (current, reserved, expected) => {
        const result = service.calculateAvailableStock(current, reserved);

        expect(result).toBe(expected);
      }
    );

    it('should throw error when reserved exceeds current', () => {
      expect(() => service.calculateAvailableStock(10, 15)).toThrow(
        '[InventoryService] Reserved stock cannot exceed current stock. Current: 10, Reserved: 15'
      );
    });

    it('should throw error for negative current stock', () => {
      expect(() => service.calculateAvailableStock(-10, 5)).toThrow(
        '[InventoryService] Current stock must be non-negative'
      );
    });

    it('should throw error for negative reserved stock', () => {
      expect(() => service.calculateAvailableStock(10, -5)).toThrow(
        '[InventoryService] Reserved stock must be non-negative'
      );
    });
  });

  describe('canFulfillOrder', () => {
    it.each([
      [10, 5, 0, true],
      [10, 10, 0, true],
      [10, 11, 0, false],
      [10, 5, 5, true],
      [10, 6, 5, false],
      [100, 50, 25, true],
      [100, 76, 25, false]
    ])(
      'should check if order can be fulfilled for current=%i, requested=%i, reserved=%i',
      (current, requested, reserved, expected) => {
        const result = service.canFulfillOrder(current, requested, reserved);

        expect(result).toBe(expected);
      }
    );

    it('should throw error for negative current stock', () => {
      expect(() => service.canFulfillOrder(-10, 5, 0)).toThrow(
        '[InventoryService] Current stock must be non-negative'
      );
    });

    it('should throw error for negative requested quantity', () => {
      expect(() => service.canFulfillOrder(10, -5, 0)).toThrow(
        '[InventoryService] Requested quantity must be positive'
      );
    });

    it('should throw error for negative reserved stock', () => {
      expect(() => service.canFulfillOrder(10, 5, -5)).toThrow(
        '[InventoryService] Reserved stock must be non-negative'
      );
    });
  });
});

// Made with Bob
