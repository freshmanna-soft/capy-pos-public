/**
 * Base Repository Interface
 * 
 * Defines the contract for all repository implementations.
 * Follows Repository Pattern and Interface Segregation Principle (SOLID).
 * 
 * @interface IBaseRepository
 * @template T - The entity type
 */
export interface IBaseRepository<T> {
  /**
   * Find all entities
   * @returns Promise resolving to array of entities
   */
  findAll(): Promise<T[]>;

  /**
   * Find entity by ID
   * @param id - Entity identifier
   * @returns Promise resolving to entity or null if not found
   */
  findById(id: string): Promise<T | null>;

  /**
   * Create a new entity
   * @param entity - Entity to create
   * @returns Promise resolving to created entity
   */
  create(entity: T): Promise<T>;

  /**
   * Update an existing entity
   * @param id - Entity identifier
   * @param data - Partial entity data to update
   * @returns Promise resolving to updated entity
   */
  update(id: string, data: Partial<T>): Promise<T>;

  /**
   * Delete an entity
   * @param id - Entity identifier
   * @returns Promise resolving when deletion is complete
   */
  delete(id: string): Promise<void>;

  /**
   * Check if entity exists
   * @param id - Entity identifier
   * @returns Promise resolving to true if entity exists
   */
  exists(id: string): Promise<boolean>;

  /**
   * Count total entities
   * @returns Promise resolving to total count
   */
  count(): Promise<number>;

  /**
   * Bulk create multiple entities
   * @param entities - Array of entities to create
   * @returns Promise resolving to created entities
   */
  bulkCreate(entities: T[]): Promise<T[]>;

  /**
   * Bulk update multiple entities
   * @param updates - Array of update operations
   * @returns Promise resolving to updated entities
   */
  bulkUpdate(updates: Array<{ id: string; data: Partial<T> }>): Promise<T[]>;
}

// Made with Bob
