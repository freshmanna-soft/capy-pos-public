import { Observable } from 'rxjs';
import { BaseEntity } from '../../domain/entities/base.entity';

/**
 * Base Application Service Interface
 * Defines common CRUD operations for all application services
 * Follows Interface Segregation Principle (SOLID)
 * 
 * @template TEntity - Domain entity type
 */
export interface IBaseApplicationService<TEntity extends BaseEntity> {
  // Read operations
  getAll(): Promise<TEntity[]>;
  getAll$(): Observable<TEntity[]>;
  getById(id: string): Promise<TEntity | null>;
  getById$(id: string): Observable<TEntity | null>;
  exists(id: string): Promise<boolean>;
  exists$(id: string): Observable<boolean>;
  count(): Promise<number>;
  count$(): Observable<number>;

  // Write operations
  create(entity: TEntity): Promise<TEntity>;
  create$(entity: TEntity): Observable<TEntity>;
  update(id: string, entity: TEntity): Promise<TEntity>;
  update$(id: string, entity: TEntity): Observable<TEntity>;
  delete(id: string): Promise<void>;
  delete$(id: string): Observable<void>;

  // Bulk operations
  bulkCreate(entities: TEntity[]): Promise<TEntity[]>;
  bulkCreate$(entities: TEntity[]): Observable<TEntity[]>;
  bulkUpdate(updates: { id: string; data: Partial<TEntity> }[]): Promise<TEntity[]>;
  bulkUpdate$(updates: { id: string; data: Partial<TEntity> }[]): Observable<TEntity[]>;
}

// Made with Bob