import { describe, it, expect, beforeEach } from 'vitest';
import { VaccinationSchedulingService } from '@core/domain/rules/vaccination-scheduling.service';
import {
  IVaccinationSchedulingService,
  Species,
  VaccinationRecord,
  VaccinationScheduleRequest,
  VaccinationStatus,
  VaccineType,
} from '@core/domain/rules/vaccination-scheduling.service.interface';

describe('VaccinationSchedulingService', () => {
  let service: IVaccinationSchedulingService;

  beforeEach(() => {
    service = new VaccinationSchedulingService();
  });

  const scheduleRequest = (
    overrides: Partial<VaccinationScheduleRequest> = {}
  ): VaccinationScheduleRequest => ({
    petId: 'pet-1',
    species: Species.Dog,
    dateOfBirth: '2026-01-01T00:00:00.000Z',
    ...overrides,
  });

  const record = (overrides: Partial<VaccinationRecord> = {}): VaccinationRecord => ({
    petId: 'pet-1',
    vaccine: VaccineType.Rabies,
    dateGiven: '2026-01-01T00:00:00.000Z',
    validityMonths: 12,
    ...overrides,
  });

  describe('protocolForSpecies', () => {
    it('should return the canine core series for dogs', () => {
      const protocol = service.protocolForSpecies(Species.Dog);

      expect(protocol.map((d) => d.vaccine)).toEqual([
        VaccineType.DHPP,
        VaccineType.DHPP,
        VaccineType.DHPP,
        VaccineType.Rabies,
      ]);
    });

    it('should return the feline core series for cats', () => {
      const protocol = service.protocolForSpecies(Species.Cat);

      expect(protocol.map((d) => d.vaccine)).toEqual([
        VaccineType.FVRCP,
        VaccineType.FVRCP,
        VaccineType.FVRCP,
        VaccineType.Rabies,
      ]);
    });

    it('should return a defensive copy that cannot mutate the shared default', () => {
      const first = service.protocolForSpecies(Species.Dog);
      first[0].ageWeeks = 999;

      const second = service.protocolForSpecies(Species.Dog);
      expect(second[0].ageWeeks).toBe(8);
    });
  });

  describe('generateSchedule', () => {
    it('should generate one planned dose per protocol entry for a dog', () => {
      const planned = service.generateSchedule(scheduleRequest());

      expect(planned).toHaveLength(4);
      expect(planned.every((p) => p.petId === 'pet-1')).toBe(true);
    });

    it('should date each dose at date of birth plus its age in weeks', () => {
      const planned = service.generateSchedule(scheduleRequest());

      // 8 weeks = 56 days after 1 Jan 2026.
      expect(planned[0].dueDate.toISOString()).toBe('2026-02-26T00:00:00.000Z');
      // 16 weeks = 112 days after 1 Jan 2026.
      expect(planned[2].dueDate.toISOString()).toBe('2026-04-23T00:00:00.000Z');
    });

    it('should number doses sequentially per vaccine', () => {
      const planned = service.generateSchedule(scheduleRequest());

      const dhpp = planned.filter((p) => p.vaccine === VaccineType.DHPP);
      expect(dhpp.map((p) => p.doseNumber)).toEqual([1, 2, 3]);

      const rabies = planned.filter((p) => p.vaccine === VaccineType.Rabies);
      expect(rabies.map((p) => p.doseNumber)).toEqual([1]);
    });

    it('should carry each dose validity through to the plan', () => {
      const planned = service.generateSchedule(scheduleRequest());
      const rabies = planned.find((p) => p.vaccine === VaccineType.Rabies);

      expect(rabies?.validityMonths).toBe(36);
    });

    it('should honour a caller-supplied protocol override', () => {
      const planned = service.generateSchedule(
        scheduleRequest({
          protocol: [{ vaccine: VaccineType.Bordetella, ageWeeks: 10, validityMonths: 12 }],
        })
      );

      expect(planned).toHaveLength(1);
      expect(planned[0].vaccine).toBe(VaccineType.Bordetella);
      // 10 weeks = 70 days after 1 Jan 2026.
      expect(planned[0].dueDate.toISOString()).toBe('2026-03-12T00:00:00.000Z');
    });

    it('should accept a Date instance for the date of birth', () => {
      const planned = service.generateSchedule(
        scheduleRequest({ dateOfBirth: new Date('2026-01-01T00:00:00.000Z') })
      );

      expect(planned[0].dueDate.toISOString()).toBe('2026-02-26T00:00:00.000Z');
    });

    it('should throw when the pet id is missing', () => {
      expect(() => service.generateSchedule(scheduleRequest({ petId: '' }))).toThrow(/Pet id/);
    });

    it('should throw when the date of birth is invalid', () => {
      expect(() =>
        service.generateSchedule(scheduleRequest({ dateOfBirth: 'not-a-date' }))
      ).toThrow(/date of birth/);
    });

    it('should throw when a protocol dose has a negative age', () => {
      expect(() =>
        service.generateSchedule(
          scheduleRequest({
            protocol: [{ vaccine: VaccineType.Rabies, ageWeeks: -1, validityMonths: 12 }],
          })
        )
      ).toThrow(/Dose age/);
    });

    it('should throw when a protocol dose has non-positive validity', () => {
      expect(() =>
        service.generateSchedule(
          scheduleRequest({
            protocol: [{ vaccine: VaccineType.Rabies, ageWeeks: 12, validityMonths: 0 }],
          })
        )
      ).toThrow(/validity/i);
    });

    it('should throw when an overriding protocol is empty', () => {
      expect(() => service.generateSchedule(scheduleRequest({ protocol: [] }))).toThrow(
        /protocol/i
      );
    });
  });

  describe('assess', () => {
    it('should compute the expiry date as date given plus validity months', () => {
      const assessment = service.assess(record({ validityMonths: 12 }), '2026-06-01T00:00:00.000Z');

      expect(assessment.expiryDate.toISOString()).toBe('2027-01-01T00:00:00.000Z');
    });

    it('should clamp the expiry day to the last day of a short month', () => {
      const assessment = service.assess(
        record({ dateGiven: '2026-01-31T00:00:00.000Z', validityMonths: 1 }),
        '2026-02-01T00:00:00.000Z'
      );

      // 31 Jan + 1 month clamps to 28 Feb 2026 (not a leap year).
      expect(assessment.expiryDate.toISOString()).toBe('2026-02-28T00:00:00.000Z');
    });

    it('should report Valid when expiry is beyond the reminder window', () => {
      const assessment = service.assess(record(), '2026-06-01T00:00:00.000Z');

      expect(assessment.status).toBe(VaccinationStatus.Valid);
      expect(assessment.daysUntilExpiry).toBeGreaterThan(30);
    });

    it('should report Upcoming when expiry falls within the reminder window', () => {
      // Expiry 1 Jan 2027; 15 Dec 2026 is 17 days out.
      const assessment = service.assess(record(), '2026-12-15T00:00:00.000Z');

      expect(assessment.status).toBe(VaccinationStatus.Upcoming);
      expect(assessment.daysUntilExpiry).toBe(17);
    });

    it('should report Due exactly on the expiry date', () => {
      const assessment = service.assess(record(), '2027-01-01T00:00:00.000Z');

      expect(assessment.status).toBe(VaccinationStatus.Due);
      expect(assessment.daysUntilExpiry).toBe(0);
    });

    it('should report Due while still within the overdue grace window', () => {
      // 10 days past expiry, default grace is 14 days.
      const assessment = service.assess(record(), '2027-01-11T00:00:00.000Z');

      expect(assessment.status).toBe(VaccinationStatus.Due);
      expect(assessment.daysUntilExpiry).toBe(-10);
    });

    it('should report Overdue once the grace window is exhausted', () => {
      const assessment = service.assess(record(), '2027-02-01T00:00:00.000Z');

      expect(assessment.status).toBe(VaccinationStatus.Overdue);
      expect(assessment.daysUntilExpiry).toBeLessThan(-14);
    });

    it('should respect a custom reminder lead window', () => {
      // 45 days before expiry: Valid under the default 30, Upcoming under 60.
      const asOf = '2026-11-17T00:00:00.000Z';

      expect(service.assess(record(), asOf).status).toBe(VaccinationStatus.Valid);
      expect(service.assess(record(), asOf, { reminderLeadDays: 60 }).status).toBe(
        VaccinationStatus.Upcoming
      );
    });

    it('should respect a custom overdue grace window', () => {
      // 10 days past expiry: Due under default grace 14, Overdue under grace 0.
      const asOf = '2027-01-11T00:00:00.000Z';

      expect(service.assess(record(), asOf).status).toBe(VaccinationStatus.Due);
      expect(service.assess(record(), asOf, { overdueAfterDays: 0 }).status).toBe(
        VaccinationStatus.Overdue
      );
    });

    it('should throw when the record is missing a pet id', () => {
      expect(() => service.assess(record({ petId: '' }), '2026-06-01T00:00:00.000Z')).toThrow(
        /Pet id/
      );
    });

    it('should throw when validity months is not positive', () => {
      expect(() =>
        service.assess(record({ validityMonths: 0 }), '2026-06-01T00:00:00.000Z')
      ).toThrow(/Validity months/);
    });

    it('should throw when asOf is not a valid date', () => {
      expect(() => service.assess(record(), 'nope')).toThrow(/asOf/);
    });

    it('should throw when a policy window is negative', () => {
      expect(() =>
        service.assess(record(), '2026-06-01T00:00:00.000Z', { reminderLeadDays: -1 })
      ).toThrow(/reminderLeadDays/);
    });
  });

  describe('assessAll', () => {
    it('should assess every record preserving input order', () => {
      const records = [
        record({ vaccine: VaccineType.Rabies }),
        record({ vaccine: VaccineType.DHPP, validityMonths: 12 }),
      ];

      const assessments = service.assessAll(records, '2026-06-01T00:00:00.000Z');

      expect(assessments.map((a) => a.record.vaccine)).toEqual([
        VaccineType.Rabies,
        VaccineType.DHPP,
      ]);
    });

    it('should return an empty array for no records', () => {
      expect(service.assessAll([], '2026-06-01T00:00:00.000Z')).toEqual([]);
    });

    it('should treat a nullish record list as empty', () => {
      expect(
        service.assessAll(undefined as unknown as VaccinationRecord[], '2026-06-01T00:00:00.000Z')
      ).toEqual([]);
    });
  });

  describe('summarize', () => {
    it('should bucket records into upcoming, due, and overdue', () => {
      const asOf = '2027-01-05T00:00:00.000Z';
      const records = [
        // Expiry 2027-01-01 → 4 days past, within grace → Due.
        record({ petId: 'pet-1', dateGiven: '2026-01-01T00:00:00.000Z', validityMonths: 12 }),
        // Expiry 2027-01-20 → 15 days out → Upcoming.
        record({ petId: 'pet-2', dateGiven: '2026-01-20T00:00:00.000Z', validityMonths: 12 }),
        // Expiry 2026-11-01 → long past grace → Overdue.
        record({ petId: 'pet-3', dateGiven: '2025-11-01T00:00:00.000Z', validityMonths: 12 }),
        // Expiry 2027-06-01 → far out → Valid (uncounted).
        record({ petId: 'pet-4', dateGiven: '2026-06-01T00:00:00.000Z', validityMonths: 12 }),
      ];

      const summary = service.summarize(records, asOf);

      expect(summary).toEqual({
        upcoming: 1,
        due: 1,
        overdue: 1,
        atRiskPetIds: ['pet-1', 'pet-3'],
      });
    });

    it('should list at-risk pet ids distinctly and sorted', () => {
      const asOf = '2027-02-01T00:00:00.000Z';
      const records = [
        record({ petId: 'pet-zeta', dateGiven: '2025-11-01T00:00:00.000Z', validityMonths: 12 }),
        record({ petId: 'pet-alpha', dateGiven: '2025-11-01T00:00:00.000Z', validityMonths: 12 }),
        // Same pet, second overdue vaccine — must not duplicate.
        record({
          petId: 'pet-alpha',
          vaccine: VaccineType.DHPP,
          dateGiven: '2025-11-01T00:00:00.000Z',
          validityMonths: 12,
        }),
      ];

      const summary = service.summarize(records, asOf);

      expect(summary.overdue).toBe(3);
      expect(summary.atRiskPetIds).toEqual(['pet-alpha', 'pet-zeta']);
    });

    it('should return zeroed figures for no records', () => {
      const summary = service.summarize([], '2026-06-01T00:00:00.000Z');

      expect(summary).toEqual({ upcoming: 0, due: 0, overdue: 0, atRiskPetIds: [] });
    });
  });
});

// Made with Bob
