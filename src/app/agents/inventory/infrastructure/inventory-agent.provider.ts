import { Provider } from '@angular/core';
import {
  InventoryAgent,
  PRODUCT_REPOSITORY_TOKEN,
} from '@app/agents/inventory/infrastructure/inventory.agent';
import { DexieProductRepository } from '@core/infrastructure/repositories/dexie-product.repository';

/**
 * Provider for InventoryAgent
 * Configures dependency injection for the inventory agent
 */
export const INVENTORY_AGENT_PROVIDERS: Provider[] = [
  {
    provide: 'IInventoryAgent',
    useClass: InventoryAgent,
  },
  {
    provide: PRODUCT_REPOSITORY_TOKEN,
    useClass: DexieProductRepository,
  },
];

// Made with Bob
