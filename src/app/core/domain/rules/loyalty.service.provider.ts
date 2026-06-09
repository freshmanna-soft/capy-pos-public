import { InjectionToken, Provider } from '@angular/core';
import { ILoyaltyService } from '@core/domain/rules/loyalty.service.interface';
import { LoyaltyService } from '@core/domain/rules/loyalty.service';

/**
 * Injection token for ILoyaltyService
 *
 * Use this token to inject the loyalty service interface rather than
 * the concrete implementation, following the Dependency Inversion Principle.
 *
 * @example
 * ```typescript
 * constructor(@Inject(LOYALTY_SERVICE) private loyaltyService: ILoyaltyService) {}
 * ```
 */
export const LOYALTY_SERVICE = new InjectionToken<ILoyaltyService>('ILoyaltyService', {
  providedIn: 'root',
  factory: () => new LoyaltyService(),
});

/**
 * Provides the loyalty service using the interface token
 *
 * @returns Provider configuration for ILoyaltyService
 *
 * @example
 * ```typescript
 * // In app.config.ts or component providers
 * providers: [
 *   provideLoyaltyService()
 * ]
 * ```
 */
export function provideLoyaltyService(): Provider {
  return {
    provide: LOYALTY_SERVICE,
    useClass: LoyaltyService,
  };
}

/**
 * Provides a specific implementation of the loyalty service
 *
 * @param implementation - The concrete implementation class
 * @returns Provider configuration
 *
 * @example
 * ```typescript
 * // In app.config.ts for testing with a mock
 * providers: [
 *   provideLoyaltyServiceImpl(MockLoyaltyService)
 * ]
 * ```
 */
export function provideLoyaltyServiceImpl(implementation: new () => ILoyaltyService): Provider {
  return {
    provide: LOYALTY_SERVICE,
    useClass: implementation,
  };
}

// Made with Bob
