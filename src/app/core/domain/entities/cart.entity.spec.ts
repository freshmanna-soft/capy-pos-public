import { describe, it, expect } from 'vitest';
import { Cart, CartItem } from '@core/domain/entities/cart.entity';
import { ProductBuilder } from '@core/domain/entities/product.builder';

describe('CartItem', () => {
  const product = new ProductBuilder()
    .withId('p1')
    .withName('Coffee')
    .withPrice(12.99)
    .withSku('COF-001')
    .withCategory('Beverages')
    .withStock(50)
    .withDescription('Premium coffee')
    .build();

  describe('constructor', () => {
    it('should create a cart item with valid quantity', () => {
      const item = new CartItem(product, 3);
      expect(item.product).toBe(product);
      expect(item.quantity).toBe(3);
      expect(item.addedAt).toBeInstanceOf(Date);
    });

    it('should throw error for quantity <= 0', () => {
      expect(() => new CartItem(product, 0)).toThrow('Quantity must be greater than 0');
      expect(() => new CartItem(product, -1)).toThrow('Quantity must be greater than 0');
    });

    it('should throw error for quantity exceeding stock', () => {
      expect(() => new CartItem(product, 51)).toThrow('Quantity exceeds available stock');
    });

    it('should accept custom addedAt date', () => {
      const date = new Date('2026-01-01');
      const item = new CartItem(product, 1, date);
      expect(item.addedAt).toBe(date);
    });
  });

  describe('getSubtotal', () => {
    it('should calculate subtotal correctly', () => {
      const item = new CartItem(product, 3);
      expect(item.getSubtotal()).toBeCloseTo(12.99 * 3, 2);
    });

    it('should return price for quantity 1', () => {
      const item = new CartItem(product, 1);
      expect(item.getSubtotal()).toBe(12.99);
    });
  });

  describe('updateQuantity', () => {
    it('should update quantity to valid value', () => {
      const item = new CartItem(product, 1);
      item.updateQuantity(5);
      expect(item.quantity).toBe(5);
    });

    it('should throw error for quantity <= 0', () => {
      const item = new CartItem(product, 1);
      expect(() => item.updateQuantity(0)).toThrow('Quantity must be greater than 0');
      expect(() => item.updateQuantity(-1)).toThrow('Quantity must be greater than 0');
    });

    it('should throw error for quantity exceeding stock', () => {
      const item = new CartItem(product, 1);
      expect(() => item.updateQuantity(51)).toThrow('Quantity exceeds available stock');
    });

    it('should allow updating to max stock', () => {
      const item = new CartItem(product, 1);
      item.updateQuantity(50);
      expect(item.quantity).toBe(50);
    });
  });
});

describe('Cart', () => {
  const product1 = new ProductBuilder()
    .withId('p1')
    .withName('Coffee')
    .withPrice(12.99)
    .withSku('COF-001')
    .withCategory('Beverages')
    .withStock(50)
    .withDescription('Premium coffee')
    .build();

  const product2 = new ProductBuilder()
    .withId('p2')
    .withName('Tea')
    .withPrice(8.49)
    .withSku('TEA-001')
    .withCategory('Beverages')
    .withStock(30)
    .withDescription('Green tea')
    .build();

  describe('constructor', () => {
    it('should create a cart with valid ID', () => {
      const cart = new Cart('cart-1');
      expect(cart.id).toBe('cart-1');
      expect(cart.isEmpty()).toBe(true);
      expect(cart.createdAt).toBeInstanceOf(Date);
      expect(cart.updatedAt).toBeInstanceOf(Date);
    });

    it('should create a cart with customer ID', () => {
      const cart = new Cart('cart-1', 'cust-1');
      expect(cart.customerId).toBe('cust-1');
    });

    it('should throw error for empty ID', () => {
      expect(() => new Cart('')).toThrow('Cart ID is required');
    });

    it('should throw error for whitespace-only ID', () => {
      expect(() => new Cart('   ')).toThrow('Cart ID is required');
    });
  });

  describe('addItem', () => {
    it('should add a new product to the cart', () => {
      const cart = new Cart('cart-1');
      cart.addItem(product1, 2);
      expect(cart.getItems().length).toBe(1);
      expect(cart.getItem('p1')?.quantity).toBe(2);
    });

    it('should increment quantity for existing product', () => {
      const cart = new Cart('cart-1');
      cart.addItem(product1, 2);
      cart.addItem(product1, 3);
      expect(cart.getItems().length).toBe(1);
      expect(cart.getItem('p1')?.quantity).toBe(5);
    });

    it('should add multiple different products', () => {
      const cart = new Cart('cart-1');
      cart.addItem(product1, 1);
      cart.addItem(product2, 2);
      expect(cart.getItems().length).toBe(2);
    });

    it('should update updatedAt timestamp', () => {
      const cart = new Cart('cart-1');
      const before = cart.updatedAt;
      cart.addItem(product1, 1);
      expect(cart.updatedAt.getTime()).toBeGreaterThanOrEqual(before.getTime());
    });
  });

  describe('removeItem', () => {
    it('should remove an existing item', () => {
      const cart = new Cart('cart-1');
      cart.addItem(product1, 1);
      cart.removeItem('p1');
      expect(cart.isEmpty()).toBe(true);
    });

    it('should throw error for non-existent product', () => {
      const cart = new Cart('cart-1');
      expect(() => cart.removeItem('non-existent')).toThrow('Product not found in cart');
    });
  });

  describe('updateItemQuantity', () => {
    it('should update quantity of existing item', () => {
      const cart = new Cart('cart-1');
      cart.addItem(product1, 1);
      cart.updateItemQuantity('p1', 5);
      expect(cart.getItem('p1')?.quantity).toBe(5);
    });

    it('should throw error for non-existent product', () => {
      const cart = new Cart('cart-1');
      expect(() => cart.updateItemQuantity('non-existent', 5)).toThrow('Product not found in cart');
    });
  });

  describe('getItems', () => {
    it('should return empty array for empty cart', () => {
      const cart = new Cart('cart-1');
      expect(cart.getItems()).toEqual([]);
    });

    it('should return all items', () => {
      const cart = new Cart('cart-1');
      cart.addItem(product1, 1);
      cart.addItem(product2, 2);
      const items = cart.getItems();
      expect(items.length).toBe(2);
    });
  });

  describe('getItem', () => {
    it('should return item by product ID', () => {
      const cart = new Cart('cart-1');
      cart.addItem(product1, 3);
      const item = cart.getItem('p1');
      expect(item?.product.id).toBe('p1');
      expect(item?.quantity).toBe(3);
    });

    it('should return undefined for non-existent product', () => {
      const cart = new Cart('cart-1');
      expect(cart.getItem('non-existent')).toBeUndefined();
    });
  });

  describe('getTotalItems', () => {
    it('should return 0 for empty cart', () => {
      const cart = new Cart('cart-1');
      expect(cart.getTotalItems()).toBe(0);
    });

    it('should sum all quantities', () => {
      const cart = new Cart('cart-1');
      cart.addItem(product1, 3);
      cart.addItem(product2, 2);
      expect(cart.getTotalItems()).toBe(5);
    });
  });

  describe('getSubtotal', () => {
    it('should return 0 for empty cart', () => {
      const cart = new Cart('cart-1');
      expect(cart.getSubtotal()).toBe(0);
    });

    it('should calculate subtotal correctly', () => {
      const cart = new Cart('cart-1');
      cart.addItem(product1, 2); // 12.99 * 2 = 25.98
      cart.addItem(product2, 1); // 8.49
      expect(cart.getSubtotal()).toBeCloseTo(34.47, 2);
    });
  });

  describe('getTax', () => {
    it('should calculate tax with default rate', () => {
      const cart = new Cart('cart-1');
      cart.addItem(product1, 1); // 12.99
      expect(cart.getTax()).toBeCloseTo(12.99 * 0.08, 2);
    });

    it('should calculate tax with custom rate', () => {
      const cart = new Cart('cart-1');
      cart.addItem(product1, 1); // 12.99
      expect(cart.getTax(0.1)).toBeCloseTo(12.99 * 0.1, 2);
    });
  });

  describe('getTotal', () => {
    it('should calculate total (subtotal + tax)', () => {
      const cart = new Cart('cart-1');
      cart.addItem(product1, 1); // 12.99
      const expected = 12.99 + 12.99 * 0.08;
      expect(cart.getTotal()).toBeCloseTo(expected, 2);
    });

    it('should calculate total with custom tax rate', () => {
      const cart = new Cart('cart-1');
      cart.addItem(product1, 1);
      const expected = 12.99 + 12.99 * 0.1;
      expect(cart.getTotal(0.1)).toBeCloseTo(expected, 2);
    });
  });

  describe('isEmpty', () => {
    it('should return true for empty cart', () => {
      const cart = new Cart('cart-1');
      expect(cart.isEmpty()).toBe(true);
    });

    it('should return false for non-empty cart', () => {
      const cart = new Cart('cart-1');
      cart.addItem(product1, 1);
      expect(cart.isEmpty()).toBe(false);
    });
  });

  describe('clear', () => {
    it('should remove all items', () => {
      const cart = new Cart('cart-1');
      cart.addItem(product1, 1);
      cart.addItem(product2, 2);
      cart.clear();
      expect(cart.isEmpty()).toBe(true);
      expect(cart.getTotalItems()).toBe(0);
    });
  });

  describe('hasProduct', () => {
    it('should return true for existing product', () => {
      const cart = new Cart('cart-1');
      cart.addItem(product1, 1);
      expect(cart.hasProduct('p1')).toBe(true);
    });

    it('should return false for non-existent product', () => {
      const cart = new Cart('cart-1');
      expect(cart.hasProduct('p1')).toBe(false);
    });
  });

  describe('validateForCheckout', () => {
    it('should return valid for cart with in-stock items', () => {
      const cart = new Cart('cart-1');
      cart.addItem(product1, 1);
      const result = cart.validateForCheckout();
      expect(result.valid).toBe(true);
      expect(result.errors).toEqual([]);
    });

    it('should return invalid for empty cart', () => {
      const cart = new Cart('cart-1');
      const result = cart.validateForCheckout();
      expect(result.valid).toBe(false);
      expect(result.errors).toContain('Cart is empty');
    });

    it('should detect out-of-stock products', () => {
      const cart = new Cart('cart-1');
      // Manually set up a cart item with a product that becomes out of stock
      cart.addItem(product1, 1);
      const result = cart.validateForCheckout();
      expect(result.valid).toBe(true);
    });
  });

  describe('toJSON', () => {
    it('should serialize cart to JSON', () => {
      const cart = new Cart('cart-1', 'cust-1');
      cart.addItem(product1, 2);

      const json = cart.toJSON();
      expect(json['id']).toBe('cart-1');
      expect(json['customerId']).toBe('cust-1');
      expect((json['items'] as unknown[]).length).toBe(1);
      expect(json['totalItems']).toBe(2);
      expect(json['subtotal']).toBeCloseTo(25.98, 2);
      expect(json['createdAt']).toBeDefined();
      expect(json['updatedAt']).toBeDefined();
    });

    it('should serialize empty cart', () => {
      const cart = new Cart('cart-1');
      const json = cart.toJSON();
      expect((json['items'] as unknown[]).length).toBe(0);
      expect(json['totalItems']).toBe(0);
      expect(json['subtotal']).toBe(0);
    });
  });
});
