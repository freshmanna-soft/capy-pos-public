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
  /**
   * App ID subject for the account just created — absent if the backend answered
   * `201` without one.
   *
   * Optional on purpose, and the asymmetry with {@link email} below is the point.
   * The adapter used to answer a missing id with `''`, which is not a fallback but
   * a fabricated identity: `''` type-checks everywhere a real `sub` does, and the
   * first thing to key a lookup or an audit row off it would silently key it off
   * nothing. `email` has a local truth to fall back on — the address the adapter
   * itself normalized and sent, which is the account's — and an id has none, so
   * this is absent instead of empty and the compiler makes every future reader say
   * what it does about that.
   */
  readonly customerId?: string;
  /** The address the account was created against, normalized by the gateway. */
  readonly email: string;
}
