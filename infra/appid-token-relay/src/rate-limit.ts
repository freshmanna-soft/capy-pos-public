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
 * ## The key map is bounded by eviction, and that costs something
 *
 * `maxKeys` is a hard ceiling on the number of windows held, enforced on every
 * insertion — not a sweep threshold that a map full of *live* windows sails
 * straight past. Elapsed windows go first because losing one costs nothing; only
 * if that frees no room is the oldest live window evicted.
 *
 * Evicting a live window loses real limiting, so it is worth being exact about
 * what that trade is. It takes `maxKeys` distinct addresses inside one window to
 * reach, and a caller who has that many already had a strictly better attack:
 * every fresh address gets a fresh window anyway, without evicting anybody. What
 * eviction does to whoever is dropped is *loosen* their limit — never refuse
 * them — which is the right direction: the other way to hold a ceiling is to
 * refuse every new key while the map is full, and that hands the same attacker a
 * way to stop real customers registering at all. The alternative to both is an
 * unbounded map, i.e. the limiter becoming the resource-exhaustion path it exists
 * to close.
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
 * The hard ceiling on how many windows are held at once — see `makeRoom`, which
 * enforces it on every insertion. A caller cycling source addresses therefore
 * cannot grow this map at all, which is what would turn a rate limiter into the
 * memory leak it exists to prevent. At this size the map is a few hundred
 * kilobytes of short strings and two-field objects, and the bound doubles as a
 * bound on the sweep: nothing in here can ever walk more entries than this.
 */
export const DEFAULT_MAX_KEYS = 10_000;

export interface RateLimitConfig {
  /** Requests allowed per window, per key. */
  readonly limit?: number;
  /** The window length, in seconds. */
  readonly windowSeconds?: number;
  /** Trusted proxy hops in front of this process. See `clientIp`. */
  readonly trustedProxyHops?: number;
  /** Hard ceiling on held keys. See `DEFAULT_MAX_KEYS`. */
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
 * The hook `http.ts` takes, with one introspection seam on it.
 *
 * Callable, so `http.ts` keeps taking a plain function and never learns anything
 * about this module. `size` is here because `maxKeys` is an invariant and not a
 * hint: `rate-limit.test.mjs` asserts the held-key count directly rather than
 * inferring it from counting behaviour, which is how a ceiling can be documented,
 * commented and unenforced without one test failing.
 */
export interface RateLimiter {
  (req: IncomingMessage): RateLimitDecision;
  /** Windows held right now. Never more than the configured `maxKeys`. */
  readonly size: () => number;
}

/**
 * Build the `rateLimit` hook `http.ts` takes. One limiter per limited route, so
 * two routes can never share a counter by accident.
 *
 * The clock is injected for the same reason `management-api.ts` injects it: the
 * suite proves the window resets by moving the clock, not by sleeping for it.
 *
 * ## The ordering invariant the map carries
 *
 * A `Map` iterates in insertion order, and a window is only ever *inserted* when
 * it starts — a key whose window elapsed is deleted before its replacement is
 * set, rather than overwritten in place. So the map stays ordered by window
 * start, oldest first, and two things fall out of that: `makeRoom` can stop
 * sweeping at the first live window instead of walking the whole map, and the
 * front of the map is the cheapest entry to evict.
 *
 * A clock that jumped backwards would cost some sweeping (the scan stops early)
 * and nothing else — the ceiling is held by `makeRoom` on size alone.
 */
export function createRateLimiter(
  config: RateLimitConfig = {},
  nowSeconds: () => number = defaultNow
): RateLimiter {
  const limit = config.limit ?? DEFAULT_LIMIT;
  const windowSeconds = config.windowSeconds ?? DEFAULT_WINDOW_SECONDS;
  const hops = config.trustedProxyHops ?? DEFAULT_TRUSTED_PROXY_HOPS;
  const maxKeys = Math.max(1, Math.floor(config.maxKeys ?? DEFAULT_MAX_KEYS));
  const windows = new Map<string, Window>();

  const limiter = (req: IncomingMessage): RateLimitDecision => {
    const now = nowSeconds();
    const key = clientIp(req, hops);

    const existing = windows.get(key);
    if (existing !== undefined && now - existing.startedAt < windowSeconds) {
      // The common path, and the only one a caller inside their window takes: one
      // `Map` lookup and an increment. No scan, no insertion, so nothing here can
      // grow the map or walk it.
      existing.count += 1;
      return decide(existing, now, limit, windowSeconds);
    }

    // A window is starting — either this key is new, or its previous one elapsed.
    // Deleted before being re-inserted, rather than overwritten in place, so the
    // new window lands at the *end* of the map and iteration order stays equal to
    // window-start order. `makeRoom`'s sweep below would normally have removed the
    // elapsed entry as part of the prefix anyway; doing it here as well is what
    // makes the ordering hold without depending on the sweep having reached it —
    // e.g. after a clock step backwards, when the prefix scan stops early.
    windows.delete(key);
    makeRoom(windows, now, windowSeconds, maxKeys);

    const started: Window = { startedAt: now, count: 1 };
    windows.set(key, started);
    return decide(started, now, limit, windowSeconds);
  };

  return Object.assign(limiter, { size: () => windows.size });
}

/** The verdict for a window that has just counted the request in hand. */
function decide(window: Window, now: number, limit: number, windowSeconds: number): RateLimitDecision {
  if (window.count <= limit) {
    return { allowed: true, retryAfterSeconds: 0 };
  }
  return { allowed: false, retryAfterSeconds: Math.max(1, window.startedAt + windowSeconds - now) };
}

/**
 * Bring the map below `maxKeys` so one more window fits. Called only on
 * insertion, because insertion is the only thing that can grow it.
 *
 * Two steps, in this order because only the second one forfeits anything:
 *
 * 1. **Sweep the elapsed prefix.** Elapsed windows are exactly the front of the
 *    map (see `createRateLimiter`'s ordering note), so this stops at the first
 *    live one: the cost is the number of entries actually freed, not the size of
 *    the map. Losing an elapsed window costs nothing — the next request from that
 *    key would have opened a fresh one regardless.
 * 2. **Evict the oldest live window**, repeatedly, until there is room. The front
 *    of the map is the live window closest to resetting on its own, so it is the
 *    entry whose eviction forfeits the least limiting. Why evicting at all is the
 *    least-bad of the three available behaviours is argued in this file's header.
 *
 * Both steps are bounded by `maxKeys`, so no request can trigger a scan that
 * grows with traffic — which is the other half of the ceiling's job.
 */
function makeRoom(windows: Map<string, Window>, now: number, windowSeconds: number, maxKeys: number): void {
  for (const [key, window] of windows) {
    if (now - window.startedAt < windowSeconds) {
      break;
    }
    windows.delete(key);
  }

  while (windows.size >= maxKeys) {
    const oldest = windows.keys().next();
    if (oldest.done === true) {
      break;
    }
    windows.delete(oldest.value);
  }
}
