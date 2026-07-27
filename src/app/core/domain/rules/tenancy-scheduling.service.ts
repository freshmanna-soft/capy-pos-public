import { Injectable } from '@angular/core';
import { BaseDomainService } from '@core/domain/rules/base-domain.service';
import {
  ITenancySchedulingService,
  Tenancy,
  TenancyRequest,
} from '@core/domain/rules/tenancy-scheduling.service.interface';

/**
 * Tenancy Scheduling Service Implementation
 *
 * Validates tenancy periods and detects per-property overlap so the occupancy
 * calendar never opens two tenancies letting the same unit at the same time.
 *
 * @class TenancySchedulingService
 * @extends BaseDomainService
 * @implements ITenancySchedulingService
 */
@Injectable({ providedIn: 'root' })
export class TenancySchedulingService
  extends BaseDomainService
  implements ITenancySchedulingService
{
  constructor() {
    super('TenancySchedulingService');
  }

  /**
   * Return every existing tenancy that overlaps the requested period on the
   * same property.
   */
  findConflicts(request: TenancyRequest, existing: Tenancy[]): Tenancy[] {
    const { start, end, propertyId } = this.resolvePeriod(request);
    const others = existing ?? [];

    return others.filter(
      (tenancy) => tenancy.propertyId === propertyId && this.overlaps(start, end, tenancy)
    );
  }

  /**
   * True when the requested period would double-let its property.
   */
  hasConflict(request: TenancyRequest, existing: Tenancy[]): boolean {
    return this.findConflicts(request, existing).length > 0;
  }

  /**
   * Build an active tenancy from a request, refusing to double-let.
   */
  createTenancy(id: string, request: TenancyRequest, existing: Tenancy[]): Tenancy {
    this.validateNotEmpty(id, 'Tenancy id');
    const { start, end, propertyId } = this.resolvePeriod(request);
    const depositAmount = this.resolveDeposit(request);

    this.validatePositive(request.monthlyRentAmount, 'Monthly rent amount');

    const conflicts = this.findConflicts(request, existing);
    this.validateInput(
      conflicts.length === 0,
      `Property ${propertyId} is already let during the requested period`
    );

    return {
      id: id.trim(),
      propertyId,
      tenantId: request.tenantId.trim(),
      start,
      end,
      monthlyRentAmount: request.monthlyRentAmount,
      depositAmount,
    };
  }

  /**
   * Validate a request and resolve its concrete period (property, start, end).
   * Centralised so conflict checks and creation agree on exactly how a request
   * maps onto an occupancy interval; the period must be non-empty (`end` after
   * `start`).
   */
  private resolvePeriod(request: TenancyRequest): {
    propertyId: string;
    start: Date;
    end: Date;
  } {
    this.validateRequired(request, 'Tenancy request');
    this.validateNotEmpty(request.propertyId, 'Property id');
    this.validateNotEmpty(request.tenantId, 'Tenant id');

    const start = this.parseDate(request.start, 'start');
    const end = this.parseDate(request.end, 'end');
    this.validateInput(end.getTime() > start.getTime(), 'end must be after start');

    return { propertyId: request.propertyId.trim(), start, end };
  }

  /**
   * Resolve the effective deposit for a request: an explicit amount when
   * provided (must be non-negative), otherwise zero.
   */
  private resolveDeposit(request: TenancyRequest): number {
    if (request.depositAmount === undefined) {
      return 0;
    }

    this.validateNonNegative(request.depositAmount, 'Deposit amount');
    return request.depositAmount;
  }

  /**
   * Do the half-open intervals `[start, end)` and the tenancy's own period
   * overlap? Consecutive tenancies (`end === other.start`) do not.
   */
  private overlaps(start: Date, end: Date, tenancy: Tenancy): boolean {
    return start.getTime() < tenancy.end.getTime() && tenancy.start.getTime() < end.getTime();
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
