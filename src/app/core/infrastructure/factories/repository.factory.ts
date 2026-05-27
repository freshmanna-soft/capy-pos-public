import { Injectable, inject } from '@angular/core';
import { IProductRepository } from '../../domain/interfaces/product.repository.interface';
import { SQLiteProductRepository } from '../repositories/sqlite-product.repository';
import { ApiProductRepository } from '../repositories/api-product.repository';

/**
 * Repository Type
 * Defines available repository implementations
 */
export type RepositoryType = 'sqlite' | 'api';

/**
 * Repository Configuration
 * Can be set via environment variables or configuration service
 */
export interface RepositoryConfig {
  type: RepositoryType;
  apiUrl?: string;
  dbPath?: string;
}

/**
 * Repository Factory
 * Implements Factory Pattern and Strategy Pattern
 * Enables easy switching between data sources without changing business logic
 * Follows Open/Closed Principle (SOLID) - open for extension, closed for modification
 */
@Injectable({
  providedIn: 'root'
})
export class RepositoryFactory {
  private static config: RepositoryConfig = {
    type: 'sqlite', // Default to SQLite for local development
  };

  /**
   * Configures the repository factory
   * @param config - Repository configuration
   */
  static configure(config: Partial<RepositoryConfig>): void {
    this.config = { ...this.config, ...config };
  }

  /**
   * Gets the current repository configuration
   */
  static getConfig(): RepositoryConfig {
    return { ...this.config };
  }

  /**
   * Creates a Product Repository based on configuration
   * @param type - Optional repository type override
   * @returns Product repository implementation
   */
  static createProductRepository(type?: RepositoryType): IProductRepository {
    const repoType = type || this.config.type;

    switch (repoType) {
      case 'sqlite':
        return new SQLiteProductRepository();
      
      case 'api':
        return new ApiProductRepository();
      
      default:
        throw new Error(`Unknown repository type: ${repoType}`);
    }
  }

  /**
   * Switches repository type at runtime
   * Useful for offline/online mode switching
   * @param type - New repository type
   */
  static switchRepositoryType(type: RepositoryType): void {
    this.config.type = type;
    console.log(`Repository switched to: ${type}`);
  }

  /**
   * Checks if currently using SQLite
   */
  static isUsingSQLite(): boolean {
    return this.config.type === 'sqlite';
  }

  /**
   * Checks if currently using API
   */
  static isUsingAPI(): boolean {
    return this.config.type === 'api';
  }
}

/**
 * Angular Service wrapper for Repository Factory
 * Provides dependency injection support
 */
@Injectable({
  providedIn: 'root'
})
export class ProductRepositoryService {
  private repository: IProductRepository;

  constructor() {
    // Initialize with configured repository type
    this.repository = RepositoryFactory.createProductRepository();
  }

  /**
   * Gets the current repository instance
   */
  getRepository(): IProductRepository {
    return this.repository;
  }

  /**
   * Switches repository implementation at runtime
   * @param type - New repository type
   */
  switchRepository(type: RepositoryType): void {
    RepositoryFactory.switchRepositoryType(type);
    this.repository = RepositoryFactory.createProductRepository(type);
  }

  /**
   * Gets current repository type
   */
  getCurrentType(): RepositoryType {
    return RepositoryFactory.getConfig().type;
  }
}

// Made with Bob
