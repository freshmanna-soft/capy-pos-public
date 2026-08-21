/**
 * What makes a till PIN worth storing.
 *
 * A PIN is the weak path by design — it exists so a device with no fingerprint
 * sensor is not locked out — and the rules here are the only thing standing
 * between that and a keypad secured by `1234`. Four digits is 10 000
 * possibilities; the guessable ones are a few dozen of them, and in practice a
 * large fraction of people pick from exactly that handful.
 *
 * Pure and exported so the rules are tested directly rather than through a
 * database round trip, and so the keypad can show the reason before submitting.
 */

export type PinRejection = 'too-short' | 'too-long' | 'not-numeric' | 'too-guessable';

/**
 * Four digits, matching what people expect from a till and a phone lock screen.
 *
 * Short enough to be typed one-handed while bagging, and the work factor in
 * `secret-hash.ts` is what compensates for the small keyspace.
 */
export const MIN_PIN_LENGTH = 4;
export const MAX_PIN_LENGTH = 8;

/**
 * @returns why the PIN is unacceptable, or null when it is fine.
 */
export function validatePin(pin: string): PinRejection | null {
  // Checked first so "12ab" is reported as the wrong characters rather than as the
  // wrong length — that is the mistake the person actually made.
  if (!/^\d*$/.test(pin)) {
    return 'not-numeric';
  }
  if (pin.length < MIN_PIN_LENGTH) {
    return 'too-short';
  }
  if (pin.length > MAX_PIN_LENGTH) {
    return 'too-long';
  }
  if (isUniform(pin) || isRun(pin) || isShortCycle(pin)) {
    return 'too-guessable';
  }
  return null;
}

/** 0000, 7777 — the single most common choice after 1234. */
function isUniform(pin: string): boolean {
  return new Set(pin).size === 1;
}

/**
 * 1234, 9876, and any other straight run in either direction.
 *
 * Deliberately not wrapped around: 8901 is a run on a dial but not on a keypad,
 * and refusing it would reject a PIN nobody would guess.
 */
function isRun(pin: string): boolean {
  const step = pin.charCodeAt(1) - pin.charCodeAt(0);
  if (step !== 1 && step !== -1) {
    return false;
  }
  for (let i = 2; i < pin.length; i++) {
    if (pin.charCodeAt(i) - pin.charCodeAt(i - 1) !== step) {
      return false;
    }
  }
  return true;
}

/**
 * 1212, 123123 — a short pattern typed twice.
 *
 * Feels random to the person choosing it and is trivially enumerable: a repeated
 * two-digit pattern has only 100 possibilities however long the PIN gets.
 */
function isShortCycle(pin: string): boolean {
  for (let size = 1; size <= pin.length / 2; size++) {
    if (pin.length % size !== 0) {
      continue;
    }
    const unit = pin.slice(0, size);
    if (unit.repeat(pin.length / size) === pin) {
      return true;
    }
  }
  return false;
}
