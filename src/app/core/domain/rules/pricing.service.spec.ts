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

  describe('applyDiscount() - Buy X Get Y', () => {
    it('should apply buy 2 get 1 free discount', () => {
      const subtotal = new Money(30, 'USD'); // 3 items at $10 each
      const discount: Discount = {
        type: DiscountType.BUY_X_GET_Y,
        value: 0,
        buyQuantity: 2,
        getQuantity: 1,
      };
      const result = pricingService.applyDiscount(subtotal, 3, discount);
      // 1 set of (2+1), 1 free item = $10 off
      expect(result.amount).toBe(20.0);
    });

    it('should not apply buy x get y when quantity is insufficient', () => {
      const subtotal = new Money(20, 'USD'); // 2 items at $10 each
      const discount: Discount = {
        type: DiscountType.BUY_X_GET_Y,
        value: 0,
        buyQuantity: 3,
        getQuantity: 1,
      };
      const result = pricingService.applyDiscount(subtotal, 2, discount);
      expect(result.amount).toBe(20.0); // No discount applied
    });
  });

  describe('applyDiscount() - Minimum Quantity', () => {
    it('should not apply discount when quantity is below minQuantity', () => {
      const subtotal = new Money(20, 'USD');
      const discount: Discount = {
        type: DiscountType.PERCENTAGE,
        value: 10,
        minQuantity: 5,
      };
      const result = pricingService.applyDiscount(subtotal, 2, discount);
      expect(result.amount).toBe(20.0); // No discount
    });

    it('should apply discount when quantity meets minQuantity', () => {
      const subtotal = new Money(50, 'USD');
      const discount: Discount = {
        type: DiscountType.PERCENTAGE,
        value: 10,
        minQuantity: 5,
      };
      const result = pricingService.applyDiscount(subtotal, 5, discount);
      expect(result.amount).toBe(45.0);
    });

    it('should return subtotal for unknown discount type', () => {
      const subtotal = new Money(100, 'USD');
      const discount: Discount = {
        type: 'UNKNOWN' as DiscountType,
        value: 10,
      };
      const result = pricingService.applyDiscount(subtotal, 1, discount);
      expect(result.amount).toBe(100.0);
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

    it('should calculate inclusive tax', () => {
      const subtotal = new Money(108, 'USD');
      const taxConfig: TaxConfig = { rate: 0.08, name: 'VAT', inclusive: true };
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

  describe('calculateTotal()', () => {
    it('should add tax to subtotal for exclusive tax', () => {
      const subtotal = new Money(100, 'USD');
      const taxConfig: TaxConfig = { rate: 0.08, name: 'Sales Tax' };
      const result = pricingService.calculateTotal(subtotal, taxConfig);
      expect(result.amount).toBe(108.0);
    });

    it('should return subtotal as-is for inclusive tax', () => {
      const subtotal = new Money(108, 'USD');
      const taxConfig: TaxConfig = { rate: 0.08, name: 'VAT', inclusive: true };
      const result = pricingService.calculateTotal(subtotal, taxConfig);
      expect(result.amount).toBe(108.0);
    });
  });

  describe('calculateBulkPrice()', () => {
    it('should apply bulk pricing tier when quantity qualifies', () => {
      const basePrice = new Money(10, 'USD');
      const tiers = [
        { minQuantity: 10, discountPercentage: 10 },
        { minQuantity: 50, discountPercentage: 20 },
      ];
      const result = pricingService.calculateBulkPrice(basePrice, 15, tiers);
      // 15 * $10 = $150, 10% off = $135
      expect(result.amount).toBe(135.0);
    });

    it('should apply highest applicable tier', () => {
      const basePrice = new Money(10, 'USD');
      const tiers = [
        { minQuantity: 10, discountPercentage: 10 },
        { minQuantity: 50, discountPercentage: 20 },
      ];
      const result = pricingService.calculateBulkPrice(basePrice, 60, tiers);
      // 60 * $10 = $600, 20% off = $480
      expect(result.amount).toBe(480.0);
    });

    it('should return full price when no tier applies', () => {
      const basePrice = new Money(10, 'USD');
      const tiers = [{ minQuantity: 10, discountPercentage: 10 }];
      const result = pricingService.calculateBulkPrice(basePrice, 5, tiers);
      // 5 * $10 = $50, no tier applies
      expect(result.amount).toBe(50.0);
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
