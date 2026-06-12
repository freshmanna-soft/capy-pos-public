import { Injectable, InjectionToken, inject } from '@angular/core';
import { IProductRepository } from '@core/domain/interfaces/product.repository.interface';
import { ICustomerRepository } from '@core/domain/interfaces/customer.repository.interface';
import { ITransactionRepository } from '@core/domain/interfaces/transaction.repository.interface';
import { IPaymentRepository } from '@core/domain/interfaces/payment.repository.interface';
import { DexieProductRepository } from '@core/infrastructure/repositories/dexie-product.repository';
import { DexieCustomerRepository } from '@core/infrastructure/repositories/dexie-customer.repository';
import { DexieTransactionRepository } from '@core/infrastructure/repositories/dexie-transaction.repository';
import { DexiePaymentRepository } from '@core/infrastructure/repositories/dexie-payment.repository';

/**
 * Repository Type Enum
 * Defines available repository implementations
 */
export enum RepositoryType {
  LOCAL = 'local', // Dexie (IndexedDB)
  API = 'api', // REST API (future implementation)
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
export const TRANSACTION_REPOSITORY = new InjectionToken<ITransactionRepository>(
  'TRANSACTION_REPOSITORY'
);
export const PAYMENT_REPOSITORY = new InjectionToken<IPaymentRepository>('PAYMENT_REPOSITORY');
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
  providedIn: 'root',
})
export class RepositoryFactory {
  private static readonly API_NOT_IMPLEMENTED = 'API repository not yet implemented';
  private readonly dexieProductRepo = inject(DexieProductRepository);
  private readonly dexieCustomerRepo = inject(DexieCustomerRepository);
  private readonly dexieTransactionRepo = inject(DexieTransactionRepository);
  private readonly dexiePaymentRepo = inject(DexiePaymentRepository);

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
        throw new Error(RepositoryFactory.API_NOT_IMPLEMENTED);

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
        throw new Error(RepositoryFactory.API_NOT_IMPLEMENTED);

      default:
        throw new Error(`Unknown repository type: ${config.type}`);
    }
  }

  /**
   * Create Transaction Repository based on configuration
   * @param config - Repository configuration
   * @returns Transaction repository implementation
   */
  createTransactionRepository(config: RepositoryConfig): ITransactionRepository {
    switch (config.type) {
      case RepositoryType.LOCAL:
        return this.dexieTransactionRepo;

      case RepositoryType.API:
        // Future: Return API implementation
        // return new ApiTransactionRepository(config.apiBaseUrl);
        throw new Error(RepositoryFactory.API_NOT_IMPLEMENTED);

      default:
        throw new Error(`Unknown repository type: ${config.type}`);
    }
  }

  /**
   * Create Payment Repository based on configuration
   * @param config - Repository configuration
   * @returns Payment repository implementation
   */
  createPaymentRepository(config: RepositoryConfig): IPaymentRepository {
    switch (config.type) {
      case RepositoryType.LOCAL:
        return this.dexiePaymentRepo;

      case RepositoryType.API:
        // Future: Return API implementation
        // return new ApiPaymentRepository(config.apiBaseUrl);
        throw new Error(RepositoryFactory.API_NOT_IMPLEMENTED);

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
 * Transaction Repository Provider Factory
 */
export function transactionRepositoryFactory(
  factory: RepositoryFactory,
  config: RepositoryConfig
): ITransactionRepository {
  return factory.createTransactionRepository(config);
}

/**
 * Payment Repository Provider Factory
 */
export function paymentRepositoryFactory(
  factory: RepositoryFactory,
  config: RepositoryConfig
): IPaymentRepository {
  return factory.createPaymentRepository(config);
}

/**
 * Default Repository Configuration
 * Uses local Dexie repositories by default
 */
export const DEFAULT_REPOSITORY_CONFIG: RepositoryConfig = {
  type: RepositoryType.LOCAL,
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
    useValue: DEFAULT_REPOSITORY_CONFIG,
  },

  // Provide Product Repository
  {
    provide: PRODUCT_REPOSITORY,
    useFactory: productRepositoryFactory,
    deps: [RepositoryFactory, REPOSITORY_CONFIG],
  },

  // Provide Customer Repository
  {
    provide: CUSTOMER_REPOSITORY,
    useFactory: customerRepositoryFactory,
    deps: [RepositoryFactory, REPOSITORY_CONFIG],
  },

  // Provide Transaction Repository
  {
    provide: TRANSACTION_REPOSITORY,
    useFactory: transactionRepositoryFactory,
    deps: [RepositoryFactory, REPOSITORY_CONFIG],
  },

  // Provide Payment Repository
  {
    provide: PAYMENT_REPOSITORY,
    useFactory: paymentRepositoryFactory,
    deps: [RepositoryFactory, REPOSITORY_CONFIG],
  },
];

// Made with Bob
