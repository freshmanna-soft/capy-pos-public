import { Injectable, InjectionToken } from '@angular/core';
import { IProductRepository } from '../../domain/interfaces/product.repository.interface';
import { ICustomerRepository } from '../../domain/interfaces/customer.repository.interface';
import { DexieProductRepository } from '../repositories/dexie-product.repository';
import { DexieCustomerRepository } from '../repositories/dexie-customer.repository';

/**
 * Repository Type Enum
 * Defines available repository implementations
 */
export enum RepositoryType {
  LOCAL = 'local',  // Dexie (IndexedDB)
  API = 'api'       // REST API (future implementation)
}

/**
 * Repository Configuration
 * Allows runtime configuration of repository type
 */
export interface RepositoryConfig {
  type: RepositoryType;
  apiBaseUrl?: string;
}

/**
 * Injection tokens for repositories
 * Allows dependency injection of repository interfaces
 */
export const PRODUCT_REPOSITORY = new InjectionToken<IProductRepository>('PRODUCT_REPOSITORY');
export const CUSTOMER_REPOSITORY = new InjectionToken<ICustomerRepository>('CUSTOMER_REPOSITORY');
export const REPOSITORY_CONFIG = new InjectionToken<RepositoryConfig>('REPOSITORY_CONFIG');

/**
 * Repository Factory
 * Implements Strategy Pattern to provide different repository implementations
 * Follows Factory Pattern for object creation
 * 
 * @example
 * ```typescript
 * // In component or service
 * constructor(
 *   @Inject(PRODUCT_REPOSITORY) private productRepo: IProductRepository
 * ) {}
 * ```
 */
@Injectable({
  providedIn: 'root'
})
export class RepositoryFactory {
  constructor(
    private dexieProductRepo: DexieProductRepository,
    private dexieCustomerRepo: DexieCustomerRepository
  ) {}

  /**
   * Create Product Repository based on configuration
   * @param config - Repository configuration
   * @returns Product repository implementation
   */
  createProductRepository(config: RepositoryConfig): IProductRepository {
    switch (config.type) {
      case RepositoryType.LOCAL:
        return this.dexieProductRepo;
      
      case RepositoryType.API:
        // Future: Return API implementation
        // return new ApiProductRepository(config.apiBaseUrl);
        throw new Error('API repository not yet implemented');
      
      default:
        throw new Error(`Unknown repository type: ${config.type}`);
    }
  }

  /**
   * Create Customer Repository based on configuration
   * @param config - Repository configuration
   * @returns Customer repository implementation
   */
  createCustomerRepository(config: RepositoryConfig): ICustomerRepository {
    switch (config.type) {
      case RepositoryType.LOCAL:
        return this.dexieCustomerRepo;
      
      case RepositoryType.API:
        // Future: Return API implementation
        // return new ApiCustomerRepository(config.apiBaseUrl);
        throw new Error('API repository not yet implemented');
      
      default:
        throw new Error(`Unknown repository type: ${config.type}`);
    }
  }
}

/**
 * Repository Provider Factory Functions
 * These functions are used in Angular providers to create repository instances
 */

/**
 * Product Repository Provider Factory
 */
export function productRepositoryFactory(
  factory: RepositoryFactory,
  config: RepositoryConfig
): IProductRepository {
  return factory.createProductRepository(config);
}

/**
 * Customer Repository Provider Factory
 */
export function customerRepositoryFactory(
  factory: RepositoryFactory,
  config: RepositoryConfig
): ICustomerRepository {
  return factory.createCustomerRepository(config);
}

/**
 * Default Repository Configuration
 * Uses local Dexie repositories by default
 */
export const DEFAULT_REPOSITORY_CONFIG: RepositoryConfig = {
  type: RepositoryType.LOCAL
};

/**
 * Repository Providers
 * Use these in app.config.ts or module providers
 * 
 * @example
 * ```typescript
 * export const appConfig: ApplicationConfig = {
 *   providers: [
 *     ...REPOSITORY_PROVIDERS
 *   ]
 * };
 * ```
 */
export const REPOSITORY_PROVIDERS = [
  // Provide default configuration
  {
    provide: REPOSITORY_CONFIG,
    useValue: DEFAULT_REPOSITORY_CONFIG
  },
  
  // Provide Product Repository
  {
    provide: PRODUCT_REPOSITORY,
    useFactory: productRepositoryFactory,
    deps: [RepositoryFactory, REPOSITORY_CONFIG]
  },
  
  // Provide Customer Repository
  {
    provide: CUSTOMER_REPOSITORY,
    useFactory: customerRepositoryFactory,
    deps: [RepositoryFactory, REPOSITORY_CONFIG]
  }
];

// Made with Bob
