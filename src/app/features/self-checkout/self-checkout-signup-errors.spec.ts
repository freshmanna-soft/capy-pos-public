import { describe, it, expect } from 'vitest';
import { describeSignUpRefusal } from './self-checkout-signup-errors';

/**
 * The refusal mapper on its own, because the branch that matters most is the one
 * the form cannot reach any more.
 *
 * `AppIdCustomerAuthAdapter.signUp` used to chase the relay's `201` with a
 * password grant, which a `PENDING` account answers `403 "Invalid email or
 * password"` (via `InvalidCredentialsError`). That message met the old
 * `/password/i` fallback, so a refusal about verification state was shown as a
 * rejected password. The grant is gone, so a component-level test can no longer
 * produce that input — asserting the classification directly is what keeps the
 * mis-reading from coming back through some other error that happens to say
 * "password".
 *
 * Bodies below are the relay's real ones (`customer-signup.ts`), copied verbatim
 * rather than imported: the relay is a separate deployable, and a shared import
 * would let a change there silently rewrite what this form is asserted to say.
 */
describe('describeSignUpRefusal', () => {
  const RELAY_409 =
    'That email address cannot be used to sign up. If the account is yours, try signing in instead, ' +
    'or reset your password if you have forgotten it.';

  const RELAY_400 = 'That password does not meet the password policy for this store.';

  describe('a password message that is not a policy refusal', () => {
    it('does NOT become password-policy copy', () => {
      // The 403 the PENDING grant produced. Nothing about the customer's
      // password was wrong, so telling them to change it is the wrong answer.
      const refusal = describeSignUpRefusal(new Error('Invalid email or password'));

      expect(refusal.message).not.toContain('password rules');
      expect(refusal.message).toContain('could not create your account');
      expect(refusal.detail).toBeNull();
      expect(refusal.field).toBeNull();
    });

    it('still classifies the relay 400 it was narrowed around', () => {
      // Narrowing must not cost the real case, which carries no readable status
      // — the body is the policy sentence itself, never `... returned 400`.
      expect(describeSignUpRefusal(new Error(RELAY_400)).message).toContain('password rules');
    });
  });

  describe('the relay 400', () => {
    it('surfaces App ID’s own explanation as the detail', () => {
      const refusal = describeSignUpRefusal(
        new Error(`${RELAY_400} Password must be at least 12 characters and contain a digit.`)
      );

      expect(refusal.message).toContain('password rules');
      expect(refusal.detail).toBe('Password must be at least 12 characters and contain a digit.');
    });

    it('carries no detail when the relay sent no explanation to show', () => {
      expect(describeSignUpRefusal(new Error(RELAY_400)).detail).toBeNull();
    });

    /**
     * The regression this file exists for after round 2.
     *
     * `statusOf` used to scrape any `\b\d{3}\b` out of the whole message, and App
     * ID's explanation is forwarded verbatim — so a policy that states its own
     * bounds ("between 8 and 100 characters", "at least 128 characters") was read
     * as status 100 or 128. Neither is 400 and neither is null, so the policy
     * branch was skipped and the customer was told to "try again" on a password
     * that would be refused identically every time, with the one sentence saying
     * what to change thrown away. Parameterised over both bound positions because
     * the old regex took the *first* number in the string either way.
     */
    it.each([
      ['a lower and an upper bound', 'Password must be between 8 and 100 characters.'],
      ['an upper bound alone', 'Password must be at most 128 characters long.'],
      ['a three-digit minimum', 'Password must be at least 100 characters.'],
      ['a bound and a digit rule', 'Must be 8 to 256 characters and contain a digit.'],
    ])('keeps policy copy and detail when the explanation quotes %s', (_label, explanation) => {
      const refusal = describeSignUpRefusal(new Error(`${RELAY_400} ${explanation}`));

      expect(refusal.message).toContain('password rules');
      expect(refusal.detail).toBe(explanation);
      expect(refusal.field).toBe('password');
    });

    it('is classified from the status the adapter attached, corroborated by the wording', () => {
      // Both channels, which is the shape a real refusal arrives in:
      // `AppIdAuthError` carries `status`, and the body is the policy sentence.
      const refusal = describeSignUpRefusal(Object.assign(new Error(RELAY_400), { status: 400 }));

      expect(refusal.message).toContain('password rules');
    });

    it('does NOT put password copy on a 400 that is not about the password', () => {
      // The relay answers 400 for its own request validation as well
      // (`customer-signup-validate.ts`), so the status alone cannot mean "policy".
      // Telling a shopper their password broke a rule sends them to fix the wrong
      // field.
      const refusal = describeSignUpRefusal(
        Object.assign(new Error('email must be a valid email address.'), { status: 400 })
      );

      expect(refusal.message).not.toContain('password rules');
      expect(refusal.field).toBe('email');
    });
  });

  /**
   * The relay's own request validation (`customer-signup-validate.ts`), which is a
   * `400` like the policy refusal and means something else entirely.
   *
   * These used to fall through to the generic sentence, and both halves of that
   * were wrong. "Please try again" invites a retry of an address the relay will
   * refuse byte-for-byte every time, and naming no field left the shopper reading
   * a banner about their account while the input that caused it stayed
   * `aria-invalid=null` — WCAG 3.3.1 failed on the same screen that had just been
   * given field-level copy. `customerEmailValidator` and the form's own
   * `maxLength` should keep these unreachable; this branch is what happens when
   * the mirrored rules drift, which is the normal fate of a rule living in two
   * deployables.
   */
  describe('the relay’s own shape refusals', () => {
    it.each([
      ['a malformed address', 'email must be a valid email address.'],
      ['an address over the transport bound', 'email must be at most 254 characters.'],
    ])('blames the email field for %s', (_label, body) => {
      const refusal = describeSignUpRefusal(Object.assign(new Error(body), { status: 400 }));

      expect(refusal.message).toContain('Check it for a typo');
      expect(refusal.field).toBe('email');
      // Never the machine sentence itself: `detail` is rendered verbatim.
      expect(refusal.detail).toBeNull();
      expect(refusal.message).not.toContain('try again');
    });

    it.each([
      ['a passphrase over the transport bound', 'password must be at most 256 characters.'],
      ['a missing passphrase', 'password is required.'],
    ])('blames the password field for %s, without quoting store rules', (_label, body) => {
      const refusal = describeSignUpRefusal(Object.assign(new Error(body), { status: 400 }));

      expect(refusal.field).toBe('password');
      // Not the policy sentence: nothing about the *tenant's* rules is known here,
      // and saying so would be inventing a reason.
      expect(refusal.message).not.toContain('password rules');
      expect(refusal.message).toContain('shorter');
    });

    it.each([
      [
        'a minimum, which means the opposite of "too long"',
        'Password must be between 8 and 100 characters.',
      ],
      ['a rule about content', 'Password must contain a digit and an uppercase letter.'],
      ['a sentence merely opening the same way', 'email must be verified before signing in.'],
    ])('does not read App ID’s own prose as a shape refusal — %s', (_label, body) => {
      // Matched whole, not by prefix. The first case is a real policy detail that
      // starts exactly like the passphrase refusal above and means a *minimum*;
      // answering it with "try a shorter one" would send the shopper the wrong way.
      const refusal = describeSignUpRefusal(Object.assign(new Error(body), { status: 400 }));

      expect(refusal.message).not.toContain('shorter');
      expect(refusal.message).not.toContain('Check it for a typo');
      expect(refusal.message).toContain('could not create your account');
      expect(refusal.field).toBeNull();
    });
  });

  describe('the relay 409', () => {
    it('offers signing in without promising it will work', () => {
      const refusal = describeSignUpRefusal(new Error(RELAY_409));

      expect(refusal.message).toContain('Try signing in instead');
      // Never a promise: the account may itself still be PENDING (item 3).
      expect(refusal.message).not.toMatch(/will work|you can sign in now/i);
    });

    it('blames the address, which is the field the shopper would change', () => {
      // What replaced the `alreadyRegistered` flag. That flag existed only to
      // reveal a "Try signing in" link pointing at `/self-checkout`, where no
      // sign-in form exists (Epic #261 item 18) — so the most common refusal
      // offered an action that led back to the lane and dropped what had been
      // typed. The advice survives in the copy; the field association is what the
      // form can actually act on today.
      expect(describeSignUpRefusal(Object.assign(new Error(''), { status: 409 })).field).toBe(
        'email'
      );
    });

    it('is not mistaken for a policy refusal, though its body says "password"', () => {
      // `DUPLICATE_EMAIL_MESSAGE` ends with "reset your password" — the exact
      // reason the duplicate branch is tested before the policy one.
      expect(describeSignUpRefusal(new Error(RELAY_409)).message).not.toContain('password rules');
    });
  });

  describe('the content-free 429', () => {
    it('says something neutral from the attached status, and invents no reason', () => {
      const refusal = describeSignUpRefusal(Object.assign(new Error(''), { status: 429 }));

      expect(refusal.message).toContain('try again shortly');
      expect(refusal.message).not.toContain('429');
      expect(refusal.message).not.toMatch(/password|email|account/i);
      expect(refusal.field).toBeNull();
    });

    it('is still classified from the adapter’s no-body message alone', () => {
      // Item 8c's limiter answers with an empty body on purpose, so the adapter's
      // `Customer sign-up returned 429` fallback can be all there is to read —
      // the one message shape a status is still parsed out of.
      expect(describeSignUpRefusal(new Error('Customer sign-up returned 429')).message).toContain(
        'try again shortly'
      );
    });

    it('does not read a status out of a sentence that merely contains that wording', () => {
      // Start-anchored: prose is never a status channel, however it is worded.
      const refusal = describeSignUpRefusal(
        new Error('App ID said: Customer sign-up returned 429 to another shopper')
      );

      expect(refusal.message).toContain('could not create your account');
    });
  });

  describe('is total — nothing raw ever reaches the customer', () => {
    it('gives neutral copy for a transport failure', () => {
      const refusal = describeSignUpRefusal(
        new Error('Customer sign-up request failed: NetworkError')
      );

      expect(refusal.message).toContain('could not create your account');
      expect(refusal.message).not.toContain('NetworkError');
    });

    it.each([
      ['a bare string', 'something went wrong'],
      ['null', null],
      ['undefined', undefined],
      ['an object that is not an Error', { code: 'ETIMEDOUT' }],
    ])('gives neutral copy for %s', (_label, thrown) => {
      const refusal = describeSignUpRefusal(thrown);

      expect(refusal.message).toContain('could not create your account');
      expect(refusal.detail).toBeNull();
      expect(refusal.field).toBeNull();
    });
  });
});
