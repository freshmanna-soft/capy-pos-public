/**
 * What a caller may ask the (unauthenticated) customer sign-up route to do,
 * and nothing else — same "narrow to exactly what's forwarded" shape as
 * `validate.ts` and `forgot-password-validate.ts`.
 *
 * ## Why the password is still not policy-checked here (item 8b)
 *
 * Item 8b gave this route real answers for a duplicate email and a refused
 * password, and neither of them lives here. App ID enforces the *tenant's* own
 * password policy on `sign_up`, and that policy is a console setting an operator
 * can change without redeploying this service — so a minimum length copied into
 * this file could only ever drift out of agreement with it, and would reject a
 * password the tenant would have accepted. The tenant stays the one authority;
 * `customer-signup.ts` turns its refusal into a message the caller can act on.
 * Duplicate detection is likewise not possible here at all: this function is pure
 * and knows nothing about existing accounts.
 *
 * What does belong here is *shape* — the checks that need no policy and no
 * network, so no account is ever attempted in a state nobody asked for: a present
 * address that looks like one, a present non-empty password, and an upper bound on
 * each. The bounds are ours rather than the tenant's because they are transport
 * facts, not policy: `MAX_EMAIL_LENGTH` is the longest address RFC 5321 permits,
 * and `MAX_PASSWORD_LENGTH` keeps a body under `MAX_BODY_BYTES` from arriving as a
 * single field no policy would have accepted anyway. Maxima only — a *minimum*
 * would be policy.
 *
 * The email is normalized (trimmed, lower-cased) and the password is passed
 * through byte-for-byte — exactly the split `validate()` already makes between
 * `username` and `password`, and the one `createUser`'s own doc comment relies
 * on: whitespace is never part of an address and can be a real part of a
 * passphrase.
 */

export interface CustomerSignupRequest {
  readonly email: string;
  readonly password: string;
}

/** What a validator returned when it refused the body. */
export interface Rejection {
  readonly error: string;
}

/** Transport cap — one address and one passphrase, nothing that ever needs to be large. */
export const MAX_BODY_BYTES = 4 * 1024;

/** Longest address RFC 5321 allows — a transport bound, not a policy one. */
export const MAX_EMAIL_LENGTH = 254;

/**
 * Upper bound on the passphrase. Generous on purpose (a real passphrase is long),
 * and a maximum rather than a minimum: the minimum is the tenant's policy to state,
 * and `customer-signup.ts` reports it when the tenant refuses.
 */
export const MAX_PASSWORD_LENGTH = 256;

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function validate(body: unknown): CustomerSignupRequest | Rejection {
  if (typeof body !== 'object' || body === null || Array.isArray(body)) {
    return { error: 'Body must be a JSON object.' };
  }
  const record = body as Record<string, unknown>;

  const email = record['email'];
  if (typeof email !== 'string' || !EMAIL_PATTERN.test(email.trim())) {
    return { error: 'email must be a valid email address.' };
  }
  if (email.trim().length > MAX_EMAIL_LENGTH) {
    return { error: `email must be at most ${MAX_EMAIL_LENGTH} characters.` };
  }

  const password = record['password'];
  if (typeof password !== 'string' || password.length === 0) {
    return { error: 'password is required.' };
  }
  if (password.length > MAX_PASSWORD_LENGTH) {
    return { error: `password must be at most ${MAX_PASSWORD_LENGTH} characters.` };
  }

  return { email: email.trim().toLowerCase(), password };
}
