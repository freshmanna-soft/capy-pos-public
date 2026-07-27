import { InjectionToken, Provider } from '@angular/core';
import { IOrderNormalizationService } from '@core/domain/rules/order-normalization.service.interface';
import { OrderNormalizationService } from '@core/domain/rules/order-normalization.service';

/**
 * Injection token for IOrderNormalizationService
 *
 * Use this token to inject the order normalization service interface rather
 * than the concrete implementation, following the Dependency Inversion
 * Principle.
 *
 * @example
 * ```typescript
 * constructor(
 *   @Inject(ORDER_NORMALIZATION_SERVICE) private normalizer: IOrderNormalizationService
 * ) {}
 * ```
 */
export const ORDER_NORMALIZATION_SERVICE = new InjectionToken<IOrderNormalizationService>(
  'IOrderNormalizationService',
  {
    providedIn: 'root',
    factory: () => new OrderNormalizationService(),
  }
);

/**
 * Provides the order normalization service using the interface token
 *
 * @returns Provider configuration for IOrderNormalizationService
 *
 * @example
 * ```typescript
 * // In app.config.ts or component providers
 * providers: [
 *   provideOrderNormalizationService()
 * ]
 * ```
 */
export function provideOrderNormalizationService(): Provider {
  return {
    provide: ORDER_NORMALIZATION_SERVICE,
    useClass: OrderNormalizationService,
  };
}

/**
 * Provides a specific implementation of the order normalization service
 *
 * @param implementation - The concrete implementation class
 * @returns Provider configuration
 *
 * @example
 * ```typescript
 * // In app.config.ts for testing with a mock
 * providers: [
 *   provideOrderNormalizationServiceImpl(MockOrderNormalizationService)
 * ]
 * ```
 */
export function provideOrderNormalizationServiceImpl(
  implementation: new () => IOrderNormalizationService
): Provider {
  return {
    provide: ORDER_NORMALIZATION_SERVICE,
    useClass: implementation,
  };
}

// Made with Bob
