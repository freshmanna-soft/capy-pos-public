/**
 * The self-checkout family's own paths, in one place.
 *
 * Absolute, because every navigation to them is a `Router.navigate` from
 * somewhere that does not carry an `ActivatedRoute` (see
 * `SelfCheckoutComponent.goToSignUp`'s own note on why the lane avoids
 * `routerLink`), so a relative path would have nothing to resolve against.
 *
 * A constants file rather than literals at each call site, and rather than the
 * form exporting them: the lane links *into* the sign-up form and the form
 * routes *on to* the interstitial, so any two of the three would otherwise
 * import the third and the interstitial would end up depending on the form it
 * merely follows. They also have to stay in step with `app.routes.ts`, where
 * these three are children of one parent segment.
 */

/** The lane itself — also the "keep shopping without an account" destination. */
export const LANE_ROUTE = '/self-checkout';

/** The customer's own sign-up form (Epic #261 item 16). */
export const SIGN_UP_ROUTE = '/self-checkout/sign-up';

/** Where a created-but-unverified account is sent (Epic #261 item 17, issue #311). */
export const CHECK_EMAIL_ROUTE = '/self-checkout/check-email';
