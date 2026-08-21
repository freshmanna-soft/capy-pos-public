import { InjectionToken } from '@angular/core';
import { AuthSessionDto } from '../dtos/auth-session.dto';
import { QuickAuthCapabilitiesDto, QuickSignInOperatorDto } from '../dtos/quick-auth.dto';

/**
 * QuickAuthGateway Port
 *
 * Signing in at a counter, in one gesture. Same destination as
 * {@link AuthGateway} — an `AuthSessionDto` — reached without typing a password
 * in front of a queue.
 *
 * A separate port rather than another method on `AuthGateway` because the input
 * is not credentials. A passkey assertion carries its own subject: the
 * authenticator tells us *who* signed, so there is no email to pass in and
 * nothing shaped like `CredentialsDto` to pass it in. Widening that DTO to a
 * union would make every existing caller handle a case it has no interest in.
 *
 * The session it returns is minted by the same issuer the password path uses, so
 * guards, the JWT claims and `CurrentUserService` cannot tell the three routes
 * apart. That is the point: this changes how a person proves who they are, not
 * what being signed in means.
 *
 * Enrollment lives on {@link QuickAuthAdminPort}, mirroring the split between
 * `AuthGateway` and `OperatorAdminPort`.
 *
 * Implementations MUST NOT throw for a person simply changing their mind — a
 * dismissed OS prompt is {@link PasskeyCancelledError}, which callers are
 * expected to swallow silently rather than surface as a failure.
 */
export interface QuickAuthGateway {
  /**
   * What this device can offer right now.
   *
   * Asked by the login screen before it renders, because a passkey button on a
   * till with no platform authenticator is worse than no button at all.
   */
  capabilities(): Promise<QuickAuthCapabilitiesDto>;

  /**
   * Sign in with a passkey enrolled on this device.
   *
   * Takes no operator id: the credential is discoverable, so the OS shows its own
   * account picker and the assertion identifies the subject. Asking the cashier
   * who they are first would be a worse flow *and* a worse guarantee — it would
   * let the screen suggest an identity the authenticator never vouched for.
   */
  signInWithPasskey(): Promise<AuthSessionDto>;

  /**
   * Sign in with an operator's till PIN.
   *
   * The fallback for a device with no platform authenticator. Weaker than a
   * passkey by construction — a PIN is a shared-shape secret that someone can
   * watch you type — so it is offered as a second choice, never as the default.
   */
  signInWithPin(operatorId: string, pin: string): Promise<AuthSessionDto>;

  /**
   * Operators who have a PIN set on this till, for the keypad's picker.
   *
   * Only operators who set one, so nobody appears in a pre-auth list without
   * having opted into this path.
   */
  listPinOperators(): Promise<QuickSignInOperatorDto[]>;
}

export const QUICK_AUTH_GATEWAY = new InjectionToken<QuickAuthGateway>('QUICK_AUTH_GATEWAY');

/**
 * The platform cannot do this at all — no WebAuthn, or no platform authenticator.
 *
 * Distinct from a refusal: this one means "do not offer the button", not "that
 * did not work".
 */
export class PasskeyUnavailableError extends Error {
  constructor(message = 'This device has no platform authenticator') {
    super(message);
    this.name = 'PasskeyUnavailableError';
  }
}

/**
 * The person dismissed the OS prompt, or it timed out.
 *
 * Its own type because it is the one outcome that must produce no error banner.
 * A cashier who touched the sensor by accident and cancelled has done nothing
 * wrong, and telling them "authentication failed" trains them to distrust a
 * screen that is working correctly.
 */
export class PasskeyCancelledError extends Error {
  constructor(message = 'Passkey sign-in was cancelled') {
    super(message);
    this.name = 'PasskeyCancelledError';
  }
}

/**
 * An assertion arrived and did not hold up.
 *
 * Unknown credential, wrong origin or relying party, user verification not
 * actually performed, a signature that does not verify, or a signature counter
 * that went backwards. All of these mean something is wrong rather than someone
 * mistyped, so they are deliberately not merged with `InvalidCredentialsError`.
 */
export class PasskeyVerificationError extends Error {
  constructor(message = 'Passkey could not be verified') {
    super(message);
    this.name = 'PasskeyVerificationError';
  }
}

/** The PIN did not match. Indistinguishable, on purpose, from "no PIN is set". */
export class InvalidPinError extends Error {
  constructor(message = 'Incorrect PIN') {
    super(message);
    this.name = 'InvalidPinError';
  }
}

/**
 * The credential verified, but the operator behind it can no longer sign in.
 *
 * Deactivating an operator has to take effect immediately, and a passkey is
 * exactly the route where it might not: the credential stays valid on the device
 * long after the account it points at was switched off. Checked on every sign-in,
 * after verification, so a revoked cashier cannot get in with a finger.
 */
export class OperatorInactiveError extends Error {
  constructor(message = 'That operator is no longer active') {
    super(message);
    this.name = 'OperatorInactiveError';
  }
}
