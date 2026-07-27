import { Injectable } from '@angular/core';
import { BaseDomainService } from '@core/domain/rules/base-domain.service';
import {
  AppointmentRequest,
  AppointmentType,
  IAppointmentSchedulingService,
  ScheduledAppointment,
} from '@core/domain/rules/appointment-scheduling.service.interface';

const MILLISECONDS_PER_MINUTE = 60_000;

/**
 * Default appointment durations, in minutes, keyed by type. Wellness exams
 * and surgeries follow the templates called out in the epic (30 min / 90 min);
 * vaccinations and follow-ups use shorter clinic-standard slots.
 */
const DEFAULT_DURATIONS: Record<AppointmentType, number> = {
  [AppointmentType.WELLNESS_EXAM]: 30,
  [AppointmentType.VACCINATION]: 15,
  [AppointmentType.SURGERY]: 90,
  [AppointmentType.FOLLOW_UP]: 20,
};

/**
 * Appointment Scheduling Service Implementation
 *
 * Resolves per-type durations, derives end times, and detects provider
 * double-booking so the clinic calendar never confirms two overlapping
 * appointments for the same clinician.
 *
 * @class AppointmentSchedulingService
 * @extends BaseDomainService
 * @implements IAppointmentSchedulingService
 */
@Injectable({ providedIn: 'root' })
export class AppointmentSchedulingService
  extends BaseDomainService
  implements IAppointmentSchedulingService
{
  constructor() {
    super('AppointmentSchedulingService');
  }

  /**
   * Default duration, in minutes, for the given appointment type.
   */
  durationForType(type: AppointmentType): number {
    const duration = DEFAULT_DURATIONS[type];
    this.validateInput(duration !== undefined, `Unknown appointment type: ${type}`);
    return duration;
  }

  /**
   * Return every existing appointment that overlaps the requested slot on the
   * same provider's calendar.
   */
  findConflicts(
    request: AppointmentRequest,
    existing: ScheduledAppointment[]
  ): ScheduledAppointment[] {
    const { start, end, providerId } = this.resolveSlot(request);
    const others = existing ?? [];

    return others.filter(
      (appointment) =>
        appointment.providerId === providerId && this.overlaps(start, end, appointment)
    );
  }

  /**
   * True when the requested slot would double-book its provider.
   */
  hasConflict(request: AppointmentRequest, existing: ScheduledAppointment[]): boolean {
    return this.findConflicts(request, existing).length > 0;
  }

  /**
   * Build a confirmed appointment from a request, refusing to double-book.
   */
  scheduleAppointment(
    id: string,
    request: AppointmentRequest,
    existing: ScheduledAppointment[]
  ): ScheduledAppointment {
    this.validateNotEmpty(id, 'Appointment id');
    const { start, end, durationMinutes, providerId } = this.resolveSlot(request);

    const conflicts = this.findConflicts(request, existing);
    this.validateInput(
      conflicts.length === 0,
      `Provider ${providerId} is already booked during the requested slot`
    );

    return {
      id: id.trim(),
      petId: request.petId.trim(),
      providerId,
      type: request.type,
      start,
      end,
      durationMinutes,
    };
  }

  /**
   * Validate a request and resolve its concrete slot (provider, start, end and
   * effective duration). Centralised so conflict checks and scheduling agree
   * on exactly how a request maps onto a calendar interval.
   */
  private resolveSlot(request: AppointmentRequest): {
    providerId: string;
    start: Date;
    end: Date;
    durationMinutes: number;
  } {
    this.validateRequired(request, 'Appointment request');
    this.validateNotEmpty(request.petId, 'Pet id');
    this.validateNotEmpty(request.providerId, 'Provider id');
    this.validateRequired(request.type, 'Appointment type');

    const start = this.parseDate(request.start, 'start');
    const durationMinutes = this.resolveDuration(request);
    const end = new Date(start.getTime() + durationMinutes * MILLISECONDS_PER_MINUTE);

    return { providerId: request.providerId.trim(), start, end, durationMinutes };
  }

  /**
   * Resolve the effective duration for a request: an explicit override when
   * provided (must be a positive integer number of minutes), otherwise the
   * per-type default.
   */
  private resolveDuration(request: AppointmentRequest): number {
    if (request.durationMinutes === undefined) {
      return this.durationForType(request.type);
    }

    this.validatePositive(request.durationMinutes, 'Duration minutes');
    this.validateInput(
      Number.isInteger(request.durationMinutes),
      'Duration minutes must be a whole number of minutes'
    );
    return request.durationMinutes;
  }

  /**
   * Do the half-open intervals `[start, end)` and the appointment's own slot
   * overlap? Back-to-back appointments (`end === other.start`) do not.
   */
  private overlaps(start: Date, end: Date, appointment: ScheduledAppointment): boolean {
    return (
      start.getTime() < appointment.end.getTime() && appointment.start.getTime() < end.getTime()
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
