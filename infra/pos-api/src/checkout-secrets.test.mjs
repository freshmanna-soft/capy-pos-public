import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { loadCheckoutSecrets } from './checkout-secrets.ts';

const KEY_A = 'a'.repeat(32);
const KEY_B = 'b'.repeat(48);

function environment(overrides = {}) {
  return {
    CHECKOUT_IDEMPOTENCY_HMAC_KEYS_JSON: JSON.stringify({ v2: KEY_B, v1: KEY_A }),
    CHECKOUT_CAPABILITY_HMAC_KEYS_JSON: JSON.stringify({ v2: KEY_A, v1: KEY_B }),
    ...overrides,
  };
}

describe('checkout secret keyrings', () => {
  it('loads retained versions into frozen null-prototype maps', () => {
    const secrets = loadCheckoutSecrets(environment());

    assert.deepEqual(Object.keys(secrets.idempotencyHmacKeys), ['v2', 'v1']);
    assert.equal(secrets.idempotencyHmacKeys.v2, KEY_B);
    assert.equal(secrets.capabilityHmacKeys.v1, KEY_B);
    assert.equal(Object.getPrototypeOf(secrets.idempotencyHmacKeys), null);
    assert.equal(Object.isFrozen(secrets.idempotencyHmacKeys), true);
    assert.equal(Object.isFrozen(secrets), true);
  });

  it('requires both bounded JSON object keyrings', () => {
    for (const value of [undefined, '', '[]', 'null', '"key"', '{']) {
      assert.throws(
        () =>
          loadCheckoutSecrets(
            environment({
              CHECKOUT_IDEMPOTENCY_HMAC_KEYS_JSON: value,
            })
          ),
        /CHECKOUT_IDEMPOTENCY_HMAC_KEYS_JSON/
      );
    }

    assert.throws(
      () =>
        loadCheckoutSecrets(
          environment({
            CHECKOUT_CAPABILITY_HMAC_KEYS_JSON: undefined,
          })
        ),
      /CHECKOUT_CAPABILITY_HMAC_KEYS_JSON/
    );
  });

  it('rejects unsafe versions and short or non-string keys', () => {
    for (const keyring of [
      { 'bad\nversion': KEY_A },
      { constructor: KEY_A },
      { prototype: KEY_A },
      { v1: 'short' },
      { v1: 42 },
    ]) {
      assert.throws(
        () =>
          loadCheckoutSecrets(
            environment({
              CHECKOUT_IDEMPOTENCY_HMAC_KEYS_JSON: JSON.stringify(keyring),
            })
          ),
        /invalid/
      );
    }
  });

  it('caps retained versions and serialized input size', () => {
    const tooManyVersions = Object.fromEntries(
      Array.from({ length: 17 }, (_, index) => [`v${index}`, KEY_A])
    );
    assert.throws(
      () =>
        loadCheckoutSecrets(
          environment({
            CHECKOUT_IDEMPOTENCY_HMAC_KEYS_JSON: JSON.stringify(tooManyVersions),
          })
        ),
      /between 1 and 16/
    );
    assert.throws(
      () =>
        loadCheckoutSecrets(
          environment({
            CHECKOUT_IDEMPOTENCY_HMAC_KEYS_JSON: ' '.repeat(16 * 1024 + 1),
          })
        ),
      /bounded/
    );
  });
});
