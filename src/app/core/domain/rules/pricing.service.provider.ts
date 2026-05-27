import { InjectionToken, Provider } from '@angular/core';
import { IPricingService } from './pricing.service.interface';
import { PricingService } from './pricing.service';

/**
 * Injection Token for IPricingService
 * 
 * This token allows us to inject the interface rather than the concrete implementation,
 * following the Dependency Inversion Principle (DIP).
 * 
 * @example
 * ```typescript
 * // In a component or service
 * constructor(@Inject(PRICING_SERVICE) private pricingService: IPricingService) {}
 * ```
 */
export const PRICING_SERVICE = new InjectionToken<IPricingService>('IPricingService', {
  providedIn: 'root',
  factory: () => new PricingService()
});

/**
 * Provider configuration for PricingService
 * 
 * Use this provider in your module or component providers array
 * when you need to override the default implementation.
 * 
 * @example
 * ```typescript
 * // In app.config.ts or component providers
 * providers: [
 *   providePricingService()
 * ]
 * ```
 */
export function providePricingService(): Provider {
  return {
    provide: PRICING_SERVICE,
    useClass: PricingService
  };
}

/**
 * Provider for using a custom implementation
 * 
 * @example
 * ```typescript
 * // In tests or when using a mock
 * providers: [
 *   providePricingServiceImpl(MockPricingService)
 * ]
 * ```
 */
export function providePricingServiceImpl(implementation: new () => IPricingService): Provider {
  return {
    provide: PRICING_SERVICE,
    useClass: implementation
  };
}

// Made with Bob