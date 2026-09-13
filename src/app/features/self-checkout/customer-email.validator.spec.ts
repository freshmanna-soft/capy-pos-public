import { describe, it, expect } from 'vitest';
import { FormControl, Validators } from '@angular/forms';
import { customerEmailValidator, MAX_EMAIL_LENGTH } from './customer-email.validator';

/**
 * The parity this validator exists for, case by case.
 *
 * The rule is deliberately a copy of the relay's `EMAIL_PATTERN`
 * (`infra/appid-token-relay/src/customer-signup-validate.ts`) rather than an
 * import of it — the relay is a separate deployable — so a copy is only as
 * trustworthy as the cases pinning it, and this is that list. Verdicts are written
 * out per address rather than checked against a regex re-declared here, which
 * would only assert a constant against itself.
 *
 * The address the whole file turns on is `jane@gmail`: `Validators.email` accepts
 * it (Angular's `EMAIL_REGEXP` makes the domain's dot-group optional) and the relay
 * refuses it with `400 "email must be a valid email address."`, so before this
 * existed a missing TLD cost a round trip and came back as
 * `describeSignUpRefusal`'s generic "please try again" — a permanent refusal shown
 * as transient, blaming no field, on the one form that had just been given
 * field-level error copy for exactly that.
 */
describe('customerEmailValidator', () => {
  const verdict = (value: unknown) => customerEmailValidator(new FormControl(value));

  describe('agrees with the relay about the shape of an address', () => {
    it.each([
      ['an ordinary address', 'shopper@capy.test'],
      ['a multi-label domain', 'jane@mail.shop.example.com'],
      ['a plus-tagged local part', 'jane+receipts@shop.example.com'],
      ['the shortest thing the pattern allows', 'a@b.co'],
      ['surrounding whitespace, which the relay trims off before testing', '  Shopper@Capy.Test  '],
    ])('accepts %s', (_label, value) => {
      expect(verdict(value)).toBeNull();
    });

    it.each([
      // The one that motivated the file: accepted by `Validators.email`, refused
      // by the relay, and a typo a shopper makes at a kiosk.
      ['a domain with no dot in it', 'jane@gmail'],
      ['a bare word', 'not-an-email'],
      ['a domain with no local part', '@example.com'],
      ['a local part with no domain', 'jane@'],
      ['no @ at all', 'jane.example.com'],
      ['a second @ where the domain belongs', 'jane@@example.com'],
      ['whitespace inside the address', 'jane doe@example.com'],
      ['a trailing dot with nothing after it', 'jane@example.'],
      // `Validators.required` only measures length, so it accepts a field holding
      // nothing but spaces and the relay (which trims first) answers 400 for it.
      // This is the only rule that catches it.
      ['nothing but whitespace', '   '],
      // Same gap, other shape: `required` accepts any non-empty value, string or
      // not. The relay's first check is `typeof email !== 'string'`.
      ['a value that is not a string at all', 42],
    ])('refuses %s', (_label, value) => {
      expect(verdict(value)).toEqual({ email: true });
    });
  });

  describe('the length bound is the relay’s MAX_EMAIL_LENGTH', () => {
    const atBound = `${'a'.repeat(MAX_EMAIL_LENGTH - 'a@capy.test'.length + 1)}@capy.test`;

    it('accepts an address exactly at the bound', () => {
      expect(atBound).toHaveLength(MAX_EMAIL_LENGTH);
      expect(verdict(atBound)).toBeNull();
    });

    it('refuses one character more, and says so as its own error', () => {
      // A distinct key, because "too long" and "malformed" are different things to
      // tell a customer — the form states the bound for the first and asks them to
      // check for a typo for the second.
      expect(verdict(`a${atBound}`)).toEqual({ emailTooLong: { max: MAX_EMAIL_LENGTH } });
    });

    it('measures the trimmed address, the way the relay does', () => {
      expect(verdict(`  ${atBound}  `)).toBeNull();
    });
  });

  describe('leaves an untouched field to Validators.required', () => {
    it.each([
      ['an empty string', ''],
      ['the null a reset control holds', null],
    ])('says nothing about %s', (_label, value) => {
      // Otherwise a field the customer has not reached yet reads as "malformed"
      // as well as "missing", and the form shows the wrong one of the two. These
      // are exactly the values `Validators.required` refuses, so nothing falls
      // between the two rules.
      expect(verdict(value)).toBeNull();
      expect(Validators.required(new FormControl(value))).toEqual({ required: true });
    });
  });

  it('is stricter than Validators.email, which is the reason it exists', () => {
    // The divergence itself, pinned: swapping this validator back for
    // `Validators.email` in the form fails here, with the address that proves why.
    const missingTld = new FormControl('jane@gmail');

    expect(Validators.email(missingTld)).toBeNull();
    expect(customerEmailValidator(missingTld)).toEqual({ email: true });
  });
});
