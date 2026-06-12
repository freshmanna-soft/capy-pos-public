import {
  ApplicationConfig,
  provideBrowserGlobalErrorListeners,
  provideZonelessChangeDetection,
  inject,
  provideAppInitializer,
} from '@angular/core';
import { provideRouter } from '@angular/router';

import { routes } from '@app/app.routes';
import { DexieDatabase } from '@core/infrastructure/database/dexie-database.service';
import {
  REPOSITORY_PROVIDERS,
  TRANSACTION_REPOSITORY,
} from '@core/infrastructure/factories/repository.factory';
import { INVENTORY_AGENT_PROVIDERS } from '@app/agents/inventory/infrastructure';
import { SALES_AGENT_PROVIDERS } from '@app/agents/sales/infrastructure';
import { PAYMENT_AGENT_PROVIDER } from '@app/agents/payment/infrastructure/payment-agent.provider';
import { AgentRegistry } from '@app/agents/agent.registry';

export const appConfig: ApplicationConfig = {
  providers: [
    provideZonelessChangeDetection(),
    provideBrowserGlobalErrorListeners(),
    provideRouter(routes),
    provideAppInitializer(async () => {
      const db = inject(DexieDatabase);
      try {
        await db.open();
        console.log('Dexie database opened successfully');

        await db.initializeWithSeedData();
        console.log('Database initialized with seed data');

        const stats = await db.getStats();
        console.log('Database statistics:', stats);
      } catch (error) {
        console.error('Failed to initialize Dexie database:', error);
        throw error;
      }
    }),
    provideAppInitializer(async () => {
      const registry = inject(AgentRegistry);
      try {
        console.log('Initializing agents via AgentRegistry...');

        await registry.initializeAll();
        await registry.startAll();

        const stats = registry.getStatistics();
        console.log('Agent statistics:', stats);

        const allHealthy = await registry.areAllHealthy();
        console.log('All agents healthy:', allHealthy);
      } catch (error) {
        console.error('Failed to initialize agents:', error);
        throw error;
      }
    }),
    // Repository providers with dependency injection
    ...REPOSITORY_PROVIDERS,
    // String-based token alias for PersistTransactionUseCase compatibility
    {
      provide: 'ITransactionRepository',
      useExisting: TRANSACTION_REPOSITORY,
    },
    // Agent providers
    ...INVENTORY_AGENT_PROVIDERS,
    ...SALES_AGENT_PROVIDERS,
    PAYMENT_AGENT_PROVIDER,
  ],
};
