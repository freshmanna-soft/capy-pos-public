import { Provider } from '@angular/core';
import { InventoryAgent } from './inventory.agent';
import { DexieProductRepository } from '../../../core/infrastructure/repositories/dexie-product.repository';
import { DexieDatabase } from '../../../core/infrastructure/database/dexie-database.service';

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
    provide: InventoryAgent,
    useFactory: (db: DexieDatabase) => {
      const productRepository = new DexieProductRepository(db);
      return new InventoryAgent(productRepository);
    },
    deps: [DexieDatabase],
  },
];

// Made with Bob