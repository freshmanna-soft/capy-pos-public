// Polyfill WebCrypto for the jsdom test environment — jose's RS256 verification
// needs crypto.subtle, which jsdom doesn't wire up automatically.
import { webcrypto } from 'node:crypto';
if (typeof globalThis.crypto === 'undefined' || typeof globalThis.crypto.subtle === 'undefined') {
  Object.defineProperty(globalThis, 'crypto', {
    value: webcrypto,
    writable: false,
    configurable: true,
  });
}

import { TestBed } from '@angular/core/testing';
import { describe, it, expect, beforeEach, afterEach, beforeAll, vi } from 'vitest';
import { SignJWT, exportJWK, generateKeyPair, type JWK } from 'jose';
import {
  AppIdAuthAdapter,
  APPID_CONFIG,
  AppIdAuthError,
  type AppIdConfig,
} from './appid-auth.adapter';
import { InvalidCredentialsError } from './local-credential-auth.adapter';
import { DEFAULT_TENANT_ID } from '@core/infrastructure/database/dexie-database.service';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const REGION = 'us-south';
const TENANT_ID = 'ee0c0740-5252-48a4-9b7c-e2b60712256e';
const CLIENT_ID = '6a92b580-1e10-4b09-ba3d-854f9fa774a5';
const RELAY_URL = 'https://relay.test/appid/token';

const ISSUER = `https://${REGION}.appid.cloud.ibm.com/oauth/v4/${TENANT_ID}`;
const JWKS_URI = `${ISSUER}/publickeys`;
const KID = 'test-signing-key';

const BASE_CONFIG: AppIdConfig = {
  enabled: true,
  region: REGION,
  tenantId: TENANT_ID,
  staffClientId: CLIENT_ID,
  customerClientId: '',
  relayUrl: RELAY_URL,
};

// Signing key material — generated once for the whole suite.
let privateKey: CryptoKey;
let publicJwk: JWK;

beforeAll(async () => {
  const pair = await generateKeyPair('RS256', { extractable: true });
  privateKey = pair.privateKey;
  publicJwk = { ...(await exportJWK(pair.publicKey)), kid: KID, alg: 'RS256', use: 'sig' };
});

interface MintOptions {
  issuer?: string;
  audience?: string[];
  /** Space-separated, exactly as App ID's real `scope` claim is shaped. */
  scope?: string;
  sub?: string;
  expiresInSec?: number;
  kid?: string;
}

/**
 * Mints a token shaped like the real one decoded during Phase 0's bootstrap:
 * `aud` as an array, `scope` as one space-separated string mixing App ID's
 * own framework scopes with ours.
 */
async function mintAccessToken(opts: MintOptions = {}): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  return new SignJWT({
    scope: opts.scope ?? 'openid appid_default appid_authenticated admin',
    email_verified: true,
    tenant: TENANT_ID, // App ID's own instance id — deliberately NOT Capy-POS's tenantId
  })
    .setProtectedHeader({ alg: 'RS256', kid: opts.kid ?? KID })
    .setIssuedAt(now)
    .setIssuer(opts.issuer ?? ISSUER)
    .setAudience(opts.audience ?? [CLIENT_ID])
    .setSubject(opts.sub ?? 'op-123')
    .setExpirationTime(now + (opts.expiresInSec ?? 3600))
    .sign(privateKey);
}

function jsonResponse(body: unknown, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  } as Response;
}

/**
 * Simulates IBM App ID's real, observed JWKS encoding defect: prepend a
 * non-minimal zero byte to a base64url-encoded unsigned integer. The
 * integer's *value* is identical either way — only its encoding changes —
 * which is exactly why `resolveSigningKey`'s fix (stripping it back off) can
 * still verify a real signature from the same key.
 */
function prependZeroByte(base64Url: string): string {
  const base64 = base64Url.replace(/-/g, '+').replace(/_/g, '/');
  const padded = base64 + '='.repeat((4 - (base64.length % 4)) % 4);
  const bytes = Uint8Array.from(atob(padded), (c) => c.charCodeAt(0));
  const withZero = new Uint8Array(bytes.length + 1);
  withZero.set(bytes, 1);
  let binary = '';
  for (const byte of withZero) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

interface FetchScenario {
  /** The relay's response body (App ID's own token response, passed through). */
  tokenResult?: Record<string, unknown>;
  /** Make the relay `fetch` itself reject (network failure). */
  tokenThrow?: boolean;
  jwksKeys?: JWK[];
  jwksBody?: unknown;
  jwksStatus?: number;
  jwksThrow?: boolean;
}

function jwksResponse(scenario: FetchScenario) {
  if (scenario.jwksThrow) throw new Error('jwks network down');
  if (scenario.jwksStatus) return jsonResponse({}, scenario.jwksStatus);
  if (scenario.jwksBody !== undefined) return jsonResponse(scenario.jwksBody);
  return jsonResponse({ keys: scenario.jwksKeys ?? [publicJwk] });
}

function installFetch(scenario: FetchScenario): ReturnType<typeof vi.fn> {
  const mock = vi.fn(async (url: string | URL) => {
    if (String(url) === JWKS_URI) {
      return jwksResponse(scenario);
    }
    if (String(url) === RELAY_URL) {
      if (scenario.tokenThrow) throw new Error('relay network down');
      return jsonResponse(scenario.tokenResult ?? {});
    }
    return jsonResponse({ error: 'unknown_endpoint' }, 404);
  });

  vi.stubGlobal('fetch', mock);
  return mock;
}

function makeAdapter(config: Partial<AppIdConfig> = {}): AppIdAuthAdapter {
  TestBed.configureTestingModule({
    providers: [
      AppIdAuthAdapter,
      { provide: APPID_CONFIG, useValue: { ...BASE_CONFIG, ...config } },
    ],
  });
  return TestBed.inject(AppIdAuthAdapter);
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('AppIdAuthAdapter', () => {
  beforeEach(() => {
    sessionStorage.clear();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    TestBed.resetTestingModule();
  });

  describe('authenticate', () => {
    it('exchanges credentials via the relay for a mapped, verified session', async () => {
      const accessToken = await mintAccessToken();
      installFetch({
        tokenResult: {
          access_token: accessToken,
          refresh_token: 'refresh-token',
          token_type: 'Bearer',
        },
      });
      const adapter = makeAdapter();

      const session = await adapter.authenticate({ email: 'ADMIN@capy.test', password: 'pw' });

      expect(session.operatorId).toBe('op-123');
      // DEFAULT_TENANT_ID, not App ID's own `tenant` claim — see the adapter's class doc.
      expect(session.tenantId).toBe(DEFAULT_TENANT_ID);
      expect(session.roles).toEqual(['admin']);
      expect(session.permissions).toContain('sale:process');
      expect(session.permissions).toContain('admin:settings');
      expect(session.accessToken).toBe(accessToken);
      expect(adapter.getAccessToken()).toBe(accessToken);
    });

    it('never calls App ID directly — only the relay and the public JWKS endpoint', async () => {
      const accessToken = await mintAccessToken();
      const fetchMock = installFetch({ tokenResult: { access_token: accessToken } });
      const adapter = makeAdapter();

      await adapter.authenticate({ email: 'a@b.com', password: 'pw' });

      const urls = fetchMock.mock.calls.map((call) => String(call[0]));
      expect(urls).toContain(RELAY_URL);
      expect(urls.every((u) => u === RELAY_URL || u === JWKS_URI)).toBe(true);
    });

    it('posts JSON with no Basic-auth header — the relay carries the client secret, not the browser', async () => {
      const accessToken = await mintAccessToken();
      const fetchMock = installFetch({ tokenResult: { access_token: accessToken } });
      const adapter = makeAdapter();

      await adapter.authenticate({ email: 'a@b.com', password: 'pw' });

      const relayCall = fetchMock.mock.calls.find((call) => String(call[0]) === RELAY_URL);
      const init = relayCall?.[1] as RequestInit;
      expect((init.headers as Record<string, string>)['Authorization']).toBeUndefined();
      expect(JSON.parse(init.body as string)).toMatchObject({
        grant_type: 'password',
        username: 'a@b.com',
        password: 'pw',
      });
    });

    it('lower-cases the username sent to the relay', async () => {
      const accessToken = await mintAccessToken();
      const fetchMock = installFetch({ tokenResult: { access_token: accessToken } });
      const adapter = makeAdapter();

      await adapter.authenticate({ email: 'ADMIN@Capy.Test', password: 'pw' });

      const relayCall = fetchMock.mock.calls.find((call) => String(call[0]) === RELAY_URL);
      const body = JSON.parse((relayCall?.[1] as RequestInit).body as string);
      expect(body.username).toBe('admin@capy.test');
    });

    it('keeps only scopes that resolve to a real role — App ID framework scopes are not roles', async () => {
      const accessToken = await mintAccessToken({
        scope:
          'openid appid_default appid_readuserattr appid_readprofile appid_writeuserattr appid_authenticated admin',
      });
      installFetch({ tokenResult: { access_token: accessToken } });
      const adapter = makeAdapter();

      const session = await adapter.authenticate({ email: 'a@b.com', password: 'pw' });

      // Exactly the real shape decoded during Phase 0's bootstrap test.
      expect(session.roles).toEqual(['admin']);
    });

    it('grants no elevated permissions when no scope resolves to a real role', async () => {
      const accessToken = await mintAccessToken({
        scope: 'openid appid_default appid_authenticated',
      });
      installFetch({ tokenResult: { access_token: accessToken } });
      const adapter = makeAdapter();

      const session = await adapter.authenticate({ email: 'a@b.com', password: 'pw' });

      expect(session.roles).toEqual([]);
      expect(session.permissions).toEqual([]);
    });

    it('maps a relay invalid_grant error to InvalidCredentialsError', async () => {
      installFetch({ tokenResult: undefined });
      vi.stubGlobal(
        'fetch',
        vi.fn(async (url: string | URL) => {
          if (String(url) === RELAY_URL) {
            return jsonResponse(
              { error: 'invalid_grant', error_description: 'wrong password' },
              400
            );
          }
          return jsonResponse({}, 404);
        })
      );
      const adapter = makeAdapter();

      await expect(adapter.authenticate({ email: 'a@b.com', password: 'wrong' })).rejects.toThrow(
        InvalidCredentialsError
      );
    });

    it('wraps a relay network failure in AppIdAuthError', async () => {
      installFetch({ tokenThrow: true });
      const adapter = makeAdapter();

      await expect(adapter.authenticate({ email: 'a@b.com', password: 'pw' })).rejects.toThrow(
        AppIdAuthError
      );
    });

    it('persists the access and refresh tokens', async () => {
      const accessToken = await mintAccessToken();
      installFetch({ tokenResult: { access_token: accessToken, refresh_token: 'refresh-token' } });
      const adapter = makeAdapter();

      await adapter.authenticate({ email: 'a@b.com', password: 'pw' });

      expect(sessionStorage.getItem('capy_pos_access_token')).toBe(accessToken);
      expect(sessionStorage.getItem('capy_pos_refresh_token')).toBe('refresh-token');
    });
  });

  describe('getActiveSession', () => {
    it('returns null when no token is stored', async () => {
      installFetch({});
      const adapter = makeAdapter();
      expect(await adapter.getActiveSession()).toBeNull();
    });

    it('rebuilds the session from a stored, still-valid token', async () => {
      const accessToken = await mintAccessToken();
      sessionStorage.setItem('capy_pos_access_token', accessToken);
      installFetch({});
      const adapter = makeAdapter();

      const session = await adapter.getActiveSession();

      expect(session?.operatorId).toBe('op-123');
    });

    it('drops and returns null for an expired token', async () => {
      const accessToken = await mintAccessToken({ expiresInSec: -10 });
      sessionStorage.setItem('capy_pos_access_token', accessToken);
      installFetch({});
      const adapter = makeAdapter();

      expect(await adapter.getActiveSession()).toBeNull();
      expect(sessionStorage.getItem('capy_pos_access_token')).toBeNull();
    });

    it('rejects a token minted for a different tenant (wrong issuer)', async () => {
      const accessToken = await mintAccessToken({
        issuer: 'https://us-south.appid.cloud.ibm.com/oauth/v4/other-tenant',
      });
      sessionStorage.setItem('capy_pos_access_token', accessToken);
      installFetch({});
      const adapter = makeAdapter();

      expect(await adapter.getActiveSession()).toBeNull();
    });

    it('rejects a token minted for a different client (wrong audience)', async () => {
      const accessToken = await mintAccessToken({ audience: ['some-other-client'] });
      sessionStorage.setItem('capy_pos_access_token', accessToken);
      installFetch({});
      const adapter = makeAdapter();

      expect(await adapter.getActiveSession()).toBeNull();
    });

    /**
     * Confirmed live, against the real tenant during Phase 0's bootstrap: IBM
     * App ID's actual JWKS encodes its RSA modulus with a non-minimal leading
     * zero byte (the ASN.1 "keep an integer positive" convention) whenever the
     * value's high bit is set. A real browser's *native* WebCrypto
     * (`crypto.subtle.importKey`) enforces RFC 7518's minimal-encoding rule
     * strictly and throws `DataError: The JWK "n" member contained a leading
     * zero.` when handed one — confirmed by the exact error text, which is
     * Chrome's own, not a `jose`-authored message.
     *
     * This test cannot reproduce *that* failure: this suite polyfills
     * `crypto.subtle` with Node's own `node:crypto` `webcrypto`, which is
     * lenient about the identical bytes (verified directly — the unmodified,
     * pre-fix adapter passes this exact test unchanged). That is a genuine
     * engine-level gap between Node's WebCrypto and a real browser's, the same
     * class of "only a real browser sees this" bug as the NG0203 and
     * `process is not defined` lessons already logged elsewhere in this
     * codebase — closing it for real would need a Playwright check running
     * against the actual compiled bundle in Chromium, not a unit test here.
     *
     * What this test *does* prove, and is still worth having: `n`'s *value* is
     * unchanged by the padding — only its encoding is — so
     * `stripLeadingZeroPadding` producing a key that still verifies a real
     * signature from the same private key is a real correctness guarantee on
     * the fix's own transformation, independent of which WebCrypto engine
     * eventually runs it.
     */
    it('verifies against a JWKS whose modulus carries a non-minimal leading zero byte', async () => {
      const paddedJwk: JWK = { ...publicJwk, n: prependZeroByte(publicJwk.n) };
      const accessToken = await mintAccessToken();
      sessionStorage.setItem('capy_pos_access_token', accessToken);
      installFetch({ jwksKeys: [paddedJwk] });
      const adapter = makeAdapter();

      const session = await adapter.getActiveSession();

      expect(session?.operatorId).toBe('op-123');
    });
  });

  describe('refresh', () => {
    it('throws when no refresh token is stored', async () => {
      installFetch({});
      const adapter = makeAdapter();
      await expect(adapter.refresh()).rejects.toThrow(AppIdAuthError);
    });

    it('exchanges the stored refresh token via the relay for a new session', async () => {
      sessionStorage.setItem('capy_pos_refresh_token', 'old-refresh');
      const accessToken = await mintAccessToken();
      const fetchMock = installFetch({
        tokenResult: { access_token: accessToken, refresh_token: 'new-refresh' },
      });
      const adapter = makeAdapter();

      await adapter.refresh();

      const relayCall = fetchMock.mock.calls.find((call) => String(call[0]) === RELAY_URL);
      const body = JSON.parse((relayCall?.[1] as RequestInit).body as string);
      expect(body).toMatchObject({ grant_type: 'refresh_token', refresh_token: 'old-refresh' });
      expect(sessionStorage.getItem('capy_pos_refresh_token')).toBe('new-refresh');
    });

    it('keeps the old refresh token when the relay does not return a new one', async () => {
      sessionStorage.setItem('capy_pos_refresh_token', 'old-refresh');
      const accessToken = await mintAccessToken();
      installFetch({ tokenResult: { access_token: accessToken } });
      const adapter = makeAdapter();

      await adapter.refresh();

      expect(sessionStorage.getItem('capy_pos_refresh_token')).toBe('old-refresh');
    });
  });

  describe('signOut', () => {
    it('clears stored tokens without calling the relay or App ID', async () => {
      sessionStorage.setItem('capy_pos_access_token', 'a');
      sessionStorage.setItem('capy_pos_refresh_token', 'r');
      const fetchMock = installFetch({});
      const adapter = makeAdapter();

      await adapter.signOut();

      expect(sessionStorage.getItem('capy_pos_access_token')).toBeNull();
      expect(sessionStorage.getItem('capy_pos_refresh_token')).toBeNull();
      expect(fetchMock).not.toHaveBeenCalled();
    });
  });

  describe('getAccessToken', () => {
    it('returns the stored access token synchronously', () => {
      sessionStorage.setItem('capy_pos_access_token', 'stored-token');
      installFetch({});
      const adapter = makeAdapter();
      expect(adapter.getAccessToken()).toBe('stored-token');
    });

    it('returns null when nothing is stored', () => {
      installFetch({});
      const adapter = makeAdapter();
      expect(adapter.getAccessToken()).toBeNull();
    });
  });

  describe('requestPasswordReset', () => {
    it('posts to the relay’s forgot-password route, derived from relayUrl', async () => {
      const fetchMock = vi.fn().mockResolvedValue(jsonResponse({}));
      vi.stubGlobal('fetch', fetchMock);
      const adapter = makeAdapter();

      await adapter.requestPasswordReset('Ada@Capy.Test');

      expect(fetchMock).toHaveBeenCalledWith(
        'https://relay.test/appid/forgot-password',
        expect.objectContaining({
          method: 'POST',
          body: JSON.stringify({ email: 'ada@capy.test' }),
        })
      );
    });

    it('supportsPasswordReset is true — this is the one adapter that can', () => {
      installFetch({});
      expect(makeAdapter().supportsPasswordReset).toBe(true);
    });

    it('throws AppIdAuthError on a genuine transport failure', async () => {
      vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('network down')));
      const adapter = makeAdapter();
      await expect(adapter.requestPasswordReset('ada@capy.test')).rejects.toThrow(AppIdAuthError);
    });
  });
});
