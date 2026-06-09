import { Product } from '@core/domain/entities/product.entity';
import { IBaseRepository } from '@core/domain/interfaces/base.repository.interface';

/**
 * Product Repository Interface
 *
 * Extends base repository with product-specific operations.
 * Follows Interface Segregation Principle (SOLID).
 * Enables easy switching between SQLite and API implementations.
 *
 * @interface IProductRepository
 * @extends IBaseRepository<Product>
 */
export interface IProductRepository extends IBaseRepository<Product> {
  /**
   * Retrieves products by category
   * @param category - Category name
   * @returns Promise resolving to array of products
   */
  findByCategory(category: string): Promise<Product[]>;

  /**
   * Retrieves active products
   * @returns Promise resolving to array of active products
   */
  findActive(): Promise<Product[]>;

  /**
   * Searches products by name, SKU, or barcode
   * @param query - Search query
   * @param limit - Maximum number of results (default: 50)
   * @returns Promise resolving to array of matching products
   */
  search(query: string, limit?: number): Promise<Product[]>;

  /**
   * Retrieves products with low stock
   * @param threshold - Stock threshold (default: 10)
   * @returns Promise resolving to array of low-stock products
   */
  findLowStock(threshold?: number): Promise<Product[]>;

  /**
   * Updates product stock quantity
   * @param productId - Product ID
   * @param quantity - New stock quantity
   * @returns Promise resolving to updated product
   */
  updateStock(productId: string, quantity: number): Promise<Product>;

  /**
   * Adjusts product stock (add or subtract)
   * @param productId - Product ID
   * @param adjustment - Amount to adjust (positive or negative)
   * @returns Promise resolving to updated product
   */
  adjustStock(productId: string, adjustment: number): Promise<Product>;

  /**
   * Updates product price
   * @param productId - Product ID
   * @param price - New price
   * @param cost - New cost (optional)
   * @returns Promise resolving to updated product
   */
  updatePrice(productId: string, price: number, cost?: number): Promise<Product>;

  /**
   * Gets all product categories
   * @returns Promise resolving to array of category names
   */
  getCategories(): Promise<string[]>;
}

// Made with Bob
