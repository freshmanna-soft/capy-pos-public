import { Injectable, Inject } from '@angular/core';
import { Product } from '../../domain/entities/product.entity';
import { IProductRepository } from '../../domain/interfaces/product.repository.interface';
import { PRODUCT_REPOSITORY } from '../../infrastructure/factories/repository.factory';

/**
 * Get Products Use Case
 * Application layer use case following Clean Architecture
 * Orchestrates business logic without knowing about infrastructure details
 * Follows Single Responsibility Principle (SOLID)
 */
@Injectable({
  providedIn: 'root'
})
export class GetProductsUseCase {
  constructor(
    @Inject(PRODUCT_REPOSITORY) private repository: IProductRepository
  ) {}

  /**
   * Executes the use case to get all products
   * @returns Promise resolving to array of products
   */
  async execute(): Promise<Product[]> {
    return await this.repository.findAll();
  }

  /**
   * Gets products by category
   * @param category - Category name
   * @returns Promise resolving to array of products
   */
  async byCategory(category: string): Promise<Product[]> {
    return await this.repository.findByCategory(category);
  }

  /**
   * Searches products
   * @param query - Search query
   * @returns Promise resolving to array of matching products
   */
  async search(query: string): Promise<Product[]> {
    return await this.repository.search(query);
  }

  /**
   * Gets low stock products
   * @param threshold - Stock threshold
   * @returns Promise resolving to array of low-stock products
   */
  async lowStock(threshold?: number): Promise<Product[]> {
    return await this.repository.findLowStock(threshold);
  }
}

// Made with Bob
