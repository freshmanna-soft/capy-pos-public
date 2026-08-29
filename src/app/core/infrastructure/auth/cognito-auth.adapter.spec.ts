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
  CognitoAuthAdapter,
  COGNITO_CONFIG,
  CognitoAuthError,
  CognitoChallengeError,
  type CognitoConfig,
} from './cognito-auth.adapter';
import { InvalidCredentialsError } from './local-credential-auth.adapter';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const REGION = 'us-east-1';
const STAFF_POOL = 'us-east-1_staffpool';
const CUSTOMER_POOL = 'us-east-1_custpool';
const CLIENT_ID = 'staff-client-id';

const STAFF_ISSUER = `https://cognito-idp.${REGION}.amazonaws.com/${STAFF_POOL}`;
const CUSTOMER_ISSUER = `https://cognito-idp.${REGION}.amazonaws.com/${CUSTOMER_POOL}`;
const JWKS_URI = `${STAFF_ISSUER}/.well-known/jwks.json`;
const KID = 'test-signing-key';

const BASE_CONFIG: CognitoConfig = {
  enabled: true,
  region: REGION,
  staffUserPoolId: STAFF_POOL,
  staffClientId: CLIENT_ID,
  customerUserPoolId: CUSTOMER_POOL,
  allowedStoreDomain: '',
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
  audience?: string;
  groups?: string[];
  tenantId?: string;
  storeDomain?: string;
  tokenUse?: string;
  sub?: string;
  expiresInSec?: number;
  kid?: string;
}

async function mintIdToken(opts: MintOptions = {}): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  const claims: Record<string, unknown> = {
    token_use: opts.tokenUse ?? 'id',
    'cognito:groups': opts.groups ?? ['admin'],
    'custom:tenant_id': opts.tenantId ?? 'tenant-1',
  };
  if (opts.storeDomain !== undefined) claims['custom:store_domain'] = opts.storeDomain;

  return new SignJWT(claims)
    .setProtectedHeader({ alg: 'RS256', kid: opts.kid ?? KID })
    .setIssuedAt(now)
    .setIssuer(opts.issuer ?? STAFF_ISSUER)
    .setAudience(opts.audience ?? CLIENT_ID)
    .setSubject(opts.sub ?? 'op-123')
    .setExpirationTime(now + (opts.expiresInSec ?? 3600))
    .sign(privateKey);
}

/**
 * Lower-level minter with full control over claims and whether the standard
 * `kid` header / `sub` / `exp` are emitted at all. `null` omits a field.
 */
async function mintRaw(
  claims: Record<string, unknown>,
  opts: { kid?: string | null; sub?: string | null; exp?: number | null } = {}
): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  const header: Record<string, unknown> = { alg: 'RS256' };
  if (opts.kid !== null) header['kid'] = opts.kid ?? KID;

  let jwt = new SignJWT(claims)
    .setProtectedHeader(header as never)
    .setIssuedAt(now)
    .setIssuer(STAFF_ISSUER)
    .setAudience(CLIENT_ID);
  if (opts.sub !== null) jwt = jwt.setSubject(opts.sub ?? 'op-123');
  if (opts.exp !== null) jwt = jwt.setExpirationTime(now + (opts.exp ?? 3600));
  return jwt.sign(privateKey);
}

function jsonResponse(body: unknown, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  } as Response;
}

interface FetchScenario {
  /** AuthenticationResult returned by InitiateAuth (success path). */
  authResult?: Record<string, unknown>;
  /** Cognito error envelope + status for InitiateAuth (failure path). */
  authError?: { type: string; status?: number };
  /** InitiateAuth error response carrying NO `__type` field (bare status). */
  authErrorNoType?: { status?: number };
  /** Make the InitiateAuth `fetch` itself reject (network failure). */
  authThrow?: boolean;
  /** Challenge name returned instead of tokens. */
  challenge?: string;
  /** JWKS keys served at the well-known endpoint. */
  jwksKeys?: JWK[];
  /** Raw JWKS body override (e.g. `{}` to omit `keys`). */
  jwksBody?: unknown;
  /** Serve a non-2xx status for the JWKS endpoint. */
  jwksStatus?: number;
  /** Make the JWKS `fetch` itself reject (network failure). */
  jwksThrow?: boolean;
}

function jwksResponse(scenario: FetchScenario) {
  if (scenario.jwksThrow) throw new Error('jwks network down');
  if (scenario.jwksStatus) return jsonResponse({}, scenario.jwksStatus);
  if (scenario.jwksBody !== undefined) return jsonResponse(scenario.jwksBody);
  return jsonResponse({ keys: scenario.jwksKeys ?? [publicJwk] });
}

function initiateAuthResponse(scenario: FetchScenario) {
  if (scenario.authThrow) throw new Error('cognito network down');
  if (scenario.authErrorNoType) {
    // Error envelope with no `__type` at all — readErrorType returns null.
    return jsonResponse({ message: 'boom' }, scenario.authErrorNoType.status ?? 500);
  }
  if (scenario.authError) {
    return jsonResponse(
      { __type: `com.amazonaws.cognito.identity.idp#${scenario.authError.type}` },
      scenario.authError.status ?? 400
    );
  }
  if (scenario.challenge) {
    return jsonResponse({ ChallengeName: scenario.challenge });
  }
  return jsonResponse({ AuthenticationResult: scenario.authResult });
}

function installFetch(scenario: FetchScenario): ReturnType<typeof vi.fn> {
  const mock = vi.fn(async (url: string | URL, init?: RequestInit) => {
    if (String(url) === JWKS_URI) {
      return jwksResponse(scenario);
    }

    const target = (init?.headers as Record<string, string> | undefined)?.['X-Amz-Target'] ?? '';
    if (target.endsWith('InitiateAuth')) {
      return initiateAuthResponse(scenario);
    }
    if (target.endsWith('GlobalSignOut')) {
      return jsonResponse({});
    }
    return jsonResponse({ __type: 'UnknownOperationException' }, 400);
  });

  vi.stubGlobal('fetch', mock);
  return mock;
}

function makeAdapter(config: Partial<CognitoConfig> = {}): CognitoAuthAdapter {
  TestBed.configureTestingModule({
    providers: [
      CognitoAuthAdapter,
      { provide: COGNITO_CONFIG, useValue: { ...BASE_CONFIG, ...config } },
    ],
  });
  return TestBed.inject(CognitoAuthAdapter);
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('CognitoAuthAdapter', () => {
  beforeEach(() => {
    sessionStorage.clear();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    TestBed.resetTestingModule();
  });

  describe('authenticate', () => {
    it('exchanges credentials for a mapped, verified session and persists tokens', async () => {
      const idToken = await mintIdToken({ groups: ['admin'], tenantId: 'tenant-1' });
      installFetch({
        authResult: {
          IdToken: idToken,
          AccessToken: 'access-token',
          RefreshToken: 'refresh-token',
        },
      });
      const adapter = makeAdapter();

      const session = await adapter.authenticate({ email: 'ADMIN@capy.test', password: 'pw' });

      expect(session.operatorId).toBe('op-123');
      expect(session.tenantId).toBe('tenant-1');
      expect(session.roles).toEqual(['admin']);
      // Admin group resolves to the canonical domain permission set.
      expect(session.permissions).toContain('sale:process');
      expect(session.permissions).toContain('admin:settings');
      // The access token (not the id token) is what requests carry.
      expect(session.accessToken).toBe('access-token');
      expect(adapter.getAccessToken()).toBe('access-token');
      expect(session.memberships).toEqual([
        expect.objectContaining({ tenantId: 'tenant-1', role: 'admin', level: 3 }),
      ]);
    });

    it('lower-cases the username sent to Cognito', async () => {
      const idToken = await mintIdToken();
      const fetchMock = installFetch({
        authResult: { IdToken: idToken, AccessToken: 'a', RefreshToken: 'r' },
      });
      const adapter = makeAdapter();

      await adapter.authenticate({ email: '  Admin@Capy.Test ', password: 'pw' });

      const initiateCall = fetchMock.mock.calls.find(([, init]) =>
        String((init?.headers as Record<string, string>)['X-Amz-Target']).endsWith('InitiateAuth')
      );
      const body = JSON.parse((initiateCall![1] as RequestInit).body as string);
      expect(body.AuthParameters.USERNAME).toBe('admin@capy.test');
      expect(body.AuthFlow).toBe('USER_PASSWORD_AUTH');
    });

    it('throws InvalidCredentialsError on NotAuthorizedException', async () => {
      installFetch({ authError: { type: 'NotAuthorizedException' } });
      const adapter = makeAdapter();

      await expect(
        adapter.authenticate({ email: 'a@b.c', password: 'bad' })
      ).rejects.toBeInstanceOf(InvalidCredentialsError);
    });

    it('throws InvalidCredentialsError on UserNotFoundException', async () => {
      installFetch({ authError: { type: 'UserNotFoundException' } });
      const adapter = makeAdapter();

      await expect(
        adapter.authenticate({ email: 'nobody@b.c', password: 'x' })
      ).rejects.toBeInstanceOf(InvalidCredentialsError);
    });

    it('surfaces an MFA/other challenge as CognitoChallengeError', async () => {
      installFetch({ challenge: 'SOFTWARE_TOKEN_MFA' });
      const adapter = makeAdapter();

      await expect(adapter.authenticate({ email: 'a@b.c', password: 'pw' })).rejects.toBeInstanceOf(
        CognitoChallengeError
      );
    });

    it('maps an unknown group to a role name but grants it no permissions', async () => {
      const idToken = await mintIdToken({ groups: ['warehouse'] });
      installFetch({ authResult: { IdToken: idToken, AccessToken: 'a', RefreshToken: 'r' } });
      const adapter = makeAdapter();

      const session = await adapter.authenticate({ email: 'a@b.c', password: 'pw' });

      expect(session.roles).toEqual(['warehouse']);
      expect(session.permissions).toEqual([]);
    });
  });

  describe('staff/customer pool isolation', () => {
    it('rejects a token minted by the customer pool (wrong issuer)', async () => {
      const customerToken = await mintIdToken({ issuer: CUSTOMER_ISSUER });
      installFetch({});
      const adapter = makeAdapter();
      sessionStorage.setItem('capy_pos_id_token', customerToken);
      sessionStorage.setItem('capy_pos_access_token', 'access-token');

      const session = await adapter.getActiveSession();

      expect(session).toBeNull();
      // The bad token is purged so it can't be retried.
      expect(adapter.getAccessToken()).toBeNull();
    });

    it('rejects a token issued for a different app client (wrong audience)', async () => {
      const token = await mintIdToken({ audience: 'some-other-client' });
      installFetch({});
      const adapter = makeAdapter();
      sessionStorage.setItem('capy_pos_id_token', token);
      sessionStorage.setItem('capy_pos_access_token', 'access-token');

      expect(await adapter.getActiveSession()).toBeNull();
    });

    it('rejects an access token substituted for the id token (token_use pinning)', async () => {
      const token = await mintIdToken({ tokenUse: 'access' });
      installFetch({});
      const adapter = makeAdapter();
      sessionStorage.setItem('capy_pos_id_token', token);
      sessionStorage.setItem('capy_pos_access_token', 'access-token');

      expect(await adapter.getActiveSession()).toBeNull();
    });
  });

  describe('store-domain pinning', () => {
    it('rejects a token whose store_domain claim does not match the configured domain', async () => {
      const token = await mintIdToken({ storeDomain: 'store-b.capy.shop' });
      installFetch({});
      const adapter = makeAdapter({ allowedStoreDomain: 'store-a.capy.shop' });
      sessionStorage.setItem('capy_pos_id_token', token);
      sessionStorage.setItem('capy_pos_access_token', 'access-token');

      expect(await adapter.getActiveSession()).toBeNull();
    });

    it('accepts a token whose store_domain claim matches', async () => {
      const token = await mintIdToken({ storeDomain: 'store-a.capy.shop' });
      installFetch({});
      const adapter = makeAdapter({ allowedStoreDomain: 'store-a.capy.shop' });
      sessionStorage.setItem('capy_pos_id_token', token);
      sessionStorage.setItem('capy_pos_access_token', 'access-token');

      const session = await adapter.getActiveSession();
      expect(session).not.toBeNull();
      expect(session!.tenantId).toBe('tenant-1');
    });
  });

  describe('getActiveSession', () => {
    it('returns null when no tokens are stored', async () => {
      installFetch({});
      const adapter = makeAdapter();
      expect(await adapter.getActiveSession()).toBeNull();
    });

    it('rehydrates a verified session from stored tokens', async () => {
      const idToken = await mintIdToken({ groups: ['manager'], tenantId: 't-9' });
      installFetch({});
      const adapter = makeAdapter();
      sessionStorage.setItem('capy_pos_id_token', idToken);
      sessionStorage.setItem('capy_pos_access_token', 'access-token');

      const session = await adapter.getActiveSession();

      expect(session).not.toBeNull();
      expect(session!.roles).toEqual(['manager']);
      expect(session!.tenantId).toBe('t-9');
      expect(session!.accessToken).toBe('access-token');
    });

    it('returns null and clears an expired token', async () => {
      const expired = await mintIdToken({ expiresInSec: -60 });
      installFetch({});
      const adapter = makeAdapter();
      sessionStorage.setItem('capy_pos_id_token', expired);
      sessionStorage.setItem('capy_pos_access_token', 'access-token');

      expect(await adapter.getActiveSession()).toBeNull();
      expect(sessionStorage.getItem('capy_pos_id_token')).toBeNull();
    });
  });

  describe('refresh', () => {
    it('exchanges the refresh token for a fresh session', async () => {
      const idToken = await mintIdToken({ groups: ['operator'] });
      installFetch({ authResult: { IdToken: idToken, AccessToken: 'new-access' } });
      const adapter = makeAdapter();
      sessionStorage.setItem('capy_pos_refresh_token', 'stored-refresh');

      const session = await adapter.refresh();

      expect(session.roles).toEqual(['operator']);
      expect(adapter.getAccessToken()).toBe('new-access');
      // The refresh token is preserved (REFRESH_TOKEN_AUTH does not reissue it).
      expect(sessionStorage.getItem('capy_pos_refresh_token')).toBe('stored-refresh');
    });

    it('throws when there is no refresh token', async () => {
      installFetch({});
      const adapter = makeAdapter();
      await expect(adapter.refresh()).rejects.toBeInstanceOf(CognitoAuthError);
    });
  });

  describe('signOut', () => {
    it('clears stored tokens and calls GlobalSignOut', async () => {
      const fetchMock = installFetch({});
      const adapter = makeAdapter();
      sessionStorage.setItem('capy_pos_access_token', 'access-token');
      sessionStorage.setItem('capy_pos_id_token', 'id-token');
      sessionStorage.setItem('capy_pos_refresh_token', 'refresh-token');

      await adapter.signOut();

      expect(adapter.getAccessToken()).toBeNull();
      expect(sessionStorage.getItem('capy_pos_id_token')).toBeNull();
      expect(sessionStorage.getItem('capy_pos_refresh_token')).toBeNull();
      const calledGlobalSignOut = fetchMock.mock.calls.some(([, init]) =>
        String((init?.headers as Record<string, string>)['X-Amz-Target']).endsWith('GlobalSignOut')
      );
      expect(calledGlobalSignOut).toBe(true);
    });

    it('clears tokens even when GlobalSignOut fails', async () => {
      vi.stubGlobal(
        'fetch',
        vi.fn(async () => {
          throw new Error('network down');
        })
      );
      const adapter = makeAdapter();
      sessionStorage.setItem('capy_pos_access_token', 'access-token');

      await adapter.signOut();

      expect(adapter.getAccessToken()).toBeNull();
    });
  });

  describe('Cognito call error handling', () => {
    it('wraps a network failure on InitiateAuth as CognitoAuthError', async () => {
      installFetch({ authThrow: true });
      const adapter = makeAdapter();

      await expect(adapter.authenticate({ email: 'a@b.c', password: 'pw' })).rejects.toBeInstanceOf(
        CognitoAuthError
      );
    });

    it('maps a non-credential Cognito error type to CognitoAuthError', async () => {
      installFetch({ authError: { type: 'InternalErrorException', status: 500 } });
      const adapter = makeAdapter();

      await expect(adapter.authenticate({ email: 'a@b.c', password: 'pw' })).rejects.toBeInstanceOf(
        CognitoAuthError
      );
    });

    it('falls back to the status code when the error envelope has no __type', async () => {
      installFetch({ authErrorNoType: { status: 503 } });
      const adapter = makeAdapter();

      await expect(adapter.authenticate({ email: 'a@b.c', password: 'pw' })).rejects.toBeInstanceOf(
        CognitoAuthError
      );
    });

    it('throws CognitoAuthError when InitiateAuth omits the id token', async () => {
      installFetch({ authResult: { AccessToken: 'access-only' } });
      const adapter = makeAdapter();

      await expect(adapter.authenticate({ email: 'a@b.c', password: 'pw' })).rejects.toBeInstanceOf(
        CognitoAuthError
      );
    });

    it('throws CognitoAuthError when InitiateAuth omits the access token', async () => {
      const idToken = await mintIdToken();
      installFetch({ authResult: { IdToken: idToken } });
      const adapter = makeAdapter();

      await expect(adapter.authenticate({ email: 'a@b.c', password: 'pw' })).rejects.toBeInstanceOf(
        CognitoAuthError
      );
    });
  });

  describe('JWKS resolution', () => {
    it('rejects a token whose kid matches no JWKS key (even after a refresh)', async () => {
      const token = await mintRaw(
        { token_use: 'id', 'cognito:groups': ['admin'] },
        { kid: 'rotated-kid' }
      );
      installFetch({ jwksKeys: [publicJwk] }); // only serves KID, never 'rotated-kid'
      const adapter = makeAdapter();
      sessionStorage.setItem('capy_pos_id_token', token);
      sessionStorage.setItem('capy_pos_access_token', 'access-token');

      expect(await adapter.getActiveSession()).toBeNull();
    });

    it('rejects a token that carries no kid header', async () => {
      const token = await mintRaw({ token_use: 'id', 'cognito:groups': ['admin'] }, { kid: null });
      installFetch({});
      const adapter = makeAdapter();
      sessionStorage.setItem('capy_pos_id_token', token);
      sessionStorage.setItem('capy_pos_access_token', 'access-token');

      expect(await adapter.getActiveSession()).toBeNull();
    });

    it('defaults the import algorithm when the JWKS key omits alg', async () => {
      const noAlgJwk = { ...publicJwk };
      delete (noAlgJwk as Record<string, unknown>)['alg'];
      const idToken = await mintIdToken({ groups: ['operator'] });
      installFetch({ jwksKeys: [noAlgJwk] });
      const adapter = makeAdapter();
      sessionStorage.setItem('capy_pos_id_token', idToken);
      sessionStorage.setItem('capy_pos_access_token', 'access-token');

      const session = await adapter.getActiveSession();
      expect(session).not.toBeNull();
      expect(session!.roles).toEqual(['operator']);
    });

    it('rejects when the JWKS endpoint returns a non-2xx status', async () => {
      const idToken = await mintIdToken();
      installFetch({ jwksStatus: 500 });
      const adapter = makeAdapter();
      sessionStorage.setItem('capy_pos_id_token', idToken);
      sessionStorage.setItem('capy_pos_access_token', 'access-token');

      expect(await adapter.getActiveSession()).toBeNull();
    });

    it('rejects when the JWKS fetch fails at the network level', async () => {
      const idToken = await mintIdToken();
      installFetch({ jwksThrow: true });
      const adapter = makeAdapter();
      sessionStorage.setItem('capy_pos_id_token', idToken);
      sessionStorage.setItem('capy_pos_access_token', 'access-token');

      expect(await adapter.getActiveSession()).toBeNull();
    });

    it('rejects when the JWKS body carries no keys', async () => {
      const idToken = await mintIdToken();
      installFetch({ jwksBody: {} }); // no `keys` → keys ?? []
      const adapter = makeAdapter();
      sessionStorage.setItem('capy_pos_id_token', idToken);
      sessionStorage.setItem('capy_pos_access_token', 'access-token');

      expect(await adapter.getActiveSession()).toBeNull();
    });
  });

  describe('claim mapping edge cases', () => {
    it('yields an empty membership list and blank ids when tenant/sub/exp claims are absent', async () => {
      const token = await mintRaw(
        { token_use: 'id', 'cognito:groups': ['operator'] },
        { sub: null, exp: null }
      );
      installFetch({});
      const adapter = makeAdapter();
      sessionStorage.setItem('capy_pos_id_token', token);
      sessionStorage.setItem('capy_pos_access_token', 'access-token');

      const session = await adapter.getActiveSession();

      expect(session).not.toBeNull();
      expect(session!.tenantId).toBe('');
      expect(session!.operatorId).toBe('');
      expect(session!.memberships).toEqual([]);
      expect(session!.expiresAt).toBe(new Date(0).toISOString());
    });

    it('treats a non-array cognito:groups claim as no groups', async () => {
      const token = await mintRaw({
        token_use: 'id',
        'cognito:groups': 'admin', // a string, not an array
        'custom:tenant_id': 'tenant-1',
      });
      installFetch({});
      const adapter = makeAdapter();
      sessionStorage.setItem('capy_pos_id_token', token);
      sessionStorage.setItem('capy_pos_access_token', 'access-token');

      const session = await adapter.getActiveSession();

      expect(session).not.toBeNull();
      expect(session!.roles).toEqual([]);
      expect(session!.permissions).toEqual([]);
      // No resolvable role → default level and a blank primary role.
      expect(session!.memberships).toEqual([
        expect.objectContaining({ tenantId: 'tenant-1', role: '', level: 1 }),
      ]);
    });

    it('keeps the highest-level role as primary when several known groups are present', async () => {
      const token = await mintRaw({
        token_use: 'id',
        'cognito:groups': ['admin', 'operator'], // admin (higher) listed first
        'custom:tenant_id': 'tenant-1',
      });
      installFetch({});
      const adapter = makeAdapter();
      sessionStorage.setItem('capy_pos_id_token', token);
      sessionStorage.setItem('capy_pos_access_token', 'access-token');

      const session = await adapter.getActiveSession();

      expect(session).not.toBeNull();
      expect(session!.roles).toEqual(['admin', 'operator']);
      expect(session!.memberships![0]).toEqual(
        expect.objectContaining({ role: 'admin', level: 3 })
      );
    });
  });
});
