import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { corsHeaders, originAllowed, readAllowedOrigins } from './cors.ts';

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

  it('does not advertise an Authorization allow-header — this service has no bearer auth to preflight', () => {
    // The sibling proxies' corsHeaders allows Authorization because a token must
    // survive their preflight. This service has no token yet on any call it serves.
    const headers = corsHeaders('https://till.example.com', ORIGINS, 'POST, OPTIONS');
    assert.equal(headers['Access-Control-Allow-Headers'], 'Content-Type');
    assert.equal(headers['Access-Control-Allow-Methods'], 'POST, OPTIONS');
  });
});
