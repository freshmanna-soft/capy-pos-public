/**
 * Per-client rate limiting for the one route on this service that creates real
 * accounts for a caller who has proved nothing at all: `POST
 * /appid/customer/sign-up` (see `customer-signup.ts`).
 *
 * Epic #261 item 8c. It is deliberately a *module*, not a middleware layer:
 * `http.ts` takes it as one optional `rateLimit` hook, and only the sign-up
 * listener in `server.ts` passes one. `/appid/token` and `/appid/customer/token`
 * are left untouched — a till that stops taking payments because a shift's worth
 * of sign-ins tripped a shared counter is a worse outage than the one this file
 * exists to prevent, and `rate-limit.test.mjs` asserts through the real router
 * that neither token route is limited.
 *
 * ## Fixed window, not a token bucket, and not an npm package
 *
 * A **fixed window** keyed by client IP. This package is zero-dependency Node by
 * design (`package.json` has an empty `dependencies`, the suite is bare
 * `node --test`), so pulling `express-rate-limit` or similar would mean adopting
 * a dependency tree — and an Express-shaped middleware signature — for what is
 * two numbers per key.
 *
 * Fixed window over token bucket, of the two hand-rolled options:
 *
 * - Its state is an integer and a window start, both exact. A bucket needs a
 *   fractional level refilled against elapsed time, which is more arithmetic to
 *   get right for no behaviour this route wants.
 * - `Retry-After` falls out of it exactly — `windowStart + windowSeconds - now`
 *   is the real moment the caller is allowed again, so the header is a fact
 *   rather than an estimate. A bucket's answer ("when will one token have
 *   refilled") is a derived approximation.
 * - The burst behaviour a bucket buys (smoothing) is not something registration
 *   needs. A human registers once.
 *
 * The trade a fixed window makes is the boundary burst: up to `2 × limit`
 * requests can land across two adjacent windows. For account creation, at these
 * limits, that is an acceptable and bounded overshoot.
 *
 * ## The state is per-instance, and that is not a global guarantee
 *
 * The counters live in this process's memory. Code Engine scales this service to
 * multiple instances, so the effective ceiling is `instances × limit`, not
 * `limit`. That is honestly weaker than a shared limiter (Redis, or App ID's own
 * throttling) — it is a real limit and vastly better than none, but it must not
 * be described as a global one. A shared store is the follow-up if the numbers
 * ever justify the operational cost.
 *
 * ## The key, and why the *last* forwarded entry
 *
 * See `clientIp` — a rate-limit key an attacker can choose is not a rate limit.
 */
import type { IncomingMessage } from 'node:http';

/** Default clock, in whole seconds — the same seam and shape as `management-api.ts`. */
const defaultNow = (): number => Math.floor(Date.now() / 1000);

/** Requests one client IP may make to the limited route per window. */
export const DEFAULT_LIMIT = 5;

/** The window, in seconds. */
export const DEFAULT_WINDOW_SECONDS = 900;

/**
 * How many proxies this service sits behind — one, IBM Cloud Code Engine's own
 * ingress. Read by `clientIp` from the *right* of `X-Forwarded-For`.
 */
export const DEFAULT_TRUSTED_PROXY_HOPS = 1;

/**
 * Distinct keys held before expired ones are swept. A ceiling on this map's
 * memory, not a tuning knob: without it, a caller cycling source addresses could
 * grow it without bound, which turns a rate limiter into a memory leak.
 */
export const DEFAULT_MAX_KEYS = 10_000;

export interface RateLimitConfig {
  /** Requests allowed per window, per key. */
  readonly limit?: number;
  /** The window length, in seconds. */
  readonly windowSeconds?: number;
  /** Trusted proxy hops in front of this process. See `clientIp`. */
  readonly trustedProxyHops?: number;
  /** Sweep threshold for the key map. See `DEFAULT_MAX_KEYS`. */
  readonly maxKeys?: number;
}

export interface RateLimitDecision {
  /** Whether this request may proceed. */
  readonly allowed: boolean;
  /**
   * Whole seconds until the caller's window resets — the `Retry-After` value
   * verbatim. Always at least 1 when refused (a `Retry-After: 0` reads as
   * "immediately", which is exactly what was just refused), and 0 when allowed.
   */
  readonly retryAfterSeconds: number;
}

/** One key's window: when it opened, and how many requests have landed in it. */
interface Window {
  startedAt: number;
  count: number;
}

/**
 * The client IP to key on, taken from the **right-hand end** of
 * `X-Forwarded-For`, `trustedProxyHops` entries in.
 *
 * `req.socket.remoteAddress` is the Code Engine ingress, not the customer: every
 * request would share one bucket and the first five customers of the day would
 * lock everyone out. So the key has to come from a forwarded header — and which
 * end of it is read is the whole security property.
 *
 * `X-Forwarded-For` is append-only: each proxy adds the peer it saw to the right.
 * A caller may therefore *send* the header pre-populated with anything, and the
 * ingress appends the address it actually observed after it:
 *
 *     X-Forwarded-For: 203.0.113.9, <real client address>
 *      ^ attacker-chosen, rotated per request      ^ appended by Code Engine
 *
 * Reading the **leftmost** entry (the common `xff.split(',')[0]` idiom, and what
 * "the original client" usually means) would hand the attacker a fresh bucket on
 * every request — a rate limit they pick their own key for, i.e. no rate limit.
 * So this reads the entry the *trusted* hop wrote: the last one for a single
 * proxy. Anything to its left is caller-supplied and ignored.
 *
 * The cost of reading from the right is that a customer behind their own
 * forwarding proxy is keyed by that proxy rather than by themselves. That is the
 * correct direction to be wrong in: it over-groups (stricter), where trusting
 * the left would under-group into nothing at all.
 *
 * With no forwarded header — a direct caller, `npm start` on a laptop, `smoke.mjs`
 * — `remoteAddress` *is* the client, so it is the fallback. `unknown` only if
 * there is no socket address either, which keeps a bucket rather than opening a
 * hole.
 */
export function clientIp(req: IncomingMessage, trustedProxyHops = DEFAULT_TRUSTED_PROXY_HOPS): string {
  const raw = req.headers['x-forwarded-for'];
  const header = Array.isArray(raw) ? raw.join(',') : raw;
  const entries = (header ?? '')
    .split(',')
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);

  const hops = Math.max(1, Math.floor(trustedProxyHops));
  // Clamped, never wrapped: a header with fewer entries than the configured hop
  // count means something upstream changed, and the leftmost entry it does have
  // is still no more caller-controlled than the whole header already was.
  const fromRight = entries[Math.max(0, entries.length - hops)];

  return fromRight ?? req.socket.remoteAddress ?? 'unknown';
}

/**
 * Build the `rateLimit` hook `http.ts` takes. One limiter per limited route, so
 * two routes can never share a counter by accident.
 *
 * The clock is injected for the same reason `management-api.ts` injects it: the
 * suite proves the window resets by moving the clock, not by sleeping for it.
 */
export function createRateLimiter(
  config: RateLimitConfig = {},
  nowSeconds: () => number = defaultNow
): (req: IncomingMessage) => RateLimitDecision {
  const limit = config.limit ?? DEFAULT_LIMIT;
  const windowSeconds = config.windowSeconds ?? DEFAULT_WINDOW_SECONDS;
  const hops = config.trustedProxyHops ?? DEFAULT_TRUSTED_PROXY_HOPS;
  const maxKeys = config.maxKeys ?? DEFAULT_MAX_KEYS;
  const windows = new Map<string, Window>();

  return (req) => {
    const now = nowSeconds();
    const key = clientIp(req, hops);

    if (windows.size >= maxKeys) {
      sweepExpired(windows, now, windowSeconds);
    }

    const existing = windows.get(key);
    const current: Window =
      existing !== undefined && now - existing.startedAt < windowSeconds
        ? existing
        : { startedAt: now, count: 0 };

    current.count += 1;
    windows.set(key, current);

    if (current.count <= limit) {
      return { allowed: true, retryAfterSeconds: 0 };
    }

    const remaining = current.startedAt + windowSeconds - now;
    return { allowed: false, retryAfterSeconds: Math.max(1, remaining) };
  };
}

/**
 * Drop every window that has already elapsed. Called only when the map reaches
 * `maxKeys`, so the common path stays a single `Map` lookup — and a sweep that
 * frees nothing (every key active) simply leaves the map full, which is a bounded
 * map, not a leak.
 */
function sweepExpired(windows: Map<string, Window>, now: number, windowSeconds: number): void {
  for (const [key, window] of windows) {
    if (now - window.startedAt >= windowSeconds) {
      windows.delete(key);
    }
  }
}
