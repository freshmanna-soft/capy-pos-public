import { InjectionToken, Provider } from '@angular/core';
import { IVaccinationSchedulingService } from '@core/domain/rules/vaccination-scheduling.service.interface';
import { VaccinationSchedulingService } from '@core/domain/rules/vaccination-scheduling.service';

/**
 * Injection token for IVaccinationSchedulingService
 *
 * Use this token to inject the vaccination scheduling service interface rather
 * than the concrete implementation, following the Dependency Inversion
 * Principle.
 *
 * @example
 * ```typescript
 * constructor(
 *   @Inject(VACCINATION_SCHEDULING_SERVICE) private vaccinations: IVaccinationSchedulingService
 * ) {}
 * ```
 */
export const VACCINATION_SCHEDULING_SERVICE = new InjectionToken<IVaccinationSchedulingService>(
  'IVaccinationSchedulingService',
  {
    providedIn: 'root',
    factory: () => new VaccinationSchedulingService(),
  }
);

/**
 * Provides the vaccination scheduling service using the interface token
 *
 * @returns Provider configuration for IVaccinationSchedulingService
 *
 * @example
 * ```typescript
 * // In app.config.ts or component providers
 * providers: [
 *   provideVaccinationSchedulingService()
 * ]
 * ```
 */
export function provideVaccinationSchedulingService(): Provider {
  return {
    provide: VACCINATION_SCHEDULING_SERVICE,
    useClass: VaccinationSchedulingService,
  };
}

/**
 * Provides a specific implementation of the vaccination scheduling service
 *
 * @param implementation - The concrete implementation class
 * @returns Provider configuration
 *
 * @example
 * ```typescript
 * // In app.config.ts for testing with a mock
 * providers: [
 *   provideVaccinationSchedulingServiceImpl(MockVaccinationSchedulingService)
 * ]
 * ```
 */
export function provideVaccinationSchedulingServiceImpl(
  implementation: new () => IVaccinationSchedulingService
): Provider {
  return {
    provide: VACCINATION_SCHEDULING_SERVICE,
    useClass: implementation,
  };
}

// Made with Bob
