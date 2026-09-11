import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { corsHeaders, originAllowed, readAllowedOrigins } from './cors.ts';

const HERE = dirname(fileURLToPath(import.meta.url));

const ORIGINS = ['https://till.example.com', 'http://localhost:4200'];

describe('readAllowedOrigins', () => {
  it('parses a comma-separated list, the way Terraform joins frontend_origins', () => {
    assert.deepEqual(readAllowedOrigins('https://a.example.com,https://b.example.com'), [
      'https://a.example.com',
      'https://b.example.com',
    ]);
  });

  it('trims whitespace, strips trailing slashes and deduplicates', () => {
    assert.deepEqual(readAllowedOrigins(' https://a.example.com/ , https://a.example.com ,https://b.example.com//'), [
      'https://a.example.com',
      'https://b.example.com',
    ]);
  });

  it('returns an empty list for anything unusable, which is what makes server.ts refuse to start', () => {
    for (const raw of [undefined, null, '', '   ', ',', ' , , ']) {
      assert.deepEqual(readAllowedOrigins(raw), [], `expected [] for ${JSON.stringify(raw)}`);
    }
  });
});

describe('originAllowed', () => {
  it('admits an allow-listed origin, with or without a trailing slash', () => {
    assert.equal(originAllowed('https://till.example.com', ORIGINS), true);
    assert.equal(originAllowed('https://till.example.com/', ORIGINS), true);
  });

  it('admits a request with no Origin at all', () => {
    assert.equal(originAllowed(undefined, ORIGINS), true);
    assert.equal(originAllowed('', ORIGINS), true);
  });

  it('refuses an unlisted origin', () => {
    for (const origin of ['https://evil.example.com', 'http://till.example.com', 'https://till.example.com.evil.com']) {
      assert.equal(originAllowed(origin, ORIGINS), false, origin);
    }
  });

  it('refuses Origin: null rather than treating it as absent', () => {
    assert.equal(originAllowed('null', ORIGINS), false);
  });

  it('refuses everything when the allow-list is empty', () => {
    assert.equal(originAllowed('https://till.example.com', []), false);
  });
});

describe('corsHeaders', () => {
  it('echoes the allow-listed origin and varies on it', () => {
    const headers = corsHeaders('https://till.example.com', ORIGINS, 'POST, OPTIONS');
    assert.equal(headers['Access-Control-Allow-Origin'], 'https://till.example.com');
    assert.equal(headers['Vary'], 'Origin');
  });

  it('never answers a wildcard, for any input', () => {
    for (const origin of ['https://till.example.com', 'https://evil.example.com', undefined, '', 'null', '*']) {
      const headers = corsHeaders(origin, ORIGINS, 'POST, OPTIONS');
      assert.notEqual(headers['Access-Control-Allow-Origin'], '*', `wildcard for ${JSON.stringify(origin)}`);
    }
  });

  it('omits the allow header for an unlisted origin, so a browser refuses the reply', () => {
    const headers = corsHeaders('https://evil.example.com', ORIGINS, 'POST, OPTIONS');
    assert.equal('Access-Control-Allow-Origin' in headers, false);
  });

  it('exposes Retry-After, which a browser otherwise hides from the page', () => {
    // Not one of the seven CORS-safelisted *response* headers, so JS on an
    // allow-listed origin cannot read it without this — and the sign-up route's
    // 429 (`rate-limit.ts`) is the only status that carries one, whose entire
    // point is telling the customer when to try again. Sent on every response for
    // the same reason `Authorization` is allowed on every route.
    const headers = corsHeaders('https://till.example.com', ORIGINS, 'POST, OPTIONS');
    assert.equal(headers['Access-Control-Expose-Headers'], 'Retry-After');
  });

  it('advertises both Content-Type and Authorization allow-headers', () => {
    // The token route (`http.ts`) never sends Authorization; the admin
    // staff-management routes (`admin-http.ts`) always do. One shared
    // `corsHeaders` allowing both is simpler and harmless for the route that
    // doesn't need it — same convention as the sibling proxies' `session-guard.ts`.
    const headers = corsHeaders('https://till.example.com', ORIGINS, 'POST, OPTIONS');
    assert.equal(headers['Access-Control-Allow-Headers'], 'Content-Type, Authorization');
    assert.equal(headers['Access-Control-Allow-Methods'], 'POST, OPTIONS');
  });
});

/**
 * Epic #261 item 23: confirm the deployed allow-list covers whatever origin
 * `/self-checkout` is served from.
 *
 * It does, and the reason is structural rather than lucky: `/self-checkout` is a
 * route inside the same Angular app as `/pos` and `/clerk` (item 15 scaffolds it
 * as a sibling route, not a separately-deployed site), and an `Origin` header
 * carries scheme://host[:port] and never a path. So the browser on
 * `https://…/self-checkout` sends byte-for-byte the same `Origin` as the one on
 * `https://…/pos` — an origin that must already be listed for `/clerk` to work
 * today. Adding an SPA route can therefore never need a new allow-list entry.
 *
 * Verified against the live relay while writing this (`OPTIONS
 * /appid/customer/token`): both origins below were echoed back in
 * `Access-Control-Allow-Origin`, an unlisted one got no allow header at all.
 * These assertions are what keep that true — the two ways it could quietly stop
 * being true are an entry growing a path (`https://host/self-checkout`), which
 * would then match no `Origin` at all, and the real frontends dropping out of
 * the list Terraform joins into `ALLOWED_ORIGINS`.
 */
describe('the deployed allow-list, against every route of the SPA', () => {
  // Terraform's `frontend_origins` default is the deployed estate's value —
  // `local.allowed_origins` in main.tf is just this list comma-joined, which is
  // exactly what `readAllowedOrigins` parses back out at boot.
  const variables = readFileSync(join(HERE, '..', '..', '..', 'terraform', 'variables.tf'), 'utf8');
  const block = variables.match(/variable "frontend_origins"[\s\S]*?\n\}\n/)?.[0];
  const declared = [...(block ?? '').matchAll(/"(https?:\/\/[^"]+)"/g)].map(([, origin]) => origin);
  const origins = readAllowedOrigins(declared.join(','));

  it('parses back out of the value Terraform joins, with both real frontends intact', () => {
    assert.ok(block, 'terraform/variables.tf declares no frontend_origins variable');
    assert.deepEqual(origins, [
      'https://freshmanna-soft.github.io',
      'https://capy-pos-app.2e2tmn0h4vl7.us-south.codeengine.appdomain.cloud',
    ]);
  });

  it('lists origins only, which is what makes a new SPA route a no-op here', () => {
    for (const origin of declared) {
      assert.match(
        origin,
        /^https?:\/\/[^/]+$/,
        `${origin} carries a path — an Origin header never does, so it would match nothing`
      );
    }
  });

  it('admits the Origin a browser on /self-checkout sends, from either frontend', () => {
    // One case per frontend, spelled out as the header the browser actually
    // sends from each of these routes: no path, so all four are one value.
    for (const origin of origins) {
      for (const route of ['/self-checkout', '/pos', '/clerk', '/']) {
        assert.equal(
          originAllowed(origin, origins),
          true,
          `${origin} refused for a browser on ${route}`
        );
        assert.equal(corsHeaders(origin, origins, 'POST, OPTIONS')['Access-Control-Allow-Origin'], origin);
      }
    }
  });

  it('still refuses an origin that only looks like a frontend, path or not', () => {
    for (const origin of [
      'https://freshmanna-soft.github.io.evil.com',
      'http://freshmanna-soft.github.io',
      'https://capy-pos-app.2e2tmn0h4vl7.us-south.codeengine.appdomain.cloud.evil.com',
    ]) {
      assert.equal(originAllowed(origin, origins), false, origin);
    }
  });
});
