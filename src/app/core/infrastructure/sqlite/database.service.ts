import { Injectable } from '@angular/core';
import initSqlJs, { Database, SqlJsStatic } from 'sql.js';

/**
 * SQLite Database Service
 * 
 * Manages SQLite database initialization, connections, and operations
 * for offline-first data storage in the browser using sql.js.
 * 
 * @class DatabaseService
 */
@Injectable({ providedIn: 'root' })
export class DatabaseService {
  private SQL: SqlJsStatic | null = null;
  private db: Database | null = null;
  private initialized = false;

  /**
   * Initialize the SQLite database
   * Loads sql.js WASM module and creates/opens the database
   */
  async initialize(): Promise<void> {
    if (this.initialized) {
      return;
    }

    try {
      // Load sql.js WASM module
      this.SQL = await initSqlJs({
        locateFile: (file) => `https://sql.js.org/dist/${file}`
      });

      // Try to load existing database from localStorage
      const savedDb = localStorage.getItem('capy-pos-db');
      
      if (savedDb) {
        // Load existing database
        const buffer = this.base64ToUint8Array(savedDb);
        this.db = new this.SQL.Database(buffer);
        console.log('[DatabaseService] Loaded existing database from localStorage');
      } else {
        // Create new database
        this.db = new this.SQL.Database();
        console.log('[DatabaseService] Created new database');
      }

      this.initialized = true;
    } catch (error) {
      console.error('[DatabaseService] Failed to initialize database:', error);
      throw new Error('Failed to initialize SQLite database');
    }
  }

  /**
   * Get the database instance
   * @throws Error if database is not initialized
   */
  getDatabase(): Database {
    if (!this.db) {
      throw new Error('[DatabaseService] Database not initialized. Call initialize() first.');
    }
    return this.db;
  }

  /**
   * Execute a SQL query
   * @param sql SQL query string
   * @param params Query parameters
   * @returns Query results
   */
  exec(sql: string, params?: any[]): any[] {
    const db = this.getDatabase();
    
    try {
      if (params) {
        const stmt = db.prepare(sql);
        stmt.bind(params);
        const results: any[] = [];
        
        while (stmt.step()) {
          results.push(stmt.getAsObject());
        }
        
        stmt.free();
        return results;
      } else {
        const results = db.exec(sql);
        return results;
      }
    } catch (error) {
      console.error('[DatabaseService] Query execution failed:', error);
      throw error;
    }
  }

  /**
   * Execute a SQL query and return the first result
   * @param sql SQL query string
   * @param params Query parameters
   * @returns First result or null
   */
  queryOne(sql: string, params?: any[]): any | null {
    const results = this.query(sql, params);
    return results.length > 0 ? results[0] : null;
  }

  /**
   * Execute a SQL query and return all results
   * @param sql SQL query string
   * @param params Query parameters
   * @returns Array of results
   */
  query(sql: string, params?: any[]): any[] {
    const db = this.getDatabase();
    
    try {
      const stmt = db.prepare(sql);
      
      if (params) {
        stmt.bind(params);
      }
      
      const results: any[] = [];
      while (stmt.step()) {
        results.push(stmt.getAsObject());
      }
      
      stmt.free();
      return results;
    } catch (error) {
      console.error('[DatabaseService] Query failed:', error);
      throw error;
    }
  }

  /**
   * Execute a SQL statement (INSERT, UPDATE, DELETE)
   * @param sql SQL statement
   * @param params Statement parameters
   * @returns Number of affected rows
   */
  run(sql: string, params?: any[]): number {
    const db = this.getDatabase();
    
    try {
      if (params) {
        const stmt = db.prepare(sql);
        stmt.bind(params);
        stmt.step();
        stmt.free();
      } else {
        db.run(sql);
      }
      
      // Save database to localStorage after modification
      this.save();
      
      // Return number of changes
      return db.getRowsModified();
    } catch (error) {
      console.error('[DatabaseService] Statement execution failed:', error);
      throw error;
    }
  }

  /**
   * Begin a transaction
   */
  beginTransaction(): void {
    this.run('BEGIN TRANSACTION');
  }

  /**
   * Commit a transaction
   */
  commit(): void {
    this.run('COMMIT');
  }

  /**
   * Rollback a transaction
   */
  rollback(): void {
    this.run('ROLLBACK');
  }

  /**
   * Execute multiple statements in a transaction
   * @param callback Function containing statements to execute
   */
  async transaction(callback: () => void | Promise<void>): Promise<void> {
    try {
      this.beginTransaction();
      await callback();
      this.commit();
    } catch (error) {
      this.rollback();
      throw error;
    }
  }

  /**
   * Save the database to localStorage
   */
  save(): void {
    if (!this.db) {
      return;
    }

    try {
      const data = this.db.export();
      const base64 = this.uint8ArrayToBase64(data);
      localStorage.setItem('capy-pos-db', base64);
    } catch (error) {
      console.error('[DatabaseService] Failed to save database:', error);
    }
  }

  /**
   * Clear the database and remove from localStorage
   */
  clear(): void {
    if (this.db) {
      this.db.close();
      this.db = null;
    }
    
    localStorage.removeItem('capy-pos-db');
    this.initialized = false;
  }

  /**
   * Export database as Uint8Array
   */
  export(): Uint8Array | null {
    if (!this.db) {
      return null;
    }
    return this.db.export();
  }

  /**
   * Import database from Uint8Array
   */
  import(data: Uint8Array): void {
    if (!this.SQL) {
      throw new Error('[DatabaseService] SQL.js not initialized');
    }

    if (this.db) {
      this.db.close();
    }

    this.db = new this.SQL.Database(data);
    this.save();
  }

  /**
   * Convert Uint8Array to base64 string
   */
  private uint8ArrayToBase64(bytes: Uint8Array): string {
    let binary = '';
    const len = bytes.byteLength;
    for (let i = 0; i < len; i++) {
      binary += String.fromCharCode(bytes[i]);
    }
    return btoa(binary);
  }

  /**
   * Convert base64 string to Uint8Array
   */
  private base64ToUint8Array(base64: string): Uint8Array {
    const binary = atob(base64);
    const len = binary.length;
    const bytes = new Uint8Array(len);
    for (let i = 0; i < len; i++) {
      bytes[i] = binary.charCodeAt(i);
    }
    return bytes;
  }

  /**
   * Check if database is initialized
   */
  isInitialized(): boolean {
    return this.initialized;
  }
}

// Made with Bob
