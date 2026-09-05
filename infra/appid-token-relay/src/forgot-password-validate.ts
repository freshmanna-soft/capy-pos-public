/**
 * What a caller may ask the (unauthenticated) forgot-password route to do,
 * and nothing else — same "narrow to exactly what's forwarded" shape as
 * `validate.ts`.
 */

export interface ForgotPasswordRequest {
  readonly email: string;
}

/** What a validator returned when it refused the body. */
export interface Rejection {
  readonly error: string;
}

/** Transport cap — one email address, nothing that ever needs to be large. */
export const MAX_BODY_BYTES = 2 * 1024;

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function validate(body: unknown): ForgotPasswordRequest | Rejection {
  if (typeof body !== 'object' || body === null || Array.isArray(body)) {
    return { error: 'Body must be a JSON object.' };
  }
  const record = body as Record<string, unknown>;

  const email = record['email'];
  if (typeof email !== 'string' || !EMAIL_PATTERN.test(email.trim())) {
    return { error: 'email must be a valid email address.' };
  }

  return { email: email.trim().toLowerCase() };
}
