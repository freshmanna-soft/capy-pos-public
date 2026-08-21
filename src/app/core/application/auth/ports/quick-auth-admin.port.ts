import { InjectionToken } from '@angular/core';
import { PasskeySummaryDto } from '../dtos/quick-auth.dto';

/**
 * QuickAuthAdminPort
 *
 * Setting up and taking away the fast sign-in methods — the enrollment side of
 * {@link QuickAuthGateway}. Split for the same reason `OperatorAdminPort` is
 * split from `AuthGateway`: authenticating and administering are different jobs
 * with different callers, and the login screen has no business being able to
 * enroll anything.
 *
 * Every method here assumes an already-authenticated operator. That is the trust
 * bootstrap and it is deliberate — a password (or an existing passkey) once, then
 * a gesture forever. Enrollment that did not require proving who you are would
 * let anyone who walks up to an unlocked till mint themselves a credential.
 */
export interface QuickAuthAdminPort {
  /**
   * Enroll a passkey on *this* device for `operatorId`.
   *
   * Per device and per origin, which is a property of the mechanism rather than a
   * limitation to work around: the private key never leaves the machine it was
   * created on. An operator who works two tills enrolls at both, and `label` is
   * how they later tell those entries apart.
   *
   * Implementations must refuse to enroll a second credential for a passkey the
   * authenticator already holds, so one sensor cannot accumulate duplicate rows
   * for the same finger.
   */
  enrollPasskey(operatorId: string, label: string): Promise<PasskeySummaryDto>;

  /** Passkeys enrolled on this device for `operatorId`. */
  listPasskeys(operatorId: string): Promise<PasskeySummaryDto[]>;

  /**
   * Forget a passkey.
   *
   * Removes our record of the public key, which is all we hold — the credential
   * itself lives in the OS keychain and is the operator's to delete there. Worth
   * being straight about in the UI: revoking here stops this till accepting it,
   * it does not reach into the authenticator.
   */
  revokePasskey(credentialId: string): Promise<void>;

  /**
   * Set or replace an operator's till PIN.
   *
   * Stored as a PBKDF2-SHA256 hash through the same helper the password path
   * uses, so there is exactly one place in this codebase that knows how a secret
   * is turned into something storable.
   *
   * @throws WeakPinError when the PIN is too short, or too guessable to be worth
   *   storing at all.
   */
  setPin(operatorId: string, pin: string): Promise<void>;

  /** Remove an operator's PIN, leaving them the passkey and password paths. */
  clearPin(operatorId: string): Promise<void>;
}

export const QUICK_AUTH_ADMIN_PORT = new InjectionToken<QuickAuthAdminPort>(
  'QUICK_AUTH_ADMIN_PORT'
);

/**
 * The proposed PIN is not worth storing.
 *
 * Carries `reason` so the UI can say which rule was broken. A keypad that just
 * refuses without saying why gets the same rejected PIN typed three more times.
 */
export class WeakPinError extends Error {
  constructor(readonly reason: 'too-short' | 'too-long' | 'not-numeric' | 'too-guessable') {
    super(WEAK_PIN_MESSAGES[reason]);
    this.name = 'WeakPinError';
  }
}

const WEAK_PIN_MESSAGES: Record<WeakPinError['reason'], string> = {
  'too-short': 'A PIN needs at least 4 digits.',
  'too-long': 'A PIN can be at most 8 digits.',
  'not-numeric': 'A PIN can only contain digits.',
  'too-guessable': 'That PIN is too easy to guess. Avoid repeats and runs like 1234.',
};

/**
 * The authenticator already holds a passkey for this operator on this device.
 *
 * Reported by the authenticator itself, via `excludeCredentials`, rather than
 * detected by us — which is the only place it *can* be detected, since the
 * authenticator knows what keys it holds and we only know what we recorded. Worth
 * its own type because it is not a failure: the operator is already set up, and
 * telling them so is the correct outcome.
 */
export class PasskeyAlreadyEnrolledError extends Error {
  constructor(message = 'This device already has a passkey for that operator') {
    super(message);
    this.name = 'PasskeyAlreadyEnrolledError';
  }
}
