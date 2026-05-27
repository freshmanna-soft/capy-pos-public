import { describe, it, expect, beforeEach } from 'vitest';
import { PricingService } from './pricing.service';
import { DiscountType, Discount, TaxConfig, IPricingService } from './pricing.service.interface';
import { Product } from '../entities/product.entity';
import { Money } from '../value-objects/money.value-object';

describe('PricingService', () => {
  let pricingService: IPricingService;
  let product: Product;

  beforeEach(() => {
    pricingService = new PricingService();
    product = new Product(
      '1',
      'Test Product',
      10.00,
      'TEST-001',
      'Test Category',
      100
    );
  });

  describe('calculatePrice()', () => {
    it('should calculate price for single item', () => {
      const result = pricingService.calculatePrice(product, 1);
      expect(result.amount).toBe(10.00);
    });

    it('should calculate price for multiple items', () => {
      const result = pricingService.calculatePrice(product, 5);
      expect(result.amount).toBe(50.00);
    });

    it('should throw error for zero quantity', () => {
      expect(() => pricingService.calculatePrice(product, 0))
        .toThrow('[PricingService] quantity must be positive');
    });

    it('should throw error for negative quantity', () => {
      expect(() => pricingService.calculatePrice(product, -1))
        .toThrow('[PricingService] quantity must be positive');
    });
  });

  describe('applyDiscount() - Percentage', () => {
    it('should apply 10% discount', () => {
      const subtotal = new Money(100, 'USD');
      const discount: Discount = { type: DiscountType.PERCENTAGE, value: 10 };
      const result = pricingService.applyDiscount(subtotal, 1, discount);
      expect(result.amount).toBe(90.00);
    });

    it('should apply 50% discount', () => {
      const subtotal = new Money(100, 'USD');
      const discount: Discount = { type: DiscountType.PERCENTAGE, value: 50 };
      const result = pricingService.applyDiscount(subtotal, 1, discount);
      expect(result.amount).toBe(50.00);
    });

    it('should throw error for invalid percentage', () => {
      const subtotal = new Money(100, 'USD');
      const discount: Discount = { type: DiscountType.PERCENTAGE, value: 150 };
      expect(() => pricingService.applyDiscount(subtotal, 1, discount))
        .toThrow('[PricingService] percentage must be between 0 and 100');
    });
  });

  describe('applyDiscount() - Fixed Amount', () => {
    it('should apply $5 fixed discount', () => {
      const subtotal = new Money(100, 'USD');
      const discount: Discount = { type: DiscountType.FIXED_AMOUNT, value: 5 };
      const result = pricingService.applyDiscount(subtotal, 1, discount);
      expect(result.amount).toBe(95.00);
    });

    it('should not let discount exceed subtotal', () => {
      const subtotal = new Money(10, 'USD');
      const discount: Discount = { type: DiscountType.FIXED_AMOUNT, value: 20 };
      const result = pricingService.applyDiscount(subtotal, 1, discount);
      expect(result.amount).toBe(0);
    });
  });

  describe('calculateTax()', () => {
    it('should calculate 8% tax', () => {
      const subtotal = new Money(100, 'USD');
      const taxConfig: TaxConfig = { rate: 0.08, name: 'Sales Tax' };
      const result = pricingService.calculateTax(subtotal, taxConfig);
      expect(result.amount).toBe(8.00);
    });

    it('should throw error for negative tax rate', () => {
      const subtotal = new Money(100, 'USD');
      const taxConfig: TaxConfig = { rate: -0.05, name: 'Invalid Tax' };
      expect(() => pricingService.calculateTax(subtotal, taxConfig))
        .toThrow('[PricingService] tax rate must be non-negative');
    });
  });

  describe('calculateLineItemTotal()', () => {
    it('should calculate line item without discount or tax', () => {
      const result = pricingService.calculateLineItemTotal(product, 5);
      expect(result.subtotal.amount).toBe(50.00);
      expect(result.discount.amount).toBe(0);
      expect(result.tax.amount).toBe(0);
      expect(result.total.amount).toBe(50.00);
    });

    it('should calculate line item with discount and tax', () => {
      const discount: Discount = { type: DiscountType.PERCENTAGE, value: 10 };
      const taxConfig: TaxConfig = { rate: 0.08, name: 'Sales Tax' };
      const result = pricingService.calculateLineItemTotal(product, 5, discount, taxConfig);
      expect(result.subtotal.amount).toBe(50.00);
      expect(result.discount.amount).toBe(5.00);
      expect(result.tax.amount).toBe(3.60);
      expect(result.total.amount).toBe(48.60);
    });
  });
});

// Made with Bob