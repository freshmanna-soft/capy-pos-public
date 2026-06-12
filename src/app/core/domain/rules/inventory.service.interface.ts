/**
 * Inventory Service Interface
 *
 * Defines the contract for inventory management operations including
 * stock checking, reservation, and availability calculations.
 *
 * @interface IInventoryService
 */

/**
 * Stock reservation details
 */
export interface StockReservation {
  productId: string;
  quantity: number;
  reservedAt: Date;
  expiresAt: Date;
  reservationId: string;
}

/**
 * Stock availability result
 */
export interface StockAvailability {
  productId: string;
  available: number;
  reserved: number;
  total: number;
  isAvailable: boolean;
}

/**
 * Low stock alert configuration
 */
export interface LowStockThreshold {
  productId: string;
  threshold: number;
  currentStock: number;
  isLowStock: boolean;
}

/**
 * Stock adjustment record
 */
export interface StockAdjustment {
  productId: string;
  previousQuantity: number;
  newQuantity: number;
  adjustmentAmount: number;
  reason: string;
  adjustedAt: Date;
}

/**
 * Inventory Service Interface
 *
 * Provides methods for managing product inventory including stock checks,
 * reservations, adjustments, and availability calculations.
 */
export interface IInventoryService {
  /**
   * Check if sufficient stock is available for a product
   *
   * @param productId - The product identifier
   * @param requestedQuantity - The quantity to check
   * @param currentStock - The current stock level
   * @returns Stock availability details
   * @throws Error if productId is empty or quantities are invalid
   */
  checkAvailability(
    productId: string,
    requestedQuantity: number,
    currentStock: number
  ): StockAvailability;

  /**
   * Reserve stock for a product (e.g., during checkout)
   *
   * @param productId - The product identifier
   * @param quantity - The quantity to reserve
   * @param currentStock - The current stock level
   * @param reservedStock - The currently reserved stock
   * @param durationMinutes - How long to hold the reservation (default: 15)
   * @returns Stock reservation details
   * @throws Error if insufficient stock or invalid parameters
   */
  reserveStock(
    productId: string,
    quantity: number,
    currentStock: number,
    reservedStock: number,
    durationMinutes?: number
  ): StockReservation;

  /**
   * Release a stock reservation
   *
   * @param reservationId - The reservation identifier
   * @param quantity - The quantity to release
   * @returns The released quantity
   * @throws Error if reservationId is empty or quantity is invalid
   */
  releaseReservation(reservationId: string, quantity: number): number;

  /**
   * Adjust stock levels (add or remove inventory)
   *
   * @param productId - The product identifier
   * @param currentStock - The current stock level
   * @param adjustmentAmount - The amount to adjust (positive to add, negative to remove)
   * @param reason - The reason for adjustment
   * @returns Stock adjustment record
   * @throws Error if adjustment would result in negative stock
   */
  adjustStock(
    productId: string,
    currentStock: number,
    adjustmentAmount: number,
    reason: string
  ): StockAdjustment;

  /**
   * Check if stock is below threshold (low stock alert)
   *
   * @param productId - The product identifier
   * @param currentStock - The current stock level
   * @param threshold - The low stock threshold
   * @returns Low stock threshold details
   * @throws Error if productId is empty or values are invalid
   */
  checkLowStock(productId: string, currentStock: number, threshold: number): LowStockThreshold;

  /**
   * Calculate available stock after reservations
   *
   * @param currentStock - The current stock level
   * @param reservedStock - The currently reserved stock
   * @returns Available stock quantity
   * @throws Error if values are invalid
   */
  calculateAvailableStock(currentStock: number, reservedStock: number): number;

  /**
   * Validate if a stock operation is allowed
   *
   * @param currentStock - The current stock level
   * @param requestedQuantity - The quantity requested
   * @param reservedStock - The currently reserved stock
   * @returns True if operation is allowed
   */
  canFulfillOrder(currentStock: number, requestedQuantity: number, reservedStock: number): boolean;
}

// Made with Bob
