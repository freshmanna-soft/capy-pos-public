import { Product } from '../entities/product.entity';

/**
 * Product Repository Interface
 * Defines the contract for product data access
 * Follows Interface Segregation Principle (SOLID)
 * Enables easy switching between SQLite and API implementations
 */
export interface IProductRepository {
  /**
   * Retrieves all products
   * @returns Promise resolving to array of products
   */
  findAll(): Promise<Product[]>;

  /**
   * Retrieves a product by ID
   * @param id - Product identifier
   * @returns Promise resolving to product or null if not found
   */
  findById(id: string): Promise<Product | null>;

  /**
   * Retrieves products by category
   * @param category - Category name
   * @returns Promise resolving to array of products
   */
  findByCategory(category: string): Promise<Product[]>;

  /**
   * Searches products by name or SKU
   * @param query - Search query
   * @returns Promise resolving to array of matching products
   */
  search(query: string): Promise<Product[]>;

  /**
   * Retrieves products with low stock
   * @param threshold - Stock threshold (default: 10)
   * @returns Promise resolving to array of low-stock products
   */
  findLowStock(threshold?: number): Promise<Product[]>;

  /**
   * Creates a new product
   * @param product - Product to create
   * @returns Promise resolving to created product
   */
  create(product: Product): Promise<Product>;

  /**
   * Updates an existing product
   * @param id - Product identifier
   * @param product - Updated product data
   * @returns Promise resolving to updated product
   */
  update(id: string, product: Partial<Product>): Promise<Product>;

  /**
   * Deletes a product
   * @param id - Product identifier
   * @returns Promise resolving when deletion is complete
   */
  delete(id: string): Promise<void>;

  /**
   * Checks if a product exists
   * @param id - Product identifier
   * @returns Promise resolving to boolean
   */
  exists(id: string): Promise<boolean>;

  /**
   * Counts total products
   * @returns Promise resolving to product count
   */
  count(): Promise<number>;

  /**
   * Bulk creates products
   * @param products - Array of products to create
   * @returns Promise resolving to array of created products
   */
  bulkCreate(products: Product[]): Promise<Product[]>;

  /**
   * Bulk updates products
   * @param updates - Array of product updates with IDs
   * @returns Promise resolving to array of updated products
   */
  bulkUpdate(updates: Array<{ id: string; data: Partial<Product> }>): Promise<Product[]>;
}

// Made with Bob
