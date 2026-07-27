/**
 * Tenancy Scheduling Service Interface
 *
 * Defines the contract for opening residential tenancies for the Capy-Rent
 * persona (Diego, epic #17, Story 2 — Tenancy Lifecycle Management). It
 * validates a tenancy period, resolves its concrete occupancy interval, and
 * guards against overlapping tenancies on the same property so the occupancy
 * calendar never shows two tenants letting the same unit at once.
 *
 * The service is pure domain logic: it operates on plain tenancy records and
 * never touches persistence, dashboards, rent collection, or notifications.
 *
 * @interface ITenancySchedulingService
 */

/**
 * An active tenancy occupying a property for a fixed term.
 *
 * The occupied period is the half-open interval `[start, end)`: a tenancy that
 * ends exactly when another begins does not overlap it, so a unit can be
 * re-let on the same day the previous lease ends without a false conflict.
 */
export interface Tenancy {
  id: string;
  /** The property (flat/room) the tenancy occupies. */
  propertyId: string;
  tenantId: string;
  start: Date;
  end: Date;
  /** Recurring monthly rent, in minor currency units (e.g. pence/cents). */
  monthlyRentAmount: number;
  /** Deposit held for the tenancy, in minor currency units (may be zero). */
  depositAmount: number;
}

/**
 * A request to open a new tenancy.
 *
 * `start`/`end` accept a `Date` or an ISO date string. `depositAmount` is
 * optional and defaults to zero, letting callers open a deposit-free tenancy
 * without passing an explicit `0` everywhere.
 */
export interface TenancyRequest {
  propertyId: string;
  tenantId: string;
  start: Date | string;
  end: Date | string;
  /** Recurring monthly rent, in minor currency units. Must be positive. */
  monthlyRentAmount: number;
  /** Optional deposit held, in minor currency units. Defaults to 0. */
  depositAmount?: number;
}

/**
 * Tenancy Scheduling Service Interface
 *
 * Provides property-scoped conflict detection and a guarded tenancy-creation
 * operation that refuses to double-let a property.
 */
export interface ITenancySchedulingService {
  /**
   * Return every existing tenancy that would overlap the requested period on
   * the same property. An empty array means the unit is free for the period.
   */
  findConflicts(request: TenancyRequest, existing: Tenancy[]): Tenancy[];

  /**
   * True when the requested period would double-let its property.
   */
  hasConflict(request: TenancyRequest, existing: Tenancy[]): boolean;

  /**
   * Build an active {@link Tenancy} from a request, resolving its period and
   * deposit.
   *
   * @throws Error when the period would double-let the property, or when the
   * request is missing required fields, has an invalid or non-positive period,
   * a non-positive rent, or a negative deposit.
   */
  createTenancy(id: string, request: TenancyRequest, existing: Tenancy[]): Tenancy;
}

// Made with Bob
