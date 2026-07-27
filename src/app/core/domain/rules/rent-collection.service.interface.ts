/**
 * Rent Collection Service Interface
 *
 * Defines the contract for monthly rent collection and arrears tracking for
 * the Capy-Rent persona (Diego, epic #17, Story 3 — Monthly Rent Collection &
 * Arrears Tracking). It turns a tenancy into a schedule of dated rent
 * invoices, assesses each invoice's outstanding balance and arrears
 * escalation level as of a given day, and rolls a portfolio of invoices up
 * into the figures a collection dashboard shows: total due, total collected,
 * outstanding arrears, and the tenancies at risk.
 *
 * The service is pure domain logic: it operates on plain invoice records and
 * an explicit "as of" date, and never touches persistence, dashboards,
 * notifications, or payment reconciliation. Callers supply the current date so
 * assessments stay deterministic and testable.
 *
 * @interface IRentCollectionService
 */

/**
 * Arrears escalation level for a single rent invoice, ordered from healthiest
 * to most severe. Escalation is driven by how many whole days a still-unpaid
 * invoice is past its due date, using the thresholds in {@link ArrearsPolicy}.
 */
export enum ArrearsStatus {
  /** Fully paid (balance is zero or the tenant has overpaid). */
  Paid = 'paid',
  /** Outstanding balance, but not yet past the due date. */
  Due = 'due',
  /** Overdue — a first, gentle payment reminder is warranted. */
  Reminder = 'reminder',
  /** Overdue longer — a final notice before escalation. */
  FinalNotice = 'final-notice',
  /** Seriously overdue — flagged for escalation (e.g. legal action). */
  Escalation = 'escalation',
}

/**
 * Thresholds (in whole days past the due date) at which an unpaid invoice
 * escalates from one {@link ArrearsStatus} to the next. All fields are
 * optional; {@link IRentCollectionService.assess} fills any gaps from its
 * defaults. Thresholds must be strictly increasing:
 * `reminderAfterDays < finalNoticeAfterDays < escalationAfterDays`.
 */
export interface ArrearsPolicy {
  /** Days overdue at which an unpaid invoice becomes a reminder. Default 1. */
  reminderAfterDays: number;
  /** Days overdue at which it becomes a final notice. Default 7. */
  finalNoticeAfterDays: number;
  /** Days overdue at which it is flagged for escalation. Default 14. */
  escalationAfterDays: number;
}

/**
 * A request to generate a rent schedule across a tenancy's period.
 *
 * `start`/`end` accept a `Date` or an ISO date string and describe the
 * half-open occupancy interval `[start, end)`, matching the tenancy scheduler.
 * A rent invoice is generated for every `dueDayOfMonth` that falls within that
 * interval.
 */
export interface RentScheduleRequest {
  tenancyId: string;
  /** Recurring monthly rent, in minor currency units (e.g. pence/cents). Must be positive. */
  monthlyRentAmount: number;
  /**
   * Day of the month rent falls due (1–31). Months shorter than the chosen day
   * clamp to their last day (e.g. `31` bills on 28 Feb).
   */
  dueDayOfMonth: number;
  start: Date | string;
  end: Date | string;
}

/**
 * A single dated rent invoice for a tenancy.
 *
 * `amountPaid` is what has been received against this invoice so far and
 * defaults to zero for a freshly generated schedule.
 */
export interface RentInvoice {
  tenancyId: string;
  /** The date this month's rent falls due. */
  dueDate: Date;
  /** Amount billed, in minor currency units. */
  amountDue: number;
  /** Amount received so far, in minor currency units. Defaults to 0. */
  amountPaid: number;
}

/**
 * The assessed state of one invoice as of a given day.
 */
export interface ArrearsAssessment {
  invoice: RentInvoice;
  /** Outstanding balance (`amountDue - amountPaid`), never negative. */
  balance: number;
  /** Whole days past the due date; `0` when not yet overdue or fully paid. */
  daysOverdue: number;
  /** Escalation level for this invoice. */
  status: ArrearsStatus;
  /** True when the invoice has reached the escalation threshold. */
  legalActionFlagged: boolean;
}

/**
 * Portfolio-level rent collection figures as of a given day.
 */
export interface RentCollectionSummary {
  /** Sum of every invoice's billed amount. */
  totalDue: number;
  /** Sum of every invoice's received amount (capped at what was billed). */
  totalCollected: number;
  /** Sum of outstanding balances on overdue invoices. */
  totalArrears: number;
  /**
   * Distinct tenancy ids with at least one invoice at final-notice or
   * escalation level, sorted ascending.
   */
  atRiskTenancyIds: string[];
}

/**
 * Rent Collection Service Interface
 *
 * Provides deterministic rent scheduling, per-invoice arrears assessment, and
 * portfolio roll-up for the collection dashboard.
 */
export interface IRentCollectionService {
  /**
   * Build the ordered list of rent invoices due within a tenancy's period.
   * Each generated invoice starts unpaid (`amountPaid` of 0).
   *
   * @throws Error when the request is missing required fields, has an invalid
   * or non-positive period, a non-positive rent, or a `dueDayOfMonth` outside
   * 1–31.
   */
  generateSchedule(request: RentScheduleRequest): RentInvoice[];

  /**
   * Assess a single invoice's balance and arrears status as of `asOf`.
   *
   * @throws Error when the invoice is invalid, `asOf` is not a valid date, or
   * the resolved policy thresholds are not strictly increasing.
   */
  assess(
    invoice: RentInvoice,
    asOf: Date | string,
    policy?: Partial<ArrearsPolicy>
  ): ArrearsAssessment;

  /**
   * Assess every invoice as of `asOf`, preserving input order.
   */
  assessAll(
    invoices: RentInvoice[],
    asOf: Date | string,
    policy?: Partial<ArrearsPolicy>
  ): ArrearsAssessment[];

  /**
   * Roll a portfolio of invoices up into collection-dashboard figures as of
   * `asOf`.
   */
  summarize(
    invoices: RentInvoice[],
    asOf: Date | string,
    policy?: Partial<ArrearsPolicy>
  ): RentCollectionSummary;
}

// Made with Bob
