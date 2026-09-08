/**
 * What a caller may ask the (unauthenticated) customer sign-up route to do,
 * and nothing else — same "narrow to exactly what's forwarded" shape as
 * `validate.ts` and `forgot-password-validate.ts`.
 *
 * ## Why the password is not policy-checked here
 *
 * This is epic #261's item 8a: the happy path only. Password *policy* (length,
 * strength) and the duplicate-email answer are item 8b, deliberately separate —
 * both are about what a *rejected* sign-up looks like, and App ID enforces its
 * own tenant password policy on `sign_up` regardless of what this file does. So
 * the one guarantee kept here is the one `createUser` cannot make for itself:
 * a present, non-empty password and an address that is at least shaped like one,
 * so no account is ever attempted in a state nobody asked for.
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

  const password = record['password'];
  if (typeof password !== 'string' || password.length === 0) {
    return { error: 'password is required.' };
  }

  return { email: email.trim().toLowerCase(), password };
}
