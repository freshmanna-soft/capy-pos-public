import { describe, it, expect, beforeEach } from 'vitest';
import { RentCollectionService } from '@core/domain/rules/rent-collection.service';
import {
  ArrearsStatus,
  IRentCollectionService,
  RentInvoice,
  RentScheduleRequest,
} from '@core/domain/rules/rent-collection.service.interface';

describe('RentCollectionService', () => {
  let service: IRentCollectionService;

  beforeEach(() => {
    service = new RentCollectionService();
  });

  const validRequest = (overrides: Partial<RentScheduleRequest> = {}): RentScheduleRequest => ({
    tenancyId: 'tenancy-1',
    monthlyRentAmount: 120_000,
    dueDayOfMonth: 1,
    start: '2026-01-01T00:00:00.000Z',
    end: '2026-04-01T00:00:00.000Z',
    ...overrides,
  });

  const invoice = (overrides: Partial<RentInvoice> = {}): RentInvoice => ({
    tenancyId: 'tenancy-1',
    dueDate: new Date('2026-01-01T00:00:00.000Z'),
    amountDue: 120_000,
    amountPaid: 0,
    ...overrides,
  });

  describe('generateSchedule', () => {
    it('should generate one invoice per month within the period', () => {
      const invoices = service.generateSchedule(validRequest());

      expect(invoices).toHaveLength(3);
      expect(invoices.map((i) => i.dueDate.toISOString())).toEqual([
        '2026-01-01T00:00:00.000Z',
        '2026-02-01T00:00:00.000Z',
        '2026-03-01T00:00:00.000Z',
      ]);
    });

    it('should bill the monthly rent, unpaid, on each invoice', () => {
      const invoices = service.generateSchedule(validRequest());

      for (const inv of invoices) {
        expect(inv.tenancyId).toBe('tenancy-1');
        expect(inv.amountDue).toBe(120_000);
        expect(inv.amountPaid).toBe(0);
      }
    });

    it('should exclude a due date on the exclusive end boundary', () => {
      // Period ends exactly on the 1 Apr due date, which must not be billed.
      const invoices = service.generateSchedule(validRequest({ end: '2026-04-01T00:00:00.000Z' }));

      expect(invoices.map((i) => i.dueDate.toISOString())).not.toContain(
        '2026-04-01T00:00:00.000Z'
      );
    });

    it('should skip a first due day that falls before the start', () => {
      // Start on the 10th with rent due on the 1st: January is skipped.
      const invoices = service.generateSchedule(
        validRequest({ start: '2026-01-10T00:00:00.000Z', dueDayOfMonth: 1 })
      );

      expect(invoices.map((i) => i.dueDate.toISOString())).toEqual([
        '2026-02-01T00:00:00.000Z',
        '2026-03-01T00:00:00.000Z',
      ]);
    });

    it('should clamp the due day to the last day of a short month', () => {
      const invoices = service.generateSchedule(
        validRequest({
          dueDayOfMonth: 31,
          start: '2026-01-01T00:00:00.000Z',
          end: '2026-04-01T00:00:00.000Z',
        })
      );

      // 2026 is not a leap year, so February clamps to the 28th.
      expect(invoices.map((i) => i.dueDate.toISOString())).toEqual([
        '2026-01-31T00:00:00.000Z',
        '2026-02-28T00:00:00.000Z',
        '2026-03-31T00:00:00.000Z',
      ]);
    });

    it('should trim the tenancy id', () => {
      const invoices = service.generateSchedule(validRequest({ tenancyId: '  tenancy-1  ' }));

      expect(invoices[0].tenancyId).toBe('tenancy-1');
    });

    it('should throw for a blank tenancy id', () => {
      expect(() => service.generateSchedule(validRequest({ tenancyId: '  ' }))).toThrow(
        /Tenancy id/
      );
    });

    it('should throw for a non-positive rent', () => {
      expect(() => service.generateSchedule(validRequest({ monthlyRentAmount: 0 }))).toThrow(
        /Monthly rent amount must be positive/
      );
    });

    it('should throw for a due day outside 1-31', () => {
      expect(() => service.generateSchedule(validRequest({ dueDayOfMonth: 32 }))).toThrow(
        /Due day of month/
      );
      expect(() => service.generateSchedule(validRequest({ dueDayOfMonth: 0 }))).toThrow(
        /Due day of month/
      );
    });

    it('should throw for a non-integer due day', () => {
      expect(() => service.generateSchedule(validRequest({ dueDayOfMonth: 1.5 }))).toThrow(
        /Due day of month/
      );
    });

    it('should throw when end is not after start', () => {
      expect(() =>
        service.generateSchedule(
          validRequest({ start: '2026-04-01T00:00:00.000Z', end: '2026-01-01T00:00:00.000Z' })
        )
      ).toThrow(/end must be after start/);
    });

    it('should throw for an invalid start date', () => {
      expect(() => service.generateSchedule(validRequest({ start: 'not-a-date' }))).toThrow(
        /start must be a valid date/
      );
    });
  });

  describe('assess', () => {
    it('should report a paid invoice with no arrears', () => {
      const result = service.assess(invoice({ amountPaid: 120_000 }), '2026-02-01T00:00:00.000Z');

      expect(result.balance).toBe(0);
      expect(result.daysOverdue).toBe(0);
      expect(result.status).toBe(ArrearsStatus.Paid);
      expect(result.legalActionFlagged).toBe(false);
    });

    it('should treat an overpaid invoice as paid with a zero balance', () => {
      const result = service.assess(invoice({ amountPaid: 130_000 }), '2026-02-01T00:00:00.000Z');

      expect(result.balance).toBe(0);
      expect(result.status).toBe(ArrearsStatus.Paid);
    });

    it('should report an outstanding balance not yet overdue as due', () => {
      const result = service.assess(invoice(), '2026-01-01T00:00:00.000Z');

      expect(result.balance).toBe(120_000);
      expect(result.daysOverdue).toBe(0);
      expect(result.status).toBe(ArrearsStatus.Due);
    });

    it('should escalate to a reminder once overdue', () => {
      const result = service.assess(invoice(), '2026-01-03T00:00:00.000Z');

      expect(result.daysOverdue).toBe(2);
      expect(result.status).toBe(ArrearsStatus.Reminder);
    });

    it('should escalate to a final notice past the threshold', () => {
      const result = service.assess(invoice(), '2026-01-09T00:00:00.000Z');

      expect(result.daysOverdue).toBe(8);
      expect(result.status).toBe(ArrearsStatus.FinalNotice);
    });

    it('should flag legal action at the escalation threshold', () => {
      const result = service.assess(invoice(), '2026-01-15T00:00:00.000Z');

      expect(result.daysOverdue).toBe(14);
      expect(result.status).toBe(ArrearsStatus.Escalation);
      expect(result.legalActionFlagged).toBe(true);
    });

    it('should count a partial payment against the balance', () => {
      const result = service.assess(invoice({ amountPaid: 20_000 }), '2026-01-03T00:00:00.000Z');

      expect(result.balance).toBe(100_000);
      expect(result.status).toBe(ArrearsStatus.Reminder);
    });

    it('should honour a custom policy', () => {
      const result = service.assess(invoice(), '2026-01-04T00:00:00.000Z', {
        reminderAfterDays: 5,
      });

      // 3 days overdue is below the custom 5-day reminder threshold.
      expect(result.status).toBe(ArrearsStatus.Due);
    });

    it('should accept an ISO string due date', () => {
      const result = service.assess(
        invoice({ dueDate: '2026-01-01T00:00:00.000Z' as unknown as Date }),
        '2026-01-03T00:00:00.000Z'
      );

      expect(result.daysOverdue).toBe(2);
    });

    it('should throw for a non-positive amount due', () => {
      expect(() => service.assess(invoice({ amountDue: 0 }), '2026-01-01T00:00:00.000Z')).toThrow(
        /Amount due must be positive/
      );
    });

    it('should throw for a negative amount paid', () => {
      expect(() => service.assess(invoice({ amountPaid: -1 }), '2026-01-01T00:00:00.000Z')).toThrow(
        /Amount paid must be non-negative/
      );
    });

    it('should throw for an invalid asOf date', () => {
      expect(() => service.assess(invoice(), 'not-a-date')).toThrow(/asOf must be a valid date/);
    });

    it('should throw when policy thresholds are not strictly increasing', () => {
      expect(() =>
        service.assess(invoice(), '2026-01-01T00:00:00.000Z', {
          reminderAfterDays: 7,
          finalNoticeAfterDays: 7,
        })
      ).toThrow(/finalNoticeAfterDays must be greater than reminderAfterDays/);
    });
  });

  describe('assessAll', () => {
    it('should assess each invoice preserving order', () => {
      const results = service.assessAll(
        [invoice({ amountPaid: 120_000 }), invoice()],
        '2026-02-01T00:00:00.000Z'
      );

      expect(results.map((r) => r.status)).toEqual([ArrearsStatus.Paid, ArrearsStatus.Escalation]);
    });

    it('should treat a nullish list as empty', () => {
      expect(
        service.assessAll(undefined as unknown as RentInvoice[], '2026-01-01T00:00:00.000Z')
      ).toEqual([]);
    });
  });

  describe('summarize', () => {
    it('should roll a portfolio up into dashboard figures', () => {
      const invoices: RentInvoice[] = [
        invoice({ tenancyId: 'a', amountPaid: 120_000 }), // paid
        invoice({ tenancyId: 'b', amountPaid: 20_000 }), // 100k arrears, escalation
        invoice({ tenancyId: 'c', amountPaid: 0 }), // 120k arrears, escalation
      ];

      const summary = service.summarize(invoices, '2026-01-20T00:00:00.000Z');

      expect(summary.totalDue).toBe(360_000);
      expect(summary.totalCollected).toBe(140_000);
      expect(summary.totalArrears).toBe(220_000);
      expect(summary.atRiskTenancyIds).toEqual(['b', 'c']);
    });

    it('should cap collected at the amount billed for overpaid invoices', () => {
      const summary = service.summarize(
        [invoice({ amountPaid: 200_000 })],
        '2026-02-01T00:00:00.000Z'
      );

      expect(summary.totalCollected).toBe(120_000);
      expect(summary.totalArrears).toBe(0);
    });

    it('should not flag a merely-reminded tenancy as at risk', () => {
      const summary = service.summarize([invoice()], '2026-01-03T00:00:00.000Z');

      expect(summary.totalArrears).toBe(120_000);
      expect(summary.atRiskTenancyIds).toEqual([]);
    });

    it('should return zeroed figures for an empty portfolio', () => {
      const summary = service.summarize([], '2026-01-01T00:00:00.000Z');

      expect(summary).toEqual({
        totalDue: 0,
        totalCollected: 0,
        totalArrears: 0,
        atRiskTenancyIds: [],
      });
    });

    it('should list each at-risk tenancy once, sorted', () => {
      const invoices: RentInvoice[] = [
        invoice({ tenancyId: 'flat-2' }),
        invoice({ tenancyId: 'flat-1' }),
        invoice({ tenancyId: 'flat-2' }),
      ];

      const summary = service.summarize(invoices, '2026-01-20T00:00:00.000Z');

      expect(summary.atRiskTenancyIds).toEqual(['flat-1', 'flat-2']);
    });
  });
});

// Made with Bob
