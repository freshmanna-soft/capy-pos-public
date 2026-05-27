import { ApplicationConfig, provideBrowserGlobalErrorListeners, APP_INITIALIZER } from '@angular/core';
import { provideRouter } from '@angular/router';

import { routes } from './app.routes';
import { DexieDatabase } from './core/infrastructure/database/dexie-database.service';
import { REPOSITORY_PROVIDERS } from './core/infrastructure/factories/repository.factory';

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
    // Repository providers with dependency injection
    ...REPOSITORY_PROVIDERS
  ]
};
