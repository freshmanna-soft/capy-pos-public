import { Injectable } from '@angular/core';
import { Product } from '../../domain/entities/product.entity';
import { ProductRepositoryService } from '../../infrastructure/factories/repository.factory';

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
  constructor(private repositoryService: ProductRepositoryService) {}

  /**
   * Executes the use case to get all products
   * @returns Promise resolving to array of products
   */
  async execute(): Promise<Product[]> {
    const repository = this.repositoryService.getRepository();
    return await repository.findAll();
  }

  /**
   * Gets products by category
   * @param category - Category name
   * @returns Promise resolving to array of products
   */
  async byCategory(category: string): Promise<Product[]> {
    const repository = this.repositoryService.getRepository();
    return await repository.findByCategory(category);
  }

  /**
   * Searches products
   * @param query - Search query
   * @returns Promise resolving to array of matching products
   */
  async search(query: string): Promise<Product[]> {
    const repository = this.repositoryService.getRepository();
    return await repository.search(query);
  }

  /**
   * Gets low stock products
   * @param threshold - Stock threshold
   * @returns Promise resolving to array of low-stock products
   */
  async lowStock(threshold?: number): Promise<Product[]> {
    const repository = this.repositoryService.getRepository();
    return await repository.findLowStock(threshold);
  }
}

// Made with Bob
