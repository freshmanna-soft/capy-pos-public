import { AbstractControl, ValidationErrors, ValidatorFn } from '@angular/forms';

/**
 * The address rule this form enforces, kept deliberately identical to the one the
 * relay enforces.
 *
 * `Validators.email` was here, and it accepts an address the relay refuses.
 * Angular's `EMAIL_REGEXP` makes the domain's dot-group optional, so `jane@gmail`
 * is valid to it; the relay's `EMAIL_PATTERN`
 * (`infra/appid-token-relay/src/customer-signup-validate.ts`) requires a dot in
 * the domain and answers `400 "email must be a valid email address."` instead. A
 * missing TLD is one of the two typos a shopper actually makes at a kiosk, so that
 * gap was reachable by hand: the submit went out, came back a permanent refusal,
 * and the form had nothing to say about *which* field — WCAG 3.3.1 failed on the
 * one screen that had just been given field-level error copy for exactly this.
 *
 * So the client rule mirrors the server rule rather than approximating it, and
 * `describeSignUpRefusal`'s email branch stays as the second line of defence for
 * the day the two drift again. Neither is redundant: this one names the field
 * before a request is made, that one names it if a request is made anyway.
 *
 * Copied rather than imported. The relay is a separate deployable with its own
 * lifecycle — an import would be a build-time coupling this app does not have, and
 * a silent behaviour change if the relay ever loosened its rule. `customer-email.
 * validator.spec.ts` is what pins the parity, case by case.
 */

/** Mirrors the relay's `EMAIL_PATTERN`. */
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * Mirrors the relay's `MAX_EMAIL_LENGTH` — the longest address RFC 5321 allows,
 * which is a transport bound rather than a policy one.
 */
export const MAX_EMAIL_LENGTH = 254;

/**
 * Validate against the trimmed value, the way the relay does
 * (`EMAIL_PATTERN.test(email.trim())`).
 *
 * Trimming matters because `[^\s@]+` rejects a leading or trailing space outright
 * while the relay — and `AppIdCustomerAuthAdapter`'s own `normalizeEmail` —
 * quietly drops it. Testing the raw value would refuse an address that would in
 * fact have registered fine, which is the same class of mistake as this file's
 * reason for existing, only pointing the other way.
 *
 * An *empty* field is left to `Validators.required`, so a field the customer has
 * not reached yet is not also "malformed". Emptiness is measured before trimming,
 * deliberately: `Validators.required` only checks length, so it accepts a field
 * holding nothing but spaces, and the relay — which trims first — answers `400`
 * for it. Testing the trimmed value here would have agreed with `required` that
 * whitespace is content and let that submit go out, so this is the only rule that
 * catches it — as it is for a non-string value, which `required` also waves
 * through.
 */
export const customerEmailValidator: ValidatorFn = (
  control: AbstractControl
): ValidationErrors | null => {
  const raw: unknown = control.value;
  // Absent, not wrong: the two values a control holds before anyone types in it.
  if (raw === null || raw === undefined || raw === '') {
    return null;
  }
  // Anything that is not a string cannot be an address, which is the relay's first
  // check too (`typeof email !== 'string'`). `Validators.required` accepts a
  // non-empty non-string, so without this the two rules leave a gap between them.
  if (typeof raw !== 'string') {
    return { email: true };
  }
  const value = raw.trim();
  if (!EMAIL_PATTERN.test(value)) {
    return { email: true };
  }
  return value.length > MAX_EMAIL_LENGTH ? { emailTooLong: { max: MAX_EMAIL_LENGTH } } : null;
};
