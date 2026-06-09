/**
 * Domain Rules Module
 *
 * Exports all domain services, interfaces, and providers.
 * This barrel file simplifies imports throughout the application.
 */

// Base Domain Service
export { BaseDomainService } from '@core/domain/rules/base-domain.service';

// Pricing Service
export type {
  IPricingService,
  Discount,
  TaxConfig,
  BulkPricingTier,
  LineItemTotal,
} from '@core/domain/rules/pricing.service.interface';
export { DiscountType } from '@core/domain/rules/pricing.service.interface';
export { PricingService } from '@core/domain/rules/pricing.service';
export {
  PRICING_SERVICE,
  providePricingService,
  providePricingServiceImpl,
} from '@core/domain/rules/pricing.service.provider';

// Inventory Service
export type {
  IInventoryService,
  StockReservation,
  StockAvailability,
  LowStockThreshold,
  StockAdjustment,
} from '@core/domain/rules/inventory.service.interface';
export { InventoryService } from '@core/domain/rules/inventory.service';
export {
  INVENTORY_SERVICE,
  provideInventoryService,
  provideInventoryServiceImpl,
} from '@core/domain/rules/inventory.service.provider';

// Loyalty Service
export type {
  ILoyaltyService,
  TierConfig,
  PointsCalculation,
  RewardRedemption,
  TierProgression,
  PointsTransaction,
} from '@core/domain/rules/loyalty.service.interface';
export { LoyaltyTier } from '@core/domain/rules/loyalty.service.interface';
export { LoyaltyService } from '@core/domain/rules/loyalty.service';
export {
  LOYALTY_SERVICE,
  provideLoyaltyService,
  provideLoyaltyServiceImpl,
} from '@core/domain/rules/loyalty.service.provider';

// Made with Bob
