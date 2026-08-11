/**
 * Vaccination Scheduling Service Interface
 *
 * Defines the contract for vaccination tracking and reminders for the Capy-Paws
 * veterinary persona (Dr. Lena, epic #16, Story 3 — Vaccination Tracking &
 * Reminders). It generates a pet's primary vaccination series from a
 * species-appropriate protocol, assesses each administered dose's renewal
 * status (up-to-date, upcoming, due, overdue) as of a given day, and rolls a
 * clinic's records up into the figures a vaccination dashboard shows: how many
 * are upcoming, due, or overdue, and which pets are at risk.
 *
 * The service is pure domain logic: it operates on plain protocol and record
 * data and an explicit "as of" date, and never touches persistence,
 * dashboards, or reminder delivery. Callers supply the current date so
 * assessments stay deterministic and testable.
 *
 * @interface IVaccinationSchedulingService
 */

/**
 * The pet species the clinic vaccinates. Each species carries a default core
 * vaccination protocol (see {@link IVaccinationSchedulingService.generateSchedule}).
 */
export enum Species {
  Dog = 'dog',
  Cat = 'cat',
}

/**
 * The vaccines a clinic tracks. `DHPP` is the canine core combination
 * (distemper, hepatitis, parainfluenza, parvovirus) and `FVRCP` its feline
 * counterpart; `Rabies` and `Bordetella` apply across species.
 */
export enum VaccineType {
  Rabies = 'rabies',
  DHPP = 'dhpp',
  FVRCP = 'fvrcp',
  Bordetella = 'bordetella',
}

/**
 * The renewal state of a single vaccination as of a given day, ordered from
 * healthiest to most severe. Status is driven by how a dose's expiry date
 * relates to the "as of" date, using the windows in
 * {@link VaccinationReminderPolicy}.
 */
export enum VaccinationStatus {
  /** Protection is current and expiry is beyond the reminder window. */
  Valid = 'valid',
  /** Expiry falls within the reminder window — a booster reminder is warranted. */
  Upcoming = 'upcoming',
  /** At or just past expiry, still within the grace window — a booster is due now. */
  Due = 'due',
  /** Expired beyond the grace window — protection has lapsed. */
  Overdue = 'overdue',
}

/**
 * One dose within a vaccination protocol.
 */
export interface VaccinationProtocolDose {
  vaccine: VaccineType;
  /** Pet age, in whole weeks, at which the dose is administered. Must be >= 0. */
  ageWeeks: number;
  /** How long the dose confers protection, in whole months. Must be positive. */
  validityMonths: number;
}

/**
 * A request to generate a pet's primary vaccination series.
 *
 * `dateOfBirth` accepts a `Date` or an ISO date string. When `protocol` is
 * omitted the service falls back to the species' default core series.
 */
export interface VaccinationScheduleRequest {
  petId: string;
  species: Species;
  dateOfBirth: Date | string;
  /** Optional protocol override; defaults to the species' core series. */
  protocol?: VaccinationProtocolDose[];
}

/**
 * A single dated dose in a pet's planned vaccination series.
 */
export interface PlannedVaccination {
  petId: string;
  vaccine: VaccineType;
  /** 1-based ordinal of this dose within its vaccine's series. */
  doseNumber: number;
  /** Date the dose is due (`dateOfBirth` + `ageWeeks`). */
  dueDate: Date;
  /** Protection window, in whole months, this dose will confer once given. */
  validityMonths: number;
}

/**
 * An administered vaccination dose being tracked for renewal.
 *
 * `dateGiven` accepts a `Date` or an ISO date string; the expiry date is
 * derived as `dateGiven` + `validityMonths`.
 */
export interface VaccinationRecord {
  petId: string;
  vaccine: VaccineType;
  /** The date the dose was administered. */
  dateGiven: Date | string;
  /** Protection window, in whole months, from `dateGiven`. Must be positive. */
  validityMonths: number;
}

/**
 * The windows (in whole days, relative to a dose's expiry date) that drive the
 * reminder lifecycle. Both fields are optional;
 * {@link IVaccinationSchedulingService.assess} fills any gaps from its
 * defaults. Both must be non-negative.
 */
export interface VaccinationReminderPolicy {
  /**
   * Days before expiry at which a still-valid vaccination becomes `Upcoming`.
   * Default 30.
   */
  reminderLeadDays: number;
  /**
   * Grace days after expiry during which a lapsed vaccination remains `Due`
   * rather than `Overdue`. Default 14.
   */
  overdueAfterDays: number;
}

/**
 * The assessed renewal state of one vaccination record as of a given day.
 */
export interface VaccinationAssessment {
  record: VaccinationRecord;
  /** Computed expiry date (`dateGiven` + `validityMonths`). */
  expiryDate: Date;
  /** Whole days until expiry; negative once expired. */
  daysUntilExpiry: number;
  status: VaccinationStatus;
}

/**
 * Clinic-level vaccination figures as of a given day.
 */
export interface VaccinationSummary {
  /** Count of vaccinations expiring within the reminder window. */
  upcoming: number;
  /** Count of vaccinations at or just past expiry (booster due now). */
  due: number;
  /** Count of vaccinations lapsed beyond the grace window. */
  overdue: number;
  /**
   * Distinct pet ids with at least one `Due` or `Overdue` vaccination, sorted
   * ascending.
   */
  atRiskPetIds: string[];
}

/**
 * Vaccination Scheduling Service Interface
 *
 * Provides deterministic primary-series generation, per-record renewal
 * assessment, and clinic-wide roll-up for the vaccination dashboard.
 */
export interface IVaccinationSchedulingService {
  /**
   * The default core vaccination protocol for the given species.
   */
  protocolForSpecies(species: Species): VaccinationProtocolDose[];

  /**
   * Build the ordered, dated primary vaccination series for a pet.
   *
   * @throws Error when the request is missing required fields, has an invalid
   * date of birth, or a protocol dose with a negative age or non-positive
   * validity.
   */
  generateSchedule(request: VaccinationScheduleRequest): PlannedVaccination[];

  /**
   * Assess a single vaccination record's renewal status as of `asOf`.
   *
   * @throws Error when the record is invalid, `asOf` is not a valid date, or
   * the resolved policy windows are negative.
   */
  assess(
    record: VaccinationRecord,
    asOf: Date | string,
    policy?: Partial<VaccinationReminderPolicy>
  ): VaccinationAssessment;

  /**
   * Assess every record as of `asOf`, preserving input order.
   */
  assessAll(
    records: VaccinationRecord[],
    asOf: Date | string,
    policy?: Partial<VaccinationReminderPolicy>
  ): VaccinationAssessment[];

  /**
   * Roll a clinic's records up into vaccination-dashboard figures as of `asOf`.
   */
  summarize(
    records: VaccinationRecord[],
    asOf: Date | string,
    policy?: Partial<VaccinationReminderPolicy>
  ): VaccinationSummary;
}

// Made with Bob
