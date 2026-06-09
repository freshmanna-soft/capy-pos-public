import { Product } from '@core/domain/entities/product.entity';
import { IBaseApplicationService } from '@core/application/services/base-application.service.interface';

/**
 * Product Service Interface
 * Extends IBaseApplicationService with product-specific operations
 * Defines contract for product-related operations
 * Follows Interface Segregation Principle (SOLID)
 */
export interface IProductService extends IBaseApplicationService<Product> {
  // Product-specific operations
  getProductsByCategory(category: string): Promise<Product[]>;
  getActiveProducts(): Promise<Product[]>;
  searchProducts(query: string, limit?: number): Promise<Product[]>;
  getLowStockProducts(): Promise<Product[]>;
  updateStock(productId: string, quantity: number): Promise<Product>;
  adjustStock(productId: string, adjustment: number): Promise<Product>;
  updatePrice(productId: string, price: number, cost?: number): Promise<Product>;
  getCategories(): Promise<string[]>;
}

// Made with Bob
