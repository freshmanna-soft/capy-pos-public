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
import { AppIdCustomerAuthAdapter } from './appid-customer-auth.adapter';
import { APPID_CONFIG, type AppIdConfig } from './appid-auth.adapter';
import { AppIdAuthError } from './appid-jwks';
import { InvalidCredentialsError } from './local-credential-auth.adapter';
import { DEFAULT_TENANT_ID } from '@core/infrastructure/database/dexie-database.service';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const REGION = 'us-south';
const TENANT_ID = 'ee0c0740-5252-48a4-9b7c-e2b60712256e';
const STAFF_CLIENT_ID = '6a92b580-1e10-4b09-ba3d-854f9fa774a5';
const CUSTOMER_CLIENT_ID = 'a1f0c2d4-9e88-4c31-b0aa-2f7d5c1e4b6a';
const RELAY_URL = 'https://relay.test/appid/token';
const CUSTOMER_RELAY_URL = 'https://relay.test/appid/customer/token';
const CUSTOMER_SIGN_UP_URL = 'https://relay.test/appid/customer/sign-up';

const ISSUER = `https://${REGION}.appid.cloud.ibm.com/oauth/v4/${TENANT_ID}`;
const JWKS_URI = `${ISSUER}/publickeys`;
const KID = 'test-signing-key';

const BASE_CONFIG: AppIdConfig = {
  enabled: true,
  region: REGION,
  tenantId: TENANT_ID,
  staffClientId: STAFF_CLIENT_ID,
  customerClientId: CUSTOMER_CLIENT_ID,
  relayUrl: RELAY_URL,
  customerRelayUrl: CUSTOMER_RELAY_URL,
};

let privateKey: CryptoKey;
let publicJwk: JWK;

beforeAll(async () => {
  const pair = await generateKeyPair('RS256', { extractable: true });
  privateKey = pair.privateKey;
  publicJwk = { ...(await exportJWK(pair.publicKey)), kid: KID, alg: 'RS256', use: 'sig' };
});

interface MintOptions {
  audience?: string[];
  issuer?: string;
  /** Space-separated, exactly as App ID's real `scope` claim is shaped. */
  scope?: string;
  sub?: string;
  email?: string;
  expiresInSec?: number;
}

/**
 * Mints a customer token shaped like the real customer application's: `aud` an
 * array holding the *customer* client id, `scope` App ID's framework scopes plus
 * the single `customer` scope its role grants.
 */
async function mintCustomerToken(opts: MintOptions = {}): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  return new SignJWT({
    scope: opts.scope ?? 'openid appid_default appid_authenticated customer',
    email: opts.email ?? 'shopper@capy.test',
    tenant: TENANT_ID, // App ID's own instance id — deliberately NOT Capy-POS's tenantId
  })
    .setProtectedHeader({ alg: 'RS256', kid: KID })
    .setIssuedAt(now)
    .setIssuer(opts.issuer ?? ISSUER)
    .setAudience(opts.audience ?? [CUSTOMER_CLIENT_ID])
    .setSubject(opts.sub ?? 'customer-abc')
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
 * non-minimal zero byte to a base64url-encoded unsigned integer. The integer's
 * *value* is unchanged — only its encoding is — which is why the shared
 * resolver's fix (stripping it back off) still verifies a real signature.
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
  /** The customer relay's token response (App ID's own, passed through). */
  tokenResult?: Record<string, unknown>;
  tokenStatus?: number;
  tokenThrow?: boolean;
  signUpResult?: Record<string, unknown>;
  signUpStatus?: number;
  signUpThrow?: boolean;
  jwksKeys?: JWK[];
  jwksThrow?: boolean;
  jwksStatus?: number;
  jwksBody?: unknown;
}

function installFetch(scenario: FetchScenario): ReturnType<typeof vi.fn> {
  const mock = vi.fn(async (url: string | URL) => {
    const target = String(url);
    if (target === JWKS_URI) {
      if (scenario.jwksThrow) throw new Error('jwks network down');
      if (scenario.jwksStatus) return jsonResponse({}, scenario.jwksStatus);
      if (scenario.jwksBody !== undefined) return jsonResponse(scenario.jwksBody);
      return jsonResponse({ keys: scenario.jwksKeys ?? [publicJwk] });
    }
    if (target === CUSTOMER_RELAY_URL) {
      if (scenario.tokenThrow) throw new Error('customer relay network down');
      return jsonResponse(scenario.tokenResult ?? {}, scenario.tokenStatus ?? 200);
    }
    if (target === CUSTOMER_SIGN_UP_URL) {
      if (scenario.signUpThrow) throw new Error('sign-up network down');
      return jsonResponse(scenario.signUpResult ?? {}, scenario.signUpStatus ?? 201);
    }
    return jsonResponse({ error: 'unknown_endpoint' }, 404);
  });

  vi.stubGlobal('fetch', mock);
  return mock;
}

function makeAdapter(config: Partial<AppIdConfig> = {}): AppIdCustomerAuthAdapter {
  TestBed.configureTestingModule({
    providers: [
      AppIdCustomerAuthAdapter,
      { provide: APPID_CONFIG, useValue: { ...BASE_CONFIG, ...config } },
    ],
  });
  return TestBed.inject(AppIdCustomerAuthAdapter);
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('AppIdCustomerAuthAdapter', () => {
  beforeEach(() => {
    sessionStorage.clear();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    TestBed.resetTestingModule();
  });

  describe('authenticate', () => {
    it('exchanges credentials on the customer relay for a mapped, verified session', async () => {
      const accessToken = await mintCustomerToken();
      installFetch({ tokenResult: { access_token: accessToken, refresh_token: 'r1' } });
      const adapter = makeAdapter();

      const session = await adapter.authenticate({ email: 'Shopper@Capy.Test', password: 'pw' });

      expect(session.customerId).toBe('customer-abc');
      expect(session.email).toBe('shopper@capy.test');
      expect(session.tenantId).toBe(DEFAULT_TENANT_ID);
      // Only `customer` — App ID's framework scopes are not roles.
      expect(session.roles).toEqual(['customer']);
      expect(session.permissions).toEqual(['sale:process']);
      expect(session.accessToken).toBe(accessToken);
      expect(adapter.getAccessToken()).toBe(accessToken);
    });

    it('posts to customerRelayUrl — never to the staff relay', async () => {
      const accessToken = await mintCustomerToken();
      const fetchMock = installFetch({ tokenResult: { access_token: accessToken } });
      const adapter = makeAdapter();

      await adapter.authenticate({ email: 'a@b.com', password: 'pw' });

      const urls = fetchMock.mock.calls.map((call) => String(call[0]));
      expect(urls).toContain(CUSTOMER_RELAY_URL);
      expect(urls).not.toContain(RELAY_URL);
      expect(urls.every((u) => u === CUSTOMER_RELAY_URL || u === JWKS_URI)).toBe(true);
    });

    it('lower-cases the username and carries no Basic-auth header', async () => {
      const accessToken = await mintCustomerToken();
      const fetchMock = installFetch({ tokenResult: { access_token: accessToken } });
      const adapter = makeAdapter();

      await adapter.authenticate({ email: '  Shopper@Capy.Test ', password: 'pw' });

      const call = fetchMock.mock.calls.find((c) => String(c[0]) === CUSTOMER_RELAY_URL);
      const init = call?.[1] as RequestInit;
      expect((init.headers as Record<string, string>)['Authorization']).toBeUndefined();
      expect(JSON.parse(init.body as string)).toEqual({
        grant_type: 'password',
        username: 'shopper@capy.test',
        password: 'pw',
      });
    });

    it('maps invalid_grant to InvalidCredentialsError', async () => {
      installFetch({ tokenResult: { error: 'invalid_grant' }, tokenStatus: 400 });
      const adapter = makeAdapter();

      await expect(adapter.authenticate({ email: 'a@b.com', password: 'bad' })).rejects.toThrow(
        InvalidCredentialsError
      );
    });

    it('wraps a relay transport failure in AppIdAuthError', async () => {
      installFetch({ tokenThrow: true });
      const adapter = makeAdapter();

      await expect(adapter.authenticate({ email: 'a@b.com', password: 'pw' })).rejects.toThrow(
        AppIdAuthError
      );
    });

    it('rejects a relay 502 (customer client not configured on the relay)', async () => {
      installFetch({ tokenResult: { error: 'relay_unavailable' }, tokenStatus: 502 });
      const adapter = makeAdapter();

      await expect(adapter.authenticate({ email: 'a@b.com', password: 'pw' })).rejects.toThrow(
        /relay error: relay_unavailable/
      );
    });

    it('rejects a 200 response that carries no access token', async () => {
      installFetch({ tokenResult: { token_type: 'Bearer' } });
      const adapter = makeAdapter();

      await expect(adapter.authenticate({ email: 'a@b.com', password: 'pw' })).rejects.toThrow(
        /relay error/
      );
    });

    it('reports no role when the token carries only App ID framework scopes', async () => {
      const accessToken = await mintCustomerToken({ scope: 'openid appid_default' });
      installFetch({ tokenResult: { access_token: accessToken } });
      const adapter = makeAdapter();

      const session = await adapter.authenticate({ email: 'a@b.com', password: 'pw' });

      expect(session.roles).toEqual([]);
      expect(session.permissions).toEqual([]);
    });

    it('tolerates a token with no scope claim at all', async () => {
      const now = Math.floor(Date.now() / 1000);
      const accessToken = await new SignJWT({ email: 'a@b.com' })
        .setProtectedHeader({ alg: 'RS256', kid: KID })
        .setIssuedAt(now)
        .setIssuer(ISSUER)
        .setAudience([CUSTOMER_CLIENT_ID])
        .setSubject('customer-abc')
        .setExpirationTime(now + 3600)
        .sign(privateKey);
      installFetch({ tokenResult: { access_token: accessToken } });
      const adapter = makeAdapter();

      const session = await adapter.authenticate({ email: 'a@b.com', password: 'pw' });

      expect(session.roles).toEqual([]);
    });
  });

  describe('audience isolation from the staff identity', () => {
    /**
     * The isolation property of epic #261: staff and customers share one App ID
     * tenant and one JWKS, so a staff token has a valid signature and the right
     * issuer here — only its `aud` differs. That single claim is what must keep
     * it out of the customer gateway.
     */
    it('rejects a token whose aud is staffClientId, signed by the same tenant', async () => {
      const staffToken = await mintCustomerToken({
        audience: [STAFF_CLIENT_ID],
        scope: 'openid appid_default admin',
      });
      installFetch({ tokenResult: { access_token: staffToken } });
      const adapter = makeAdapter();

      // jose's own message for a failed audience binding.
      await expect(
        adapter.authenticate({ email: 'boss@capy.test', password: 'pw' })
      ).rejects.toThrow(/"aud" claim/);
    });

    it('treats a staff token planted in the customer storage slot as no session', async () => {
      const staffToken = await mintCustomerToken({ audience: [STAFF_CLIENT_ID] });
      sessionStorage.setItem('capy_pos_customer_access_token', staffToken);
      installFetch({});
      const adapter = makeAdapter();

      await expect(adapter.getActiveSession()).resolves.toBeNull();
      expect(sessionStorage.getItem('capy_pos_customer_access_token')).toBeNull();
    });

    it('rejects a token from another tenant (issuer mismatch)', async () => {
      const foreign = await mintCustomerToken({ issuer: `${ISSUER}-other` });
      installFetch({ tokenResult: { access_token: foreign } });
      const adapter = makeAdapter();

      await expect(adapter.authenticate({ email: 'a@b.com', password: 'pw' })).rejects.toThrow();
    });

    it('fails closed when customerClientId is unset — never falls back to staffClientId', async () => {
      const staffToken = await mintCustomerToken({ audience: [STAFF_CLIENT_ID] });
      installFetch({ tokenResult: { access_token: staffToken } });
      const adapter = makeAdapter({ customerClientId: '' });

      await expect(adapter.authenticate({ email: 'a@b.com', password: 'pw' })).rejects.toThrow(
        /customerClientId/
      );
    });
  });

  describe('session storage', () => {
    it('uses customer-specific keys so a staff session in the same tab survives', async () => {
      sessionStorage.setItem('capy_pos_access_token', 'staff-token');
      sessionStorage.setItem('capy_pos_refresh_token', 'staff-refresh');
      const accessToken = await mintCustomerToken();
      installFetch({
        tokenResult: { access_token: accessToken, refresh_token: 'customer-refresh' },
      });
      const adapter = makeAdapter();

      await adapter.authenticate({ email: 'a@b.com', password: 'pw' });

      expect(sessionStorage.getItem('capy_pos_customer_access_token')).toBe(accessToken);
      expect(sessionStorage.getItem('capy_pos_customer_refresh_token')).toBe('customer-refresh');
      expect(sessionStorage.getItem('capy_pos_access_token')).toBe('staff-token');
      expect(sessionStorage.getItem('capy_pos_refresh_token')).toBe('staff-refresh');
    });

    it('signOut clears only the customer keys', async () => {
      sessionStorage.setItem('capy_pos_access_token', 'staff-token');
      sessionStorage.setItem('capy_pos_customer_access_token', 'customer-token');
      sessionStorage.setItem('capy_pos_customer_refresh_token', 'customer-refresh');
      installFetch({});
      const adapter = makeAdapter();

      await adapter.signOut();

      expect(sessionStorage.getItem('capy_pos_customer_access_token')).toBeNull();
      expect(sessionStorage.getItem('capy_pos_customer_refresh_token')).toBeNull();
      expect(sessionStorage.getItem('capy_pos_access_token')).toBe('staff-token');
    });

    it('getAccessToken returns null with no session, and never reads the staff slot', () => {
      sessionStorage.setItem('capy_pos_access_token', 'staff-token');
      installFetch({});
      const adapter = makeAdapter();

      expect(adapter.getAccessToken()).toBeNull();
    });

    it('survives blocked sessionStorage (private mode) without throwing', async () => {
      const setSpy = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
        throw new Error('storage blocked');
      });
      const getSpy = vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
        throw new Error('storage blocked');
      });
      const removeSpy = vi.spyOn(Storage.prototype, 'removeItem').mockImplementation(() => {
        throw new Error('storage blocked');
      });
      const accessToken = await mintCustomerToken();
      installFetch({ tokenResult: { access_token: accessToken, refresh_token: 'r' } });
      const adapter = makeAdapter();

      const session = await adapter.authenticate({ email: 'a@b.com', password: 'pw' });
      expect(session.accessToken).toBe(accessToken);
      expect(adapter.getAccessToken()).toBeNull();
      await expect(adapter.signOut()).resolves.toBeUndefined();

      setSpy.mockRestore();
      getSpy.mockRestore();
      removeSpy.mockRestore();
    });
  });

  describe('getActiveSession', () => {
    it('rehydrates a verified session from the customer slot', async () => {
      const accessToken = await mintCustomerToken();
      sessionStorage.setItem('capy_pos_customer_access_token', accessToken);
      installFetch({});
      const adapter = makeAdapter();

      const session = await adapter.getActiveSession();

      expect(session?.customerId).toBe('customer-abc');
      expect(session?.roles).toEqual(['customer']);
    });

    it('returns null when nothing is stored', async () => {
      installFetch({});
      const adapter = makeAdapter();

      await expect(adapter.getActiveSession()).resolves.toBeNull();
    });

    it('drops an expired token', async () => {
      const expired = await mintCustomerToken({ expiresInSec: -60 });
      sessionStorage.setItem('capy_pos_customer_access_token', expired);
      installFetch({});
      const adapter = makeAdapter();

      await expect(adapter.getActiveSession()).resolves.toBeNull();
      expect(sessionStorage.getItem('capy_pos_customer_access_token')).toBeNull();
    });
  });

  describe('refresh', () => {
    it('exchanges the stored refresh token and keeps it when the relay returns none', async () => {
      sessionStorage.setItem('capy_pos_customer_refresh_token', 'stored-refresh');
      const accessToken = await mintCustomerToken();
      const fetchMock = installFetch({ tokenResult: { access_token: accessToken } });
      const adapter = makeAdapter();

      const session = await adapter.refresh();

      const call = fetchMock.mock.calls.find((c) => String(c[0]) === CUSTOMER_RELAY_URL);
      expect(JSON.parse((call?.[1] as RequestInit).body as string)).toEqual({
        grant_type: 'refresh_token',
        refresh_token: 'stored-refresh',
      });
      expect(session.accessToken).toBe(accessToken);
      expect(sessionStorage.getItem('capy_pos_customer_refresh_token')).toBe('stored-refresh');
    });

    it('throws when there is no stored customer refresh token', async () => {
      installFetch({});
      const adapter = makeAdapter();

      await expect(adapter.refresh()).rejects.toThrow(AppIdAuthError);
    });
  });

  describe('signUp', () => {
    it('registers on the relay sign-up route, then signs the new customer in', async () => {
      const accessToken = await mintCustomerToken();
      const fetchMock = installFetch({
        signUpResult: { id: 'customer-abc', email: 'shopper@capy.test' },
        tokenResult: { access_token: accessToken, refresh_token: 'r' },
      });
      const adapter = makeAdapter();

      const session = await adapter.signUp({ email: ' Shopper@Capy.Test ', password: 'pw' });

      const urls = fetchMock.mock.calls.map((c) => String(c[0]));
      expect(urls[0]).toBe(CUSTOMER_SIGN_UP_URL);
      expect(urls).toContain(CUSTOMER_RELAY_URL);
      expect(JSON.parse((fetchMock.mock.calls[0][1] as RequestInit).body as string)).toEqual({
        email: 'shopper@capy.test',
        password: 'pw',
      });
      expect(session.customerId).toBe('customer-abc');
      expect(adapter.getAccessToken()).toBe(accessToken);
    });

    it('throws the relay error verbatim — mapping to copy is the form’s job', async () => {
      installFetch({ signUpResult: { error: 'email already registered' }, signUpStatus: 409 });
      const adapter = makeAdapter();

      await expect(adapter.signUp({ email: 'a@b.com', password: 'pw' })).rejects.toThrow(
        'email already registered'
      );
    });

    it('reports the status when the relay answers with no error body', async () => {
      installFetch({ signUpResult: {}, signUpStatus: 502 });
      const adapter = makeAdapter();

      await expect(adapter.signUp({ email: 'a@b.com', password: 'pw' })).rejects.toThrow(/502/);
    });

    it('wraps a sign-up transport failure in AppIdAuthError', async () => {
      installFetch({ signUpThrow: true });
      const adapter = makeAdapter();

      await expect(adapter.signUp({ email: 'a@b.com', password: 'pw' })).rejects.toThrow(
        AppIdAuthError
      );
    });

    it('does not attempt sign-in when registration failed', async () => {
      const fetchMock = installFetch({ signUpResult: { error: 'nope' }, signUpStatus: 400 });
      const adapter = makeAdapter();

      await expect(adapter.signUp({ email: 'a@b.com', password: 'pw' })).rejects.toThrow('nope');
      expect(fetchMock.mock.calls.map((c) => String(c[0]))).not.toContain(CUSTOMER_RELAY_URL);
    });
  });

  describe('configuration', () => {
    it('refuses to sign in when customerRelayUrl is unset — no derivation from relayUrl', async () => {
      const fetchMock = installFetch({});
      const adapter = makeAdapter({ customerRelayUrl: undefined });

      await expect(adapter.authenticate({ email: 'a@b.com', password: 'pw' })).rejects.toThrow(
        /customerRelayUrl/
      );
      expect(fetchMock).not.toHaveBeenCalled();
    });

    it('surfaces a JWKS transport failure as AppIdAuthError', async () => {
      const accessToken = await mintCustomerToken();
      installFetch({ tokenResult: { access_token: accessToken }, jwksThrow: true });
      const adapter = makeAdapter();

      await expect(adapter.authenticate({ email: 'a@b.com', password: 'pw' })).rejects.toThrow(
        /JWKS fetch failed/
      );
    });

    it('surfaces a non-OK JWKS response as AppIdAuthError', async () => {
      const accessToken = await mintCustomerToken();
      installFetch({ tokenResult: { access_token: accessToken }, jwksStatus: 503 });
      const adapter = makeAdapter();

      await expect(adapter.authenticate({ email: 'a@b.com', password: 'pw' })).rejects.toThrow(
        /JWKS fetch returned 503/
      );
    });

    it('rejects when the tenant JWKS holds no key for the token kid', async () => {
      const accessToken = await mintCustomerToken();
      // A JWKS document with no `keys` array at all — treated as empty, then
      // re-fetched once in case a key had just rotated in.
      const fetchMock = installFetch({ tokenResult: { access_token: accessToken }, jwksBody: {} });
      const adapter = makeAdapter();

      await expect(adapter.authenticate({ email: 'a@b.com', password: 'pw' })).rejects.toThrow(
        new RegExp(`No JWKS key matches kid ${KID}`)
      );
      expect(fetchMock.mock.calls.filter((c) => String(c[0]) === JWKS_URI)).toHaveLength(2);
    });

    it('verifies against a JWKS whose modulus carries a non-minimal leading zero byte', async () => {
      // The real App ID defect (see AppIdJwksKeyResolver.resolveSigningKey):
      // same key, same signature — only the modulus encoding is padded.
      const paddedJwk = { ...publicJwk, n: prependZeroByte(publicJwk.n as string) };
      const accessToken = await mintCustomerToken();
      installFetch({ tokenResult: { access_token: accessToken }, jwksKeys: [paddedJwk] });
      const adapter = makeAdapter();

      const session = await adapter.authenticate({ email: 'a@b.com', password: 'pw' });

      expect(session.accessToken).toBe(accessToken);
    });
  });
});
