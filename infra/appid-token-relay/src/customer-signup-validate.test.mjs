import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { validate, MAX_BODY_BYTES } from './customer-signup-validate.ts';

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
