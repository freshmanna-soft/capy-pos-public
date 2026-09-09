/**
 * Where leaving the clerk lane lands you.
 *
 * `/clerk` is reachable without a staff session (#219), which makes "back out of
 * here" two different journeys sharing one button. A cashier is stepping out of a
 * mode and belongs at the till. A customer has no till and no login — sending
 * them to `/pos` would bounce them off `authGuard` and dump them on the staff
 * login page, which is the least useful screen in the app for someone holding a
 * basket. They go to the customer lane instead.
 *
 * A pure function rather than a method on the component so the decision is
 * testable without standing up a canvas, a camera and the agent tier.
 */

/** The staff terminal — the till, and where the checkout overlay lives. */
export const STAFF_EXIT_PATH = '/pos';

/** The customer lane. Unguarded, so an anonymous visitor actually arrives. */
export const CUSTOMER_EXIT_PATH = '/self-checkout';

/** What the way out is called when it leads to the till. */
export const STAFF_EXIT_LABEL = 'Back to POS';

/**
 * What the way out is called when it leads to the customer lane.
 *
 * Named after the destination screen's own heading ("Self-checkout") rather than
 * the route, so the button and the page a customer lands on agree.
 */
export const CUSTOMER_EXIT_LABEL = 'Back to self-checkout';

/**
 * Resolve the route to leave `/clerk` for.
 *
 * @param isStaffAuthenticated whether an operator session is active.
 */
export function clerkExitPath(isStaffAuthenticated: boolean): string {
  return isStaffAuthenticated ? STAFF_EXIT_PATH : CUSTOMER_EXIT_PATH;
}

/**
 * Resolve the label for the way out, so the button names where it actually goes.
 *
 * Deliberately derived from the same argument as `clerkExitPath` and living
 * beside it: the two were briefly out of step — the destination became
 * session-aware while the button kept reading "Back to POS" — which told a
 * customer the one thing the un-gating exists to stop them believing, that this
 * lane belongs to the till and they are on their way to it. A label is not
 * decoration when it is the only description of where a control leads.
 *
 * @param isStaffAuthenticated whether an operator session is active.
 */
export function clerkExitLabel(isStaffAuthenticated: boolean): string {
  return isStaffAuthenticated ? STAFF_EXIT_LABEL : CUSTOMER_EXIT_LABEL;
}

/**
 * Resolve the route the "pay now" hand-off targets, plus its query params.
 *
 * Checkout lives in `/pos` as an overlay rather than a route, so the staff path
 * asks for it with `?checkout=1`. There is no customer-side payment step yet —
 * it arrives with the later #218 stories — so an anonymous customer is handed to
 * the customer lane without the flag rather than being bounced into a staff
 * login they cannot complete. Deliberately graceful-but-incomplete, not a
 * silently broken redirect.
 */
export function clerkCheckoutTarget(isStaffAuthenticated: boolean): {
  path: string;
  queryParams?: Record<string, number>;
} {
  return isStaffAuthenticated
    ? { path: STAFF_EXIT_PATH, queryParams: { checkout: 1 } }
    : { path: CUSTOMER_EXIT_PATH };
}
