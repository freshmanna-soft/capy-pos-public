import { Injectable, InjectionToken, inject } from '@angular/core';
import { decodeProtectedHeader, importJWK, jwtVerify, type JWTPayload } from 'jose';
import { environment } from '../../../../environments/environment';
import { AuthGateway } from '@core/application/auth/ports/auth-gateway.port';
import { CredentialsDto } from '@core/application/auth/dtos/credentials.dto';
import { AuthSessionDto, TenantMembershipDto } from '@core/application/auth/dtos/auth-session.dto';
import { DEFAULT_TENANT_ID } from '@core/infrastructure/database/dexie-database.service';
import { Role } from '@core/domain/auth';
import { InvalidCredentialsError } from './local-credential-auth.adapter';

/**
 * AppIdAuthAdapter
 *
 * A concrete {@link AuthGateway} that authenticates staff against an IBM Cloud
 * App ID tenant and validates the RS256 access tokens it issues. Ported from
 * {@link CognitoAuthAdapter}'s shape — same port, same DI seam in
 * `auth.providers.ts`, same `sessionStorage` key convention — with three real
 * differences that came out of actually testing App ID rather than assuming
 * it works like Cognito:
 *
 * 1. **App ID's token endpoint requires a client secret** via
 *    `Authorization: Basic base64(clientId:clientSecret)` on every call —
 *    unlike Cognito's public-client `InitiateAuth`, which needs none. A
 *    secret cannot safely live in a browser bundle, so `authenticate()` and
 *    `refresh()` post to `environment.appId.relayUrl`
 *    (`infra/appid-token-relay`, not this repo's problem to keep secret) —
 *    never to App ID's token endpoint directly. JWKS verification stays
 *    direct: `GET /oauth/v4/<tenantID>/publickeys` is unauthenticated.
 * 2. **One token, not two.** Cognito issues a separate ID token (identity
 *    claims) and access token (the API bearer + `cognito:groups`). App ID's
 *    single access token carries both `sub`/`email_verified` and `scope` —
 *    confirmed by decoding a real one — so there's no second token to fetch
 *    or verify.
 * 3. **`scope` is a space-separated string mixing App ID's own framework
 *    scopes with ours** (`"openid appid_default appid_readuserattr ... admin"`),
 *    not a clean user-defined list like Cognito's `cognito:groups`. Filtering
 *    through `Role.fromName()` — which already discards anything that isn't a
 *    real Capy-POS role name — handles this correctly, but `roles` below
 *    deliberately keeps only what resolved, unlike Cognito's adapter which
 *    keeps every raw group name. Keeping `appid_readuserattr` etc. in the
 *    session's `roles` claim would be framework noise, not a role.
 *
 * Also confirmed by decoding a real token: App ID's own `tenant` claim is the
 * *App ID service instance's* id (constant, same for every user) — nothing
 * like Cognito's per-user `custom:tenant_id`. Using it as Capy-POS's
 * multi-tenant `tenantId` would silently give every operator the same
 * meaningless value. This pilot is effectively single-tenant today (see
 * `DEFAULT_TENANT_ID`), so that's what's used here instead; real per-store
 * multi-tenancy over App ID would need a genuine custom claim (App ID's
 * `PUT config/tokens` → `accessTokenClaims`), not this one.
 *
 * Known gap, not solved here: `infra/pos-api/src/session-auth.ts` verifies
 * `SessionIssuer`'s shared-HS256-secret tokens today, not App ID's RS256
 * ones. Enabling this gateway (`environment.appId.enabled`) without also
 * updating pos-api to accept App ID tokens means every authenticated API call
 * 401s — this adapter alone does not make the rest of the app work end to end.
 */

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

export interface AppIdConfig {
  readonly enabled: boolean;
  readonly region: string;
  readonly tenantId: string;
  readonly staffClientId: string;
  /** Documentation/tooling only — a customer-pool token can't reach this gateway
   *  in the first place, since it would come from a different App ID tenant. */
  readonly customerClientId?: string;
  /** `infra/appid-token-relay` — holds the client secret App ID's token
   *  endpoint requires, which cannot live in this browser bundle. */
  readonly relayUrl: string;
}

/**
 * App ID configuration seam. Defaults to `environment.appId`; specs and
 * alternate deployments override it via the DI container.
 */
export const APPID_CONFIG = new InjectionToken<AppIdConfig>('APPID_CONFIG', {
  providedIn: 'root',
  factory: () => environment.appId as AppIdConfig,
});

// ---------------------------------------------------------------------------
// Token storage — same keys/strategy as the other two gateways, so the three
// remain interchangeable from the presentation layer's point of view.
// ---------------------------------------------------------------------------

const ACCESS_TOKEN_KEY = 'capy_pos_access_token';
const REFRESH_TOKEN_KEY = 'capy_pos_refresh_token';

function setItem(key: string, value: string): void {
  try {
    sessionStorage.setItem(key, value);
  } catch {
    // sessionStorage unavailable (private mode / blocked) — continue in-memory-less
  }
}

function getItem(key: string): string | null {
  try {
    return sessionStorage.getItem(key);
  } catch {
    return null;
  }
}

function removeItem(key: string): void {
  try {
    sessionStorage.removeItem(key);
  } catch {
    // ignore
  }
}

// ---------------------------------------------------------------------------
// Errors
// ---------------------------------------------------------------------------

/** Raised for non-credential App ID failures (network, relay, service, config). */
export class AppIdAuthError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'AppIdAuthError';
  }
}

// ---------------------------------------------------------------------------
// Wire types (only the fields we consume)
// ---------------------------------------------------------------------------

/** What `infra/appid-token-relay` returns — App ID's own token response, passed through. */
interface RelayTokenResponse {
  access_token?: string;
  refresh_token?: string;
  token_type?: string;
  expires_in?: number;
  error?: string;
  error_description?: string;
}

interface Jwk {
  kid: string;
  kty: string;
  n: string;
  e: string;
  alg?: string;
  use?: string;
}

// ---------------------------------------------------------------------------
// Adapter
// ---------------------------------------------------------------------------

@Injectable()
export class AppIdAuthAdapter implements AuthGateway {
  private readonly config = inject(APPID_CONFIG);

  /** JWKS is immutable per tenant; cache it after the first fetch. */
  private jwksCache: Jwk[] | null = null;

  private get issuer(): string {
    return `https://${this.config.region}.appid.cloud.ibm.com/oauth/v4/${this.config.tenantId}`;
  }

  private get jwksUri(): string {
    return `${this.issuer}/publickeys`;
  }

  // -------------------------------------------------------------------------
  // AuthGateway
  // -------------------------------------------------------------------------

  async authenticate(creds: CredentialsDto): Promise<AuthSessionDto> {
    const result = await this.relayCall({
      grant_type: 'password',
      username: creds.email.trim().toLowerCase(),
      password: creds.password,
    });

    const session = await this.buildSession(result);
    this.persist(result);
    return session;
  }

  async getActiveSession(): Promise<AuthSessionDto | null> {
    const accessToken = getItem(ACCESS_TOKEN_KEY);
    if (!accessToken) return null;

    try {
      return await this.sessionFromToken(accessToken);
    } catch {
      // Expired, tampered, or wrong tenant — drop it.
      this.clear();
      return null;
    }
  }

  async refresh(): Promise<AuthSessionDto> {
    const refreshToken = getItem(REFRESH_TOKEN_KEY);
    if (!refreshToken) {
      throw new AppIdAuthError('No refresh token — cannot refresh session');
    }

    const result = await this.relayCall({
      grant_type: 'refresh_token',
      refresh_token: refreshToken,
    });
    const session = await this.buildSession(result);
    this.persist({ ...result, refresh_token: result.refresh_token ?? refreshToken });
    return session;
  }

  async signOut(): Promise<void> {
    // No server-side revocation call: unlike Cognito's documented GlobalSignOut,
    // an App ID token-revocation endpoint isn't confirmed against real docs, and
    // this adapter doesn't guess API shapes it hasn't verified. Local clear is a
    // real logout (the token stops being presented) even without it.
    this.clear();
  }

  getAccessToken(): string | null {
    return getItem(ACCESS_TOKEN_KEY);
  }

  // -------------------------------------------------------------------------
  // Internals
  // -------------------------------------------------------------------------

  /**
   * Post to `infra/appid-token-relay`, never to App ID's token endpoint
   * directly — see the class doc's point 1. The relay attaches the
   * `Authorization: Basic` header server-side and forwards the response
   * untouched, so the shape here is exactly App ID's own token response.
   */
  private async relayCall(body: Record<string, string>): Promise<RelayTokenResponse> {
    let response: Response;
    try {
      response = await fetch(this.config.relayUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
    } catch (err) {
      throw new AppIdAuthError(`App ID relay request failed: ${(err as Error).message}`);
    }

    const data = (await response.json().catch(() => ({}))) as RelayTokenResponse;
    if (response.ok && data.access_token) {
      return data;
    }

    // App ID's own error shape: { error: 'invalid_grant' | 'invalid_request', error_description }.
    if (data.error === 'invalid_grant') {
      throw new InvalidCredentialsError();
    }
    throw new AppIdAuthError(`App ID relay error: ${data.error ?? response.status}`);
  }

  private async buildSession(result: RelayTokenResponse): Promise<AuthSessionDto> {
    if (!result.access_token) {
      throw new AppIdAuthError('App ID relay returned no access token');
    }
    return this.sessionFromToken(result.access_token);
  }

  private async sessionFromToken(accessToken: string): Promise<AuthSessionDto> {
    const payload = await this.verifyAccessToken(accessToken);

    // See the class doc: App ID's `tenant` claim is the service instance's own
    // id, not a per-operator Capy-POS store id — DEFAULT_TENANT_ID until real
    // multi-tenancy over App ID exists.
    const tenantId = DEFAULT_TENANT_ID;
    const { roles, permissions, primaryRole, level } = this.resolveRoles(this.readScopes(payload));

    const memberships: TenantMembershipDto[] = [
      { tenantId, role: primaryRole, permissions, level },
    ];

    return {
      operatorId: payload.sub ?? '',
      tenantId,
      roles,
      permissions,
      memberships,
      accessToken,
      expiresAt: new Date((payload.exp ?? 0) * 1000).toISOString(),
    };
  }

  /**
   * Verify an App ID access token: RS256 signature against the tenant's JWKS,
   * plus issuer and audience binding — the same isolation guarantee
   * `CognitoAuthAdapter` documents, ported to App ID's claim names. `jose`'s
   * `audience` check matches whether `aud` is a string or an array (App ID's
   * is an array — confirmed by decoding a real token), so no special-casing.
   */
  private async verifyAccessToken(token: string): Promise<JWTPayload> {
    const header = decodeProtectedHeader(token);
    const key = await this.resolveSigningKey(header.kid);

    const { payload } = await jwtVerify(token, key, {
      issuer: this.issuer,
      audience: this.config.staffClientId,
    });
    return payload;
  }

  private async resolveSigningKey(kid: string | undefined): Promise<CryptoKey> {
    if (!kid) throw new AppIdAuthError('Token has no key id (kid)');

    const jwk = await this.findJwk(kid);
    if (!jwk) throw new AppIdAuthError(`No JWKS key matches kid ${kid}`);

    return (await importJWK(jwk, jwk.alg ?? 'RS256')) as CryptoKey;
  }

  private async findJwk(kid: string): Promise<Jwk | undefined> {
    if (!this.jwksCache) {
      this.jwksCache = await this.fetchJwks();
    }
    const hit = this.jwksCache.find((k) => k.kid === kid);
    if (hit) return hit;

    // A rotated key we haven't seen — refresh the cache once and retry.
    this.jwksCache = await this.fetchJwks();
    return this.jwksCache.find((k) => k.kid === kid);
  }

  private async fetchJwks(): Promise<Jwk[]> {
    let response: Response;
    try {
      response = await fetch(this.jwksUri, { method: 'GET' });
    } catch (err) {
      throw new AppIdAuthError(`JWKS fetch failed: ${(err as Error).message}`);
    }
    if (!response.ok) {
      throw new AppIdAuthError(`JWKS fetch returned ${response.status}`);
    }
    const data = (await response.json()) as { keys?: Jwk[] };
    return data.keys ?? [];
  }

  /** Space-separated scope string → individual scope tokens. */
  private readScopes(payload: JWTPayload): string[] {
    const raw = payload['scope'];
    return typeof raw === 'string' ? raw.split(/\s+/).filter(Boolean) : [];
  }

  /**
   * Map App ID scopes to the session's role/permission claims.
   *
   * Unlike `CognitoAuthAdapter.resolveRoles()`, `roles` here keeps only the
   * scopes that actually resolved to a real Capy-POS role — App ID's scope
   * claim always includes its own framework scopes (`openid`,
   * `appid_default`, `appid_readuserattr`, …) alongside ours, and those are
   * not roles to report, just noise `Role.fromName()` correctly rejects.
   */
  private resolveRoles(scopes: string[]): {
    roles: string[];
    permissions: string[];
    primaryRole: string;
    level: number;
  } {
    const permissions = new Set<string>();
    const roles: string[] = [];
    let primary: Role | null = null;

    for (const scope of scopes) {
      let role: Role | null;
      try {
        role = Role.fromName(scope);
      } catch {
        continue; // an App ID framework scope, or an unknown name — not a role
      }
      roles.push(scope);
      for (const p of role.permissions) permissions.add(p);
      if (!primary || role.level > primary.level) primary = role;
    }

    return {
      roles,
      permissions: [...permissions],
      primaryRole: primary?.name ?? '',
      level: primary?.level ?? 1,
    };
  }

  private persist(result: RelayTokenResponse): void {
    if (result.access_token) setItem(ACCESS_TOKEN_KEY, result.access_token);
    if (result.refresh_token) setItem(REFRESH_TOKEN_KEY, result.refresh_token);
  }

  private clear(): void {
    removeItem(ACCESS_TOKEN_KEY);
    removeItem(REFRESH_TOKEN_KEY);
  }
}
