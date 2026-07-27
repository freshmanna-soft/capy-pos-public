import { Injectable } from '@angular/core';
import { BaseDomainService } from '@core/domain/rules/base-domain.service';
import {
  ArrearsAssessment,
  ArrearsPolicy,
  ArrearsStatus,
  IRentCollectionService,
  RentCollectionSummary,
  RentInvoice,
  RentScheduleRequest,
} from '@core/domain/rules/rent-collection.service.interface';

/** Whole days in a 24-hour period, used to convert overdue milliseconds. */
const MS_PER_DAY = 24 * 60 * 60 * 1000;

/**
 * Default arrears escalation thresholds (in days past due). A reminder goes
 * out the day after rent is missed, a final notice a week later, and the
 * invoice is flagged for escalation after a fortnight.
 */
const DEFAULT_POLICY: ArrearsPolicy = {
  reminderAfterDays: 1,
  finalNoticeAfterDays: 7,
  escalationAfterDays: 14,
};

/**
 * Rent Collection Service Implementation
 *
 * Turns a tenancy into a dated rent schedule, assesses each invoice's arrears
 * escalation as of an explicit "as of" date, and rolls a portfolio up into the
 * figures a collection dashboard shows.
 *
 * @class RentCollectionService
 * @extends BaseDomainService
 * @implements IRentCollectionService
 */
@Injectable({ providedIn: 'root' })
export class RentCollectionService extends BaseDomainService implements IRentCollectionService {
  constructor() {
    super('RentCollectionService');
  }

  /**
   * Build the ordered list of rent invoices due within a tenancy's period.
   */
  generateSchedule(request: RentScheduleRequest): RentInvoice[] {
    this.validateRequired(request, 'Rent schedule request');
    this.validateNotEmpty(request.tenancyId, 'Tenancy id');
    this.validatePositive(request.monthlyRentAmount, 'Monthly rent amount');
    this.validateDueDay(request.dueDayOfMonth);

    const start = this.parseDate(request.start, 'start');
    const end = this.parseDate(request.end, 'end');
    this.validateInput(end.getTime() > start.getTime(), 'end must be after start');

    const tenancyId = request.tenancyId.trim();
    const invoices: RentInvoice[] = [];

    // Walk month by month, billing on the (clamped) due day, and keep every
    // due date that falls inside the half-open occupancy interval [start, end).
    for (
      let due = this.dueDateFor(start.getUTCFullYear(), start.getUTCMonth(), request.dueDayOfMonth);
      due.getTime() < end.getTime();
      due = this.dueDateFor(due.getUTCFullYear(), due.getUTCMonth() + 1, request.dueDayOfMonth)
    ) {
      if (due.getTime() >= start.getTime()) {
        invoices.push({
          tenancyId,
          dueDate: due,
          amountDue: request.monthlyRentAmount,
          amountPaid: 0,
        });
      }
    }

    return invoices;
  }

  /**
   * Assess a single invoice's balance and arrears status as of `asOf`.
   */
  assess(
    invoice: RentInvoice,
    asOf: Date | string,
    policy?: Partial<ArrearsPolicy>
  ): ArrearsAssessment {
    this.validateRequired(invoice, 'Rent invoice');
    this.validateNotEmpty(invoice.tenancyId, 'Tenancy id');
    this.validatePositive(invoice.amountDue, 'Amount due');
    this.validateNonNegative(invoice.amountPaid, 'Amount paid');

    const dueDate = this.parseDate(invoice.dueDate, 'due date');
    const now = this.parseDate(asOf, 'asOf');
    const resolved = this.resolvePolicy(policy);

    const balance = Math.max(0, invoice.amountDue - invoice.amountPaid);
    const daysOverdue =
      balance === 0 ? 0 : Math.max(0, Math.floor((now.getTime() - dueDate.getTime()) / MS_PER_DAY));
    const status = this.statusFor(balance, daysOverdue, resolved);

    return {
      invoice,
      balance,
      daysOverdue,
      status,
      legalActionFlagged: status === ArrearsStatus.Escalation,
    };
  }

  /**
   * Assess every invoice as of `asOf`, preserving input order.
   */
  assessAll(
    invoices: RentInvoice[],
    asOf: Date | string,
    policy?: Partial<ArrearsPolicy>
  ): ArrearsAssessment[] {
    const list = invoices ?? [];
    return list.map((invoice) => this.assess(invoice, asOf, policy));
  }

  /**
   * Roll a portfolio of invoices up into collection-dashboard figures.
   */
  summarize(
    invoices: RentInvoice[],
    asOf: Date | string,
    policy?: Partial<ArrearsPolicy>
  ): RentCollectionSummary {
    const assessments = this.assessAll(invoices, asOf, policy);
    const atRisk = new Set<string>();

    let totalDue = 0;
    let totalCollected = 0;
    let totalArrears = 0;

    for (const assessment of assessments) {
      const { invoice, balance, status } = assessment;
      totalDue += invoice.amountDue;
      // Never credit more than was billed, even if an invoice is overpaid.
      totalCollected += Math.min(invoice.amountPaid, invoice.amountDue);

      if (
        status === ArrearsStatus.Reminder ||
        status === ArrearsStatus.FinalNotice ||
        status === ArrearsStatus.Escalation
      ) {
        totalArrears += balance;
      }

      if (status === ArrearsStatus.FinalNotice || status === ArrearsStatus.Escalation) {
        atRisk.add(invoice.tenancyId);
      }
    }

    return {
      totalDue,
      totalCollected,
      totalArrears,
      atRiskTenancyIds: [...atRisk].sort(),
    };
  }

  /**
   * Map an outstanding balance and its days overdue onto an escalation level.
   */
  private statusFor(balance: number, daysOverdue: number, policy: ArrearsPolicy): ArrearsStatus {
    if (balance === 0) {
      return ArrearsStatus.Paid;
    }
    if (daysOverdue >= policy.escalationAfterDays) {
      return ArrearsStatus.Escalation;
    }
    if (daysOverdue >= policy.finalNoticeAfterDays) {
      return ArrearsStatus.FinalNotice;
    }
    if (daysOverdue >= policy.reminderAfterDays) {
      return ArrearsStatus.Reminder;
    }
    return ArrearsStatus.Due;
  }

  /**
   * Merge a partial policy over the defaults and validate that the thresholds
   * are non-negative and strictly increasing.
   */
  private resolvePolicy(policy?: Partial<ArrearsPolicy>): ArrearsPolicy {
    const resolved: ArrearsPolicy = { ...DEFAULT_POLICY, ...policy };

    this.validateNonNegative(resolved.reminderAfterDays, 'reminderAfterDays');
    this.validateInput(
      resolved.reminderAfterDays < resolved.finalNoticeAfterDays,
      'finalNoticeAfterDays must be greater than reminderAfterDays'
    );
    this.validateInput(
      resolved.finalNoticeAfterDays < resolved.escalationAfterDays,
      'escalationAfterDays must be greater than finalNoticeAfterDays'
    );

    return resolved;
  }

  /**
   * Resolve the due date for a given year/month and requested day, clamping the
   * day to the last day of the month so shorter months still bill (e.g. a
   * `31`st due day bills on 28 Feb). Month overflow is normalised, so passing
   * month `12` rolls into January of the next year.
   */
  private dueDateFor(year: number, month: number, dueDayOfMonth: number): Date {
    // Day 0 of the following month is the last day of `month`, giving its length.
    const lastDayOfMonth = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
    const day = Math.min(dueDayOfMonth, lastDayOfMonth);
    return new Date(Date.UTC(year, month, day));
  }

  /**
   * Validate that the due day is an integer within 1–31.
   */
  private validateDueDay(dueDayOfMonth: number): void {
    this.validateInput(
      Number.isInteger(dueDayOfMonth) && dueDayOfMonth >= 1 && dueDayOfMonth <= 31,
      'Due day of month must be an integer between 1 and 31'
    );
  }

  /**
   * Parse a Date or ISO date string into a Date, rejecting invalid values.
   */
  private parseDate(value: Date | string, paramName: string): Date {
    this.validateRequired(value, paramName);
    const date = value instanceof Date ? value : new Date(value);
    this.validateInput(!Number.isNaN(date.getTime()), `${paramName} must be a valid date`);
    return date;
  }
}

// Made with Bob
