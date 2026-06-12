import { describe, it, expect } from 'vitest';
import { ProductBuilder } from './product.builder';
import { Product } from './product.entity';

describe('ProductBuilder', () => {
  const validBuilder = (): ProductBuilder =>
    new ProductBuilder()
      .withId('test-id-123')
      .withName('Organic Coffee')
      .withPrice(12.99)
      .withSku('COF-001')
      .withCategory('Beverages')
      .withStock(50);

  describe('build()', () => {
    it('should create a valid Product with required fields', () => {
      const product = validBuilder().build();

      expect(product).toBeInstanceOf(Product);
      expect(product.id).toBe('test-id-123');
      expect(product.name).toBe('Organic Coffee');
      expect(product.price).toBe(12.99);
      expect(product.sku).toBe('COF-001');
      expect(product.category).toBe('Beverages');
      expect(product.stock).toBe(50);
    });

    it('should apply default values for optional fields', () => {
      const product = validBuilder().build();

      expect(product.lowStockThreshold).toBe(10);
      expect(product.reorderQuantity).toBe(20);
      expect(product.cost).toBe(0);
      expect(product.isActive).toBe(true);
      expect(product.description).toBeUndefined();
      expect(product.imageUrl).toBeUndefined();
      expect(product.barcode).toBeUndefined();
      expect(product.emoji).toBeUndefined();
    });

    it('should set all optional fields when provided', () => {
      const createdAt = new Date('2025-01-01');
      const updatedAt = new Date('2025-06-01');

      const product = validBuilder()
        .withDescription('Premium organic coffee beans')
        .withImageUrl('https://example.com/coffee.png')
        .withBarcode('1234567890123')
        .withEmoji('☕')
        .withLowStockThreshold(5)
        .withReorderQuantity(30)
        .withCost(7.5)
        .withIsActive(false)
        .withCreatedAt(createdAt)
        .withUpdatedAt(updatedAt)
        .withCreatedBy('admin')
        .withUpdatedBy('manager')
        .build();

      expect(product.description).toBe('Premium organic coffee beans');
      expect(product.imageUrl).toBe('https://example.com/coffee.png');
      expect(product.barcode).toBe('1234567890123');
      expect(product.emoji).toBe('☕');
      expect(product.lowStockThreshold).toBe(5);
      expect(product.reorderQuantity).toBe(30);
      expect(product.cost).toBe(7.5);
      expect(product.isActive).toBe(false);
      expect(product.createdAt).toEqual(createdAt);
      expect(product.updatedAt).toEqual(updatedAt);
      expect(product.createdBy).toBe('admin');
      expect(product.updatedBy).toBe('manager');
    });

    it('should set soft-delete fields when provided', () => {
      const deletedAt = new Date('2025-07-01');

      const product = validBuilder().withDeletedAt(deletedAt).withDeletedBy('admin').build();

      expect(product.deletedAt).toEqual(deletedAt);
      expect(product.deletedBy).toBe('admin');
    });
  });

  describe('validation (delegated to Product)', () => {
    it('should throw when name is empty', () => {
      expect(() =>
        new ProductBuilder()
          .withId('id-1')
          .withName('')
          .withPrice(10)
          .withSku('SKU-1')
          .withCategory('General')
          .withStock(5)
          .build()
      ).toThrow('Product name is required');
    });

    it('should throw when price is negative', () => {
      expect(() =>
        new ProductBuilder()
          .withId('id-1')
          .withName('Test Product')
          .withPrice(-1)
          .withSku('SKU-1')
          .withCategory('General')
          .withStock(5)
          .build()
      ).toThrow('Price cannot be negative');
    });

    it('should throw when SKU is empty', () => {
      expect(() =>
        new ProductBuilder()
          .withId('id-1')
          .withName('Test Product')
          .withPrice(10)
          .withSku('')
          .withCategory('General')
          .withStock(5)
          .build()
      ).toThrow('SKU is required');
    });

    it('should throw when stock is negative', () => {
      expect(() =>
        new ProductBuilder()
          .withId('id-1')
          .withName('Test Product')
          .withPrice(10)
          .withSku('SKU-1')
          .withCategory('General')
          .withStock(-1)
          .build()
      ).toThrow('Stock cannot be negative');
    });
  });

  describe('fluent API', () => {
    it('should support method chaining', () => {
      const builder = new ProductBuilder();
      const result = builder
        .withId('id')
        .withName('name')
        .withPrice(1)
        .withSku('sku')
        .withCategory('cat')
        .withStock(1);

      expect(result).toBe(builder);
    });

    it('should allow overriding previously set values', () => {
      const product = validBuilder().withName('First Name').withName('Updated Name').build();

      expect(product.name).toBe('Updated Name');
    });

    it('should generate a unique id by default', () => {
      const product1 = new ProductBuilder()
        .withName('Product 1')
        .withPrice(10)
        .withSku('SKU-1')
        .withCategory('General')
        .withStock(5)
        .build();

      const product2 = new ProductBuilder()
        .withName('Product 2')
        .withPrice(20)
        .withSku('SKU-2')
        .withCategory('General')
        .withStock(10)
        .build();

      expect(product1.id).not.toBe(product2.id);
      expect(product1.id).toBeTruthy();
      expect(product2.id).toBeTruthy();
    });
  });
});
