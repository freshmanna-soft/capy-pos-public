/**
 * Domain Rules Module
 * 
 * Exports all domain services, interfaces, and providers.
 * This barrel file simplifies imports throughout the application.
 */

// Base Domain Service
export { BaseDomainService } from './base-domain.service';

// Pricing Service
export type {
  IPricingService,
  Discount,
  TaxConfig,
  BulkPricingTier,
  LineItemTotal
} from './pricing.service.interface';
export { DiscountType } from './pricing.service.interface';
export { PricingService } from './pricing.service';
export {
  PRICING_SERVICE,
  providePricingService,
  providePricingServiceImpl
} from './pricing.service.provider';

// Inventory Service
export type {
  IInventoryService,
  StockReservation,
  StockAvailability,
  LowStockThreshold,
  StockAdjustment
} from './inventory.service.interface';
export { InventoryService } from './inventory.service';
export {
  INVENTORY_SERVICE,
  provideInventoryService,
  provideInventoryServiceImpl
} from './inventory.service.provider';

// Loyalty Service
export type {
  ILoyaltyService,
  TierConfig,
  PointsCalculation,
  RewardRedemption,
  TierProgression,
  PointsTransaction
} from './loyalty.service.interface';
export { LoyaltyTier } from './loyalty.service.interface';
export { LoyaltyService } from './loyalty.service';
export {
  LOYALTY_SERVICE,
  provideLoyaltyService,
  provideLoyaltyServiceImpl
} from './loyalty.service.provider';

// Made with Bob