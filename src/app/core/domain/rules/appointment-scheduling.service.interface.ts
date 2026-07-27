/**
 * Appointment Scheduling Service Interface
 *
 * Defines the contract for scheduling clinic appointments for the Capy-Paws
 * veterinary persona (Dr. Lena, epic #16, Story 2). It resolves a per-type
 * duration template, derives the appointment's end time, and guards against
 * double-booking a provider before an appointment is confirmed.
 *
 * The service is pure domain logic: it operates on plain appointment records
 * and never touches persistence, scheduling UI, or reminder delivery.
 *
 * @interface IAppointmentSchedulingService
 */

/**
 * The kinds of appointment a clinic can book. Each type carries a default
 * duration (see {@link IAppointmentSchedulingService.durationForType}).
 */
export enum AppointmentType {
  WELLNESS_EXAM = 'WELLNESS_EXAM',
  VACCINATION = 'VACCINATION',
  SURGERY = 'SURGERY',
  FOLLOW_UP = 'FOLLOW_UP',
}

/**
 * A confirmed appointment occupying a provider's calendar slot.
 *
 * The slot is the half-open interval `[start, end)`: an appointment that ends
 * exactly when another begins does not overlap it, so back-to-back bookings
 * are allowed.
 */
export interface ScheduledAppointment {
  id: string;
  petId: string;
  /** The clinician (vet/tech) whose calendar the slot belongs to. */
  providerId: string;
  type: AppointmentType;
  start: Date;
  end: Date;
  durationMinutes: number;
}

/**
 * A request to book a new appointment.
 *
 * `durationMinutes` is optional: when omitted the service falls back to the
 * per-type default, letting callers override it for atypical visits (e.g. a
 * complex surgery) without hard-coding a duration everywhere.
 */
export interface AppointmentRequest {
  petId: string;
  providerId: string;
  type: AppointmentType;
  start: Date | string;
  /** Optional override of the per-type default duration, in minutes. */
  durationMinutes?: number;
}

/**
 * Appointment Scheduling Service Interface
 *
 * Provides duration resolution, provider conflict detection, and a guarded
 * scheduling operation that refuses to double-book a provider.
 */
export interface IAppointmentSchedulingService {
  /**
   * Default duration, in minutes, for the given appointment type.
   */
  durationForType(type: AppointmentType): number;

  /**
   * Return every existing appointment that would overlap the requested slot
   * on the same provider's calendar. An empty array means the slot is free.
   */
  findConflicts(
    request: AppointmentRequest,
    existing: ScheduledAppointment[]
  ): ScheduledAppointment[];

  /**
   * True when the requested slot would double-book its provider.
   */
  hasConflict(request: AppointmentRequest, existing: ScheduledAppointment[]): boolean;

  /**
   * Build a confirmed {@link ScheduledAppointment} from a request, resolving
   * its duration and end time.
   *
   * @throws Error when the slot would double-book the provider, or when the
   * request is missing required fields / has an invalid start or duration.
   */
  scheduleAppointment(
    id: string,
    request: AppointmentRequest,
    existing: ScheduledAppointment[]
  ): ScheduledAppointment;
}

// Made with Bob
