import { Injectable } from '@angular/core';
import { BaseDomainService } from '@core/domain/rules/base-domain.service';
import {
  IVaccinationSchedulingService,
  PlannedVaccination,
  Species,
  VaccinationAssessment,
  VaccinationProtocolDose,
  VaccinationRecord,
  VaccinationReminderPolicy,
  VaccinationScheduleRequest,
  VaccinationStatus,
  VaccinationSummary,
  VaccineType,
} from '@core/domain/rules/vaccination-scheduling.service.interface';

/** Whole days in a 24-hour period, used to convert expiry deltas. */
const MS_PER_DAY = 24 * 60 * 60 * 1000;

/** Days in a week, used to offset protocol doses from the date of birth. */
const DAYS_PER_WEEK = 7;

/**
 * Default reminder lifecycle windows. A booster reminder goes out a month
 * before protection expires, and a lapsed vaccination is treated as merely
 * "due" for a fortnight of grace before it is considered overdue.
 */
const DEFAULT_POLICY: VaccinationReminderPolicy = {
  reminderLeadDays: 30,
  overdueAfterDays: 14,
};

/**
 * Default core vaccination protocols per species. Both cover the standard
 * puppy/kitten primary series plus the first rabies dose; callers can override
 * with a bespoke protocol on the request.
 */
const DEFAULT_PROTOCOLS: Readonly<Record<Species, readonly VaccinationProtocolDose[]>> = {
  [Species.Dog]: [
    { vaccine: VaccineType.DHPP, ageWeeks: 8, validityMonths: 12 },
    { vaccine: VaccineType.DHPP, ageWeeks: 12, validityMonths: 12 },
    { vaccine: VaccineType.DHPP, ageWeeks: 16, validityMonths: 12 },
    { vaccine: VaccineType.Rabies, ageWeeks: 12, validityMonths: 36 },
  ],
  [Species.Cat]: [
    { vaccine: VaccineType.FVRCP, ageWeeks: 8, validityMonths: 12 },
    { vaccine: VaccineType.FVRCP, ageWeeks: 12, validityMonths: 12 },
    { vaccine: VaccineType.FVRCP, ageWeeks: 16, validityMonths: 12 },
    { vaccine: VaccineType.Rabies, ageWeeks: 12, validityMonths: 36 },
  ],
};

/**
 * Vaccination Scheduling Service Implementation
 *
 * Generates a pet's dated primary vaccination series, assesses each
 * administered dose's renewal status as of an explicit "as of" date, and rolls
 * a clinic's records up into the figures a vaccination dashboard shows.
 *
 * @class VaccinationSchedulingService
 * @extends BaseDomainService
 * @implements IVaccinationSchedulingService
 */
@Injectable({ providedIn: 'root' })
export class VaccinationSchedulingService
  extends BaseDomainService
  implements IVaccinationSchedulingService
{
  constructor() {
    super('VaccinationSchedulingService');
  }

  /**
   * The default core vaccination protocol for the given species.
   */
  protocolForSpecies(species: Species): VaccinationProtocolDose[] {
    const protocol = DEFAULT_PROTOCOLS[species];
    this.validateInput(!!protocol, `No default protocol for species "${species}"`);
    // Hand back a defensive copy so callers can't mutate the shared defaults.
    return protocol.map((dose) => ({ ...dose }));
  }

  /**
   * Build the ordered, dated primary vaccination series for a pet.
   */
  generateSchedule(request: VaccinationScheduleRequest): PlannedVaccination[] {
    this.validateRequired(request, 'Vaccination schedule request');
    this.validateNotEmpty(request.petId, 'Pet id');

    const dob = this.parseDate(request.dateOfBirth, 'date of birth');
    const protocol = request.protocol ?? this.protocolForSpecies(request.species);
    this.validateArrayNotEmpty(protocol, 'Vaccination protocol');

    const petId = request.petId.trim();
    const doseNumbers = new Map<VaccineType, number>();

    return protocol.map((dose) => {
      this.validateDoseAge(dose.ageWeeks);
      this.validatePositive(dose.validityMonths, 'Dose validity months');

      const doseNumber = (doseNumbers.get(dose.vaccine) ?? 0) + 1;
      doseNumbers.set(dose.vaccine, doseNumber);

      return {
        petId,
        vaccine: dose.vaccine,
        doseNumber,
        dueDate: this.addDays(dob, dose.ageWeeks * DAYS_PER_WEEK),
        validityMonths: dose.validityMonths,
      };
    });
  }

  /**
   * Assess a single vaccination record's renewal status as of `asOf`.
   */
  assess(
    record: VaccinationRecord,
    asOf: Date | string,
    policy?: Partial<VaccinationReminderPolicy>
  ): VaccinationAssessment {
    this.validateRequired(record, 'Vaccination record');
    this.validateNotEmpty(record.petId, 'Pet id');
    this.validatePositive(record.validityMonths, 'Validity months');

    const dateGiven = this.parseDate(record.dateGiven, 'date given');
    const now = this.parseDate(asOf, 'asOf');
    const resolved = this.resolvePolicy(policy);

    const expiryDate = this.addMonths(dateGiven, record.validityMonths);
    // Floor so a partial day still counts as "not yet expired" until the whole
    // day has passed, mirroring how the rent scheduler treats overdue days.
    const daysUntilExpiry = Math.floor((expiryDate.getTime() - now.getTime()) / MS_PER_DAY);

    return {
      record,
      expiryDate,
      daysUntilExpiry,
      status: this.statusFor(daysUntilExpiry, resolved),
    };
  }

  /**
   * Assess every record as of `asOf`, preserving input order.
   */
  assessAll(
    records: VaccinationRecord[],
    asOf: Date | string,
    policy?: Partial<VaccinationReminderPolicy>
  ): VaccinationAssessment[] {
    const list = records ?? [];
    return list.map((record) => this.assess(record, asOf, policy));
  }

  /**
   * Roll a clinic's records up into vaccination-dashboard figures.
   */
  summarize(
    records: VaccinationRecord[],
    asOf: Date | string,
    policy?: Partial<VaccinationReminderPolicy>
  ): VaccinationSummary {
    const assessments = this.assessAll(records, asOf, policy);
    const atRisk = new Set<string>();

    let upcoming = 0;
    let due = 0;
    let overdue = 0;

    for (const { record, status } of assessments) {
      switch (status) {
        case VaccinationStatus.Upcoming:
          upcoming += 1;
          break;
        case VaccinationStatus.Due:
          due += 1;
          atRisk.add(record.petId);
          break;
        case VaccinationStatus.Overdue:
          overdue += 1;
          atRisk.add(record.petId);
          break;
        default:
          break;
      }
    }

    return {
      upcoming,
      due,
      overdue,
      atRiskPetIds: [...atRisk].sort(),
    };
  }

  /**
   * Map a dose's days-until-expiry onto a renewal status.
   *
   * `Valid` beyond the reminder window, `Upcoming` once inside it, `Due` from
   * expiry through the grace window, and `Overdue` once the grace window is
   * exhausted.
   */
  private statusFor(daysUntilExpiry: number, policy: VaccinationReminderPolicy): VaccinationStatus {
    if (daysUntilExpiry > policy.reminderLeadDays) {
      return VaccinationStatus.Valid;
    }
    if (daysUntilExpiry > 0) {
      return VaccinationStatus.Upcoming;
    }
    if (daysUntilExpiry >= -policy.overdueAfterDays) {
      return VaccinationStatus.Due;
    }
    return VaccinationStatus.Overdue;
  }

  /**
   * Merge a partial policy over the defaults and validate that both windows are
   * non-negative.
   */
  private resolvePolicy(policy?: Partial<VaccinationReminderPolicy>): VaccinationReminderPolicy {
    const resolved: VaccinationReminderPolicy = { ...DEFAULT_POLICY, ...policy };

    this.validateNonNegative(resolved.reminderLeadDays, 'reminderLeadDays');
    this.validateNonNegative(resolved.overdueAfterDays, 'overdueAfterDays');

    return resolved;
  }

  /**
   * Add whole days to a date, in UTC.
   */
  private addDays(date: Date, days: number): Date {
    return new Date(date.getTime() + days * MS_PER_DAY);
  }

  /**
   * Add whole months to a date, clamping the day to the last day of the target
   * month so a 31st still lands validly in a shorter month (e.g. 31 Jan +
   * 1 month bills on 28 Feb). Works in UTC to match the rest of the scheduler.
   */
  private addMonths(date: Date, months: number): Date {
    const year = date.getUTCFullYear();
    const month = date.getUTCMonth() + months;
    const day = date.getUTCDate();
    // Day 0 of the following month is the last day of the target month.
    const lastDayOfMonth = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
    return new Date(
      Date.UTC(
        year,
        month,
        Math.min(day, lastDayOfMonth),
        date.getUTCHours(),
        date.getUTCMinutes(),
        date.getUTCSeconds(),
        date.getUTCMilliseconds()
      )
    );
  }

  /**
   * Validate that a protocol dose age is a non-negative integer number of weeks.
   */
  private validateDoseAge(ageWeeks: number): void {
    this.validateInput(
      Number.isInteger(ageWeeks) && ageWeeks >= 0,
      'Dose age must be a non-negative integer number of weeks'
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
