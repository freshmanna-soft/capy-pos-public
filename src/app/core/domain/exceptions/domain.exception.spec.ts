import { describe, it, expect } from 'vitest';
import {
  DomainException,
  EntityNotFoundException,
  ValidationException,
  DuplicateEntityException,
  InsufficientStockException,
  InvalidStateException,
} from '@core/domain/exceptions/domain.exception';

describe('DomainException', () => {
  it('should create with code and message', () => {
    const ex = new DomainException('INVALID_PRICE', 'Price must be greater than zero');
    expect(ex.code).toBe('INVALID_PRICE');
    expect(ex.message).toBe('Price must be greater than zero');
    expect(ex.name).toBe('DomainException');
  });

  it('should be an instance of Error', () => {
    const ex = new DomainException('TEST', 'test message');
    expect(ex).toBeInstanceOf(Error);
    expect(ex).toBeInstanceOf(DomainException);
  });
});

describe('EntityNotFoundException', () => {
  it('should create with entity type and ID', () => {
    const ex = new EntityNotFoundException('Product', 'prod-123');
    expect(ex.code).toBe('ENTITY_NOT_FOUND');
    expect(ex.entityType).toBe('Product');
    expect(ex.entityId).toBe('prod-123');
    expect(ex.message).toBe("Product with id 'prod-123' not found");
    expect(ex.name).toBe('EntityNotFoundException');
  });

  it('should be an instance of DomainException', () => {
    const ex = new EntityNotFoundException('Customer', 'c-1');
    expect(ex).toBeInstanceOf(DomainException);
    expect(ex).toBeInstanceOf(Error);
  });
});

describe('ValidationException', () => {
  it('should create with field and message', () => {
    const ex = new ValidationException('email', 'Email format is invalid');
    expect(ex.code).toBe('VALIDATION_ERROR');
    expect(ex.field).toBe('email');
    expect(ex.message).toBe('Email format is invalid');
    expect(ex.name).toBe('ValidationException');
  });

  it('should be an instance of DomainException', () => {
    const ex = new ValidationException('name', 'Name is required');
    expect(ex).toBeInstanceOf(DomainException);
  });
});

describe('DuplicateEntityException', () => {
  it('should create with entity type, field, and value', () => {
    const ex = new DuplicateEntityException('Product', 'sku', 'COF-001');
    expect(ex.code).toBe('DUPLICATE_ENTITY');
    expect(ex.entityType).toBe('Product');
    expect(ex.field).toBe('sku');
    expect(ex.value).toBe('COF-001');
    expect(ex.message).toBe("Product with sku 'COF-001' already exists");
    expect(ex.name).toBe('DuplicateEntityException');
  });

  it('should be an instance of DomainException', () => {
    const ex = new DuplicateEntityException('Customer', 'email', 'test@test.com');
    expect(ex).toBeInstanceOf(DomainException);
  });
});

describe('InsufficientStockException', () => {
  it('should create with product details and stock info', () => {
    const ex = new InsufficientStockException('prod-1', 'Coffee', 5, 10);
    expect(ex.code).toBe('INSUFFICIENT_STOCK');
    expect(ex.productId).toBe('prod-1');
    expect(ex.productName).toBe('Coffee');
    expect(ex.available).toBe(5);
    expect(ex.requested).toBe(10);
    expect(ex.message).toBe("Insufficient stock for 'Coffee': available 5, requested 10");
    expect(ex.name).toBe('InsufficientStockException');
  });

  it('should be an instance of DomainException', () => {
    const ex = new InsufficientStockException('p1', 'Tea', 0, 1);
    expect(ex).toBeInstanceOf(DomainException);
  });
});

describe('InvalidStateException', () => {
  it('should create with entity type, state, and operation', () => {
    const ex = new InvalidStateException('Transaction', 'COMPLETED', 'cancel');
    expect(ex.code).toBe('INVALID_STATE');
    expect(ex.entityType).toBe('Transaction');
    expect(ex.currentState).toBe('COMPLETED');
    expect(ex.attemptedOperation).toBe('cancel');
    expect(ex.message).toBe("Cannot cancel on Transaction: current state is 'COMPLETED'");
    expect(ex.name).toBe('InvalidStateException');
  });

  it('should be an instance of DomainException', () => {
    const ex = new InvalidStateException('Order', 'PENDING', 'refund');
    expect(ex).toBeInstanceOf(DomainException);
  });
});
