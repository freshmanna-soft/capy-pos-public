import { Injectable } from '@angular/core';
import { Money } from '@core/domain/value-objects/money.value-object';
import { Product } from '@core/domain/entities/product.entity';
import {
  IPricingService,
  Discount,
  DiscountType,
  TaxConfig,
  BulkPricingTier,
  LineItemTotal,
} from '@core/domain/rules/pricing.service.interface';
import { BaseDomainService } from '@core/domain/rules/base-domain.service';

/**
 * Pricing Service Implementation
 *
 * Domain service responsible for all pricing calculations including:
 * - Product pricing with discounts
 * - Tax calculations
 * - Bulk pricing
 * - Promotional pricing
 *
 * Extends BaseDomainService for common functionality.
 * Implements IPricingService interface following Dependency Inversion Principle (DIP).
 * Uses Angular's Dependency Injection for service management.
 *
 * @example
 * ```typescript
 * // In a component or service
 * constructor(private pricingService: IPricingService) {}
 *
 * calculateTotal() {
 *   const finalPrice = this.pricingService.calculatePrice(product, 5, discount);
 *   const tax = this.pricingService.calculateTax(subtotal, taxConfig);
 * }
 * ```
 */
@Injectable({
  providedIn: 'root',
})
export class PricingService extends BaseDomainService implements IPricingService {
  constructor() {
    super('PricingService');
  }

  /**
   * Calculate final price for a product with quantity and optional discount
   */
  calculatePrice(product: Product, quantity: number, discount?: Discount, currency = 'USD'): Money {
    this.validateRequired(product, 'product');
    this.validatePositive(quantity, 'quantity');

    const basePrice = new Money(product.price, currency);
    const subtotal = basePrice.multiply(quantity);

    if (!discount) {
      return subtotal;
    }

    return this.applyDiscount(subtotal, quantity, discount);
  }

  /**
   * Apply discount to a subtotal
   */
  applyDiscount(subtotal: Money, quantity: number, discount: Discount): Money {
    // Check minimum quantity requirement
    if (discount.minQuantity && quantity < discount.minQuantity) {
      return subtotal;
    }

    switch (discount.type) {
      case DiscountType.PERCENTAGE:
        return this.applyPercentageDiscount(subtotal, discount.value);

      case DiscountType.FIXED_AMOUNT:
        return this.applyFixedDiscount(subtotal, discount.value);

      case DiscountType.BUY_X_GET_Y:
        return this.applyBuyXGetYDiscount(subtotal, quantity, discount);

      default:
        return subtotal;
    }
  }

  /**
   * Apply percentage discount (e.g., 10% off)
   */
  private applyPercentageDiscount(subtotal: Money, percentage: number): Money {
    this.validateRange(percentage, 0, 100, 'percentage');

    const discountAmount = subtotal.multiply(percentage / 100);
    return subtotal.subtract(discountAmount);
  }

  /**
   * Apply fixed amount discount (e.g., $5 off)
   */
  private applyFixedDiscount(subtotal: Money, amount: number): Money {
    this.validateNonNegative(amount, 'discount amount');

    const discountMoney = new Money(amount, subtotal.currency);

    // Don't let discount exceed subtotal
    if (discountMoney.greaterThan(subtotal)) {
      return new Money(0, subtotal.currency);
    }

    return subtotal.subtract(discountMoney);
  }

  /**
   * Apply Buy X Get Y discount (e.g., Buy 2 Get 1 Free)
   */
  private applyBuyXGetYDiscount(subtotal: Money, quantity: number, discount: Discount): Money {
    this.validateRequired(discount.buyQuantity, 'discount.buyQuantity');
    this.validateRequired(discount.getQuantity, 'discount.getQuantity');

    // Calculate how many free items customer gets
    const sets = Math.floor(quantity / (discount.buyQuantity + discount.getQuantity));
    const freeItems = sets * discount.getQuantity;

    if (freeItems === 0) {
      return subtotal;
    }

    // Calculate unit price and discount
    const unitPrice = subtotal.divide(quantity);
    const discountAmount = unitPrice.multiply(freeItems);

    return subtotal.subtract(discountAmount);
  }

  /**
   * Calculate tax on a subtotal
   */
  calculateTax(subtotal: Money, taxConfig: TaxConfig): Money {
    this.validateRequired(subtotal, 'subtotal');
    this.validateRequired(taxConfig, 'taxConfig');
    this.validateNonNegative(taxConfig.rate, 'tax rate');

    if (taxConfig.inclusive) {
      // Tax is already included in the price
      // Calculate the tax portion: subtotal * (rate / (1 + rate))
      return subtotal.multiply(taxConfig.rate / (1 + taxConfig.rate));
    }

    // Tax is added on top of the price
    return subtotal.multiply(taxConfig.rate);
  }

  /**
   * Calculate total with tax
   */
  calculateTotal(subtotal: Money, taxConfig: TaxConfig): Money {
    const tax = this.calculateTax(subtotal, taxConfig);

    if (taxConfig.inclusive) {
      // Tax already included, return subtotal as is
      return subtotal;
    }

    // Add tax to subtotal
    return subtotal.add(tax);
  }

  /**
   * Calculate bulk pricing discount based on quantity tiers
   */
  calculateBulkPrice(basePrice: Money, quantity: number, tiers: BulkPricingTier[]): Money {
    this.validateRequired(basePrice, 'basePrice');
    this.validatePositive(quantity, 'quantity');
    this.validateRequired(tiers, 'tiers');

    // Sort tiers by minQuantity descending to find the best applicable tier
    const sortedTiers = [...tiers].sort((a, b) => b.minQuantity - a.minQuantity);

    // Find the first tier that applies
    const applicableTier = sortedTiers.find((tier) => quantity >= tier.minQuantity);

    if (!applicableTier) {
      return basePrice.multiply(quantity);
    }

    // Apply the tier discount
    const subtotal = basePrice.multiply(quantity);
    return this.applyPercentageDiscount(subtotal, applicableTier.discountPercentage);
  }

  /**
   * Calculate line item total (price * quantity with discount and tax)
   */
  calculateLineItemTotal(
    product: Product,
    quantity: number,
    discount?: Discount,
    taxConfig?: TaxConfig,
    currency = 'USD'
  ): LineItemTotal {
    const priceAsMoney = new Money(product.price, currency);
    const subtotal = priceAsMoney.multiply(quantity);

    let discountAmount = new Money(0, currency);
    let finalSubtotal = subtotal;

    if (discount) {
      finalSubtotal = this.applyDiscount(subtotal, quantity, discount);
      discountAmount = subtotal.subtract(finalSubtotal);
    }

    let tax = new Money(0, currency);
    let total = finalSubtotal;

    if (taxConfig) {
      tax = this.calculateTax(finalSubtotal, taxConfig);
      total = this.calculateTotal(finalSubtotal, taxConfig);
    }

    return {
      subtotal,
      discount: discountAmount,
      tax,
      total,
    };
  }
}

// Made with Bob
