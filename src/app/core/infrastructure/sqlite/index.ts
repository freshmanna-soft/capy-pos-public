/**
 * SQLite Infrastructure Module
 *
 * Exports all SQLite-related services and utilities for offline-first data storage.
 */

export { DatabaseService } from '@core/infrastructure/sqlite/database.service';
export { DatabaseInitializerService } from '@core/infrastructure/sqlite/database-initializer.service';
export {
  CREATE_TABLES,
  CREATE_INDEXES,
  SEED_DATA,
  INITIALIZE_SCHEMA,
} from '@core/infrastructure/sqlite/schema';

// Made with Bob
