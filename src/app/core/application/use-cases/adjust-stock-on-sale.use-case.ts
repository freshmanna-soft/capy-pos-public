import { Injectable, inject } from '@angular/core';
import { IProductRepository } from '@core/domain/interfaces/product.repository.interface';
import { PRODUCT_REPOSITORY } from '@core/infrastructure/factories/repository.factory';

/**
 * Represents a single item whose stock needs adjustment after a sale.
 */
export interface StockAdjustmentItem {
  /** The product ID to adjust */
  productId: string;
  /** The quantity sold (positive number) */
  quantity: number;
}

/**
 * Details of a successfully adjusted product.
 */
export interface AdjustedProductDetail {
  productId: string;
  previousStock: number;
  newStock: number;
  quantitySold: number;
}

/**
 * Details of a failed stock adjustment.
 */
export interface FailedAdjustmentDetail {
  productId: string;
  quantity: number;
  error: string;
}

/**
 * Result of the stock adjustment operation.
 */
export interface StockAdjustmentResult {
  /** Whether all adjustments succeeded */
  success: boolean;
  /** Products that were successfully adjusted */
  adjustedProducts: AdjustedProductDetail[];
  /** Products that failed to adjust */
  failedAdjustments: FailedAdjustmentDetail[];
  /** Timestamp of the adjustment */
  timestamp: Date;
}

/**
 * AdjustStockOnSaleUseCase
 *
 * Automatically decreases product stock levels when a sale is completed.
 * Processes each item individually to allow partial success — if one product
 * fails to adjust, others still proceed. Failures are logged for manual
 * reconciliation.
 *
 * Clean Architecture: Application Layer Use Case
 * - Depends on: IProductRepository (domain interface)
 * - Called by: POS Terminal component after payment completion
 *
 * @example
 * ```typescript
 * const items = cartItems.map(item => ({
 *   productId: item.product.id,
 *   quantity: item.quantity
 * }));
 * const result = await adjustStockUseCase.execute(items);
 * ```
 */
@Injectable({ providedIn: 'root' })
export class AdjustStockOnSaleUseCase {
  private readonly productRepository = inject<IProductRepository>(PRODUCT_REPOSITORY);

  /**
   * Executes stock adjustment for all items sold in a transaction.
   *
   * @param items - Array of products and quantities to adjust
   * @returns StockAdjustmentResult with success/failure details
   */
  async execute(items: StockAdjustmentItem[]): Promise<StockAdjustmentResult> {
    const adjustedProducts: AdjustedProductDetail[] = [];
    const failedAdjustments: FailedAdjustmentDetail[] = [];

    // Filter out invalid items (zero or negative quantities)
    const validItems = items.filter((item) => item.quantity > 0);

    for (const item of validItems) {
      try {
        // Get current stock before adjustment for audit trail
        const currentProduct = await this.productRepository.findById(item.productId);
        const previousStock = currentProduct?.stock ?? 0;

        // Apply negative adjustment (decrease stock by quantity sold)
        const updatedProduct = await this.productRepository.adjustStock(
          item.productId,
          -item.quantity
        );

        adjustedProducts.push({
          productId: item.productId,
          previousStock,
          newStock: updatedProduct.stock,
          quantitySold: item.quantity,
        });
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : 'Unknown error';
        console.error(
          `[AdjustStockOnSale] Failed to adjust stock for product ${item.productId}:`,
          errorMessage
        );

        failedAdjustments.push({
          productId: item.productId,
          quantity: item.quantity,
          error: errorMessage,
        });
      }
    }

    const success = failedAdjustments.length === 0;

    if (!success) {
      console.warn(
        `[AdjustStockOnSale] ${failedAdjustments.length} of ${validItems.length} stock adjustments failed. Manual reconciliation required.`
      );
    }

    return {
      success,
      adjustedProducts,
      failedAdjustments,
      timestamp: new Date(),
    };
  }
}
