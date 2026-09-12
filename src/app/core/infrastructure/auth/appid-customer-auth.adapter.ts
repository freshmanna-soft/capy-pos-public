import { Injectable, inject } from '@angular/core';
import { decodeProtectedHeader, jwtVerify, type JWTPayload } from 'jose';
import { CustomerAuthGateway } from '@core/application/auth/ports/customer-auth-gateway.port';
import { CredentialsDto } from '@core/application/auth/dtos/credentials.dto';
import { CustomerRegistrationDto } from '@core/application/auth/dtos/customer-registration.dto';
import { CustomerSessionDto } from '@core/application/auth/dtos/customer-session.dto';
import { DEFAULT_TENANT_ID } from '@core/infrastructure/database/dexie-database.service';
import { Permission } from '@core/domain/auth';
import { InvalidCredentialsError } from './local-credential-auth.adapter';
import { APPID_CONFIG, type AppIdConfig } from './appid-config';
import { AppIdAuthError, AppIdJwksKeyResolver } from './appid-jwks';

/**
 * AppIdCustomerAuthAdapter
 *
 * The real {@link CustomerAuthGateway} (epic #261 item 11) — the customer-side
 * counterpart of {@link AppIdAuthAdapter}, replacing
 * `InMemoryCustomerAuthAdapter`. Same tenant, same relay pattern, same JWKS
 * (`AppIdJwksKeyResolver`, shared rather than copied so the leading-zero fix
 * lives in exactly one place). Four things differ, and each one is the point:
 *
 * 1. **Audience.** `verifyAccessToken` binds `config.customerClientId`, never
 *    `staffClientId`. Staff and customers share one App ID *tenant* and are
 *    separated only by which App ID *application* the grant was exchanged
 *    under, so `aud` is the entire isolation guarantee: a staff token's `aud`
 *    is `staffClientId` and fails this check, a customer token's fails the
 *    staff adapter's. `issuer` stays identical — same tenant.
 * 2. **Relay.** Posts to `config.customerRelayUrl`
 *    (`infra/appid-token-relay`'s `/appid/customer/token`), which is a sibling
 *    of the staff route wired to the customer application's own client secret,
 *    not a variant of `relayUrl` — see `AppIdConfig`'s own doc comment for why
 *    it is a separate field rather than something derived from `relayUrl`.
 * 3. **Its own `sessionStorage` keys.** `capy_pos_customer_*`, not the staff
 *    adapter's `capy_pos_*`. That single-slot collision is why
 *    `CUSTOMER_AUTH_GATEWAY` is a separate port at all: self-checkout runs on
 *    the same device staff sign in on, so one tab has to hold both sessions.
 * 4. **`signUp`.** Not on {@link AuthGateway} — staff accounts are created by
 *    an admin, a customer creates their own (items 8a/16). It returns a
 *    {@link CustomerRegistrationDto} and no session, for the reason its own doc
 *    comment gives: item 3 proved a just-created account is `PENDING`.
 *
 * Not wired into DI here: binding `CUSTOMER_AUTH_GATEWAY` to this class, scoped
 * to the self-checkout lazy route's own providers, is item 13.
 *
 * Not verifiable against a live tenant yet either: `customerClientId` is empty
 * in every `environment.*.ts` because the customer App ID *application* (items
 * 1-3) has not been registered, and item 25 is what wires the resulting
 * credentials. Until then every verification here fails closed — which is the
 * correct behaviour for an identity whose audience is unknown.
 */

// ---------------------------------------------------------------------------
// Token storage — distinct keys from the staff adapter's, on purpose (point 3).
// ---------------------------------------------------------------------------

const CUSTOMER_ACCESS_TOKEN_KEY = 'capy_pos_customer_access_token';
const CUSTOMER_REFRESH_TOKEN_KEY = 'capy_pos_customer_refresh_token';

function setItem(key: string, value: string): void {
  try {
    sessionStorage.setItem(key, value);
  } catch {
    // sessionStorage unavailable (private mode / blocked) — continue without it
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
// Wire types (only the fields we consume)
// ---------------------------------------------------------------------------

/** App ID's own token response, passed through by the relay verbatim. */
interface RelayTokenResponse {
  access_token?: string;
  refresh_token?: string;
  error?: string;
  error_description?: string;
}

/** `POST /appid/customer/sign-up` answers `201 { id, email }` — no tokens. */
interface SignUpResponse {
  id?: string;
  email?: string;
  error?: string;
}

/**
 * The relay's sign-up route. An absolute path resolved against
 * `customerRelayUrl`'s origin, because one relay deployment registers both
 * routes (`infra/appid-token-relay/src/server.ts`) — deliberately not a regex
 * rewrite of the configured path, which is the pattern `AppIdConfig` rejects
 * for `customerRelayUrl` itself.
 */
const CUSTOMER_SIGN_UP_ROUTE = '/appid/customer/sign-up';

/** The one scope the customer application grants (`infra/appid-token-relay/src/customer-signup.ts`). */
const CUSTOMER_SCOPE = 'customer';

@Injectable()
export class AppIdCustomerAuthAdapter implements CustomerAuthGateway {
  private readonly config = inject<AppIdConfig>(APPID_CONFIG);

  /** Same tenant as staff, so the very same signing keys. */
  private readonly jwks = new AppIdJwksKeyResolver(() => this.jwksUri);

  private get issuer(): string {
    return `https://${this.config.region}.appid.cloud.ibm.com/oauth/v4/${this.config.tenantId}`;
  }

  private get jwksUri(): string {
    return `${this.issuer}/publickeys`;
  }

  private get relayUrl(): string {
    const url = this.config.customerRelayUrl;
    if (!url) {
      throw new AppIdAuthError(
        'No customerRelayUrl configured — customer sign-in is not available in this deployment'
      );
    }
    return url;
  }

  // -------------------------------------------------------------------------
  // CustomerAuthGateway
  // -------------------------------------------------------------------------

  /**
   * Register the customer. Does **not** sign them in, and must not start to.
   *
   * The relay's sign-up route answers `201 { id, email }` rather than a token
   * (item 8a: account creation goes through App ID's Management API, which does
   * not mint grants). This used to chase that with a password grant on the
   * customer token route so it could satisfy a `Promise<CustomerSessionDto>`,
   * which was written before item 3 ran the experiment: an account this route
   * just created is `PENDING`, so that grant is answered
   * `403 "Pending user verification"` — every time, for every account, against
   * any real tenant. The exchange therefore could not succeed, only mislabel
   * itself, and the form above it inherited an unreachable success path plus a
   * refusal wearing the wrong copy (`InvalidCredentialsError`'s "Invalid email
   * or password" read as a password-policy rejection). So the `201` is now the
   * whole answer, which is also all the relay ever promised.
   *
   * Backend errors propagate verbatim — mapping them to user-facing copy is the
   * sign-up form's job (item 16), not this adapter's.
   */
  async signUp(creds: CredentialsDto): Promise<CustomerRegistrationDto> {
    const email = normalizeEmail(creds.email);
    // Resolved before the try: a config failure is not a transport failure and
    // must not be re-worded as one by the catch below.
    const url = this.signUpUrl();

    let response: Response;
    try {
      response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password: creds.password }),
      });
    } catch (err) {
      throw new AppIdAuthError(`Customer sign-up request failed: ${(err as Error).message}`);
    }

    const data = (await response.json().catch(() => ({}))) as SignUpResponse;
    if (!response.ok) {
      // Verbatim: whatever the relay said is what the form gets to interpret —
      // plus the status, as a number. The form classifies 409/400/429 into its own
      // copy, and the only alternative to passing the status here is the form
      // digging it back out of the sentence, which cannot be done safely: the
      // relay forwards App ID's policy explanation and that prose quotes its own
      // bounds, so "between 8 and 100 characters" reads as a status.
      throw new AppIdAuthError(
        data.error ?? `Customer sign-up returned ${response.status}`,
        response.status
      );
    }

    // `email` rather than `data.email` as the fallback: the address this
    // adapter normalized and sent is the one the account exists under, so a
    // relay that answered `201` without echoing it back still leaves the form
    // able to tell the customer which inbox to open.
    return { customerId: data.id ?? '', email: data.email ?? email };
  }

  async authenticate(creds: CredentialsDto): Promise<CustomerSessionDto> {
    const result = await this.relayCall({
      grant_type: 'password',
      username: normalizeEmail(creds.email),
      password: creds.password,
    });

    const session = await this.buildSession(result);
    this.persist(result);
    return session;
  }

  async getActiveSession(): Promise<CustomerSessionDto | null> {
    const accessToken = getItem(CUSTOMER_ACCESS_TOKEN_KEY);
    if (!accessToken) return null;

    try {
      return await this.sessionFromToken(accessToken);
    } catch {
      // Expired, tampered, wrong tenant — or a staff token someone dropped in
      // this slot. Any of those is "no customer session".
      this.clear();
      return null;
    }
  }

  async refresh(): Promise<CustomerSessionDto> {
    const refreshToken = getItem(CUSTOMER_REFRESH_TOKEN_KEY);
    if (!refreshToken) {
      throw new AppIdAuthError('No customer refresh token — cannot refresh session');
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
    // Local clear only, same as the staff adapter: an App ID revocation
    // endpoint isn't confirmed against real docs, and dropping the token is a
    // real logout without it. Only the customer keys are removed — a staff
    // session in the same tab must survive a customer signing out.
    this.clear();
  }

  getAccessToken(): string | null {
    return getItem(CUSTOMER_ACCESS_TOKEN_KEY);
  }

  // -------------------------------------------------------------------------
  // Internals
  // -------------------------------------------------------------------------

  private signUpUrl(): string {
    try {
      return new URL(CUSTOMER_SIGN_UP_ROUTE, this.relayUrl).toString();
    } catch (err) {
      // `customerRelayUrl` is deployment config this adapter never validates
      // elsewhere, and `URL` answers an unparseable base with a raw
      // `TypeError`. `relayCall`'s own `fetch` failure already surfaces as an
      // `AppIdAuthError`; this path must match it, since that is the only error
      // type callers handle.
      if (err instanceof AppIdAuthError) throw err;
      throw new AppIdAuthError(
        `Invalid customerRelayUrl (${this.config.customerRelayUrl}): ${(err as Error).message}`
      );
    }
  }

  private async relayCall(body: Record<string, string>): Promise<RelayTokenResponse> {
    let response: Response;
    try {
      response = await fetch(this.relayUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
    } catch (err) {
      throw new AppIdAuthError(`App ID customer relay request failed: ${(err as Error).message}`);
    }

    const data = (await response.json().catch(() => ({}))) as RelayTokenResponse;
    if (response.ok && data.access_token) {
      return data;
    }

    if (data.error === 'invalid_grant') {
      throw new InvalidCredentialsError();
    }
    throw new AppIdAuthError(`App ID customer relay error: ${data.error ?? response.status}`);
  }

  private async buildSession(result: RelayTokenResponse): Promise<CustomerSessionDto> {
    if (!result.access_token) {
      throw new AppIdAuthError('App ID customer relay returned no access token');
    }
    return this.sessionFromToken(result.access_token);
  }

  private async sessionFromToken(accessToken: string): Promise<CustomerSessionDto> {
    const payload = await this.verifyAccessToken(accessToken);
    const scopes = this.readScopes(payload);

    return {
      customerId: payload.sub ?? '',
      email: typeof payload['email'] === 'string' ? payload['email'] : '',
      // Not App ID's own `tenant` claim — that is the service instance's id,
      // constant for every user. Same reasoning as the staff adapter's.
      tenantId: DEFAULT_TENANT_ID,
      // Only the customer scope, never App ID's framework scopes (`openid`,
      // `appid_default`, …) and never a staff role name that somehow rode
      // along: this identity is `customer` or it is nothing.
      roles: scopes.includes(CUSTOMER_SCOPE) ? [CUSTOMER_SCOPE] : [],
      permissions: scopes.includes(CUSTOMER_SCOPE) ? [Permission.PROCESS_SALE] : [],
      accessToken,
      expiresAt: new Date((payload.exp ?? 0) * 1000).toISOString(),
    };
  }

  /**
   * RS256 signature against the shared tenant JWKS, plus issuer and — the
   * whole point — `customerClientId` as the audience. `jose` matches `aud`
   * whether it is a string or an array (App ID's is an array).
   */
  private async verifyAccessToken(token: string): Promise<JWTPayload> {
    const audience = this.config.customerClientId;
    if (!audience) {
      // Fail closed rather than verify against nothing: an unset audience would
      // otherwise accept the staff tokens this adapter exists to reject.
      throw new AppIdAuthError(
        'No customerClientId configured — cannot verify a customer access token'
      );
    }

    const header = decodeProtectedHeader(token);
    const key = await this.jwks.resolveSigningKey(header.kid);

    const { payload } = await jwtVerify(token, key, {
      issuer: this.issuer,
      audience,
    });
    return payload;
  }

  /** Space-separated scope string → individual scope tokens. */
  private readScopes(payload: JWTPayload): string[] {
    const raw = payload['scope'];
    return typeof raw === 'string' ? raw.split(/\s+/).filter(Boolean) : [];
  }

  private persist(result: RelayTokenResponse): void {
    if (result.access_token) setItem(CUSTOMER_ACCESS_TOKEN_KEY, result.access_token);
    if (result.refresh_token) setItem(CUSTOMER_REFRESH_TOKEN_KEY, result.refresh_token);
  }

  private clear(): void {
    removeItem(CUSTOMER_ACCESS_TOKEN_KEY);
    removeItem(CUSTOMER_REFRESH_TOKEN_KEY);
  }
}

function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}
