import { Money } from '@core/domain/value-objects/money.value-object';
import { Product } from '@core/domain/entities/product.entity';

/**
 * Discount type enumeration
 */
export enum DiscountType {
  PERCENTAGE = 'PERCENTAGE',
  FIXED_AMOUNT = 'FIXED_AMOUNT',
  BUY_X_GET_Y = 'BUY_X_GET_Y',
}

/**
 * Discount configuration interface
 */
export interface Discount {
  type: DiscountType;
  value: number;
  minQuantity?: number;
  buyQuantity?: number;
  getQuantity?: number;
}

/**
 * Tax configuration interface
 */
export interface TaxConfig {
  rate: number;
  name: string;
  inclusive?: boolean;
}

/**
 * Bulk pricing tier interface
 */
export interface BulkPricingTier {
  minQuantity: number;
  discountPercentage: number;
}

/**
 * Line item calculation result interface
 */
export interface LineItemTotal {
  subtotal: Money;
  discount: Money;
  tax: Money;
  total: Money;
}

/**
 * Pricing Service Interface
 *
 * Defines the contract for pricing calculations in the domain.
 * Follows Interface Segregation Principle (ISP) and Dependency Inversion Principle (DIP).
 */
export interface IPricingService {
  /**
   * Calculate final price for a product with quantity and optional discount
   */
  calculatePrice(product: Product, quantity: number, discount?: Discount, currency?: string): Money;

  /**
   * Apply discount to a subtotal
   */
  applyDiscount(subtotal: Money, quantity: number, discount: Discount): Money;

  /**
   * Calculate tax on a subtotal
   */
  calculateTax(subtotal: Money, taxConfig: TaxConfig): Money;

  /**
   * Calculate total with tax
   */
  calculateTotal(subtotal: Money, taxConfig: TaxConfig): Money;

  /**
   * Calculate bulk pricing discount based on quantity tiers
   */
  calculateBulkPrice(basePrice: Money, quantity: number, tiers: BulkPricingTier[]): Money;

  /**
   * Calculate line item total (price * quantity with discount and tax)
   */
  calculateLineItemTotal(
    product: Product,
    quantity: number,
    discount?: Discount,
    taxConfig?: TaxConfig,
    currency?: string
  ): LineItemTotal;
}

// Made with Bob
