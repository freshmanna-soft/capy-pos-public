import { CustomerVerificationPendingError } from '@core/application/auth/customer-auth.errors';
import { InvalidCredentialsError } from '@core/infrastructure/auth/local-credential-auth.adapter';
import { AppIdAuthError } from '@core/infrastructure/auth/appid-jwks';

/**
 * Sign-in refusal → customer-facing copy for the /shop account modal.
 *
 * Ported from the retired self-checkout sign-in form (its folder is removed by
 * PR #379) rather than imported from it, so /shop does not depend on a feature
 * that is going away. A pure function for the same reason it was one there:
 * every refusal can be asserted without rendering a form.
 *
 * Classification is by error *type* and the status the adapter attaches, never
 * by scraping the relay's prose — see `AppIdAuthError.status`.
 */
export interface SignInRefusalCopy {
  readonly message: string;
  /** The input to mark `aria-invalid`, or null when the refusal blames neither. */
  readonly field: 'email' | 'password' | null;
  /** True when the account exists but its email is not verified yet. */
  readonly pendingVerification: boolean;
}

// Deliberately does not say which of the two was wrong: the relay answers an
// unknown address and a wrong password identically, and so must this copy.
const INVALID_COPY = 'That email or password did not match. Check both and try again.';
const PENDING_COPY =
  'Verify your email before signing in. Open the verification link we sent, then try again.';
const RATE_LIMITED_COPY = 'Too many sign-in attempts just now. Please wait a moment and try again.';
const NETWORK_COPY =
  'We could not reach the sign-in service. Check your connection and try again — you can keep shopping meanwhile.';
const GENERIC_COPY = 'We could not sign you in just now. You can keep shopping without an account.';

/**
 * The adapter's own wording for a `fetch` that never got an answer (offline,
 * DNS, CORS refusal). It composes these itself, so matching the prefix is
 * matching our own code, not upstream prose.
 */
const TRANSPORT_FAILURE =
  /^(?:App ID customer relay request failed|Customer sign-up request failed)/;

/** True when the request never reached the relay — shared with the sign-up mapping. */
export function isTransportFailure(error: unknown): boolean {
  return (
    error instanceof AppIdAuthError &&
    error.status === null &&
    TRANSPORT_FAILURE.test(error.message)
  );
}

/** Maps provider/application failures to neutral, actionable customer copy. */
export function describeSignInRefusal(error: unknown): SignInRefusalCopy {
  if (error instanceof CustomerVerificationPendingError) {
    return { message: PENDING_COPY, field: 'email', pendingVerification: true };
  }

  if (error instanceof InvalidCredentialsError) {
    return { message: INVALID_COPY, field: null, pendingVerification: false };
  }

  if (error instanceof AppIdAuthError && error.status === 429) {
    return { message: RATE_LIMITED_COPY, field: null, pendingVerification: false };
  }

  if (isTransportFailure(error)) {
    return { message: NETWORK_COPY, field: null, pendingVerification: false };
  }

  return { message: GENERIC_COPY, field: null, pendingVerification: false };
}
