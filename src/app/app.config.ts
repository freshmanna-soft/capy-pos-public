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
import { SyncService } from '@core/infrastructure/sync';
import { AUTH_PROVIDERS } from '@core/infrastructure/auth/auth.providers';
import { CurrentUserService } from '@core/application/auth/current-user.service';
import { environment } from '../environments/environment';

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
    // Rehydrate existing session AFTER the DB is open so the JWT gateway
    // can resolve the operator record if needed. Runs before routing resolves.
    provideAppInitializer(async () => {
      const currentUser = inject(CurrentUserService);
      try {
        await currentUser.hydrate();
        console.log('Session hydrated:', currentUser.isAuthenticated());
      } catch (error) {
        // Non-fatal — user will be redirected to /login by authGuard
        console.warn('Session hydration failed (will require login):', error);
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
    // Auth providers (local credential adapter — swap for Cognito in Story #42)
    ...AUTH_PROVIDERS,
    // Background sync worker (syncs local Dexie ↔ AWS API)
    provideAppInitializer(() => {
      const syncService = inject(SyncService);
      syncService.start({
        apiBaseUrl: environment.apiUrl.replace('/api', ''),
        syncIntervalMs: 30000,
        circuitBreaker: environment.circuitBreaker,
        retry: environment.retry,
      });
    }),
  ],
};
