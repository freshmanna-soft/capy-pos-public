import { Observable, from } from 'rxjs';
import { IBaseRepository } from '@core/domain/interfaces/base.repository.interface';
import { BaseEntity } from '@core/domain/entities/base.entity';
import { IBaseApplicationService } from '@core/application/services/base-application.service.interface';

/**
 * Base Application Service
 * Abstract base class for all application services
 * Implements IBaseApplicationService interface
 * Provides common CRUD operations with Promise and Observable support
 * Follows Template Method Pattern and DRY principle
 *
 * @template TEntity - Domain entity type
 * @template TRepository - Repository interface type
 */
export abstract class BaseApplicationService<
  TEntity extends BaseEntity,
  TRepository extends IBaseRepository<TEntity>,
> implements IBaseApplicationService<TEntity> {
  constructor(protected readonly repository: TRepository) {}

  /**
   * Get all entities
   */
  async getAll(): Promise<TEntity[]> {
    return this.repository.findAll();
  }

  /**
   * Get all entities as Observable
   */
  getAll$(): Observable<TEntity[]> {
    return from(this.repository.findAll());
  }

  /**
   * Get entity by ID
   */
  async getById(id: string): Promise<TEntity | null> {
    return this.repository.findById(id);
  }

  /**
   * Get entity by ID as Observable
   */
  getById$(id: string): Observable<TEntity | null> {
    return from(this.repository.findById(id));
  }

  /**
   * Create new entity
   */
  async create(entity: TEntity): Promise<TEntity> {
    return this.repository.create(entity);
  }

  /**
   * Create new entity as Observable
   */
  create$(entity: TEntity): Observable<TEntity> {
    return from(this.repository.create(entity));
  }

  /**
   * Update existing entity
   */
  async update(id: string, entity: TEntity): Promise<TEntity> {
    return this.repository.update(id, entity);
  }

  /**
   * Update existing entity as Observable
   */
  update$(id: string, entity: TEntity): Observable<TEntity> {
    return from(this.repository.update(id, entity));
  }

  /**
   * Delete entity (soft delete)
   */
  async delete(id: string): Promise<void> {
    return this.repository.delete(id);
  }

  /**
   * Delete entity as Observable
   */
  delete$(id: string): Observable<void> {
    return from(this.repository.delete(id));
  }

  /**
   * Check if entity exists
   */
  async exists(id: string): Promise<boolean> {
    return this.repository.exists(id);
  }

  /**
   * Check if entity exists as Observable
   */
  exists$(id: string): Observable<boolean> {
    return from(this.repository.exists(id));
  }

  /**
   * Get count of all entities
   */
  async count(): Promise<number> {
    return this.repository.count();
  }

  /**
   * Get count of all entities as Observable
   */
  count$(): Observable<number> {
    return from(this.repository.count());
  }

  /**
   * Bulk create entities
   */
  async bulkCreate(entities: TEntity[]): Promise<TEntity[]> {
    return this.repository.bulkCreate(entities);
  }

  /**
   * Bulk create entities as Observable
   */
  bulkCreate$(entities: TEntity[]): Observable<TEntity[]> {
    return from(this.repository.bulkCreate(entities));
  }

  /**
   * Bulk update entities
   */
  async bulkUpdate(updates: { id: string; data: Partial<TEntity> }[]): Promise<TEntity[]> {
    return this.repository.bulkUpdate(updates);
  }

  /**
   * Bulk update entities as Observable
   */
  bulkUpdate$(updates: { id: string; data: Partial<TEntity> }[]): Observable<TEntity[]> {
    return from(this.repository.bulkUpdate(updates));
  }

  /**
   * Validate entity before operations
   * Override in concrete services for custom validation
   */
  protected validateEntity(_entity: TEntity): void {
    // Default: no validation
    // Override in concrete services
  }

  /**
   * Hook called before create
   * Override in concrete services for custom logic
   */
  protected async beforeCreate(entity: TEntity): Promise<void> {
    this.validateEntity(entity);
  }

  /**
   * Hook called after create
   * Override in concrete services for custom logic
   */
  protected async afterCreate(_entity: TEntity): Promise<void> {
    // Default: no action
  }

  /**
   * Hook called before update
   * Override in concrete services for custom logic
   */
  protected async beforeUpdate(id: string, entity: TEntity): Promise<void> {
    this.validateEntity(entity);
  }

  /**
   * Hook called after update
   * Override in concrete services for custom logic
   */
  protected async afterUpdate(_entity: TEntity): Promise<void> {
    // Default: no action
  }

  /**
   * Hook called before delete
   * Override in concrete services for custom logic
   */
  protected async beforeDelete(_id: string): Promise<void> {
    // Default: no action
  }

  /**
   * Hook called after delete
   * Override in concrete services for custom logic
   */
  protected async afterDelete(_id: string): Promise<void> {
    // Default: no action
  }
}

// Made with Bob
