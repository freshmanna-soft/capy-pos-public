/**
 * CustomerRegistrationDto
 *
 * What a customer self-registration actually yields: an account, and nothing to
 * sign in with. Deliberately NOT a {@link CustomerSessionDto} — there is no
 * token to put in one.
 *
 * Item 3 of epic #261 established empirically (2026-09-11) that an account App
 * ID has just created is `PENDING` and cannot complete a password grant until
 * the customer confirms it by email: App ID answers
 * `403 "Pending user verification"`. So the relay's sign-up route
 * (`infra/appid-token-relay/src/customer-signup.ts`) answers `201 { id, email }`
 * and no token, and this is the shape that fact forces on the port.
 *
 * Keeping it a separate type rather than a partially-filled session is the
 * point: a `CustomerSessionDto` with a blank `accessToken` would type-check
 * everywhere a real session does, and `CurrentCustomerService.setSession()`
 * would happily accept it and flip `isAuthenticated()` to true for an account
 * that cannot authenticate. The compiler refuses that here instead.
 */
export interface CustomerRegistrationDto {
  /** App ID subject for the account just created. */
  readonly customerId: string;
  /** The address the account was created against, normalized by the gateway. */
  readonly email: string;
}
