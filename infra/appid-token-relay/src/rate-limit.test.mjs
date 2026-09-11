/**
 * The suite for `rate-limit.ts` — epic #261 item 8c.
 *
 * Three parts, because the module has three separable risks:
 *
 * 1. **The key.** `clientIp` unit cases, including the one that matters most: a
 *    caller who sends their own `X-Forwarded-For` must not get their own bucket.
 *    A rate limit keyed on a value the caller picks is not a rate limit, so that
 *    is asserted directly rather than inferred from the counting behaviour.
 * 2. **The behaviour**, over real sockets and through the real router, in the
 *    same shape as `http.test.mjs` and `routes.test.mjs`: under the limit
 *    succeeds, over it gets a 429 carrying `Retry-After`, the window resets, two
 *    IPs are independent, and — the case the issue calls out explicitly — neither
 *    `/appid/token` nor `/appid/customer/token` is limited at all.
 * 3. **The map.** `maxKeys` is a ceiling, so the held-key count is asserted
 *    directly through the limiter's own `size` seam rather than inferred from
 *    counting behaviour — a cap that is only documented is not a cap, and the
 *    behaviour alone cannot tell the two apart.
 *
 * The clock is injected through `createRateLimiter`'s `nowSeconds` seam (the same
 * one `management-api.ts` takes), so "the window resets" is proved by moving time
 * rather than by a 900-second sleep.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createServer, request as httpRequest } from 'node:http';
import { createRateLimiter, clientIp, DEFAULT_TRUSTED_PROXY_HOPS } from './rate-limit.ts';
import { createRequestListener, ALLOWED_METHODS } from './http.ts';
import { createRouter } from './routes.ts';

const ALLOWED = 'https://till.example.com';
const ORIGINS = [ALLOWED];
const SIGNUP_ROUTE = '/appid/customer/sign-up';
const TOKEN_ROUTE = '/appid/token';
const CUSTOMER_TOKEN_ROUTE = '/appid/customer/token';
const LIMIT = 3;
const WINDOW = 900;

/** A fake `IncomingMessage`, only as much of one as `clientIp` reads. */
const fakeRequest = (headers, remoteAddress = '10.0.0.1') => ({
  headers,
  socket: { remoteAddress },
});

describe('clientIp — which forwarded entry is trusted', () => {
  it('takes the last X-Forwarded-For entry, the one the trusted proxy appended', () => {
    // `203.0.113.9` is whatever the caller sent; `198.51.100.7` is what Code
    // Engine's ingress actually observed and appended.
    assert.equal(
      clientIp(fakeRequest({ 'x-forwarded-for': '203.0.113.9, 198.51.100.7' })),
      '198.51.100.7'
    );
  });

  it('ignores a spoofed left-hand entry, so a caller cannot rotate their own bucket', () => {
    const first = clientIp(fakeRequest({ 'x-forwarded-for': 'attacker-picked-1, 198.51.100.7' }));
    const second = clientIp(fakeRequest({ 'x-forwarded-for': 'attacker-picked-2, 198.51.100.7' }));
    // Same key both times: the two requests share one bucket, which is the whole
    // point — reading `[0]` here would have produced two.
    assert.equal(first, second);
    assert.equal(first, '198.51.100.7');
  });

  it('falls back to the socket address when nothing is forwarded (laptop, smoke.mjs)', () => {
    assert.equal(clientIp(fakeRequest({}, '127.0.0.1')), '127.0.0.1');
  });

  it('keys on "unknown" rather than opening a hole when there is no address at all', () => {
    // Not `fakeRequest`: its default would fill the address back in, and the case
    // under test is a socket that reports none.
    assert.equal(clientIp({ headers: {}, socket: {} }), 'unknown');
  });

  it('joins a repeated header before reading it from the right', () => {
    assert.equal(
      clientIp(fakeRequest({ 'x-forwarded-for': ['203.0.113.9', '198.51.100.7'] })),
      '198.51.100.7'
    );
  });

  it('reads further left for a deployment with more trusted hops', () => {
    assert.equal(
      clientIp(fakeRequest({ 'x-forwarded-for': 'spoofed, 198.51.100.7, 10.1.1.1' }), 2),
      '198.51.100.7'
    );
  });

  it('clamps rather than wrapping when there are fewer entries than hops', () => {
    assert.equal(clientIp(fakeRequest({ 'x-forwarded-for': '198.51.100.7' }), 3), '198.51.100.7');
    assert.equal(DEFAULT_TRUSTED_PROXY_HOPS, 1);
  });
});

/**
 * The whole service's dispatch, with the limiter on sign-up only — the same
 * asymmetry `server.ts` declares, so the "not the token routes" assertions below
 * exercise the real router rather than a hand-rolled stand-in.
 */
async function withRoutedServer(run) {
  let now = 1_000_000;
  const handled = { [SIGNUP_ROUTE]: 0, [TOKEN_ROUTE]: 0, [CUSTOMER_TOKEN_ROUTE]: 0 };

  const boundary = (route, extra = {}) =>
    createRequestListener({
      logPrefix: '[test]',
      route,
      origins: ORIGINS,
      maxBodyBytes: 2048,
      validate: (body) => (typeof body === 'object' && body !== null ? body : { error: 'bad body' }),
      handle: async () => {
        handled[route] += 1;
        return { status: 201, body: { ok: true } };
      },
      unavailable: 'unavailable',
      ...extra,
    });

  const listener = createRouter({
    origins: ORIGINS,
    routes: [
      { match: 'exact', path: TOKEN_ROUTE, methods: ALLOWED_METHODS, listener: boundary(TOKEN_ROUTE) },
      {
        match: 'exact',
        path: CUSTOMER_TOKEN_ROUTE,
        methods: ALLOWED_METHODS,
        listener: boundary(CUSTOMER_TOKEN_ROUTE),
      },
      {
        match: 'exact',
        path: SIGNUP_ROUTE,
        methods: ALLOWED_METHODS,
        listener: boundary(SIGNUP_ROUTE, {
          rateLimit: createRateLimiter({ limit: LIMIT, windowSeconds: WINDOW }, () => now),
          tooManyRequests: 'Too many sign-up attempts. Please try again later.',
        }),
      },
    ],
  });

  const server = createServer(listener);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address();

  try {
    return await run({
      port,
      handled,
      advance: (seconds) => {
        now += seconds;
      },
    });
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
}

/** One POST, as a customer's browser sends it through the Code Engine ingress. */
function post(port, { path = SIGNUP_ROUTE, ip = '198.51.100.7', xff, body } = {}) {
  const headers = {
    Origin: ALLOWED,
    'Content-Type': 'application/json',
    'X-Forwarded-For': xff ?? ip,
  };
  return new Promise((resolve, reject) => {
    const req = httpRequest({ host: '127.0.0.1', port, method: 'POST', path, headers }, (res) => {
      const received = [];
      res.on('data', (chunk) => received.push(chunk));
      res.on('end', () => {
        const text = Buffer.concat(received).toString('utf8');
        let json;
        try {
          json = JSON.parse(text);
        } catch {
          json = undefined;
        }
        resolve({ status: res.statusCode, headers: res.headers, json });
      });
    });
    req.on('error', reject);
    req.end(JSON.stringify(body ?? { email: 'customer@example.com', password: 'Sup3rSecret!' }));
  });
}

describe('the limiter, over a socket, on the sign-up route', () => {
  it('serves every request up to the limit', async () => {
    await withRoutedServer(async ({ port, handled }) => {
      for (let attempt = 0; attempt < LIMIT; attempt += 1) {
        const response = await post(port);
        assert.equal(response.status, 201, `attempt ${attempt + 1} should be served`);
      }
      assert.equal(handled[SIGNUP_ROUTE], LIMIT);
    });
  });

  it('answers 429 with Retry-After once the limit is exceeded, without reaching the handler', async () => {
    await withRoutedServer(async ({ port, handled }) => {
      for (let attempt = 0; attempt < LIMIT; attempt += 1) {
        await post(port);
      }

      const refused = await post(port);
      assert.equal(refused.status, 429);
      assert.equal(refused.headers['retry-after'], String(WINDOW));
      // Present is not the same as readable: `Retry-After` is not a CORS-safelisted
      // response header, so without both of these the self-checkout page gets a 429
      // it cannot say "try again in N minutes" about. See `cors.ts`.
      assert.equal(refused.headers['access-control-expose-headers'], 'Retry-After');
      assert.equal(refused.headers['access-control-allow-origin'], ALLOWED);
      // The App ID Management API was never touched — no account, no attempt.
      assert.equal(handled[SIGNUP_ROUTE], LIMIT);
    });
  });

  it('says nothing in the 429 body about the email, so it cannot be used to enumerate accounts', async () => {
    // #253's property: the answer must be the same whichever address is tried,
    // and must not hint at whether that address already has an account. The
    // decision is taken before the body is parsed, so it cannot depend on it.
    await withRoutedServer(async ({ port }) => {
      for (let attempt = 0; attempt < LIMIT; attempt += 1) {
        await post(port);
      }

      const existing = await post(port, { body: { email: 'already@example.com', password: 'Sup3rSecret!' } });
      const fresh = await post(port, { body: { email: 'brand-new@example.com', password: 'Sup3rSecret!' } });

      assert.deepEqual(existing.json, { error: 'Too many sign-up attempts. Please try again later.' });
      assert.deepEqual(fresh.json, existing.json);
      assert.equal(fresh.status, existing.status);
      const body = JSON.stringify(existing.json);
      assert.ok(!body.includes('already@example.com'), 'the 429 body must not echo the address');
      assert.ok(!/exist/i.test(body), 'the 429 body must not mention an account existing');
    });
  });

  it('counts down a Retry-After that shrinks as the window elapses', async () => {
    await withRoutedServer(async ({ port, advance }) => {
      for (let attempt = 0; attempt < LIMIT; attempt += 1) {
        await post(port);
      }
      advance(300);

      const refused = await post(port);
      assert.equal(refused.status, 429);
      assert.equal(refused.headers['retry-after'], String(WINDOW - 300));
    });
  });

  it('never advertises Retry-After: 0, which would read as "retry immediately"', async () => {
    await withRoutedServer(async ({ port, advance }) => {
      for (let attempt = 0; attempt < LIMIT; attempt += 1) {
        await post(port);
      }
      // The last second of the window: the window has not reset yet, so this is
      // still refused, and the honest remaining time rounds to zero.
      advance(WINDOW - 1);

      const refused = await post(port);
      assert.equal(refused.status, 429);
      assert.equal(refused.headers['retry-after'], '1');
    });
  });

  it('resets when the window elapses — proved by moving the clock, not by sleeping', async () => {
    await withRoutedServer(async ({ port, handled, advance }) => {
      for (let attempt = 0; attempt < LIMIT; attempt += 1) {
        await post(port);
      }
      assert.equal((await post(port)).status, 429);

      advance(WINDOW);

      const afterReset = await post(port);
      assert.equal(afterReset.status, 201);
      assert.equal(handled[SIGNUP_ROUTE], LIMIT + 1);
    });
  });

  it('gives two different client IPs independent buckets', async () => {
    await withRoutedServer(async ({ port }) => {
      for (let attempt = 0; attempt < LIMIT; attempt += 1) {
        assert.equal((await post(port, { ip: '198.51.100.7' })).status, 201);
      }
      assert.equal((await post(port, { ip: '198.51.100.7' })).status, 429);

      // A second customer, unaffected by the first one's exhausted window.
      assert.equal((await post(port, { ip: '203.0.113.4' })).status, 201);
    });
  });

  it('does not let a caller escape their bucket by prepending a forged X-Forwarded-For entry', async () => {
    await withRoutedServer(async ({ port }) => {
      // Each request arrives with a different attacker-chosen left-hand entry;
      // the ingress-appended right-hand one is the same address every time.
      for (let attempt = 0; attempt < LIMIT; attempt += 1) {
        const response = await post(port, { xff: `10.9.9.${attempt}, 198.51.100.7` });
        assert.equal(response.status, 201);
      }

      const refused = await post(port, { xff: '10.9.9.99, 198.51.100.7' });
      assert.equal(refused.status, 429, 'a forged left-hand entry must not buy a fresh bucket');
    });
  });

  it(
    'answers a refused caller who is still uploading an oversized body',
    { timeout: 15_000 },
    async () => {
      // The 429 is decided before the body is read, so a refused caller can be
      // mid-upload when the reply is written. Node's server discards the unread
      // body once the response finishes; a body far larger than any socket buffer
      // proves that rather than leaving it assumed — the ad-hoc `req.resume()`
      // this path used to carry was answering a question nobody had measured.
      // `http.test.mjs` posts the same body at the 403 and the 404.
      await withRoutedServer(async ({ port, handled }) => {
        const pad = 'x'.repeat(4 * 1024 * 1024);
        for (let attempt = 0; attempt < LIMIT; attempt += 1) {
          await post(port);
        }

        const refused = await post(port, {
          body: { email: 'customer@example.com', password: 'Sup3rSecret!', pad },
        });
        assert.equal(refused.status, 429);
        assert.equal(refused.headers['retry-after'], String(WINDOW));
        assert.equal(handled[SIGNUP_ROUTE], LIMIT);
      });
    }
  );
});

describe('the limiter is scoped to sign-up and nothing else', () => {
  it('never limits POST /appid/token, however many times a till signs in', async () => {
    await withRoutedServer(async ({ port, handled }) => {
      for (let attempt = 0; attempt < LIMIT * 3; attempt += 1) {
        const response = await post(port, { path: TOKEN_ROUTE });
        assert.equal(response.status, 201, `staff sign-in ${attempt + 1} must not be limited`);
        assert.equal(response.headers['retry-after'], undefined);
      }
      assert.equal(handled[TOKEN_ROUTE], LIMIT * 3);
    });
  });

  it('never limits POST /appid/customer/token', async () => {
    await withRoutedServer(async ({ port, handled }) => {
      for (let attempt = 0; attempt < LIMIT * 3; attempt += 1) {
        const response = await post(port, { path: CUSTOMER_TOKEN_ROUTE });
        assert.equal(response.status, 201, `customer sign-in ${attempt + 1} must not be limited`);
        assert.equal(response.headers['retry-after'], undefined);
      }
      assert.equal(handled[CUSTOMER_TOKEN_ROUTE], LIMIT * 3);
    });
  });

  it('keeps the token routes serving after sign-up has been exhausted for that IP', async () => {
    // The failure this guards against is a shared counter: a shift's worth of
    // sign-ups must never be able to stop a till taking payments.
    await withRoutedServer(async ({ port }) => {
      for (let attempt = 0; attempt < LIMIT + 1; attempt += 1) {
        await post(port);
      }
      assert.equal((await post(port)).status, 429);

      assert.equal((await post(port, { path: TOKEN_ROUTE })).status, 201);
      assert.equal((await post(port, { path: CUSTOMER_TOKEN_ROUTE })).status, 201);
    });
  });
});

describe('the counters as a bounded map', () => {
  it('sweeps elapsed windows, so a caller who rotated addresses is forgotten', () => {
    let now = 0;
    const limiter = createRateLimiter({ limit: 1, windowSeconds: 60, maxKeys: 8 }, () => now);

    for (let index = 0; index < 8; index += 1) {
      limiter(fakeRequest({ 'x-forwarded-for': `198.51.100.${index}` }));
    }
    assert.equal(limiter.size(), 8);
    now += 60;

    // The next insertion sweeps all eight elapsed windows before adding its own —
    // and the caller whose window elapsed gets a fresh one, which is the same
    // thing seen from the other side.
    const afterSweep = limiter(fakeRequest({ 'x-forwarded-for': '198.51.100.0' }));
    assert.deepEqual(afterSweep, { allowed: true, retryAfterSeconds: 0 });
    assert.equal(limiter.size(), 1);
  });

  it('never holds more than maxKeys windows, however many live keys arrive', () => {
    // The regression this exists for: sweeping frees nothing while every window is
    // live, so a ceiling enforced only by sweeping is not a ceiling. With
    // `maxKeys: 10`, 5000 distinct in-window addresses used to leave 5000 windows
    // resident — a limiter that is itself the memory-growth path, and an O(n) scan
    // on every request with n still climbing.
    let now = 0;
    const limiter = createRateLimiter({ limit: 1, windowSeconds: 900, maxKeys: 10 }, () => now);

    for (let index = 0; index < 5000; index += 1) {
      limiter(fakeRequest({ 'x-forwarded-for': `10.${Math.floor(index / 256)}.${index % 256}.1` }));
      assert.ok(limiter.size() <= 10, `held ${limiter.size()} windows after ${index + 1} distinct keys`);
    }
    assert.equal(limiter.size(), 10);
  });

  it('still refuses an active key while the map has room for it', () => {
    let now = 0;
    const limiter = createRateLimiter({ limit: 1, windowSeconds: 60, maxKeys: 4 }, () => now);

    assert.equal(limiter(fakeRequest({ 'x-forwarded-for': '198.51.100.1' })).allowed, true);
    assert.equal(limiter(fakeRequest({ 'x-forwarded-for': '198.51.100.2' })).allowed, true);
    // Nothing to sweep and nothing to evict: the limit is untouched by the cap.
    assert.equal(limiter(fakeRequest({ 'x-forwarded-for': '198.51.100.1' })).allowed, false);
    assert.equal(limiter.size(), 2);
  });

  it('evicts a live window only to stay under the ceiling, and only ever loosens it', () => {
    // The cost of a hard ceiling, asserted rather than left implied. It takes
    // `maxKeys` distinct addresses inside one window to provoke, and a caller with
    // that many already had a fresh window per address without evicting anyone —
    // so what eviction hands out is a looser limit for the address dropped, never
    // a refusal for it.
    let now = 0;
    const limiter = createRateLimiter({ limit: 1, windowSeconds: 60, maxKeys: 2 }, () => now);

    limiter(fakeRequest({ 'x-forwarded-for': '198.51.100.1' })); // window opens, limit spent
    limiter(fakeRequest({ 'x-forwarded-for': '198.51.100.2' })); // window opens, limit spent
    limiter(fakeRequest({ 'x-forwarded-for': '198.51.100.3' })); // no room: `.1` is evicted
    assert.equal(limiter.size(), 2);

    assert.equal(
      limiter(fakeRequest({ 'x-forwarded-for': '198.51.100.2' })).allowed,
      false,
      '.2 was still held, so its exhausted window still refuses'
    );
    assert.equal(
      limiter(fakeRequest({ 'x-forwarded-for': '198.51.100.1' })).allowed,
      true,
      '.1 was evicted, so it starts a fresh window — loosened, never locked out'
    );
  });

  it('evicts the oldest live window, not the one most recently opened', () => {
    // What `makeRoom`'s second step means in practice, and the ordering invariant
    // it leans on: the front of the map is the oldest window *start*, not the
    // longest-known key. `.1` opens a second window at t=70, so it is younger than
    // `.2`'s and `.2` is what makes room for `.3`. Evicting from the back instead
    // would drop the window that had just opened and keep the one about to reset
    // by itself — forfeiting nearly a full window of limiting for nothing.
    let now = 0;
    const limiter = createRateLimiter({ limit: 1, windowSeconds: 60, maxKeys: 2 }, () => now);

    limiter(fakeRequest({ 'x-forwarded-for': '198.51.100.1' })); // window opens at t=0
    now = 30;
    limiter(fakeRequest({ 'x-forwarded-for': '198.51.100.2' })); // window opens at t=30
    now = 70;
    // `.1`'s window has elapsed, so this opens a new one at t=70, behind `.2`'s.
    assert.equal(limiter(fakeRequest({ 'x-forwarded-for': '198.51.100.1' })).allowed, true);

    // A third address needs room, and `.2` (t=30) is the oldest live window.
    limiter(fakeRequest({ 'x-forwarded-for': '198.51.100.3' }));
    assert.equal(limiter.size(), 2);
    assert.equal(
      limiter(fakeRequest({ 'x-forwarded-for': '198.51.100.1' })).allowed,
      false,
      '.1 kept the window it had just opened'
    );
  });
});
