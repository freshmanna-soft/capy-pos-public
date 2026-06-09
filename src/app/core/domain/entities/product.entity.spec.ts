import { describe, it, expect } from 'vitest';
import { Product } from '@core/domain/entities/product.entity';

describe('Product Entity', () => {
  describe('constructor', () => {
    it('should create a valid product', () => {
      const product = new Product('1', 'Test Product', 29.99, 'TEST-001', 'Electronics', 100);

      expect(product.id).toBe('1');
      expect(product.name).toBe('Test Product');
      expect(product.price).toBe(29.99);
      expect(product.sku).toBe('TEST-001');
      expect(product.category).toBe('Electronics');
      expect(product.stock).toBe(100);
    });

    it('should throw error for empty id', () => {
      expect(() => {
        new Product('', 'Test', 10, 'SKU', 'Cat', 5);
      }).toThrow('Product ID is required');
    });

    it('should throw error for empty name', () => {
      expect(() => {
        new Product('1', '', 10, 'SKU', 'Cat', 5);
      }).toThrow('Product name is required');
    });

    it('should throw error for negative price', () => {
      expect(() => {
        new Product('1', 'Test', -10, 'SKU', 'Cat', 5);
      }).toThrow('Price cannot be negative');
    });

    it('should throw error for empty SKU', () => {
      expect(() => {
        new Product('1', 'Test', 10, '', 'Cat', 5);
      }).toThrow('SKU is required');
    });

    it('should throw error for negative stock', () => {
      expect(() => {
        new Product('1', 'Test', 10, 'SKU', 'Cat', -5);
      }).toThrow('Stock cannot be negative');
    });
  });

  describe('updateStock', () => {
    it('should increase stock', () => {
      const product = new Product('1', 'Test', 10, 'SKU', 'Cat', 50);
      product.updateStock(10);
      expect(product.stock).toBe(60);
    });

    it('should decrease stock', () => {
      const product = new Product('1', 'Test', 10, 'SKU', 'Cat', 50);
      product.updateStock(-10);
      expect(product.stock).toBe(40);
    });

    it('should throw error for insufficient stock', () => {
      const product = new Product('1', 'Test', 10, 'SKU', 'Cat', 5);
      expect(() => {
        product.updateStock(-10);
      }).toThrow('Insufficient stock');
    });

    it('should update updatedAt timestamp', () => {
      const product = new Product('1', 'Test', 10, 'SKU', 'Cat', 50);
      const oldTimestamp = product.updatedAt;

      // Wait a bit to ensure timestamp changes
      setTimeout(() => {
        product.updateStock(5);
        expect(product.updatedAt.getTime()).toBeGreaterThan(oldTimestamp.getTime());
      }, 10);
    });
  });

  describe('isLowStock', () => {
    it('should return true when stock is below threshold', () => {
      const product = new Product('1', 'Test', 10, 'SKU', 'Cat', 5);
      expect(product.isLowStock(10)).toBe(true);
    });

    it('should return false when stock is above threshold', () => {
      const product = new Product('1', 'Test', 10, 'SKU', 'Cat', 50);
      expect(product.isLowStock(10)).toBe(false);
    });

    it('should use default threshold of 10', () => {
      const product = new Product('1', 'Test', 10, 'SKU', 'Cat', 8);
      expect(product.isLowStock()).toBe(true);
    });
  });

  describe('isOutOfStock', () => {
    it('should return true when stock is 0', () => {
      const product = new Product('1', 'Test', 10, 'SKU', 'Cat', 0);
      expect(product.isOutOfStock()).toBe(true);
    });

    it('should return false when stock is greater than 0', () => {
      const product = new Product('1', 'Test', 10, 'SKU', 'Cat', 1);
      expect(product.isOutOfStock()).toBe(false);
    });
  });

  describe('updatePrice', () => {
    it('should update price', () => {
      const product = new Product('1', 'Test', 10, 'SKU', 'Cat', 50);
      product.updatePrice(15.99);
      expect(product.price).toBe(15.99);
    });

    it('should throw error for negative price', () => {
      const product = new Product('1', 'Test', 10, 'SKU', 'Cat', 50);
      expect(() => {
        product.updatePrice(-5);
      }).toThrow('Price cannot be negative');
    });
  });

  describe('clone', () => {
    it('should create a copy of the product', () => {
      const original = new Product('1', 'Test', 10, 'SKU', 'Cat', 50);
      const clone = original.clone();

      expect(clone.id).toBe(original.id);
      expect(clone.name).toBe(original.name);
      expect(clone.price).toBe(original.price);
      expect(clone).not.toBe(original); // Different instances
    });
  });

  describe('toJSON', () => {
    it('should convert product to plain object', () => {
      const product = new Product('1', 'Test', 10, 'SKU', 'Cat', 50);
      const json = product.toJSON();

      expect(json).toHaveProperty('id', '1');
      expect(json).toHaveProperty('name', 'Test');
      expect(json).toHaveProperty('price', 10);
      expect(json).toHaveProperty('sku', 'SKU');
      expect(json).toHaveProperty('category', 'Cat');
      expect(json).toHaveProperty('stock', 50);
      expect(json).toHaveProperty('createdAt');
      expect(json).toHaveProperty('updatedAt');
    });
  });

  describe('fromJSON', () => {
    it('should create product from plain object', () => {
      const data = {
        id: '1',
        name: 'Test',
        price: 10,
        sku: 'SKU',
        category: 'Cat',
        stock: 50,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };

      const product = Product.fromJSON(data);

      expect(product.id).toBe(data.id);
      expect(product.name).toBe(data.name);
      expect(product.price).toBe(data.price);
      expect(product instanceof Product).toBe(true);
    });
  });
});

// Made with Bob
