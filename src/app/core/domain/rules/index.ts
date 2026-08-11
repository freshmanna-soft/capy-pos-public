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

// Order Normalization Service
export type {
  IOrderNormalizationService,
  NormalizedOrder,
  NormalizedOrderItem,
  PosRegisterOrder,
  UberEatsOrder,
  OrderAheadOrder,
} from '@core/domain/rules/order-normalization.service.interface';
export { OrderChannel } from '@core/domain/rules/order-normalization.service.interface';
export { OrderNormalizationService } from '@core/domain/rules/order-normalization.service';
export {
  ORDER_NORMALIZATION_SERVICE,
  provideOrderNormalizationService,
  provideOrderNormalizationServiceImpl,
} from '@core/domain/rules/order-normalization.service.provider';

// Appointment Scheduling Service
export type {
  IAppointmentSchedulingService,
  ScheduledAppointment,
  AppointmentRequest,
} from '@core/domain/rules/appointment-scheduling.service.interface';
export { AppointmentType } from '@core/domain/rules/appointment-scheduling.service.interface';
export { AppointmentSchedulingService } from '@core/domain/rules/appointment-scheduling.service';
export {
  APPOINTMENT_SCHEDULING_SERVICE,
  provideAppointmentSchedulingService,
  provideAppointmentSchedulingServiceImpl,
} from '@core/domain/rules/appointment-scheduling.service.provider';

// Tenancy Scheduling Service
export type {
  ITenancySchedulingService,
  Tenancy,
  TenancyRequest,
} from '@core/domain/rules/tenancy-scheduling.service.interface';
export { TenancySchedulingService } from '@core/domain/rules/tenancy-scheduling.service';
export {
  TENANCY_SCHEDULING_SERVICE,
  provideTenancySchedulingService,
  provideTenancySchedulingServiceImpl,
} from '@core/domain/rules/tenancy-scheduling.service.provider';

// Rent Collection Service
export type {
  IRentCollectionService,
  ArrearsPolicy,
  RentScheduleRequest,
  RentInvoice,
  ArrearsAssessment,
  RentCollectionSummary,
} from '@core/domain/rules/rent-collection.service.interface';
export { ArrearsStatus } from '@core/domain/rules/rent-collection.service.interface';
export { RentCollectionService } from '@core/domain/rules/rent-collection.service';
export {
  RENT_COLLECTION_SERVICE,
  provideRentCollectionService,
  provideRentCollectionServiceImpl,
} from '@core/domain/rules/rent-collection.service.provider';

// Vaccination Scheduling Service
export type {
  IVaccinationSchedulingService,
  VaccinationProtocolDose,
  VaccinationScheduleRequest,
  PlannedVaccination,
  VaccinationRecord,
  VaccinationReminderPolicy,
  VaccinationAssessment,
  VaccinationSummary,
} from '@core/domain/rules/vaccination-scheduling.service.interface';
export {
  Species,
  VaccineType,
  VaccinationStatus,
} from '@core/domain/rules/vaccination-scheduling.service.interface';
export { VaccinationSchedulingService } from '@core/domain/rules/vaccination-scheduling.service';
export {
  VACCINATION_SCHEDULING_SERVICE,
  provideVaccinationSchedulingService,
  provideVaccinationSchedulingServiceImpl,
} from '@core/domain/rules/vaccination-scheduling.service.provider';

// Made with Bob
