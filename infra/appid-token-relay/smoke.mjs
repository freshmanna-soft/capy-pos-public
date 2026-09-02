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
const PORT = Number(process.env.PORT ?? 8790);
const URL = `http://127.0.0.1:${PORT}/appid/token`;
const ORIGIN = (process.env.ALLOWED_ORIGINS ?? '').split(',')[0]?.trim() ?? 'http://localhost:4200';

async function post(body, { origin = ORIGIN } = {}) {
  const started = Date.now();
  const response = await fetch(URL, {
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
