/**
 * End-to-end smoke test for the App ID token relay.
 *
 * Unlike the sibling proxies' smoke scripts, this one needs no minted session
 * token — this service's entire purpose is answering callers who do not have
 * one yet. What it does need is a real App ID staff account, so the last two
 * checks are opt-in: they run only when `SMOKE_APPID_USERNAME`/`_PASSWORD` are
 * set, so this script stays runnable (bounds-only) without spending an attempt
 * against the real tenant on every CI run.
 *
 *   APPID_REGION=… APPID_TENANT_ID=… APPID_CLIENT_ID=… APPID_CLIENT_SECRET=… \
 *   ALLOWED_ORIGINS=http://localhost:4200 npm start                # one terminal
 *
 *   SMOKE_APPID_USERNAME=… SMOKE_APPID_PASSWORD=… node smoke.mjs   # another
 */
const PORT = Number(process.env.PORT ?? 8792);
const BASE = `http://127.0.0.1:${PORT}`;
const URL = `${BASE}/appid/token`;
const CUSTOMER_URL = `${BASE}/appid/customer/token`;
const ORIGIN = (process.env.ALLOWED_ORIGINS ?? '').split(',')[0]?.trim() ?? 'http://localhost:4200';

async function post(body, { origin = ORIGIN, url = URL } = {}) {
  const started = Date.now();
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Origin: origin },
    body: JSON.stringify(body),
  });
  return { status: response.status, ms: Date.now() - started, body: await response.json() };
}

console.log('bounds:');

const preflight = await fetch(URL, {
  method: 'OPTIONS',
  headers: { Origin: ORIGIN, 'Access-Control-Request-Method': 'POST' },
});
console.log(`  preflight from allowed origin: HTTP ${preflight.status}`);

const wrongOrigin = await post({ grant_type: 'password', username: 'a', password: 'b' }, { origin: 'https://not-listed.example' });
console.log(`  unlisted origin: HTTP ${wrongOrigin.status} — ${JSON.stringify(wrongOrigin.body)}`);

const badGrant = await post({ grant_type: 'nonsense' });
console.log(`  unknown grant_type: HTTP ${badGrant.status} — ${JSON.stringify(badGrant.body)}`);

const missingPassword = await post({ grant_type: 'password', username: 'a' });
console.log(`  missing password: HTTP ${missingPassword.status} — ${JSON.stringify(missingPassword.body)}`);

const notJson = await fetch(URL, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', Origin: ORIGIN },
  body: 'not json',
});
console.log(`  non-JSON body: HTTP ${notJson.status}`);

// The route table (`routes.ts`), end to end: an unrouted path must get this
// service's own 404 rather than falling through to the token listener, and a
// path that merely *ends* with a real route is not that route.
for (const path of ['/nope', '/anything/appid/token']) {
  const unrouted = await fetch(`${BASE}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Origin: ORIGIN },
    body: JSON.stringify({ grant_type: 'password', username: 'a', password: 'b' }),
  });
  console.log(`  unrouted ${path}: HTTP ${unrouted.status} — ${JSON.stringify(await unrouted.json())}`);
}

// ─── The customer route, which is the same shape under a different client ──────
//
// Bounds only, and deliberately no real customer grant: this route exists to be
// exchanged under the *customer* App ID application, so a staff credential would
// tell us nothing about it. What is worth confirming without an account is that
// the route is routed at all (not a 404 from `routes.ts`), that it validates the
// same two grants as the staff route, and that a deployment missing
// `APPID_CUSTOMER_CLIENT_ID`/`_SECRET` answers a 502 rather than passing App ID's
// `invalid_client` back as if the person had typed the wrong password.

console.log('\ncustomer route bounds:');

const customerPreflight = await fetch(CUSTOMER_URL, {
  method: 'OPTIONS',
  headers: { Origin: ORIGIN, 'Access-Control-Request-Method': 'POST' },
});
console.log(`  preflight from allowed origin: HTTP ${customerPreflight.status}`);

const customerBadGrant = await post({ grant_type: 'nonsense' }, { url: CUSTOMER_URL });
console.log(`  unknown grant_type: HTTP ${customerBadGrant.status} — ${JSON.stringify(customerBadGrant.body)}`);

const customerWrongOrigin = await post(
  { grant_type: 'password', username: 'a', password: 'b' },
  { origin: 'https://not-listed.example', url: CUSTOMER_URL }
);
console.log(`  unlisted origin: HTTP ${customerWrongOrigin.status} — ${JSON.stringify(customerWrongOrigin.body)}`);

// 502 when the customer client is not deployed yet; a real App ID answer (400
// invalid_grant for this made-up account) once it is. Either is a pass — what
// would not be is a 404, or an `invalid_client` reaching the caller.
const customerGrant = await post(
  { grant_type: 'password', username: 'nobody@example.com', password: 'nope' },
  { url: CUSTOMER_URL }
);
console.log(`  password grant: HTTP ${customerGrant.status} — ${JSON.stringify(customerGrant.body)}`);

// ─── Then a real grant, if credentials were given ──────────────────────────────

const username = process.env.SMOKE_APPID_USERNAME ?? '';
const password = process.env.SMOKE_APPID_PASSWORD ?? '';

if (username.length === 0 || password.length === 0) {
  console.log('\nSMOKE_APPID_USERNAME/_PASSWORD not set — skipping the real App ID grant.');
} else {
  console.log(`\nreal grant for ${username}:`);
  const wrongPassword = await post({ grant_type: 'password', username, password: `${password}-wrong` });
  console.log(`  wrong password: HTTP ${wrongPassword.status} — ${JSON.stringify(wrongPassword.body)}`);

  const correct = await post({ grant_type: 'password', username, password });
  console.log(`  correct password: HTTP ${correct.status} in ${correct.ms}ms`);
  if (correct.status === 200 && typeof correct.body.access_token === 'string') {
    const payload = JSON.parse(Buffer.from(correct.body.access_token.split('.')[1], 'base64url').toString('utf8'));
    console.log(`  scope: ${payload.scope}`);

    const refreshed = await post({ grant_type: 'refresh_token', refresh_token: correct.body.refresh_token });
    console.log(`  refresh_token grant: HTTP ${refreshed.status} in ${refreshed.ms}ms`);
  }
}
