import { Injectable, inject } from '@angular/core';
import { DatabaseService } from '@core/infrastructure/sqlite/database.service';
import { INITIALIZE_SCHEMA } from '@core/infrastructure/sqlite/schema';

/**
 * Database Initializer Service
 *
 * Handles database initialization, schema creation, and migrations.
 * Should be called during application bootstrap.
 *
 * @class DatabaseInitializerService
 */
@Injectable({ providedIn: 'root' })
export class DatabaseInitializerService {
  private databaseService = inject(DatabaseService);

  private initializationPromise: Promise<void> | null = null;

  /**
   * Initialize the database with schema and seed data
   * This method is idempotent and can be called multiple times safely
   */
  async initializeDatabase(): Promise<void> {
    // Return existing promise if initialization is in progress
    if (this.initializationPromise) {
      return this.initializationPromise;
    }

    this.initializationPromise = this.performInitialization();
    return this.initializationPromise;
  }

  /**
   * Perform the actual database initialization
   */
  private async performInitialization(): Promise<void> {
    try {
      console.log('[DatabaseInitializer] Starting database initialization...');

      // Initialize the database service
      await this.databaseService.initialize();

      // Check if database is already initialized
      if (this.isDatabaseInitialized()) {
        console.log('[DatabaseInitializer] Database already initialized');
        return;
      }

      // Create schema
      console.log('[DatabaseInitializer] Creating database schema...');
      this.databaseService.exec(INITIALIZE_SCHEMA);

      // Mark database as initialized
      this.markDatabaseInitialized();

      console.log('[DatabaseInitializer] Database initialization complete');
    } catch (error) {
      console.error('[DatabaseInitializer] Database initialization failed:', error);
      this.initializationPromise = null;
      throw error;
    }
  }

  /**
   * Check if database has been initialized
   */
  private isDatabaseInitialized(): boolean {
    try {
      const result = this.databaseService.queryOne(
        "SELECT name FROM sqlite_master WHERE type='table' AND name='products'",
      );
      return result !== null;
    } catch {
      return false;
    }
  }

  /**
   * Mark database as initialized in metadata table
   */
  private markDatabaseInitialized(): void {
    try {
      // Create metadata table if it doesn't exist
      this.databaseService.exec(`
        CREATE TABLE IF NOT EXISTS _metadata (
          key TEXT PRIMARY KEY,
          value TEXT NOT NULL,
          updated_at TEXT NOT NULL
        )
      `);

      // Insert initialization record
      this.databaseService.run(
        `INSERT OR REPLACE INTO _metadata (key, value, updated_at) 
         VALUES (?, ?, datetime('now'))`,
        ['initialized', 'true'],
      );
    } catch (error) {
      console.error('[DatabaseInitializer] Failed to mark database as initialized:', error);
    }
  }

  /**
   * Reset the database (clear all data and reinitialize)
   * WARNING: This will delete all data!
   */
  async resetDatabase(): Promise<void> {
    console.log('[DatabaseInitializer] Resetting database...');

    this.databaseService.clear();
    this.initializationPromise = null;

    await this.initializeDatabase();

    console.log('[DatabaseInitializer] Database reset complete');
  }

  /**
   * Get database statistics
   */
  getDatabaseStats(): {
    products: number;
    customers: number;
    transactions: number;
    payments: number;
  } {
    try {
      const stats = {
        products: this.getTableCount('products'),
        customers: this.getTableCount('customers'),
        transactions: this.getTableCount('transactions'),
        payments: this.getTableCount('payments'),
      };
      return stats;
    } catch (error) {
      console.error('[DatabaseInitializer] Failed to get database stats:', error);
      return { products: 0, customers: 0, transactions: 0, payments: 0 };
    }
  }

  /**
   * Get count of records in a table
   */
  private getTableCount(tableName: string): number {
    try {
      const result = this.databaseService.queryOne(
        `SELECT COUNT(*) as count FROM ${tableName}`,
      ) as { count: number } | null;
      return result ? result.count : 0;
    } catch {
      return 0;
    }
  }

  /**
   * Export database as JSON
   */
  exportDatabaseAsJson(): string {
    const stats = this.getDatabaseStats();
    const data = {
      metadata: {
        exportedAt: new Date().toISOString(),
        version: '1.0.0',
        stats,
      },
      products: this.databaseService.query('SELECT * FROM products'),
      customers: this.databaseService.query('SELECT * FROM customers'),
      transactions: this.databaseService.query('SELECT * FROM transactions'),
      payments: this.databaseService.query('SELECT * FROM payments'),
    };

    return JSON.stringify(data, null, 2);
  }

  /**
   * Check database health
   */
  checkHealth(): {
    isHealthy: boolean;
    initialized: boolean;
    canQuery: boolean;
    stats: unknown;
  } {
    try {
      const initialized = this.isDatabaseInitialized();
      const canQuery = initialized && this.databaseService.isInitialized();
      const stats = canQuery ? this.getDatabaseStats() : null;

      return {
        isHealthy: initialized && canQuery,
        initialized,
        canQuery,
        stats,
      };
    } catch (error) {
      console.error('[DatabaseInitializer] Health check failed:', error);
      return {
        isHealthy: false,
        initialized: false,
        canQuery: false,
        stats: null,
      };
    }
  }
}

// Made with Bob
