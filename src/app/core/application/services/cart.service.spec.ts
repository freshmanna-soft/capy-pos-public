import { describe, it, expect, beforeEach } from 'vitest';
import { CartService } from '@core/application/services/cart.service';
import { Product } from '@core/domain/entities/product.entity';
import { ProductBuilder } from '@core/domain/entities/product.builder';

describe('CartService', () => {
  let cartService: CartService;
  let product1: Product;
  let product2: Product;

  beforeEach(() => {
    cartService = new CartService();
    product1 = new ProductBuilder()
      .withId('prod-1')
      .withName('Coffee')
      .withPrice(5)
      .withSku('COF-001')
      .withCategory('Beverages')
      .withStock(50)
      .build();
    product2 = new ProductBuilder()
      .withId('prod-2')
      .withName('Muffin')
      .withPrice(3.5)
      .withSku('MUF-001')
      .withCategory('Bakery')
      .withStock(30)
      .build();
  });

  describe('addProduct()', () => {
    it('should add a new product to the cart', () => {
      cartService.addProduct(product1);
      expect(cartService.items().length).toBe(1);
      expect(cartService.items()[0].product.id).toBe('prod-1');
      expect(cartService.items()[0].quantity).toBe(1);
    });

    it('should increase quantity when adding existing product', () => {
      cartService.addProduct(product1);
      cartService.addProduct(product1);
      expect(cartService.items().length).toBe(1);
      expect(cartService.items()[0].quantity).toBe(2);
    });

    it('should throw error when adding null product', () => {
      expect(() => cartService.addProduct(null as unknown as Product)).toThrow(
        'Cannot add null or undefined product to cart'
      );
    });

    it('should throw error when adding undefined product', () => {
      expect(() => cartService.addProduct(undefined as unknown as Product)).toThrow(
        'Cannot add null or undefined product to cart'
      );
    });
  });

  describe('increaseQuantity()', () => {
    it('should increase quantity of existing item', () => {
      cartService.addProduct(product1);
      cartService.increaseQuantity('prod-1');
      expect(cartService.getQuantity('prod-1')).toBe(2);
    });

    it('should throw error for non-existent product', () => {
      expect(() => cartService.increaseQuantity('non-existent')).toThrow(
        'Product with ID non-existent not found in cart'
      );
    });
  });

  describe('decreaseQuantity()', () => {
    it('should decrease quantity of existing item', () => {
      cartService.addProduct(product1);
      cartService.addProduct(product1); // qty = 2
      cartService.decreaseQuantity('prod-1');
      expect(cartService.getQuantity('prod-1')).toBe(1);
    });

    it('should remove item when quantity reaches zero', () => {
      cartService.addProduct(product1); // qty = 1
      cartService.decreaseQuantity('prod-1');
      expect(cartService.hasProduct('prod-1')).toBe(false);
      expect(cartService.items().length).toBe(0);
    });

    it('should throw error for non-existent product', () => {
      expect(() => cartService.decreaseQuantity('non-existent')).toThrow(
        'Product with ID non-existent not found in cart'
      );
    });
  });

  describe('updateQuantity()', () => {
    it('should update quantity to specific value', () => {
      cartService.addProduct(product1);
      cartService.updateQuantity('prod-1', 10);
      expect(cartService.getQuantity('prod-1')).toBe(10);
    });

    it('should remove item when quantity is set to 0', () => {
      cartService.addProduct(product1);
      cartService.updateQuantity('prod-1', 0);
      expect(cartService.hasProduct('prod-1')).toBe(false);
    });

    it('should throw error for negative quantity', () => {
      cartService.addProduct(product1);
      expect(() => cartService.updateQuantity('prod-1', -1)).toThrow('Quantity cannot be negative');
    });

    it('should throw error for non-existent product', () => {
      expect(() => cartService.updateQuantity('non-existent', 5)).toThrow(
        'Product with ID non-existent not found in cart'
      );
    });
  });

  describe('removeItem()', () => {
    it('should remove item from cart', () => {
      cartService.addProduct(product1);
      cartService.addProduct(product2);
      cartService.removeItem('prod-1');
      expect(cartService.items().length).toBe(1);
      expect(cartService.hasProduct('prod-1')).toBe(false);
    });
  });

  describe('clearCart()', () => {
    it('should remove all items from cart', () => {
      cartService.addProduct(product1);
      cartService.addProduct(product2);
      cartService.clearCart();
      expect(cartService.items().length).toBe(0);
      expect(cartService.isEmpty()).toBe(true);
    });
  });

  describe('setTaxRate()', () => {
    it('should update tax rate', () => {
      cartService.setTaxRate(0.1);
      expect(cartService.taxRate()).toBe(0.1);
    });

    it('should throw error for negative rate', () => {
      expect(() => cartService.setTaxRate(-0.05)).toThrow('Tax rate must be between 0 and 1');
    });

    it('should throw error for rate greater than 1', () => {
      expect(() => cartService.setTaxRate(1.5)).toThrow('Tax rate must be between 0 and 1');
    });

    it('should accept rate of 0', () => {
      cartService.setTaxRate(0);
      expect(cartService.taxRate()).toBe(0);
    });

    it('should accept rate of 1', () => {
      cartService.setTaxRate(1);
      expect(cartService.taxRate()).toBe(1);
    });
  });

  describe('computed values', () => {
    it('should calculate totalItems correctly', () => {
      cartService.addProduct(product1);
      cartService.addProduct(product1);
      cartService.addProduct(product2);
      expect(cartService.totalItems()).toBe(3);
    });

    it('should calculate subtotal correctly', () => {
      cartService.addProduct(product1); // $5
      cartService.addProduct(product1); // $5 (qty 2 = $10)
      cartService.addProduct(product2); // $3.5
      expect(cartService.subtotal()).toBe(13.5);
    });

    it('should calculate tax correctly', () => {
      cartService.addProduct(product1); // $5
      cartService.setTaxRate(0.1); // 10%
      expect(cartService.tax()).toBe(0.5);
    });

    it('should calculate total correctly', () => {
      cartService.addProduct(product1); // $5
      cartService.setTaxRate(0.1); // 10%
      expect(cartService.total()).toBe(5.5);
    });

    it('should report isEmpty correctly', () => {
      expect(cartService.isEmpty()).toBe(true);
      cartService.addProduct(product1);
      expect(cartService.isEmpty()).toBe(false);
    });
  });

  describe('getItem()', () => {
    it('should return item when found', () => {
      cartService.addProduct(product1);
      const item = cartService.getItem('prod-1');
      expect(item).toBeDefined();
      expect(item?.product.id).toBe('prod-1');
    });

    it('should return undefined when not found', () => {
      const item = cartService.getItem('non-existent');
      expect(item).toBeUndefined();
    });
  });

  describe('hasProduct()', () => {
    it('should return true when product is in cart', () => {
      cartService.addProduct(product1);
      expect(cartService.hasProduct('prod-1')).toBe(true);
    });

    it('should return false when product is not in cart', () => {
      expect(cartService.hasProduct('prod-1')).toBe(false);
    });
  });

  describe('getQuantity()', () => {
    it('should return quantity when product is in cart', () => {
      cartService.addProduct(product1);
      cartService.addProduct(product1);
      expect(cartService.getQuantity('prod-1')).toBe(2);
    });

    it('should return 0 when product is not in cart', () => {
      expect(cartService.getQuantity('non-existent')).toBe(0);
    });
  });
});
