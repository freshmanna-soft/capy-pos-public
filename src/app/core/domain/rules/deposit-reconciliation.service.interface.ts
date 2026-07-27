/**
 * Deposit Reconciliation Service Interface
 *
 * Defines the contract for settling a tenancy's security deposit at move-out
 * for the Capy-Rent persona (Diego, epic #17, Story 2 — Tenancy Lifecycle
 * Management: deposit ledger and move-out checkout). It takes the deposit held
 * at the start of a tenancy and the itemised deductions raised on move-out
 * (damage, cleaning, arrears, and other), totals them per category, and works
 * out what is returned to the tenant and any shortfall they still owe.
 *
 * The service is pure domain logic: it operates on plain deposit records and
 * never touches persistence, dashboards, payouts, or notifications. The
 * settlement is a deterministic function of its inputs so it stays testable.
 *
 * @interface IDepositReconciliationService
 */

/**
 * The category a single deposit deduction is booked against. These mirror the
 * grounds a landlord may lawfully withhold a deposit for on move-out.
 */
export enum DepositDeductionCategory {
  /** Repair of damage beyond fair wear and tear (e.g. a broken window). */
  Damage = 'damage',
  /** Professional cleaning to restore the unit's condition. */
  Cleaning = 'cleaning',
  /** Unpaid rent rolled into the deposit settlement. */
  Arrears = 'arrears',
  /** Any other agreed deduction that does not fit the categories above. */
  Other = 'other',
}

/**
 * A single itemised deduction taken from the deposit on move-out.
 */
export interface DepositDeduction {
  /** The ground the deduction is booked against. */
  category: DepositDeductionCategory;
  /** Amount withheld for this line, in minor currency units. Must be positive. */
  amount: number;
  /** Optional free-text note explaining the deduction (e.g. "broken window"). */
  description?: string;
}

/**
 * A request to settle one tenancy's deposit at move-out.
 */
export interface DepositSettlementRequest {
  tenancyId: string;
  /** Deposit held at the start of the tenancy, in minor currency units. Must be positive. */
  depositHeld: number;
  /** Itemised deductions to apply on move-out. Defaults to none (full return). */
  deductions?: DepositDeduction[];
}

/**
 * The settled outcome of reconciling one tenancy's deposit.
 */
export interface DepositSettlement {
  tenancyId: string;
  /** Deposit that was held, in minor currency units. */
  depositHeld: number;
  /** Sum of every deduction line, in minor currency units. */
  totalDeductions: number;
  /**
   * Deduction totals broken down by category. Every category is present, with
   * a zero total for any category that had no deductions.
   */
  deductionsByCategory: Record<DepositDeductionCategory, number>;
  /**
   * Amount returned to the tenant (`depositHeld - totalDeductions`), never
   * negative — deductions can exhaust the deposit but not create a debt here.
   */
  amountReturned: number;
  /**
   * Uncovered amount owed by the tenant when deductions exceed the deposit
   * (`totalDeductions - depositHeld`), never negative.
   */
  shortfall: number;
  /**
   * True when no deductions were applied and the full deposit is returned.
   */
  fullyReturned: boolean;
}

/**
 * Deposit Reconciliation Service Interface
 *
 * Provides deterministic move-out deposit settlement: per-category deduction
 * totals, the amount returned to the tenant, and any shortfall they owe.
 */
export interface IDepositReconciliationService {
  /**
   * Settle a single tenancy's deposit at move-out.
   *
   * @throws Error when the request is missing required fields, the deposit
   * held is not positive, or any deduction has an unknown category or a
   * non-positive amount.
   */
  reconcile(request: DepositSettlementRequest): DepositSettlement;

  /**
   * Settle every request in a batch, preserving input order. Useful for
   * running move-out settlements across a portfolio in one pass.
   */
  reconcileAll(requests: DepositSettlementRequest[]): DepositSettlement[];
}

// Made with Bob
