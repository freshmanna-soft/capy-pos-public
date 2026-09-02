import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { isRejection, validate } from './validate.ts';

describe('validate — password grant', () => {
  it('accepts a well-formed password grant', () => {
    assert.deepEqual(validate({ grant_type: 'password', username: 'a@b.com', password: 'secret' }), {
      grantType: 'password',
      username: 'a@b.com',
      password: 'secret',
    });
  });

  it('refuses a missing or blank username', () => {
    for (const body of [
      { grant_type: 'password', password: 'secret' },
      { grant_type: 'password', username: '', password: 'secret' },
      { grant_type: 'password', username: '   ', password: 'secret' },
      { grant_type: 'password', username: 42, password: 'secret' },
    ]) {
      assert.ok(isRejection(validate(body)), JSON.stringify(body));
    }
  });

  it('refuses a missing or empty password', () => {
    for (const body of [
      { grant_type: 'password', username: 'a@b.com' },
      { grant_type: 'password', username: 'a@b.com', password: '' },
      { grant_type: 'password', username: 'a@b.com', password: 42 },
    ]) {
      assert.ok(isRejection(validate(body)), JSON.stringify(body));
    }
  });
});

describe('validate — refresh_token grant', () => {
  it('accepts a well-formed refresh grant', () => {
    assert.deepEqual(validate({ grant_type: 'refresh_token', refresh_token: 'rt-1' }), {
      grantType: 'refresh_token',
      refreshToken: 'rt-1',
    });
  });

  it('refuses a missing or empty refresh_token', () => {
    for (const body of [{ grant_type: 'refresh_token' }, { grant_type: 'refresh_token', refresh_token: '' }, { grant_type: 'refresh_token', refresh_token: 7 }]) {
      assert.ok(isRejection(validate(body)), JSON.stringify(body));
    }
  });
});

describe('validate — everything else', () => {
  it('refuses an unknown or missing grant_type', () => {
    for (const body of [{}, { grant_type: 'implicit' }, { grant_type: '' }, { grant_type: 42 }]) {
      assert.ok(isRejection(validate(body)), JSON.stringify(body));
    }
  });

  it('refuses a non-object body', () => {
    for (const body of [null, undefined, 'a string', 42, ['grant_type']]) {
      assert.ok(isRejection(validate(body)), JSON.stringify(body));
    }
  });

  it('never forwards a grant type this relay does not support', () => {
    // AppIdAuthAdapter only ever sends 'password' or 'refresh_token'; a caller
    // sending 'authorization_code' or 'client_credentials' must not slip through.
    const result = validate({ grant_type: 'client_credentials', client_id: 'x', client_secret: 'y' });
    assert.ok(isRejection(result));
  });
});

describe('isRejection', () => {
  it('distinguishes a TokenRequest from a Rejection', () => {
    assert.equal(isRejection({ error: 'nope' }), true);
    assert.equal(isRejection({ grantType: 'password', username: 'a', password: 'b' }), false);
  });
});
