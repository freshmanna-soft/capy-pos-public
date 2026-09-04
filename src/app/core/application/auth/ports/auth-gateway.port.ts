import { InjectionToken } from '@angular/core';
import { CredentialsDto } from '../dtos/credentials.dto';
import { AuthSessionDto } from '../dtos/auth-session.dto';

/**
 * AuthGateway Port
 *
 * Swap seam that decouples the application layer from the concrete
 * authentication mechanism (local bcrypt in Story #40, Cognito in #42/#43).
 *
 * Implementations live in infrastructure and are bound via AUTH_GATEWAY token.
 */
export interface AuthGateway {
  /**
   * Validate credentials and return a signed session.
   * Throws `InvalidCredentialsError` when authentication fails.
   */
  authenticate(creds: CredentialsDto): Promise<AuthSessionDto>;

  /**
   * Rehydrate a session from persisted storage on app boot.
   * Returns null when no valid session is found.
   */
  getActiveSession(): Promise<AuthSessionDto | null>;

  /**
   * Attempt to refresh the current session token.
   * Throws when no session exists or the refresh fails.
   */
  refresh(): Promise<AuthSessionDto>;

  /** Invalidate the current session and remove stored tokens. */
  signOut(): Promise<void>;

  /**
   * Return the raw JWT string synchronously (no IO).
   * Returns null when not authenticated — safe to call on the hot path.
   */
  getAccessToken(): string | null;

  /**
   * Whether `requestPasswordReset()` can actually do anything on this
   * backend — `false` for {@link LocalCredentialAuthAdapter}/
   * {@link CognitoAuthAdapter} (no self-service reset flow built for either),
   * `true` for {@link AppIdAuthAdapter}. A capability flag, not a permission
   * check: `LoginComponent` reads this to decide whether to *offer* the
   * "Forgot password?" link at all — the same "offered only when it can
   * succeed" convention already used for passkey/PIN and for
   * `OperatorAdminPort.supportsCreate`.
   */
  readonly supportsPasswordReset: boolean;

  /**
   * Ask the backend to email `email` a way to set a new password. Resolves
   * regardless of whether an account exists for that email — this is a
   * deliberate anti-enumeration property the implementation must preserve,
   * not an oversight to "fix" by rejecting for an unknown address.
   */
  requestPasswordReset(email: string): Promise<void>;
}

export const AUTH_GATEWAY = new InjectionToken<AuthGateway>('AUTH_GATEWAY');
