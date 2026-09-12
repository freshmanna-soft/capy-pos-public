import { InjectionToken } from '@angular/core';
import { CredentialsDto } from '../dtos/credentials.dto';
import { CustomerRegistrationDto } from '../dtos/customer-registration.dto';
import { CustomerSessionDto } from '../dtos/customer-session.dto';

/**
 * CustomerAuthGateway Port
 *
 * Swap seam for the *customer* identity introduced by Epic #261's
 * self-checkout flow. Mirrors {@link AuthGateway} method-for-method; it is a
 * second, parallel port rather than a reuse because the staff gateway and its
 * `CurrentUserService` are a single root singleton — one browser tab cannot
 * hold a staff session and a customer session in that one slot at the same
 * time, and self-checkout has to work on the same device a staff member also
 * signs in on.
 *
 * The one shape that is NOT in {@link AuthGateway} is {@link signUp}: staff
 * accounts are created for an operator by an admin, while a customer creates
 * their own (epic items 8a/16), so self-registration belongs on this seam.
 *
 * Implementations live in infrastructure and are bound via the
 * CUSTOMER_AUTH_GATEWAY token. `InMemoryCustomerAuthAdapter` backs it until
 * `AppIdCustomerAuthAdapter` lands (epic item 11); the binding itself is
 * scoped to the self-checkout lazy route by epic item 13 — deliberately not
 * root-provided, so nothing outside self-checkout can resolve a customer
 * identity by accident.
 */
export interface CustomerAuthGateway {
  /**
   * Self-register a new customer and return the account that was created.
   *
   * Returns a {@link CustomerRegistrationDto}, **not** a session, and this is
   * load-bearing rather than a convenience: item 3 proved empirically
   * (2026-09-11) that an account App ID has just created is `PENDING` and
   * cannot complete a password grant until it is confirmed by email — App ID
   * answers `403 "Pending user verification"`. A `signUp` that promised a
   * session could therefore only ever have delivered one by attempting that
   * grant, which always fails, making its own success path unreachable. The
   * caller's job after this resolves is item 17's "check your email"
   * interstitial, not a signed-in lane.
   *
   * Throws `CustomerAlreadyExistsError`-style backend errors verbatim — the
   * sign-up form (epic item 16) is what maps them to copy, not this port.
   */
  signUp(creds: CredentialsDto): Promise<CustomerRegistrationDto>;

  /**
   * Validate credentials and return a signed session.
   * Throws `InvalidCredentialsError` when authentication fails.
   */
  authenticate(creds: CredentialsDto): Promise<CustomerSessionDto>;

  /**
   * Rehydrate a customer session from persisted storage on route entry.
   * Returns null when no valid session is found.
   */
  getActiveSession(): Promise<CustomerSessionDto | null>;

  /**
   * Attempt to refresh the current customer session token.
   * Throws when no session exists or the refresh fails.
   */
  refresh(): Promise<CustomerSessionDto>;

  /** Invalidate the current customer session and remove stored tokens. */
  signOut(): Promise<void>;

  /**
   * Return the raw JWT string synchronously (no IO).
   * Returns null when not authenticated — safe to call on the hot path
   * (every self-checkout call to `pos-api` reads it).
   */
  getAccessToken(): string | null;
}

export const CUSTOMER_AUTH_GATEWAY = new InjectionToken<CustomerAuthGateway>(
  'CUSTOMER_AUTH_GATEWAY'
);
