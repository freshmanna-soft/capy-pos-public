import type { CheckoutRateLimiter, CheckoutRateLimitResult } from './checkout-http.ts';

interface Bucket {
  count: number;
  windowStartedAtMs: number;
}

export interface FixedWindowRateLimiterOptions {
  readonly maxRequests: number;
  readonly windowMs: number;
  readonly maxKeys: number;
  readonly nowMs?: () => number;
}

export class FixedWindowCheckoutRateLimiter implements CheckoutRateLimiter {
  private readonly options: Required<FixedWindowRateLimiterOptions>;
  private readonly buckets = new Map<string, Bucket>();

  constructor(options: FixedWindowRateLimiterOptions) {
    if (!Number.isSafeInteger(options.maxRequests) || options.maxRequests < 1) {
      throw new Error('Checkout rate limit max requests is invalid.');
    }
    if (!Number.isSafeInteger(options.windowMs) || options.windowMs < 1) {
      throw new Error('Checkout rate limit window is invalid.');
    }
    if (!Number.isSafeInteger(options.maxKeys) || options.maxKeys < 1) {
      throw new Error('Checkout rate limit key bound is invalid.');
    }
    this.options = { ...options, nowMs: options.nowMs ?? Date.now };
  }

  consume(key: string): CheckoutRateLimitResult {
    const now = this.options.nowMs();
    if (!Number.isFinite(now) || now < 0) throw new Error('Checkout rate limit clock is invalid.');
    const boundedKey = rateLimitKey(key);
    this.removeExpired(now);
    const bucket = this.buckets.get(boundedKey);
    if (bucket === undefined) {
      if (this.buckets.size >= this.options.maxKeys) {
        const oldest = this.buckets.keys().next().value as string | undefined;
        if (oldest !== undefined) this.buckets.delete(oldest);
      }
      this.buckets.set(boundedKey, { count: 1, windowStartedAtMs: now });
      return { allowed: true };
    }
    if (bucket.count >= this.options.maxRequests) {
      return {
        allowed: false,
        retryAfterSeconds: Math.max(
          1,
          Math.ceil((bucket.windowStartedAtMs + this.options.windowMs - now) / 1000)
        ),
      };
    }
    bucket.count += 1;
    this.buckets.delete(boundedKey);
    this.buckets.set(boundedKey, bucket);
    return { allowed: true };
  }

  private removeExpired(now: number): void {
    for (const [key, bucket] of this.buckets) {
      if (bucket.windowStartedAtMs + this.options.windowMs <= now) this.buckets.delete(key);
    }
  }
}

function rateLimitKey(value: string): string {
  if (typeof value !== 'string' || value.length < 1 || value.length > 500) return 'unknown';
  return value;
}
