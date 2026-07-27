import { describe, it, expect, beforeEach } from 'vitest';
import { AppointmentSchedulingService } from '@core/domain/rules/appointment-scheduling.service';
import {
  AppointmentRequest,
  AppointmentType,
  IAppointmentSchedulingService,
  ScheduledAppointment,
} from '@core/domain/rules/appointment-scheduling.service.interface';

describe('AppointmentSchedulingService', () => {
  let service: IAppointmentSchedulingService;

  beforeEach(() => {
    service = new AppointmentSchedulingService();
  });

  const validRequest = (overrides: Partial<AppointmentRequest> = {}): AppointmentRequest => ({
    petId: 'pet-1',
    providerId: 'dr-lena',
    type: AppointmentType.WELLNESS_EXAM,
    start: '2026-07-27T09:00:00.000Z',
    ...overrides,
  });

  const existingAppointment = (
    overrides: Partial<ScheduledAppointment> = {}
  ): ScheduledAppointment => ({
    id: 'appt-existing',
    petId: 'pet-other',
    providerId: 'dr-lena',
    type: AppointmentType.WELLNESS_EXAM,
    start: new Date('2026-07-27T09:00:00.000Z'),
    end: new Date('2026-07-27T09:30:00.000Z'),
    durationMinutes: 30,
    ...overrides,
  });

  describe('durationForType', () => {
    it('should use the wellness-exam template of 30 minutes', () => {
      expect(service.durationForType(AppointmentType.WELLNESS_EXAM)).toBe(30);
    });

    it('should use the surgery template of 90 minutes', () => {
      expect(service.durationForType(AppointmentType.SURGERY)).toBe(90);
    });

    it('should resolve vaccination and follow-up durations', () => {
      expect(service.durationForType(AppointmentType.VACCINATION)).toBe(15);
      expect(service.durationForType(AppointmentType.FOLLOW_UP)).toBe(20);
    });

    it('should throw for an unknown appointment type', () => {
      expect(() => service.durationForType('MASSAGE' as AppointmentType)).toThrow(
        /Unknown appointment type/
      );
    });
  });

  describe('scheduleAppointment', () => {
    it('should schedule an appointment and derive its end time from the type template', () => {
      const result = service.scheduleAppointment('appt-1', validRequest(), []);

      expect(result.id).toBe('appt-1');
      expect(result.petId).toBe('pet-1');
      expect(result.providerId).toBe('dr-lena');
      expect(result.type).toBe(AppointmentType.WELLNESS_EXAM);
      expect(result.durationMinutes).toBe(30);
      expect(result.start.toISOString()).toBe('2026-07-27T09:00:00.000Z');
      expect(result.end.toISOString()).toBe('2026-07-27T09:30:00.000Z');
    });

    it('should honour an explicit duration override', () => {
      const result = service.scheduleAppointment(
        'appt-1',
        validRequest({ type: AppointmentType.SURGERY, durationMinutes: 120 }),
        []
      );

      expect(result.durationMinutes).toBe(120);
      expect(result.end.toISOString()).toBe('2026-07-27T11:00:00.000Z');
    });

    it('should accept a Date instance for start', () => {
      const result = service.scheduleAppointment(
        'appt-1',
        validRequest({ start: new Date('2026-07-27T14:00:00.000Z') }),
        []
      );

      expect(result.start.toISOString()).toBe('2026-07-27T14:00:00.000Z');
      expect(result.end.toISOString()).toBe('2026-07-27T14:30:00.000Z');
    });

    it('should trim id and petId', () => {
      const result = service.scheduleAppointment(
        '  appt-1  ',
        validRequest({ petId: ' pet-1 ' }),
        []
      );

      expect(result.id).toBe('appt-1');
      expect(result.petId).toBe('pet-1');
    });

    it('should throw when the slot double-books the provider', () => {
      expect(() =>
        service.scheduleAppointment('appt-1', validRequest(), [existingAppointment()])
      ).toThrow(/already booked/);
    });

    it('should allow a back-to-back appointment immediately after an existing one', () => {
      const result = service.scheduleAppointment(
        'appt-1',
        validRequest({ start: '2026-07-27T09:30:00.000Z' }),
        [existingAppointment()]
      );

      expect(result.start.toISOString()).toBe('2026-07-27T09:30:00.000Z');
    });

    it('should throw for a missing pet id', () => {
      expect(() => service.scheduleAppointment('appt-1', validRequest({ petId: '' }), [])).toThrow(
        /Pet id/
      );
    });

    it('should throw for a missing provider id', () => {
      expect(() =>
        service.scheduleAppointment('appt-1', validRequest({ providerId: '   ' }), [])
      ).toThrow(/Provider id/);
    });

    it('should throw for a blank appointment id', () => {
      expect(() => service.scheduleAppointment('  ', validRequest(), [])).toThrow(/Appointment id/);
    });

    it('should throw for an invalid start date', () => {
      expect(() =>
        service.scheduleAppointment('appt-1', validRequest({ start: 'not-a-date' }), [])
      ).toThrow(/valid date/);
    });

    it('should throw for a non-positive duration override', () => {
      expect(() =>
        service.scheduleAppointment('appt-1', validRequest({ durationMinutes: 0 }), [])
      ).toThrow(/must be positive/);
    });

    it('should throw for a fractional duration override', () => {
      expect(() =>
        service.scheduleAppointment('appt-1', validRequest({ durationMinutes: 12.5 }), [])
      ).toThrow(/whole number/);
    });
  });

  describe('findConflicts / hasConflict', () => {
    it('should report no conflict against an empty calendar', () => {
      expect(service.hasConflict(validRequest(), [])).toBe(false);
      expect(service.findConflicts(validRequest(), [])).toEqual([]);
    });

    it('should treat a nullish existing list as an empty calendar', () => {
      expect(
        service.hasConflict(validRequest(), undefined as unknown as ScheduledAppointment[])
      ).toBe(false);
    });

    it('should detect a partial overlap', () => {
      // Requested 09:00-09:30 overlaps an existing 09:15-09:45 slot.
      const conflicts = service.findConflicts(validRequest(), [
        existingAppointment({
          start: new Date('2026-07-27T09:15:00.000Z'),
          end: new Date('2026-07-27T09:45:00.000Z'),
        }),
      ]);

      expect(conflicts).toHaveLength(1);
      expect(service.hasConflict(validRequest(), conflicts)).toBe(true);
    });

    it('should detect an enclosing existing appointment', () => {
      const conflicts = service.findConflicts(
        validRequest({ start: '2026-07-27T09:10:00.000Z', durationMinutes: 10 }),
        [
          existingAppointment({
            start: new Date('2026-07-27T09:00:00.000Z'),
            end: new Date('2026-07-27T10:00:00.000Z'),
          }),
        ]
      );

      expect(conflicts).toHaveLength(1);
    });

    it('should not conflict with an appointment for a different provider', () => {
      const conflicts = service.findConflicts(validRequest(), [
        existingAppointment({ providerId: 'dr-sam' }),
      ]);

      expect(conflicts).toEqual([]);
    });

    it('should not conflict with a non-overlapping earlier slot', () => {
      const conflicts = service.findConflicts(validRequest(), [
        existingAppointment({
          start: new Date('2026-07-27T08:00:00.000Z'),
          end: new Date('2026-07-27T08:30:00.000Z'),
        }),
      ]);

      expect(conflicts).toEqual([]);
    });

    it('should only return the conflicting slots among several', () => {
      const conflicts = service.findConflicts(validRequest(), [
        existingAppointment({
          id: 'earlier',
          start: new Date('2026-07-27T08:00:00.000Z'),
          end: new Date('2026-07-27T08:30:00.000Z'),
        }),
        existingAppointment({ id: 'overlapping' }),
        existingAppointment({ id: 'other-provider', providerId: 'dr-sam' }),
      ]);

      expect(conflicts).toHaveLength(1);
      expect(conflicts[0].id).toBe('overlapping');
    });
  });
});

// Made with Bob
