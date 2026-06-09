import { describe, it, expect, beforeEach } from 'vitest';
import { PricingService } from '@core/domain/rules/pricing.service';
import {
  DiscountType,
  Discount,
  TaxConfig,
  IPricingService,
} from '@core/domain/rules/pricing.service.interface';
import { Product } from '@core/domain/entities/product.entity';
import { ProductBuilder } from '@core/domain/entities/product.builder';
import { Money } from '@core/domain/value-objects/money.value-object';

describe('PricingService', () => {
  let pricingService: IPricingService;
  let product: Product;

  beforeEach(() => {
    pricingService = new PricingService();
    product = new ProductBuilder()
      .withId('1')
      .withName('Test Product')
      .withPrice(10.0)
      .withSku('TEST-001')
      .withCategory('Test Category')
      .withStock(100)
      .build();
  });

  describe('calculatePrice()', () => {
    it('should calculate price for single item', () => {
      const result = pricingService.calculatePrice(product, 1);
      expect(result.amount).toBe(10.0);
    });

    it('should calculate price for multiple items', () => {
      const result = pricingService.calculatePrice(product, 5);
      expect(result.amount).toBe(50.0);
    });

    it('should throw error for zero quantity', () => {
      expect(() => pricingService.calculatePrice(product, 0)).toThrow(
        '[PricingService] quantity must be positive',
      );
    });

    it('should throw error for negative quantity', () => {
      expect(() => pricingService.calculatePrice(product, -1)).toThrow(
        '[PricingService] quantity must be positive',
      );
    });
  });

  describe('applyDiscount() - Percentage', () => {
    it('should apply 10% discount', () => {
      const subtotal = new Money(100, 'USD');
      const discount: Discount = { type: DiscountType.PERCENTAGE, value: 10 };
      const result = pricingService.applyDiscount(subtotal, 1, discount);
      expect(result.amount).toBe(90.0);
    });

    it('should apply 50% discount', () => {
      const subtotal = new Money(100, 'USD');
      const discount: Discount = { type: DiscountType.PERCENTAGE, value: 50 };
      const result = pricingService.applyDiscount(subtotal, 1, discount);
      expect(result.amount).toBe(50.0);
    });

    it('should throw error for invalid percentage', () => {
      const subtotal = new Money(100, 'USD');
      const discount: Discount = { type: DiscountType.PERCENTAGE, value: 150 };
      expect(() => pricingService.applyDiscount(subtotal, 1, discount)).toThrow(
        '[PricingService] percentage must be between 0 and 100',
      );
    });
  });

  describe('applyDiscount() - Fixed Amount', () => {
    it('should apply $5 fixed discount', () => {
      const subtotal = new Money(100, 'USD');
      const discount: Discount = { type: DiscountType.FIXED_AMOUNT, value: 5 };
      const result = pricingService.applyDiscount(subtotal, 1, discount);
      expect(result.amount).toBe(95.0);
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
      expect(result.amount).toBe(8.0);
    });

    it('should throw error for negative tax rate', () => {
      const subtotal = new Money(100, 'USD');
      const taxConfig: TaxConfig = { rate: -0.05, name: 'Invalid Tax' };
      expect(() => pricingService.calculateTax(subtotal, taxConfig)).toThrow(
        '[PricingService] tax rate must be non-negative',
      );
    });
  });

  describe('calculateLineItemTotal()', () => {
    it('should calculate line item without discount or tax', () => {
      const result = pricingService.calculateLineItemTotal(product, 5);
      expect(result.subtotal.amount).toBe(50.0);
      expect(result.discount.amount).toBe(0);
      expect(result.tax.amount).toBe(0);
      expect(result.total.amount).toBe(50.0);
    });

    it('should calculate line item with discount and tax', () => {
      const discount: Discount = { type: DiscountType.PERCENTAGE, value: 10 };
      const taxConfig: TaxConfig = { rate: 0.08, name: 'Sales Tax' };
      const result = pricingService.calculateLineItemTotal(product, 5, discount, taxConfig);
      expect(result.subtotal.amount).toBe(50.0);
      expect(result.discount.amount).toBe(5.0);
      expect(result.tax.amount).toBe(3.6);
      expect(result.total.amount).toBe(48.6);
    });
  });
});

// Made with Bob
