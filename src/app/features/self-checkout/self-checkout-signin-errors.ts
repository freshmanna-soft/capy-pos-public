import { CustomerVerificationPendingError } from '@core/application/auth/customer-auth.errors';
import { InvalidCredentialsError } from '@core/infrastructure/auth/local-credential-auth.adapter';
import { AppIdAuthError } from '@core/infrastructure/auth/appid-jwks';

export interface SignInRefusalCopy {
  readonly message: string;
  readonly field: 'email' | 'password' | null;
  readonly pendingVerification: boolean;
}

const INVALID_COPY = 'That email or password did not match. Check both and try again.';
const PENDING_COPY =
  'Verify your email before signing in. Open the verification link we sent, then try again.';
const RATE_LIMITED_COPY = 'Too many sign-in attempts just now. Please wait a moment and try again.';
const GENERIC_COPY = 'We could not sign you in just now. You can keep shopping without an account.';

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

  return { message: GENERIC_COPY, field: null, pendingVerification: false };
}
