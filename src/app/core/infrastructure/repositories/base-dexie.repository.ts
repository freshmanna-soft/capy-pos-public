import { IndexableType, Table, UpdateSpec } from 'dexie';
import { BaseEntity } from '@core/domain/entities/base.entity';
import { IBaseRepository } from '@core/domain/interfaces/base.repository.interface';

/**
 * Base Dexie Repository
 * Abstract base class for all Dexie-based repositories
 * Implements common CRUD operations using Dexie ORM
 *
 * @template TEntity - Domain entity type
 * @template TDB - Database record type
 */
export abstract class BaseDexieRepository<
  TEntity extends BaseEntity,
  TDB,
> implements IBaseRepository<TEntity> {
  constructor(protected readonly table: Table<TDB, string>) {}

  /**
   * Abstract method to map database record to domain entity
   * Must be implemented by concrete repositories
   */
  protected abstract mapToEntity(record: TDB): TEntity;

  /**
   * Abstract method to map domain entity to database record
   * Must be implemented by concrete repositories
   */
  protected abstract mapToDatabase(entity: TEntity): TDB;

  /**
   * Find all entities (excluding soft-deleted)
   */
  async findAll(): Promise<TEntity[]> {
    const records = await this.table
      .filter((record) => !(record as Record<string, unknown>)['deletedAt'])
      .toArray();
    return records.map((record) => this.mapToEntity(record));
  }

  /**
   * Find entity by ID
   */
  async findById(id: string): Promise<TEntity | null> {
    const record = await this.table.get(id);
    if (!record || (record as Record<string, unknown>)['deletedAt']) {
      return null;
    }
    return this.mapToEntity(record);
  }

  /**
   * Create new entity
   */
  async create(entity: TEntity): Promise<TEntity> {
    const dbRecord = this.mapToDatabase(entity);
    await this.table.add(dbRecord);
    return entity;
  }

  /**
   * Update existing entity
   */
  async update(id: string, entity: TEntity): Promise<TEntity> {
    const existing = await this.table.get(id);
    if (!existing || (existing as Record<string, unknown>)['deletedAt']) {
      throw new Error(`Entity with id ${id} not found`);
    }

    const dbRecord = this.mapToDatabase(entity);
    await this.table.put(dbRecord);
    return entity;
  }

  /**
   * Soft delete entity
   */
  async delete(id: string): Promise<void> {
    const existing = await this.table.get(id);
    if (!existing) {
      throw new Error(`Entity with id ${id} not found`);
    }

    await this.table.update(id, {
      deletedAt: new Date(),
      updatedAt: new Date(),
    } as unknown as UpdateSpec<TDB>);
  }

  /**
   * Hard delete entity (permanent removal)
   */
  async hardDelete(id: string): Promise<void> {
    await this.table.delete(id);
  }

  /**
   * Check if entity exists
   */
  async exists(id: string): Promise<boolean> {
    const record = await this.table.get(id);
    return !!record && !(record as Record<string, unknown>)['deletedAt'];
  }

  /**
   * Count all entities (excluding soft-deleted)
   */
  async count(): Promise<number> {
    return await this.table
      .filter((record) => !(record as Record<string, unknown>)['deletedAt'])
      .count();
  }

  /**
   * Bulk create entities
   */
  async bulkCreate(entities: TEntity[]): Promise<TEntity[]> {
    const dbRecords = entities.map((entity) => this.mapToDatabase(entity));
    await this.table.bulkAdd(dbRecords);
    return entities;
  }

  /**
   * Bulk update entities
   */
  async bulkUpdate(updates: { id: string; data: Partial<TEntity> }[]): Promise<TEntity[]> {
    const updatedEntities: TEntity[] = [];

    for (const update of updates) {
      const existing = await this.findById(update.id);
      if (!existing) {
        throw new Error(`Entity with id ${update.id} not found`);
      }

      // Merge existing entity with partial update
      const merged = { ...existing, ...update.data, updatedAt: new Date() } as TEntity;

      const dbRecord = this.mapToDatabase(merged);
      await this.table.put(dbRecord);
      updatedEntities.push(merged);
    }

    return updatedEntities;
  }

  /**
   * Find entities with pagination
   */
  protected async findWithPagination(page = 1, pageSize = 50): Promise<TEntity[]> {
    const offset = (page - 1) * pageSize;
    const records = await this.table
      .filter((record) => !(record as Record<string, unknown>)['deletedAt'])
      .offset(offset)
      .limit(pageSize)
      .toArray();
    return records.map((record) => this.mapToEntity(record));
  }

  /**
   * Search entities by field
   */
  protected async searchByField(field: keyof TDB, query: string, limit = 50): Promise<TEntity[]> {
    const lowerQuery = query.toLowerCase();
    const records = await this.table
      .filter((record) => {
        if ((record as Record<string, unknown>)['deletedAt']) return false;
        const rawValue = (record as Record<string, unknown>)[field as string];
        const value = (typeof rawValue === 'string' ? rawValue : '').toLowerCase();
        return value.includes(lowerQuery);
      })
      .limit(limit)
      .toArray();
    return records.map((record) => this.mapToEntity(record));
  }

  /**
   * Find entities by indexed field
   */
  protected async findByIndexedField(field: keyof TDB, value: IndexableType): Promise<TEntity[]> {
    const records = await this.table
      .where(field as string)
      .equals(value)
      .filter((record) => !(record as Record<string, unknown>)['deletedAt'])
      .toArray();
    return records.map((record) => this.mapToEntity(record));
  }

  /**
   * Find one entity by indexed field
   */
  protected async findOneByIndexedField(
    field: keyof TDB,
    value: IndexableType,
  ): Promise<TEntity | null> {
    const record = await this.table
      .where(field as string)
      .equals(value)
      .filter((record) => !(record as Record<string, unknown>)['deletedAt'])
      .first();
    return record ? this.mapToEntity(record) : null;
  }

  /**
   * Find entities by compound index
   */
  protected async findByCompoundIndex(
    fields: [keyof TDB, keyof TDB],
    values: [IndexableType, IndexableType],
  ): Promise<TEntity[]> {
    const indexName = `[${String(fields[0])}+${String(fields[1])}]`;
    const records = await this.table
      .where(indexName)
      .equals(values as unknown as IndexableType)
      .filter((record) => !(record as Record<string, unknown>)['deletedAt'])
      .toArray();
    return records.map((record) => this.mapToEntity(record));
  }

  /**
   * Count entities by field value
   */
  protected async countByField(field: keyof TDB, value: IndexableType): Promise<number> {
    return await this.table
      .where(field as string)
      .equals(value)
      .filter((record) => !(record as Record<string, unknown>)['deletedAt'])
      .count();
  }

  /**
   * Find entities sorted by field
   */
  protected async findSorted(
    field: keyof TDB,
    direction: 'asc' | 'desc' = 'asc',
    limit?: number,
  ): Promise<TEntity[]> {
    let collection = this.table
      .orderBy(field as string)
      .filter((record) => !(record as Record<string, unknown>)['deletedAt']);

    if (direction === 'desc') {
      collection = collection.reverse();
    }

    if (limit) {
      collection = collection.limit(limit);
    }

    const records = await collection.toArray();
    return records.map((record) => this.mapToEntity(record));
  }

  /**
   * Clear all entities from table (for testing)
   */
  async clear(): Promise<void> {
    await this.table.clear();
  }
}

// Made with Bob
