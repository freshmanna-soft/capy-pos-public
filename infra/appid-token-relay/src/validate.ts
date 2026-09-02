/**
 * What a caller may ask this relay to do, and nothing else.
 *
 * Two grants, matching exactly what `AppIdAuthAdapter.authenticate()`/`refresh()`
 * send — not the full surface App ID's token endpoint accepts. A caller cannot ask
 * this relay for a grant type it does not forward, because there is no branch that
 * would forward one.
 */

export type TokenRequest =
  | { readonly grantType: 'password'; readonly username: string; readonly password: string }
  | { readonly grantType: 'refresh_token'; readonly refreshToken: string };

/** What a validator returned when it refused the body. */
export interface Rejection {
  readonly error: string;
}

/** Transport cap, above any single field's own reasonable length. */
export const MAX_BODY_BYTES = 8 * 1024;

export function validate(body: unknown): TokenRequest | Rejection {
  if (typeof body !== 'object' || body === null || Array.isArray(body)) {
    return { error: 'Body must be a JSON object.' };
  }
  const record = body as Record<string, unknown>;

  const grantType = record['grant_type'];
  if (grantType === 'password') {
    const username = record['username'];
    const password = record['password'];
    if (typeof username !== 'string' || username.trim().length === 0) {
      return { error: 'username is required for grant_type=password.' };
    }
    if (typeof password !== 'string' || password.length === 0) {
      return { error: 'password is required for grant_type=password.' };
    }
    return { grantType: 'password', username, password };
  }

  if (grantType === 'refresh_token') {
    const refreshToken = record['refresh_token'];
    if (typeof refreshToken !== 'string' || refreshToken.length === 0) {
      return { error: 'refresh_token is required for grant_type=refresh_token.' };
    }
    return { grantType: 'refresh_token', refreshToken };
  }

  return { error: "grant_type must be 'password' or 'refresh_token'." };
}

/** Whether a validator refused. Mirrors the same predicate in the sibling proxies. */
export function isRejection<T>(result: T | Rejection): result is Rejection {
  return (
    typeof result === 'object' &&
    result !== null &&
    'error' in result &&
    typeof (result as Rejection).error === 'string'
  );
}
