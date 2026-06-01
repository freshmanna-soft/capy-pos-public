import { ApplicationConfig, provideBrowserGlobalErrorListeners, APP_INITIALIZER } from '@angular/core';
import { provideRouter } from '@angular/router';

import { routes } from './app.routes';
import { DexieDatabase } from './core/infrastructure/database/dexie-database.service';
import { REPOSITORY_PROVIDERS } from './core/infrastructure/factories/repository.factory';
import { INVENTORY_AGENT_PROVIDERS } from './agents/inventory/infrastructure';
import { SALES_AGENT_PROVIDERS } from './agents/sales/infrastructure';
import { PAYMENT_AGENT_PROVIDER } from './agents/payment/infrastructure/payment-agent.provider';
import { AgentRegistry } from './agents/agent.registry';

/**
 * Initialize Dexie database on application startup
 */
export function initializeDexieDatabase(db: DexieDatabase) {
  return async () => {
    try {
      // Open the database
      await db.open();
      console.log('Dexie database opened successfully');
      
      // Initialize with seed data if needed
      await db.initializeWithSeedData();
      console.log('Database initialized with seed data');
      
      // Log database stats
      const stats = await db.getStats();
      console.log('Database statistics:', stats);
    } catch (error) {
      console.error('Failed to initialize Dexie database:', error);
      throw error;
    }
  };
}

/**
 * Initialize agents on application startup using AgentRegistry
 */
export function initializeAgents(registry: AgentRegistry) {
  return async () => {
    try {
      console.log('Initializing agents via AgentRegistry...');
      
      // Initialize and start all agents through registry
      await registry.initializeAll();
      await registry.startAll();
      
      // Log agent statistics
      const stats = registry.getStatistics();
      console.log('Agent statistics:', stats);
      
      // Check health
      const allHealthy = await registry.areAllHealthy();
      console.log('All agents healthy:', allHealthy);
      
    } catch (error) {
      console.error('Failed to initialize agents:', error);
      throw error;
    }
  };
}

export const appConfig: ApplicationConfig = {
  providers: [
    provideBrowserGlobalErrorListeners(),
    provideRouter(routes),
    {
      provide: APP_INITIALIZER,
      useFactory: initializeDexieDatabase,
      deps: [DexieDatabase],
      multi: true
    },
    {
      provide: APP_INITIALIZER,
      useFactory: initializeAgents,
      deps: [AgentRegistry],
      multi: true
    },
    // Repository providers with dependency injection
    ...REPOSITORY_PROVIDERS,
    // Agent providers
    ...INVENTORY_AGENT_PROVIDERS,
    ...SALES_AGENT_PROVIDERS,
    PAYMENT_AGENT_PROVIDER
  ]
};
