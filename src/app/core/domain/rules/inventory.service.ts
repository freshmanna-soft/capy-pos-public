import { Injectable } from '@angular/core';
import { BaseDomainService } from '@core/domain/rules/base-domain.service';
import {
  IInventoryService,
  StockReservation,
  StockAvailability,
  LowStockThreshold,
  StockAdjustment,
} from '@core/domain/rules/inventory.service.interface';

const CURRENT_STOCK_LABEL = 'Current stock';

/**
 * Inventory Service Implementation
 *
 * Implements inventory management operations including stock checking,
 * reservation, and availability calculations.
 *
 * @class InventoryService
 * @extends BaseDomainService
 * @implements IInventoryService
 */
@Injectable({ providedIn: 'root' })
export class InventoryService extends BaseDomainService implements IInventoryService {
  constructor() {
    super('InventoryService');
  }

  /**
   * Check if sufficient stock is available for a product
   */
  checkAvailability(
    productId: string,
    requestedQuantity: number,
    currentStock: number,
  ): StockAvailability {
    this.validateRequired(productId, 'Product ID');
    this.validatePositive(requestedQuantity, 'Requested quantity');
    this.validateNonNegative(currentStock, CURRENT_STOCK_LABEL);

    const available = currentStock;
    const isAvailable = available >= requestedQuantity;

    return {
      productId,
      available,
      reserved: 0,
      total: currentStock,
      isAvailable,
    };
  }

  /**
   * Reserve stock for a product (e.g., during checkout)
   */
  reserveStock(
    productId: string,
    quantity: number,
    currentStock: number,
    reservedStock: number,
    durationMinutes = 15,
  ): StockReservation {
    this.validateRequired(productId, 'Product ID');
    this.validatePositive(quantity, 'Quantity');
    this.validateNonNegative(currentStock, CURRENT_STOCK_LABEL);
    this.validateNonNegative(reservedStock, 'Reserved stock');
    this.validatePositive(durationMinutes, 'Duration');

    const availableStock = currentStock - reservedStock;

    if (availableStock < quantity) {
      throw new Error(
        `[${this.serviceName}] Insufficient stock available. ` +
          `Requested: ${quantity}, Available: ${availableStock}`,
      );
    }

    const now = new Date();
    const expiresAt = new Date(now.getTime() + durationMinutes * 60000);
    const reservationId = this.generateReservationId(productId, now);

    return {
      productId,
      quantity,
      reservedAt: now,
      expiresAt,
      reservationId,
    };
  }

  /**
   * Release a stock reservation
   */
  releaseReservation(reservationId: string, quantity: number): number {
    this.validateRequired(reservationId, 'Reservation ID');
    this.validatePositive(quantity, 'Quantity');

    // In a real implementation, this would update the reservation store
    // For now, we just return the released quantity
    return quantity;
  }

  /**
   * Adjust stock levels (add or remove inventory)
   */
  adjustStock(
    productId: string,
    currentStock: number,
    adjustmentAmount: number,
    reason: string,
  ): StockAdjustment {
    this.validateRequired(productId, 'Product ID');
    this.validateNonNegative(currentStock, CURRENT_STOCK_LABEL);
    this.validateRequired(reason, 'Reason');

    const newQuantity = currentStock + adjustmentAmount;

    if (newQuantity < 0) {
      throw new Error(
        `[${this.serviceName}] Stock adjustment would result in negative stock. ` +
          `Current: ${currentStock}, Adjustment: ${adjustmentAmount}, Result: ${newQuantity}`,
      );
    }

    return {
      productId,
      previousQuantity: currentStock,
      newQuantity,
      adjustmentAmount,
      reason,
      adjustedAt: new Date(),
    };
  }

  /**
   * Check if stock is below threshold (low stock alert)
   */
  checkLowStock(productId: string, currentStock: number, threshold: number): LowStockThreshold {
    this.validateRequired(productId, 'Product ID');
    this.validateNonNegative(currentStock, CURRENT_STOCK_LABEL);
    this.validateNonNegative(threshold, 'Threshold');

    return {
      productId,
      threshold,
      currentStock,
      isLowStock: currentStock <= threshold,
    };
  }

  /**
   * Calculate available stock after reservations
   */
  calculateAvailableStock(currentStock: number, reservedStock: number): number {
    this.validateNonNegative(currentStock, CURRENT_STOCK_LABEL);
    this.validateNonNegative(reservedStock, 'Reserved stock');

    if (reservedStock > currentStock) {
      throw new Error(
        `[${this.serviceName}] Reserved stock cannot exceed current stock. ` +
          `Current: ${currentStock}, Reserved: ${reservedStock}`,
      );
    }

    return currentStock - reservedStock;
  }

  /**
   * Validate if a stock operation is allowed
   */
  canFulfillOrder(currentStock: number, requestedQuantity: number, reservedStock: number): boolean {
    this.validateNonNegative(currentStock, CURRENT_STOCK_LABEL);
    this.validatePositive(requestedQuantity, 'Requested quantity');
    this.validateNonNegative(reservedStock, 'Reserved stock');

    const availableStock = this.calculateAvailableStock(currentStock, reservedStock);
    return availableStock >= requestedQuantity;
  }

  /**
   * Generate a unique reservation ID
   * @private
   */
  private generateReservationId(productId: string, timestamp: Date): string {
    const time = timestamp.getTime();
    const random = Math.random().toString(36).substring(2, 9);
    return `RES-${productId}-${time}-${random}`;
  }
}

// Made with Bob
