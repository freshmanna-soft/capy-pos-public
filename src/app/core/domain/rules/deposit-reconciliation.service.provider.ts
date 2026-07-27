import { InjectionToken, Provider } from '@angular/core';
import { IDepositReconciliationService } from '@core/domain/rules/deposit-reconciliation.service.interface';
import { DepositReconciliationService } from '@core/domain/rules/deposit-reconciliation.service';

/**
 * Injection token for IDepositReconciliationService
 *
 * Use this token to inject the deposit reconciliation service interface rather
 * than the concrete implementation, following the Dependency Inversion
 * Principle.
 *
 * @example
 * ```typescript
 * constructor(
 *   @Inject(DEPOSIT_RECONCILIATION_SERVICE) private deposits: IDepositReconciliationService
 * ) {}
 * ```
 */
export const DEPOSIT_RECONCILIATION_SERVICE = new InjectionToken<IDepositReconciliationService>(
  'IDepositReconciliationService',
  {
    providedIn: 'root',
    factory: () => new DepositReconciliationService(),
  }
);

/**
 * Provides the deposit reconciliation service using the interface token
 *
 * @returns Provider configuration for IDepositReconciliationService
 *
 * @example
 * ```typescript
 * // In app.config.ts or component providers
 * providers: [
 *   provideDepositReconciliationService()
 * ]
 * ```
 */
export function provideDepositReconciliationService(): Provider {
  return {
    provide: DEPOSIT_RECONCILIATION_SERVICE,
    useClass: DepositReconciliationService,
  };
}

/**
 * Provides a specific implementation of the deposit reconciliation service
 *
 * @param implementation - The concrete implementation class
 * @returns Provider configuration
 *
 * @example
 * ```typescript
 * // In app.config.ts for testing with a mock
 * providers: [
 *   provideDepositReconciliationServiceImpl(MockDepositReconciliationService)
 * ]
 * ```
 */
export function provideDepositReconciliationServiceImpl(
  implementation: new () => IDepositReconciliationService
): Provider {
  return {
    provide: DEPOSIT_RECONCILIATION_SERVICE,
    useClass: implementation,
  };
}

// Made with Bob
