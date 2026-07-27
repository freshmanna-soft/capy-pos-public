import { describe, it, expect, beforeEach } from 'vitest';
import { TenancySchedulingService } from '@core/domain/rules/tenancy-scheduling.service';
import {
  ITenancySchedulingService,
  Tenancy,
  TenancyRequest,
} from '@core/domain/rules/tenancy-scheduling.service.interface';

describe('TenancySchedulingService', () => {
  let service: ITenancySchedulingService;

  beforeEach(() => {
    service = new TenancySchedulingService();
  });

  const validRequest = (overrides: Partial<TenancyRequest> = {}): TenancyRequest => ({
    propertyId: 'flat-1',
    tenantId: 'tenant-1',
    start: '2026-08-01T00:00:00.000Z',
    end: '2027-08-01T00:00:00.000Z',
    monthlyRentAmount: 120_000,
    ...overrides,
  });

  const existingTenancy = (overrides: Partial<Tenancy> = {}): Tenancy => ({
    id: 'tenancy-existing',
    propertyId: 'flat-1',
    tenantId: 'tenant-other',
    start: new Date('2026-08-01T00:00:00.000Z'),
    end: new Date('2027-08-01T00:00:00.000Z'),
    monthlyRentAmount: 120_000,
    depositAmount: 120_000,
    ...overrides,
  });

  describe('createTenancy', () => {
    it('should open a tenancy and resolve its period', () => {
      const result = service.createTenancy('tenancy-1', validRequest(), []);

      expect(result.id).toBe('tenancy-1');
      expect(result.propertyId).toBe('flat-1');
      expect(result.tenantId).toBe('tenant-1');
      expect(result.monthlyRentAmount).toBe(120_000);
      expect(result.start.toISOString()).toBe('2026-08-01T00:00:00.000Z');
      expect(result.end.toISOString()).toBe('2027-08-01T00:00:00.000Z');
    });

    it('should default the deposit to zero when omitted', () => {
      const result = service.createTenancy('tenancy-1', validRequest(), []);

      expect(result.depositAmount).toBe(0);
    });

    it('should honour an explicit deposit amount', () => {
      const result = service.createTenancy(
        'tenancy-1',
        validRequest({ depositAmount: 150_000 }),
        []
      );

      expect(result.depositAmount).toBe(150_000);
    });

    it('should accept a zero deposit', () => {
      const result = service.createTenancy('tenancy-1', validRequest({ depositAmount: 0 }), []);

      expect(result.depositAmount).toBe(0);
    });

    it('should accept Date instances for the period', () => {
      const result = service.createTenancy(
        'tenancy-1',
        validRequest({
          start: new Date('2026-09-01T00:00:00.000Z'),
          end: new Date('2027-03-01T00:00:00.000Z'),
        }),
        []
      );

      expect(result.start.toISOString()).toBe('2026-09-01T00:00:00.000Z');
      expect(result.end.toISOString()).toBe('2027-03-01T00:00:00.000Z');
    });

    it('should trim id, propertyId and tenantId', () => {
      const result = service.createTenancy(
        '  tenancy-1  ',
        validRequest({ propertyId: ' flat-1 ', tenantId: ' tenant-1 ' }),
        []
      );

      expect(result.id).toBe('tenancy-1');
      expect(result.propertyId).toBe('flat-1');
      expect(result.tenantId).toBe('tenant-1');
    });

    it('should throw when the period double-lets the property', () => {
      expect(() => service.createTenancy('tenancy-1', validRequest(), [existingTenancy()])).toThrow(
        /already let/
      );
    });

    it('should allow a consecutive tenancy starting the day the previous ends', () => {
      const result = service.createTenancy(
        'tenancy-1',
        validRequest({
          start: '2027-08-01T00:00:00.000Z',
          end: '2028-08-01T00:00:00.000Z',
        }),
        [existingTenancy()]
      );

      expect(result.start.toISOString()).toBe('2027-08-01T00:00:00.000Z');
    });

    it('should throw for a blank tenancy id', () => {
      expect(() => service.createTenancy('  ', validRequest(), [])).toThrow(/Tenancy id/);
    });

    it('should throw for a missing property id', () => {
      expect(() =>
        service.createTenancy('tenancy-1', validRequest({ propertyId: '' }), [])
      ).toThrow(/Property id/);
    });

    it('should throw for a missing tenant id', () => {
      expect(() =>
        service.createTenancy('tenancy-1', validRequest({ tenantId: '   ' }), [])
      ).toThrow(/Tenant id/);
    });

    it('should throw for an invalid start date', () => {
      expect(() =>
        service.createTenancy('tenancy-1', validRequest({ start: 'not-a-date' }), [])
      ).toThrow(/start must be a valid date/);
    });

    it('should throw for an invalid end date', () => {
      expect(() =>
        service.createTenancy('tenancy-1', validRequest({ end: 'not-a-date' }), [])
      ).toThrow(/end must be a valid date/);
    });

    it('should throw when end is not after start', () => {
      expect(() =>
        service.createTenancy(
          'tenancy-1',
          validRequest({
            start: '2027-08-01T00:00:00.000Z',
            end: '2026-08-01T00:00:00.000Z',
          }),
          []
        )
      ).toThrow(/end must be after start/);
    });

    it('should throw when start and end are the same instant', () => {
      expect(() =>
        service.createTenancy(
          'tenancy-1',
          validRequest({
            start: '2026-08-01T00:00:00.000Z',
            end: '2026-08-01T00:00:00.000Z',
          }),
          []
        )
      ).toThrow(/end must be after start/);
    });

    it('should throw for a non-positive monthly rent', () => {
      expect(() =>
        service.createTenancy('tenancy-1', validRequest({ monthlyRentAmount: 0 }), [])
      ).toThrow(/Monthly rent amount must be positive/);
    });

    it('should throw for a negative deposit', () => {
      expect(() =>
        service.createTenancy('tenancy-1', validRequest({ depositAmount: -1 }), [])
      ).toThrow(/Deposit amount must be non-negative/);
    });
  });

  describe('findConflicts / hasConflict', () => {
    it('should report no conflict against an empty portfolio', () => {
      expect(service.hasConflict(validRequest(), [])).toBe(false);
      expect(service.findConflicts(validRequest(), [])).toEqual([]);
    });

    it('should treat a nullish existing list as an empty portfolio', () => {
      expect(service.hasConflict(validRequest(), undefined as unknown as Tenancy[])).toBe(false);
    });

    it('should detect a partial overlap', () => {
      // Requested 2026-08-01..2027-08-01 overlaps an existing 2027-01-01..2027-12-01 let.
      const conflicts = service.findConflicts(validRequest(), [
        existingTenancy({
          start: new Date('2027-01-01T00:00:00.000Z'),
          end: new Date('2027-12-01T00:00:00.000Z'),
        }),
      ]);

      expect(conflicts).toHaveLength(1);
      expect(service.hasConflict(validRequest(), conflicts)).toBe(true);
    });

    it('should detect an enclosing existing tenancy', () => {
      const conflicts = service.findConflicts(
        validRequest({
          start: '2026-10-01T00:00:00.000Z',
          end: '2026-11-01T00:00:00.000Z',
        }),
        [
          existingTenancy({
            start: new Date('2026-08-01T00:00:00.000Z'),
            end: new Date('2027-08-01T00:00:00.000Z'),
          }),
        ]
      );

      expect(conflicts).toHaveLength(1);
    });

    it('should not conflict with a tenancy on a different property', () => {
      const conflicts = service.findConflicts(validRequest(), [
        existingTenancy({ propertyId: 'flat-2' }),
      ]);

      expect(conflicts).toEqual([]);
    });

    it('should not conflict with a non-overlapping earlier tenancy', () => {
      const conflicts = service.findConflicts(validRequest(), [
        existingTenancy({
          start: new Date('2025-08-01T00:00:00.000Z'),
          end: new Date('2026-08-01T00:00:00.000Z'),
        }),
      ]);

      expect(conflicts).toEqual([]);
    });

    it('should only return the conflicting tenancies among several', () => {
      const conflicts = service.findConflicts(validRequest(), [
        existingTenancy({
          id: 'earlier',
          start: new Date('2025-08-01T00:00:00.000Z'),
          end: new Date('2026-08-01T00:00:00.000Z'),
        }),
        existingTenancy({ id: 'overlapping' }),
        existingTenancy({ id: 'other-property', propertyId: 'flat-2' }),
      ]);

      expect(conflicts).toHaveLength(1);
      expect(conflicts[0].id).toBe('overlapping');
    });
  });
});

// Made with Bob
