import { Injectable, signal } from '@angular/core';

/**
 * PendingRegistrationStore
 *
 * The one hand-off between the sign-up form (epic #261 item 16) and the
 * check-your-email interstitial (item 17): the address the account was created
 * against, so the interstitial can name the inbox the verification mail went to.
 *
 * **Why not a query param.** The form used to navigate with
 * `queryParams: { email }`, which put a shopper's address in the address bar and
 * the session history of a terminal the *next* shopper walks up to — and nothing
 * read it, so the disclosure bought exactly nothing. Router `state` is better
 * (out of the URL) but Angular persists it into `history.state`, so a back
 * navigation or a reload still hands the address to whoever is standing there.
 * This holds it in memory instead.
 *
 * **Why a service rather than an input or a signal on the form.** The two screens
 * are separate routes, so neither can hold the other's state; what they do share
 * — and the only reason this works — is the ONE environment injector the
 * `self-checkout` parent route's `providers` create for the whole family (see
 * `app.routes.ts`, and the invariant `app.routes.spec.ts` pins). Provided on that
 * parent, this is one instance for the form and the interstitial both.
 * `@Injectable()` with no `providedIn: 'root'` is deliberate and matches
 * `CurrentCustomerService`: an in-flight registration must die with the route
 * subtree rather than outlive the lane in the root injector.
 *
 * **Read once.** {@link take} clears as it reads, so the address survives exactly
 * one arrival at the interstitial. A shopper who leaves the screen up, or a
 * reload that rebuilds it, gets the copy that names no inbox — which is the
 * failure mode this store exists to choose.
 */
@Injectable()
export class PendingRegistrationStore {
  private readonly _email = signal<string | null>(null);

  /**
   * Remember the address the gateway registered — the normalized one, not the
   * raw field value, so the interstitial names the inbox that was actually used.
   */
  remember(email: string): void {
    this._email.set(email);
  }

  /** The remembered address, or null; clears it, so a second read gets null. */
  take(): string | null {
    const email = this._email();
    this._email.set(null);
    return email;
  }
}
