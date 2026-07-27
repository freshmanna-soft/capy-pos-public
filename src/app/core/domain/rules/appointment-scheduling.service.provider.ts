import { InjectionToken, Provider } from '@angular/core';
import { IAppointmentSchedulingService } from '@core/domain/rules/appointment-scheduling.service.interface';
import { AppointmentSchedulingService } from '@core/domain/rules/appointment-scheduling.service';

/**
 * Injection token for IAppointmentSchedulingService
 *
 * Use this token to inject the appointment scheduling service interface rather
 * than the concrete implementation, following the Dependency Inversion
 * Principle.
 *
 * @example
 * ```typescript
 * constructor(
 *   @Inject(APPOINTMENT_SCHEDULING_SERVICE) private scheduler: IAppointmentSchedulingService
 * ) {}
 * ```
 */
export const APPOINTMENT_SCHEDULING_SERVICE = new InjectionToken<IAppointmentSchedulingService>(
  'IAppointmentSchedulingService',
  {
    providedIn: 'root',
    factory: () => new AppointmentSchedulingService(),
  }
);

/**
 * Provides the appointment scheduling service using the interface token
 *
 * @returns Provider configuration for IAppointmentSchedulingService
 *
 * @example
 * ```typescript
 * // In app.config.ts or component providers
 * providers: [
 *   provideAppointmentSchedulingService()
 * ]
 * ```
 */
export function provideAppointmentSchedulingService(): Provider {
  return {
    provide: APPOINTMENT_SCHEDULING_SERVICE,
    useClass: AppointmentSchedulingService,
  };
}

/**
 * Provides a specific implementation of the appointment scheduling service
 *
 * @param implementation - The concrete implementation class
 * @returns Provider configuration
 *
 * @example
 * ```typescript
 * // In app.config.ts for testing with a mock
 * providers: [
 *   provideAppointmentSchedulingServiceImpl(MockAppointmentSchedulingService)
 * ]
 * ```
 */
export function provideAppointmentSchedulingServiceImpl(
  implementation: new () => IAppointmentSchedulingService
): Provider {
  return {
    provide: APPOINTMENT_SCHEDULING_SERVICE,
    useClass: implementation,
  };
}

// Made with Bob
