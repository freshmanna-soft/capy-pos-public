import { Injectable, inject } from '@angular/core';
import { IProductRepository } from '@core/domain/interfaces/product.repository.interface';
import { PRODUCT_REPOSITORY } from '@core/infrastructure/factories/repository.factory';
import { Product } from '@core/domain/entities/product.entity';
import { BaseApplicationService } from '@core/application/services/base-application.service';
import { IProductService } from '@core/application/services/product.service.interface';

/**
 * Product Application Service
 * Implements IProductService interface
 * Extends BaseApplicationService with product-specific operations
 * Orchestrates product-related use cases
 * Uses repository through dependency injection
 *
 * @example
 * ```typescript
 * constructor(private productService: ProductService) {}
 *
 * async loadProducts() {
 *   const products = await this.productService.getAll();
 * }
 * ```
 */
@Injectable({
  providedIn: 'root',
})
export class ProductService
  extends BaseApplicationService<Product, IProductRepository>
  implements IProductService
{
  constructor() {
    const productRepository = inject<IProductRepository>(PRODUCT_REPOSITORY);

    super(productRepository);
  }

  /**
   * Get products by category
   */
  async getProductsByCategory(category: string): Promise<Product[]> {
    return this.repository.findByCategory(category);
  }

  /**
   * Get active products
   */
  async getActiveProducts(): Promise<Product[]> {
    return this.repository.findActive();
  }

  /**
   * Search products
   */
  async searchProducts(query: string, limit?: number): Promise<Product[]> {
    return this.repository.search(query, limit);
  }

  /**
   * Get low stock products
   */
  async getLowStockProducts(): Promise<Product[]> {
    return this.repository.findLowStock();
  }

  /**
   * Update product stock
   */
  async updateStock(productId: string, quantity: number): Promise<Product> {
    return this.repository.updateStock(productId, quantity);
  }

  /**
   * Adjust product stock
   */
  async adjustStock(productId: string, adjustment: number): Promise<Product> {
    return this.repository.adjustStock(productId, adjustment);
  }

  /**
   * Update product price
   */
  async updatePrice(productId: string, price: number, cost?: number): Promise<Product> {
    return this.repository.updatePrice(productId, price, cost);
  }

  /**
   * Get all categories
   */
  async getCategories(): Promise<string[]> {
    return this.repository.getCategories();
  }

  /**
   * Validate product before operations
   * Override from base service
   */
  protected override validateEntity(product: Product): void {
    if (!product.name || product.name.trim() === '') {
      throw new Error('Product name is required');
    }
    if (product.price < 0) {
      throw new Error('Product price cannot be negative');
    }
    if (!product.sku || product.sku.trim() === '') {
      throw new Error('Product SKU is required');
    }
  }
}

// Made with Bob
