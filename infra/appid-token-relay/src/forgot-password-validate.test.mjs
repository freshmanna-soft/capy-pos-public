import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { validate } from './forgot-password-validate.ts';

describe('validate', () => {
  it('accepts a well-formed request, lower-casing and trimming the email', () => {
    assert.deepEqual(validate({ email: '  Ada@Capy.Test  ' }), { email: 'ada@capy.test' });
  });

  it('refuses a missing or malformed email', () => {
    for (const body of [{}, { email: 'not-an-email' }, { email: 42 }]) {
      assert.match(validate(body).error, /email/);
    }
  });

  it('refuses a non-object body', () => {
    for (const body of [null, 'string', 42, ['a']]) {
      assert.equal(typeof validate(body).error, 'string');
    }
  });
});
