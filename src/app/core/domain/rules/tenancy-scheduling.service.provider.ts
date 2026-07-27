import { InjectionToken, Provider } from '@angular/core';
import { ITenancySchedulingService } from '@core/domain/rules/tenancy-scheduling.service.interface';
import { TenancySchedulingService } from '@core/domain/rules/tenancy-scheduling.service';

/**
 * Injection token for ITenancySchedulingService
 *
 * Use this token to inject the tenancy scheduling service interface rather
 * than the concrete implementation, following the Dependency Inversion
 * Principle.
 *
 * @example
 * ```typescript
 * constructor(
 *   @Inject(TENANCY_SCHEDULING_SERVICE) private scheduler: ITenancySchedulingService
 * ) {}
 * ```
 */
export const TENANCY_SCHEDULING_SERVICE = new InjectionToken<ITenancySchedulingService>(
  'ITenancySchedulingService',
  {
    providedIn: 'root',
    factory: () => new TenancySchedulingService(),
  }
);

/**
 * Provides the tenancy scheduling service using the interface token
 *
 * @returns Provider configuration for ITenancySchedulingService
 *
 * @example
 * ```typescript
 * // In app.config.ts or component providers
 * providers: [
 *   provideTenancySchedulingService()
 * ]
 * ```
 */
export function provideTenancySchedulingService(): Provider {
  return {
    provide: TENANCY_SCHEDULING_SERVICE,
    useClass: TenancySchedulingService,
  };
}

/**
 * Provides a specific implementation of the tenancy scheduling service
 *
 * @param implementation - The concrete implementation class
 * @returns Provider configuration
 *
 * @example
 * ```typescript
 * // In app.config.ts for testing with a mock
 * providers: [
 *   provideTenancySchedulingServiceImpl(MockTenancySchedulingService)
 * ]
 * ```
 */
export function provideTenancySchedulingServiceImpl(
  implementation: new () => ITenancySchedulingService
): Provider {
  return {
    provide: TENANCY_SCHEDULING_SERVICE,
    useClass: implementation,
  };
}

// Made with Bob
