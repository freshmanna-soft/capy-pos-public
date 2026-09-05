import { Injectable, inject } from '@angular/core';
import { DexieDatabase } from '@core/infrastructure/database/dexie-database.service';
import { AuthGateway } from '@core/application/auth/ports/auth-gateway.port';
import { CredentialsDto } from '@core/application/auth/dtos/credentials.dto';
import { AuthSessionDto } from '@core/application/auth/dtos/auth-session.dto';
import { SessionIssuer, clearToken, readToken } from './session-issuer';
import { compareSecret, hashSecret } from './secret-hash';

// ---------------------------------------------------------------------------
// Domain errors
// ---------------------------------------------------------------------------

export class InvalidCredentialsError extends Error {
  constructor() {
    super('Invalid email or password');
    this.name = 'InvalidCredentialsError';
  }
}

/**
 * Hash a plaintext password for a newly created account.
 *
 * Kept exported under this name because callers across the app and its specs
 * already use it. The implementation lives in `secret-hash.ts`, shared with the
 * till PIN — see the note there on why there is only one of these.
 */
export const hashPassword = hashSecret;

// ---------------------------------------------------------------------------
// Adapter
// ---------------------------------------------------------------------------

/**
 * LocalCredentialAuthAdapter
 *
 * Email and password against the local Dexie `operators` table, for a till with
 * no backend. Verifying the password is all this owns: the session it returns is
 * minted by {@link SessionIssuer}, which the passkey and PIN paths also use, so
 * all three routes produce identical claims.
 *
 * When the Cognito adapter is enabled (#42) this file is bypassed entirely and
 * credentials are validated server-side.
 */
@Injectable()
export class LocalCredentialAuthAdapter implements AuthGateway {
  private readonly db = inject(DexieDatabase);
  private readonly sessions = inject(SessionIssuer);

  async authenticate(creds: CredentialsDto): Promise<AuthSessionDto> {
    const email = creds.email.trim().toLowerCase();

    const operator = await this.db.operators.where('email').equals(email).first();

    if (!operator || !operator.isActive) {
      throw new InvalidCredentialsError();
    }

    const passwordMatch = await compareSecret(creds.password, operator.passwordHash);
    if (!passwordMatch) {
      throw new InvalidCredentialsError();
    }

    return this.sessions.issueFor(operator);
  }

  async getActiveSession(): Promise<AuthSessionDto | null> {
    return this.sessions.readActive();
  }

  async refresh(): Promise<AuthSessionDto> {
    const current = await this.getActiveSession();
    if (!current) {
      throw new Error('No active session to refresh');
    }

    // Rebuild from CURRENT database state (not the stale token claims) so a role
    // reassignment or permission change made while signed in takes effect on the
    // next refresh — this is what makes admin changes reach the current user's
    // guards and gated UI live (AC4, #44).
    const operator = await this.db.operators.get(current.operatorId);
    if (!operator || !operator.isActive) {
      // The operator was removed or deactivated — treat as signed out.
      clearToken();
      throw new Error('Operator no longer active — session refresh denied');
    }
    return this.sessions.issueFor(operator);
  }

  async signOut(): Promise<void> {
    clearToken();
  }

  getAccessToken(): string | null {
    return readToken();
  }

  readonly supportsPasswordReset = false;

  /** Local/dev has no self-service reset flow — a seeded operator's password is fixed at seed time. */
  requestPasswordReset(): Promise<void> {
    return Promise.reject(new Error('Password reset is not supported for local credentials.'));
  }
}
