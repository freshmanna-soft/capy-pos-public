import { InjectionToken, Provider } from '@angular/core';
import { IRentCollectionService } from '@core/domain/rules/rent-collection.service.interface';
import { RentCollectionService } from '@core/domain/rules/rent-collection.service';

/**
 * Injection token for IRentCollectionService
 *
 * Use this token to inject the rent collection service interface rather than
 * the concrete implementation, following the Dependency Inversion Principle.
 *
 * @example
 * ```typescript
 * constructor(
 *   @Inject(RENT_COLLECTION_SERVICE) private rent: IRentCollectionService
 * ) {}
 * ```
 */
export const RENT_COLLECTION_SERVICE = new InjectionToken<IRentCollectionService>(
  'IRentCollectionService',
  {
    providedIn: 'root',
    factory: () => new RentCollectionService(),
  }
);

/**
 * Provides the rent collection service using the interface token
 *
 * @returns Provider configuration for IRentCollectionService
 *
 * @example
 * ```typescript
 * // In app.config.ts or component providers
 * providers: [
 *   provideRentCollectionService()
 * ]
 * ```
 */
export function provideRentCollectionService(): Provider {
  return {
    provide: RENT_COLLECTION_SERVICE,
    useClass: RentCollectionService,
  };
}

/**
 * Provides a specific implementation of the rent collection service
 *
 * @param implementation - The concrete implementation class
 * @returns Provider configuration
 *
 * @example
 * ```typescript
 * // In app.config.ts for testing with a mock
 * providers: [
 *   provideRentCollectionServiceImpl(MockRentCollectionService)
 * ]
 * ```
 */
export function provideRentCollectionServiceImpl(
  implementation: new () => IRentCollectionService
): Provider {
  return {
    provide: RENT_COLLECTION_SERVICE,
    useClass: implementation,
  };
}

// Made with Bob
