import { Injectable, InjectionToken, inject } from '@angular/core';
import { decodeProtectedHeader, importJWK, jwtVerify, type JWTPayload } from 'jose';
import { environment } from '../../../../environments/environment';
import { AuthGateway } from '@core/application/auth/ports/auth-gateway.port';
import { CredentialsDto } from '@core/application/auth/dtos/credentials.dto';
import { AuthSessionDto, TenantMembershipDto } from '@core/application/auth/dtos/auth-session.dto';
import { Role } from '@core/domain/auth';
import { InvalidCredentialsError } from './local-credential-auth.adapter';

/**
 * CognitoAuthAdapter (Story #140)
 *
 * A concrete {@link AuthGateway} that authenticates staff against an AWS Cognito
 * user pool and validates the pool's RS256 JWTs. It is the production swap for
 * {@link LocalCredentialAuthAdapter}: bind it in `auth.providers.ts` once a real
 * staff pool is stood up (the backend/Terraform is tracked separately — see the
 * note on issue #140).
 *
 * Zero new dependencies: it talks to the Cognito Identity Provider REST API with
 * `fetch` (the documented `AWSCognitoIdentityProviderService.*` JSON targets) and
 * verifies tokens with `jose` against the pool's published JWKS. That keeps the
 * whole adapter unit-testable offline — no AWS SDK, no live pool.
 *
 * Security guarantees enforced here (not by the backend):
 *   - **Staff/customer pool isolation.** Verification binds `issuer` to the staff
 *     pool and `audience` to the staff app-client id, so a token minted by the
 *     customer pool (different `iss`/`aud`) can never satisfy this staff gateway.
 *   - **Store-domain pinning.** When `allowedStoreDomain` is configured, a token
 *     whose `custom:store_domain` claim does not match is rejected — a token for
 *     store A cannot be replayed against store B's SPA.
 *   - **`token_use` pinning.** Only an ID token (`token_use === 'id'`) is accepted
 *     for claim extraction; an access token cannot be substituted.
 */

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

export interface CognitoConfig {
  readonly enabled: boolean;
  readonly region: string;
  readonly staffUserPoolId: string;
  readonly staffClientId: string;
  /** Documentation/tooling only — isolation is enforced by issuer binding. */
  readonly customerUserPoolId?: string;
  /** When set, `custom:store_domain` must equal this or the token is rejected. */
  readonly allowedStoreDomain?: string;
}

/**
 * Cognito configuration seam. Defaults to `environment.cognito`; specs and
 * alternate deployments override it via the DI container.
 */
export const COGNITO_CONFIG = new InjectionToken<CognitoConfig>('COGNITO_CONFIG', {
  providedIn: 'root',
  factory: () => environment.cognito as CognitoConfig,
});

// ---------------------------------------------------------------------------
// Token storage — mirrors the local adapter's sessionStorage strategy so the
// two gateways are interchangeable from the presentation layer's point of view.
// ---------------------------------------------------------------------------

const ACCESS_TOKEN_KEY = 'capy_pos_access_token';
const ID_TOKEN_KEY = 'capy_pos_id_token';
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

/** Raised for non-credential Cognito failures (network, service, config). */
export class CognitoAuthError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'CognitoAuthError';
  }
}

/**
 * Raised when Cognito returns a challenge (MFA, NEW_PASSWORD_REQUIRED, …) instead
 * of tokens. The challenge/response loop is a follow-up (MFA is a #140 scope item
 * that depends on the real backend); surfacing it explicitly avoids a silent
 * "authenticated but no session" state.
 */
export class CognitoChallengeError extends Error {
  constructor(public readonly challengeName: string) {
    super(`Cognito requires a challenge response: ${challengeName}`);
    this.name = 'CognitoChallengeError';
  }
}

// ---------------------------------------------------------------------------
// Cognito wire types (only the fields we consume)
// ---------------------------------------------------------------------------

interface AuthenticationResult {
  AccessToken: string;
  IdToken: string;
  RefreshToken?: string;
  ExpiresIn?: number;
  TokenType?: string;
}

interface InitiateAuthResponse {
  AuthenticationResult?: AuthenticationResult;
  ChallengeName?: string;
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
export class CognitoAuthAdapter implements AuthGateway {
  private readonly config = inject(COGNITO_CONFIG);

  /** JWKS is immutable per pool; cache it after the first fetch. */
  private jwksCache: Jwk[] | null = null;

  private get idpEndpoint(): string {
    return `https://cognito-idp.${this.config.region}.amazonaws.com/`;
  }

  private get issuer(): string {
    return `https://cognito-idp.${this.config.region}.amazonaws.com/${this.config.staffUserPoolId}`;
  }

  private get jwksUri(): string {
    return `${this.issuer}/.well-known/jwks.json`;
  }

  // -------------------------------------------------------------------------
  // AuthGateway
  // -------------------------------------------------------------------------

  async authenticate(creds: CredentialsDto): Promise<AuthSessionDto> {
    const result = await this.initiateAuth('USER_PASSWORD_AUTH', {
      USERNAME: creds.email.trim().toLowerCase(),
      PASSWORD: creds.password,
    });

    const session = await this.buildSession(result);
    this.persist(result);
    return session;
  }

  async getActiveSession(): Promise<AuthSessionDto | null> {
    const idToken = getItem(ID_TOKEN_KEY);
    const accessToken = getItem(ACCESS_TOKEN_KEY);
    if (!idToken || !accessToken) return null;

    try {
      return await this.sessionFromTokens(idToken, accessToken);
    } catch {
      // Expired, tampered, wrong pool, or store-domain mismatch — drop it.
      this.clear();
      return null;
    }
  }

  async refresh(): Promise<AuthSessionDto> {
    const refreshToken = getItem(REFRESH_TOKEN_KEY);
    if (!refreshToken) {
      throw new CognitoAuthError('No refresh token — cannot refresh session');
    }

    // REFRESH_TOKEN_AUTH returns new Access/Id tokens but not a new refresh token,
    // so we keep the existing one.
    const result = await this.initiateAuth('REFRESH_TOKEN_AUTH', {
      REFRESH_TOKEN: refreshToken,
    });

    const session = await this.buildSession(result);
    this.persist({ ...result, RefreshToken: result.RefreshToken ?? refreshToken });
    return session;
  }

  async signOut(): Promise<void> {
    const accessToken = getItem(ACCESS_TOKEN_KEY);
    if (accessToken) {
      // Best-effort global sign-out; never let a failure block the local logout.
      try {
        await this.cognitoCall('GlobalSignOut', { AccessToken: accessToken });
      } catch {
        // ignore — tokens are cleared below regardless
      }
    }
    this.clear();
  }

  getAccessToken(): string | null {
    // The access token is what API Gateway / a Cognito authorizer expects on the
    // Authorization header — return it synchronously for the request hot path.
    return getItem(ACCESS_TOKEN_KEY);
  }

  readonly supportsPasswordReset = false;

  /** Cognito's own ForgotPassword/ConfirmForgotPassword flow was never wired up here — not built. */
  requestPasswordReset(): Promise<void> {
    return Promise.reject(new Error('Password reset is not supported for Cognito yet.'));
  }

  // -------------------------------------------------------------------------
  // Internals
  // -------------------------------------------------------------------------

  private async initiateAuth(
    authFlow: 'USER_PASSWORD_AUTH' | 'REFRESH_TOKEN_AUTH',
    authParameters: Record<string, string>
  ): Promise<AuthenticationResult> {
    const body: InitiateAuthResponse = await this.cognitoCall('InitiateAuth', {
      AuthFlow: authFlow,
      ClientId: this.config.staffClientId,
      AuthParameters: authParameters,
    });

    if (body.ChallengeName) {
      throw new CognitoChallengeError(body.ChallengeName);
    }
    if (!body.AuthenticationResult?.IdToken || !body.AuthenticationResult?.AccessToken) {
      throw new CognitoAuthError('Cognito returned no authentication result');
    }
    return body.AuthenticationResult;
  }

  /**
   * Low-level Cognito Identity Provider JSON call. Maps credential failures to
   * {@link InvalidCredentialsError} (per the AuthGateway contract) and everything
   * else to {@link CognitoAuthError}.
   */
  private async cognitoCall<T>(target: string, payload: unknown): Promise<T> {
    let response: Response;
    try {
      response = await fetch(this.idpEndpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-amz-json-1.1',
          'X-Amz-Target': `AWSCognitoIdentityProviderService.${target}`,
        },
        body: JSON.stringify(payload),
      });
    } catch (err) {
      throw new CognitoAuthError(`Cognito request failed: ${(err as Error).message}`);
    }

    if (response.ok) {
      return (await response.json()) as T;
    }

    // Error envelope: { __type: 'NotAuthorizedException', message: '...' }
    const errorType = await this.readErrorType(response);
    if (errorType === 'NotAuthorizedException' || errorType === 'UserNotFoundException') {
      throw new InvalidCredentialsError();
    }
    throw new CognitoAuthError(`Cognito error: ${errorType || response.status}`);
  }

  private async readErrorType(response: Response): Promise<string | null> {
    try {
      const data = (await response.json()) as { __type?: string };
      // `__type` may be "com.amazonaws...#NotAuthorizedException"; take the tail.
      return data.__type ? (data.__type.split('#').pop() ?? null) : null;
    } catch {
      return null;
    }
  }

  private async buildSession(result: AuthenticationResult): Promise<AuthSessionDto> {
    return this.sessionFromTokens(result.IdToken, result.AccessToken);
  }

  private async sessionFromTokens(idToken: string, accessToken: string): Promise<AuthSessionDto> {
    const payload = await this.verifyIdToken(idToken);

    const tenantId = (payload['custom:tenant_id'] as string | undefined) ?? '';
    const groups = this.readGroups(payload);
    const { roles, permissions, primaryRole, level } = this.resolveRoles(groups);

    this.assertStoreDomain(payload);

    const memberships: TenantMembershipDto[] = tenantId
      ? [{ tenantId, role: primaryRole, permissions, level }]
      : [];

    return {
      operatorId: payload.sub ?? '',
      tenantId,
      roles,
      permissions,
      memberships,
      // The access token is the one attached to API requests (see getAccessToken).
      accessToken,
      expiresAt: new Date((payload.exp ?? 0) * 1000).toISOString(),
    };
  }

  /**
   * Verify a Cognito ID token: RS256 signature against the pool JWKS, plus issuer
   * (staff pool) and audience (staff app-client) binding. The issuer/audience
   * checks are what stop a customer-pool token from satisfying this gateway.
   */
  private async verifyIdToken(token: string): Promise<JWTPayload> {
    const header = decodeProtectedHeader(token);
    const key = await this.resolveSigningKey(header.kid);

    const { payload } = await jwtVerify(token, key, {
      issuer: this.issuer,
      audience: this.config.staffClientId,
    });

    if (payload['token_use'] !== 'id') {
      throw new CognitoAuthError('Expected an ID token');
    }
    return payload;
  }

  private async resolveSigningKey(kid: string | undefined): Promise<CryptoKey> {
    if (!kid) throw new CognitoAuthError('Token has no key id (kid)');

    const jwk = await this.findJwk(kid);
    if (!jwk) throw new CognitoAuthError(`No JWKS key matches kid ${kid}`);

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
      throw new CognitoAuthError(`JWKS fetch failed: ${(err as Error).message}`);
    }
    if (!response.ok) {
      throw new CognitoAuthError(`JWKS fetch returned ${response.status}`);
    }
    const data = (await response.json()) as { keys?: Jwk[] };
    return data.keys ?? [];
  }

  private readGroups(payload: JWTPayload): string[] {
    const raw = payload['cognito:groups'];
    return Array.isArray(raw) ? raw.filter((g): g is string => typeof g === 'string') : [];
  }

  /**
   * Map Cognito groups to the session's role/permission claims.
   *
   * Built-in group names (operator/manager/admin) resolve to the canonical domain
   * permission set via the Role value object, so the session claim never drifts
   * from the authorization rules. Unknown groups are kept as role names but grant
   * no permissions (resilient mapping — an unrecognised group can't escalate).
   */
  private resolveRoles(groups: string[]): {
    roles: string[];
    permissions: string[];
    primaryRole: string;
    level: number;
  } {
    const permissions = new Set<string>();
    let primary: Role | null = null;

    for (const group of groups) {
      let role: Role | null;
      try {
        role = Role.fromName(group);
      } catch {
        role = null; // unknown group — keep the name, grant nothing
      }
      if (role) {
        for (const p of role.permissions) permissions.add(p);
        if (!primary || role.level > primary.level) primary = role;
      }
    }

    return {
      roles: groups,
      permissions: [...permissions],
      primaryRole: primary?.name ?? groups[0] ?? '',
      level: primary?.level ?? 1,
    };
  }

  private assertStoreDomain(payload: JWTPayload): void {
    const allowed = this.config.allowedStoreDomain;
    if (!allowed) return; // check disabled

    const claim = payload['custom:store_domain'] as string | undefined;
    if (claim && claim !== allowed) {
      throw new CognitoAuthError(
        `store_domain claim '${claim}' does not match allowed domain '${allowed}'`
      );
    }
  }

  private persist(result: AuthenticationResult): void {
    setItem(ACCESS_TOKEN_KEY, result.AccessToken);
    setItem(ID_TOKEN_KEY, result.IdToken);
    if (result.RefreshToken) {
      setItem(REFRESH_TOKEN_KEY, result.RefreshToken);
    }
  }

  private clear(): void {
    removeItem(ACCESS_TOKEN_KEY);
    removeItem(ID_TOKEN_KEY);
    removeItem(REFRESH_TOKEN_KEY);
  }
}
