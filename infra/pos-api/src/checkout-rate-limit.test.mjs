import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { FixedWindowCheckoutRateLimiter } from './checkout-rate-limit.ts';

describe('FixedWindowCheckoutRateLimiter', () => {
  it('bounds requests per key and resets after the fixed window', () => {
    let now = 1_000;
    const limiter = new FixedWindowCheckoutRateLimiter({
      maxRequests: 2,
      windowMs: 10_000,
      maxKeys: 10,
      nowMs: () => now,
    });
    assert.deepEqual(limiter.consume('client-a'), { allowed: true });
    assert.deepEqual(limiter.consume('client-a'), { allowed: true });
    assert.deepEqual(limiter.consume('client-a'), {
      allowed: false,
      retryAfterSeconds: 10,
    });
    assert.deepEqual(limiter.consume('client-b'), { allowed: true });
    now = 11_000;
    assert.deepEqual(limiter.consume('client-a'), { allowed: true });
  });

  it('bounds tracked keys and rejects invalid options or clocks', () => {
    let now = 0;
    const limiter = new FixedWindowCheckoutRateLimiter({
      maxRequests: 1,
      windowMs: 1_000,
      maxKeys: 1,
      nowMs: () => now,
    });
    assert.deepEqual(limiter.consume('client-a'), { allowed: true });
    assert.deepEqual(limiter.consume('client-b'), { allowed: true });
    assert.deepEqual(limiter.consume('client-a'), { allowed: true });
    now = Number.NaN;
    assert.throws(() => limiter.consume('client-a'), /clock/);
    assert.throws(
      () => new FixedWindowCheckoutRateLimiter({ maxRequests: 0, windowMs: 1, maxKeys: 1 })
    );
    assert.throws(
      () => new FixedWindowCheckoutRateLimiter({ maxRequests: 1, windowMs: 0, maxKeys: 1 })
    );
    assert.throws(
      () => new FixedWindowCheckoutRateLimiter({ maxRequests: 1, windowMs: 1, maxKeys: 0 })
    );
  });
});
