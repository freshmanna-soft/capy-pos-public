/**
 * Base Domain Exception
 *
 * All domain-layer exceptions extend this class.
 * Domain exceptions represent violations of business rules,
 * invariants, or domain constraints.
 *
 * @example
 * ```typescript
 * throw new DomainException('INVALID_PRICE', 'Price must be greater than zero');
 * ```
 */
export class DomainException extends Error {
  constructor(
    public readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = 'DomainException';
    Object.setPrototypeOf(this, DomainException.prototype);
  }
}

/**
 * Entity Not Found Exception
 *
 * Thrown when a requested entity does not exist in the repository.
 */
export class EntityNotFoundException extends DomainException {
  constructor(
    public readonly entityType: string,
    public readonly entityId: string,
  ) {
    super('ENTITY_NOT_FOUND', `${entityType} with id '${entityId}' not found`);
    this.name = 'EntityNotFoundException';
    Object.setPrototypeOf(this, EntityNotFoundException.prototype);
  }
}

/**
 * Validation Exception
 *
 * Thrown when input data fails domain validation rules.
 */
export class ValidationException extends DomainException {
  constructor(
    public readonly field: string,
    message: string,
  ) {
    super('VALIDATION_ERROR', message);
    this.name = 'ValidationException';
    Object.setPrototypeOf(this, ValidationException.prototype);
  }
}

/**
 * Duplicate Entity Exception
 *
 * Thrown when attempting to create an entity that already exists
 * (e.g., duplicate email, duplicate SKU).
 */
export class DuplicateEntityException extends DomainException {
  constructor(
    public readonly entityType: string,
    public readonly field: string,
    public readonly value: string,
  ) {
    super('DUPLICATE_ENTITY', `${entityType} with ${field} '${value}' already exists`);
    this.name = 'DuplicateEntityException';
    Object.setPrototypeOf(this, DuplicateEntityException.prototype);
  }
}

/**
 * Insufficient Stock Exception
 *
 * Thrown when a stock operation would result in negative inventory.
 */
export class InsufficientStockException extends DomainException {
  constructor(
    public readonly productId: string,
    public readonly productName: string,
    public readonly available: number,
    public readonly requested: number,
  ) {
    super(
      'INSUFFICIENT_STOCK',
      `Insufficient stock for '${productName}': available ${available}, requested ${requested}`,
    );
    this.name = 'InsufficientStockException';
    Object.setPrototypeOf(this, InsufficientStockException.prototype);
  }
}

/**
 * Invalid State Exception
 *
 * Thrown when an operation is attempted on an entity in an invalid state.
 */
export class InvalidStateException extends DomainException {
  constructor(
    public readonly entityType: string,
    public readonly currentState: string,
    public readonly attemptedOperation: string,
  ) {
    super(
      'INVALID_STATE',
      `Cannot ${attemptedOperation} on ${entityType}: current state is '${currentState}'`,
    );
    this.name = 'InvalidStateException';
    Object.setPrototypeOf(this, InvalidStateException.prototype);
  }
}
