import { IBuilder } from './builder.interface';
import { generateUUID } from '../utils/uuid';

/**
 * AbstractEntityBuilder
 * Base abstract builder that handles common entity fields shared by all
 * domain entities (BaseEntity + SoftDeletableEntity fields).
 *
 * Concrete builders extend this class and add domain-specific fields.
 * Uses CRTP (Curiously Recurring Template Pattern) via `Self` type
 * to preserve fluent API return types in subclasses.
 *
 * @typeParam T - The entity type being built
 * @typeParam Self - The concrete builder type (for fluent API chaining)
 */
export abstract class AbstractEntityBuilder<
  T,
  Self extends AbstractEntityBuilder<T, Self>,
> implements IBuilder<T> {
  protected _id: string = generateUUID();
  protected _createdAt: Date = new Date();
  protected _updatedAt: Date = new Date();
  protected _createdBy?: string;
  protected _updatedBy?: string;
  protected _deletedAt?: Date;
  protected _deletedBy?: string;

  /**
   * Returns `this` typed as the concrete builder (Self).
   * Enables fluent chaining in subclasses without casting.
   */
  protected get self(): Self {
    return this as unknown as Self;
  }

  withId(id: string): Self {
    this._id = id;
    return this.self;
  }

  withCreatedAt(createdAt: Date): Self {
    this._createdAt = createdAt;
    return this.self;
  }

  withUpdatedAt(updatedAt: Date): Self {
    this._updatedAt = updatedAt;
    return this.self;
  }

  withCreatedBy(createdBy: string): Self {
    this._createdBy = createdBy;
    return this.self;
  }

  withUpdatedBy(updatedBy: string): Self {
    this._updatedBy = updatedBy;
    return this.self;
  }

  withDeletedAt(deletedAt: Date): Self {
    this._deletedAt = deletedAt;
    return this.self;
  }

  withDeletedBy(deletedBy: string): Self {
    this._deletedBy = deletedBy;
    return this.self;
  }

  /**
   * Builds and returns the final entity.
   * Must be implemented by concrete builders.
   */
  abstract build(): T;
}
