import { InjectionToken, Provider } from '@angular/core';
import { IInventoryService } from '@core/domain/rules/inventory.service.interface';
import { InventoryService } from '@core/domain/rules/inventory.service';

/**
 * Injection token for IInventoryService
 *
 * Use this token to inject the inventory service interface rather than
 * the concrete implementation, following the Dependency Inversion Principle.
 *
 * @example
 * ```typescript
 * constructor(@Inject(INVENTORY_SERVICE) private inventoryService: IInventoryService) {}
 * ```
 */
export const INVENTORY_SERVICE = new InjectionToken<IInventoryService>('IInventoryService', {
  providedIn: 'root',
  factory: () => new InventoryService(),
});

/**
 * Provides the inventory service using the interface token
 *
 * @returns Provider configuration for IInventoryService
 *
 * @example
 * ```typescript
 * // In app.config.ts or component providers
 * providers: [
 *   provideInventoryService()
 * ]
 * ```
 */
export function provideInventoryService(): Provider {
  return {
    provide: INVENTORY_SERVICE,
    useClass: InventoryService,
  };
}

/**
 * Provides a specific implementation of the inventory service
 *
 * @param implementation - The concrete implementation class
 * @returns Provider configuration
 *
 * @example
 * ```typescript
 * // In app.config.ts for testing with a mock
 * providers: [
 *   provideInventoryServiceImpl(MockInventoryService)
 * ]
 * ```
 */
export function provideInventoryServiceImpl(implementation: new () => IInventoryService): Provider {
  return {
    provide: INVENTORY_SERVICE,
    useClass: implementation,
  };
}

// Made with Bob
