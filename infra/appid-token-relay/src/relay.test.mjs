/**
 * The suite for `relay.ts`, with `fetch` stubbed — this file asserts the shape
 * of the request `relay()` builds and how it turns App ID's answer (or a
 * transport failure) into its own result, not that a real App ID tenant exists.
 */
import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { relay } from './relay.ts';

const CONFIG = {
  region: 'us-south',
  tenantId: 'tenant-1',
  clientId: 'client-1',
  clientSecret: 'shh',
};

let originalFetch;
let calls;

beforeEach(() => {
  originalFetch = globalThis.fetch;
  calls = [];
});

afterEach(() => {
  globalThis.fetch = originalFetch;
});

function stub(respond) {
  globalThis.fetch = async (url, options) => {
    calls.push({ url, options });
    return respond(url, options);
  };
}

function jsonResponse(status, body) {
  return { status, json: async () => body };
}

describe('relay — request shape', () => {
  it('posts to the region+tenant token endpoint', async () => {
    stub(() => jsonResponse(200, { access_token: 'a' }));
    await relay({ grantType: 'password', username: 'u', password: 'p' }, CONFIG);
    assert.equal(calls[0].url, 'https://us-south.appid.cloud.ibm.com/oauth/v4/tenant-1/token');
    assert.equal(calls[0].options.method, 'POST');
  });

  it('attaches Basic auth built from clientId:clientSecret', async () => {
    stub(() => jsonResponse(200, {}));
    await relay({ grantType: 'password', username: 'u', password: 'p' }, CONFIG);
    const expected = `Basic ${Buffer.from('client-1:shh').toString('base64')}`;
    assert.equal(calls[0].options.headers.Authorization, expected);
  });

  it('sends a password grant as multipart form fields, not JSON', async () => {
    stub(() => jsonResponse(200, {}));
    await relay({ grantType: 'password', username: 'user@example.com', password: 'secret' }, CONFIG);
    const form = calls[0].options.body;
    assert.ok(form instanceof FormData);
    assert.equal(form.get('grant_type'), 'password');
    assert.equal(form.get('username'), 'user@example.com');
    assert.equal(form.get('password'), 'secret');
    assert.equal(form.get('refresh_token'), null);
  });

  it('sends a refresh_token grant as multipart form fields', async () => {
    stub(() => jsonResponse(200, {}));
    await relay({ grantType: 'refresh_token', refreshToken: 'rt-1' }, CONFIG);
    const form = calls[0].options.body;
    assert.equal(form.get('grant_type'), 'refresh_token');
    assert.equal(form.get('refresh_token'), 'rt-1');
    assert.equal(form.get('username'), null);
    assert.equal(form.get('password'), null);
  });
});

describe('relay — passing App ID\'s own answer through', () => {
  it('resolves with a successful token response untouched', async () => {
    const body = { access_token: 'a', refresh_token: 'r', token_type: 'Bearer', expires_in: 3600, scope: 'admin' };
    stub(() => jsonResponse(200, body));
    const result = await relay({ grantType: 'password', username: 'u', password: 'p' }, CONFIG);
    assert.deepEqual(result, { status: 200, body });
  });

  it('resolves (does not throw) for a well-formed OAuth error — invalid_grant is App ID answering correctly', async () => {
    const body = { error: 'invalid_grant', error_description: 'The username or password is incorrect' };
    stub(() => jsonResponse(400, body));
    const result = await relay({ grantType: 'password', username: 'u', password: 'wrong' }, CONFIG);
    assert.deepEqual(result, { status: 400, body });
  });

  it('resolves for any status App ID actually answered with, including 401/403/429', async () => {
    for (const status of [401, 403, 429]) {
      stub(() => jsonResponse(status, { error: 'whatever' }));
      const result = await relay({ grantType: 'refresh_token', refreshToken: 'rt' }, CONFIG);
      assert.equal(result.status, status);
    }
  });
});

describe('relay — genuine transport failure', () => {
  it('throws when the network request itself fails', async () => {
    stub(() => {
      throw new Error('getaddrinfo ENOTFOUND');
    });
    await assert.rejects(() => relay({ grantType: 'password', username: 'u', password: 'p' }, CONFIG), /App ID request failed/);
  });

  it('throws when App ID answers with something that is not JSON', async () => {
    stub(() => ({
      status: 200,
      json: async () => {
        throw new SyntaxError('Unexpected token');
      },
    }));
    await assert.rejects(
      () => relay({ grantType: 'password', username: 'u', password: 'p' }, CONFIG),
      /App ID returned a non-JSON response/
    );
  });
});
