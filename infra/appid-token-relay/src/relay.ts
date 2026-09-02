/**
 * The one thing this service exists to do: attach the client secret App ID's
 * token endpoint requires, so the browser never has to.
 *
 * `AppIdAuthAdapter.authenticate()`/`refresh()` post here instead of to App ID
 * directly, because `POST /oauth/v4/<tenantID>/token` requires
 * `Authorization: Basic base64(clientId:clientSecret)` on every call — unlike
 * Cognito's public-client `InitiateAuth`, which needs no secret at all. A secret
 * cannot safely live in a browser bundle; this is the whole reason this service
 * exists rather than the adapter calling App ID straight, the way
 * `CognitoAuthAdapter` does.
 *
 * ## Why a real OAuth error is not a 502
 *
 * Every other relay in this repo (`vision-proxy`, `clerk-agent-relay`) hides the
 * real downstream error behind a generic message on failure — a model error is
 * never this caller's business. That reasoning does not apply here: App ID's
 * `{error: 'invalid_grant', ...}` for a wrong password is not this relay
 * *failing*, it is App ID correctly answering "no." `AppIdAuthAdapter` reads that
 * exact shape to raise `InvalidCredentialsError` instead of a generic auth error.
 * So `relay()` resolves with App ID's real status and body whenever App ID
 * actually answered — success or a well-formed OAuth error alike — and only
 * *rejects* for the cases that really are this relay's problem: the network is
 * down, or App ID sent back something that is not JSON at all.
 */
import type { TokenRequest } from './validate.ts';

export interface RelayConfig {
  readonly region: string;
  readonly tenantId: string;
  readonly clientId: string;
  readonly clientSecret: string;
}

export interface RelayResponse {
  readonly status: number;
  readonly body: unknown;
}

export async function relay(request: TokenRequest, config: RelayConfig): Promise<RelayResponse> {
  const endpoint = `https://${config.region}.appid.cloud.ibm.com/oauth/v4/${config.tenantId}/token`;

  // Multipart form-data, not urlencoded: this is the exact shape confirmed
  // working against a real App ID tenant during this service's own bootstrap
  // test — not a guess at what the endpoint accepts.
  const form = new FormData();
  if (request.grantType === 'password') {
    form.set('grant_type', 'password');
    form.set('username', request.username);
    form.set('password', request.password);
  } else {
    form.set('grant_type', 'refresh_token');
    form.set('refresh_token', request.refreshToken);
  }

  const basicAuth = Buffer.from(`${config.clientId}:${config.clientSecret}`).toString('base64');

  let response: Response;
  try {
    response = await fetch(endpoint, {
      method: 'POST',
      headers: { Authorization: `Basic ${basicAuth}`, Accept: 'application/json' },
      body: form,
    });
  } catch (err) {
    throw new Error(`App ID request failed: ${(err as Error).message}`);
  }

  let body: unknown;
  try {
    body = await response.json();
  } catch (err) {
    throw new Error(`App ID returned a non-JSON response: ${(err as Error).message}`);
  }

  return { status: response.status, body };
}
