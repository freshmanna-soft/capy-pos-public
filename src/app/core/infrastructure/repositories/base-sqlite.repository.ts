import { DatabaseService } from '../sqlite/database.service';
import { IBaseRepository } from '../../domain/interfaces/base.repository.interface';

/**
 * Base SQLite Repository
 * 
 * Abstract base class for all SQLite repository implementations.
 * Provides common functionality and enforces consistent patterns.
 * Follows Template Method Pattern and DRY principle.
 * 
 * @abstract
 * @class BaseSQLiteRepository
 * @implements IBaseRepository
 * @template T - The entity type
 */
export abstract class BaseSQLiteRepository<T> implements IBaseRepository<T> {
  /**
   * Table name in the database
   */
  protected abstract readonly tableName: string;

  /**
   * Constructor
   * @param db - Database service instance
   */
  constructor(protected readonly db: DatabaseService) {}

  /**
   * Find all entities
   */
  async findAll(): Promise<T[]> {
    const sql = `SELECT * FROM ${this.tableName} WHERE deleted_at IS NULL ORDER BY created_at DESC`;
    const rows = this.db.query(sql);
    return rows.map(row => this.mapToEntity(row));
  }

  /**
   * Find entity by ID
   */
  async findById(id: string): Promise<T | null> {
    const sql = `SELECT * FROM ${this.tableName} WHERE id = ? AND deleted_at IS NULL`;
    const row = this.db.queryOne(sql, [id]);
    return row ? this.mapToEntity(row) : null;
  }

  /**
   * Create a new entity
   */
  async create(entity: T): Promise<T> {
    const { sql, params } = this.buildInsertQuery(entity);
    this.db.run(sql, params);
    return entity;
  }

  /**
   * Update an existing entity
   */
  async update(id: string, data: Partial<T>): Promise<T> {
    const existing = await this.findById(id);
    if (!existing) {
      throw new Error(`${this.tableName} with ID ${id} not found`);
    }

    const { sql, params } = this.buildUpdateQuery(id, data);
    this.db.run(sql, params);

    const updated = await this.findById(id);
    if (!updated) {
      throw new Error(`Failed to retrieve updated ${this.tableName}`);
    }

    return updated;
  }

  /**
   * Delete an entity (soft delete)
   */
  async delete(id: string): Promise<void> {
    const sql = `UPDATE ${this.tableName} SET deleted_at = datetime('now') WHERE id = ?`;
    this.db.run(sql, [id]);
  }

  /**
   * Permanently delete an entity (hard delete)
   */
  async hardDelete(id: string): Promise<void> {
    const sql = `DELETE FROM ${this.tableName} WHERE id = ?`;
    this.db.run(sql, [id]);
  }

  /**
   * Check if entity exists
   */
  async exists(id: string): Promise<boolean> {
    const sql = `SELECT COUNT(*) as count FROM ${this.tableName} WHERE id = ? AND deleted_at IS NULL`;
    const result = this.db.queryOne(sql, [id]);
    return result ? result.count > 0 : false;
  }

  /**
   * Count total entities
   */
  async count(): Promise<number> {
    const sql = `SELECT COUNT(*) as count FROM ${this.tableName} WHERE deleted_at IS NULL`;
    const result = this.db.queryOne(sql);
    return result ? result.count : 0;
  }

  /**
   * Bulk create multiple entities
   */
  async bulkCreate(entities: T[]): Promise<T[]> {
    await this.db.transaction(async () => {
      for (const entity of entities) {
        await this.create(entity);
      }
    });
    return entities;
  }

  /**
   * Bulk update multiple entities
   */
  async bulkUpdate(updates: Array<{ id: string; data: Partial<T> }>): Promise<T[]> {
    const updated: T[] = [];
    
    await this.db.transaction(async () => {
      for (const update of updates) {
        const entity = await this.update(update.id, update.data);
        updated.push(entity);
      }
    });

    return updated;
  }

  /**
   * Find entities with pagination
   */
  async findPaginated(page: number, pageSize: number): Promise<{
    data: T[];
    total: number;
    page: number;
    pageSize: number;
    totalPages: number;
  }> {
    const offset = (page - 1) * pageSize;
    const sql = `SELECT * FROM ${this.tableName} WHERE deleted_at IS NULL ORDER BY created_at DESC LIMIT ? OFFSET ?`;
    const rows = this.db.query(sql, [pageSize, offset]);
    const data = rows.map(row => this.mapToEntity(row));
    const total = await this.count();
    const totalPages = Math.ceil(total / pageSize);

    return {
      data,
      total,
      page,
      pageSize,
      totalPages
    };
  }

  /**
   * Map database row to entity
   * Must be implemented by concrete repositories
   * @abstract
   */
  protected abstract mapToEntity(row: any): T;

  /**
   * Build INSERT query for entity
   * Must be implemented by concrete repositories
   * @abstract
   */
  protected abstract buildInsertQuery(entity: T): { sql: string; params: any[] };

  /**
   * Build UPDATE query for entity
   * Must be implemented by concrete repositories
   * @abstract
   */
  protected abstract buildUpdateQuery(id: string, data: Partial<T>): { sql: string; params: any[] };

  /**
   * Get column names for the table
   * Helper method for building queries
   */
  protected getColumnNames(data: any): string[] {
    return Object.keys(data).filter(key => data[key] !== undefined);
  }

  /**
   * Build WHERE clause for search
   */
  protected buildSearchWhere(searchFields: string[], query: string): { where: string; params: any[] } {
    const conditions = searchFields.map(field => `${field} LIKE ?`);
    const searchPattern = `%${query}%`;
    const params = searchFields.map(() => searchPattern);
    
    return {
      where: `(${conditions.join(' OR ')})`,
      params
    };
  }
}

// Made with Bob
