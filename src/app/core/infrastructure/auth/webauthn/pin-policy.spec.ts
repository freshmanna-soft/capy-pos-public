import { describe, it, expect } from 'vitest';
import { MAX_PIN_LENGTH, MIN_PIN_LENGTH, validatePin } from './pin-policy';

describe('validatePin', () => {
  it('accepts an unremarkable four-digit PIN', () => {
    expect(validatePin('4917')).toBeNull();
  });

  it('accepts the longest PIN allowed', () => {
    expect(validatePin('49172683')).toBeNull();
  });

  it.each(['', '1', '123'])('refuses %s as too short', (pin) => {
    expect(validatePin(pin)).toBe('too-short');
  });

  it('refuses a PIN longer than the maximum', () => {
    expect(validatePin('4917268305')).toBe('too-long');
  });

  it.each(['12a4', '49 17', '4917x', '½917'])('refuses %s as not numeric', (pin) => {
    expect(validatePin(pin)).toBe('not-numeric');
  });

  it('reports the wrong characters before the wrong length', () => {
    // The person typed letters; telling them it is "too short" sends them to add more.
    expect(validatePin('ab')).toBe('not-numeric');
  });

  it.each(['0000', '1111', '7777', '99999999'])('refuses %s — every digit the same', (pin) => {
    expect(validatePin(pin)).toBe('too-guessable');
  });

  it.each(['1234', '0123', '3456', '12345678'])('refuses %s — an ascending run', (pin) => {
    expect(validatePin(pin)).toBe('too-guessable');
  });

  it.each(['4321', '9876', '87654321'])('refuses %s — a descending run', (pin) => {
    expect(validatePin(pin)).toBe('too-guessable');
  });

  it.each(['1212', '123123', '45454545'])('refuses %s — a short pattern repeated', (pin) => {
    expect(validatePin(pin)).toBe('too-guessable');
  });

  it('allows a run that only wraps around on a dial', () => {
    // 8901 looks like a sequence but is not one on a keypad, and nobody guesses it.
    expect(validatePin('8901')).toBeNull();
  });

  it('allows a PIN that merely starts like a run', () => {
    expect(validatePin('1235')).toBeNull();
  });

  it('allows a PIN with a repeated digit that is not a pattern', () => {
    expect(validatePin('4411')).toBeNull();
  });

  it('exposes the bounds it enforces', () => {
    expect(MIN_PIN_LENGTH).toBe(4);
    expect(MAX_PIN_LENGTH).toBe(8);
    expect(validatePin('9'.repeat(MAX_PIN_LENGTH + 1))).toBe('too-long');
  });
});
