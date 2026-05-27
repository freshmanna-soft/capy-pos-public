/**
 * Base Entity Interface
 * Defines common properties for all entities
 */
export interface IEntity {
  readonly id: string;
  readonly createdAt: Date;
  updatedAt: Date;
}

/**
 * Auditable Interface
 * For entities that track creation and modification
 */
export interface IAuditable {
  readonly createdAt: Date;
  updatedAt: Date;
  createdBy?: string;
  updatedBy?: string;
}

/**
 * Soft Deletable Interface
 * For entities that support soft deletion
 */
export interface ISoftDeletable {
  deletedAt?: Date;
  deletedBy?: string;
  isDeleted: boolean;
}

/**
 * Serializable Interface
 * For entities that can be converted to/from JSON
 */
export interface ISerializable<T> {
  toJSON(): Record<string, any>;
}

/**
 * Refundable Interface
 * For entities that support refund operations
 */
export interface IRefundable {
  refundedAmount: number;
  refund(amount: number, updatedBy?: string): void;
  getRefundableAmount(): number;
  isRefundable(): boolean;
}

/**
 * Processable Interface
 * For entities that have a processing lifecycle
 */
export interface IProcessable {
  markAsProcessing(updatedBy?: string): void;
  markAsCompleted(updatedBy?: string): void;
  markAsFailed(reason: string, updatedBy?: string): void;
  isCompleted(): boolean;
}

/**
 * Abstract Base Entity
 * Provides common functionality for all domain entities
 * Follows DRY principle and Template Method pattern
 */
export abstract class BaseEntity implements IEntity, IAuditable, ISerializable<BaseEntity> {
  constructor(
    public readonly id: string,
    public readonly createdAt: Date = new Date(),
    public updatedAt: Date = new Date(),
    public createdBy?: string,
    public updatedBy?: string
  ) {
    this.validateId();
  }

  /**
   * Validates entity ID
   */
  private validateId(): void {
    if (!this.id || this.id.trim() === '') {
      throw new Error(`${this.constructor.name} ID is required`);
    }
  }

  /**
   * Updates the updatedAt timestamp
   */
  protected touch(updatedBy?: string): void {
    this.updatedAt = new Date();
    if (updatedBy) {
      this.updatedBy = updatedBy;
    }
  }

  /**
   * Abstract method for entity-specific validation
   * Must be implemented by derived classes
   */
  protected abstract validate(): void;

  /**
   * Checks if entity is newly created (within last minute)
   */
  isNew(): boolean {
    const oneMinuteAgo = new Date(Date.now() - 60000);
    return this.createdAt > oneMinuteAgo;
  }

  /**
   * Checks if entity was recently updated (within last minute)
   */
  isRecentlyUpdated(): boolean {
    const oneMinuteAgo = new Date(Date.now() - 60000);
    return this.updatedAt > oneMinuteAgo;
  }

  /**
   * Gets entity age in milliseconds
   */
  getAge(): number {
    return Date.now() - this.createdAt.getTime();
  }

  /**
   * Converts entity to plain object
   * Can be overridden by derived classes
   */
  toJSON(): Record<string, any> {
    return {
      id: this.id,
      createdAt: this.createdAt.toISOString(),
      updatedAt: this.updatedAt.toISOString(),
      createdBy: this.createdBy,
      updatedBy: this.updatedBy
    };
  }

  /**
   * Compares entities by ID
   */
  equals(other: BaseEntity): boolean {
    return this.id === other.id && 
           this.constructor.name === other.constructor.name;
  }

  /**
   * Creates a shallow copy of the entity
   */
  abstract clone(): BaseEntity;
}

/**
 * Abstract Soft Deletable Entity
 * Extends BaseEntity with soft deletion support
 */
export abstract class SoftDeletableEntity extends BaseEntity implements ISoftDeletable {
  constructor(
    id: string,
    createdAt: Date = new Date(),
    updatedAt: Date = new Date(),
    createdBy?: string,
    updatedBy?: string,
    public deletedAt?: Date,
    public deletedBy?: string
  ) {
    super(id, createdAt, updatedAt, createdBy, updatedBy);
  }

  /**
   * Checks if entity is deleted
   */
  get isDeleted(): boolean {
    return this.deletedAt !== undefined;
  }

  /**
   * Soft deletes the entity
   */
  softDelete(deletedBy?: string): void {
    if (this.isDeleted) {
      throw new Error(`${this.constructor.name} is already deleted`);
    }
    this.deletedAt = new Date();
    this.deletedBy = deletedBy;
    this.touch(deletedBy);
  }

  /**
   * Restores a soft-deleted entity
   */
  restore(restoredBy?: string): void {
    if (!this.isDeleted) {
      throw new Error(`${this.constructor.name} is not deleted`);
    }
    this.deletedAt = undefined;
    this.deletedBy = undefined;
    this.touch(restoredBy);
  }

  /**
   * Converts entity to JSON including soft delete info
   */
  override toJSON(): Record<string, any> {
    return {
      ...super.toJSON(),
      deletedAt: this.deletedAt?.toISOString(),
      deletedBy: this.deletedBy,
      isDeleted: this.isDeleted
    };
  }
}

/**
 * Value Object Base Class
 * For immutable domain objects without identity
 */
export abstract class ValueObject {
  /**
   * Abstract method for value object validation
   */
  protected abstract validate(): void;

  /**
   * Abstract method for equality comparison
   */
  abstract equals(other: ValueObject): boolean;

  /**
   * Converts value object to plain object
   */
  abstract toJSON(): Record<string, any>;
}

// Made with Bob
