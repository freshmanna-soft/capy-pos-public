import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  validate,
  MAX_BODY_BYTES,
  MAX_EMAIL_LENGTH,
  MAX_PASSWORD_LENGTH,
} from './customer-signup-validate.ts';

describe('validate', () => {
  it('accepts a well-formed request, normalizing the email and leaving the password byte-for-byte', () => {
    assert.deepEqual(validate({ email: '  Shopper@Capy.Test  ', password: '  pass phrase  ' }), {
      email: 'shopper@capy.test',
      password: '  pass phrase  ',
    });
  });

  it('refuses a missing or malformed email', () => {
    for (const body of [{ password: 'p' }, { email: 'not-an-email', password: 'p' }, { email: 42, password: 'p' }]) {
      assert.match(validate(body).error, /email/);
    }
  });

  it('refuses a missing or empty password', () => {
    for (const body of [
      { email: 'shopper@capy.test' },
      { email: 'shopper@capy.test', password: '' },
      { email: 'shopper@capy.test', password: 42 },
    ]) {
      assert.match(validate(body).error, /password/);
    }
  });

  it('refuses a non-object body', () => {
    for (const body of [null, 'string', 42, ['a']]) {
      assert.equal(typeof validate(body).error, 'string');
    }
  });

  it('ignores anything else the caller sent — a role or scope is never a caller-supplied field', () => {
    assert.deepEqual(validate({ email: 'shopper@capy.test', password: 'p', roleId: 'admin-role', scope: 'admin' }), {
      email: 'shopper@capy.test',
      password: 'p',
    });
  });

  it('caps the body at a size one address and one passphrase never exceed', () => {
    assert.equal(MAX_BODY_BYTES, 4 * 1024);
  });
});

describe('shape bounds (item 8b)', () => {
  it('refuses an address longer than a transport can carry, and accepts one at the bound', () => {
    const local = 'a'.repeat(MAX_EMAIL_LENGTH - '@capy.test'.length);
    assert.deepEqual(validate({ email: `${local}@capy.test`, password: 'p' }), {
      email: `${local}@capy.test`,
      password: 'p',
    });
    assert.match(validate({ email: `${local}x@capy.test`, password: 'p' }).error, /email/);
  });

  it('refuses a password past the upper bound, and accepts one exactly at it', () => {
    const atBound = 'p'.repeat(MAX_PASSWORD_LENGTH);
    assert.equal(validate({ email: 'shopper@capy.test', password: atBound }).password, atBound);
    assert.match(validate({ email: 'shopper@capy.test', password: `${atBound}p` }).error, /password/);
  });

  it('states no password *minimum* — the tenant policy is the only authority on strength', () => {
    // A one-character password is accepted *here* on purpose: App ID refuses it,
    // and `customer-signup.ts` turns that refusal into the caller's message. A
    // minimum copied into this file would drift from the console setting.
    assert.deepEqual(validate({ email: 'shopper@capy.test', password: 'x' }), {
      email: 'shopper@capy.test',
      password: 'x',
    });
  });
});
