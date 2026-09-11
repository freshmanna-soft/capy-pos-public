import { InjectionToken } from '@angular/core';
import { environment } from '../../../../environments/environment';

/**
 * Shared IBM App ID configuration surface.
 *
 * Extracted from {@link AppIdAuthAdapter} for epic #261 item 13, mirroring what
 * item 11 did for the shared JWKS logic (`appid-jwks.ts`). The reason is an
 * import edge: while `AppIdCustomerAuthAdapter` read `APPID_CONFIG` from
 * `appid-auth.adapter.ts`, anything reaching the customer adapter dragged in the
 * entire *staff* adapter, so the route-scoped `CUSTOMER_AUTH_GATEWAY` binding had
 * an import graph that was not scoped at all. Config is the only thing the two
 * adapters actually share here, so config is what moves.
 *
 * It buys no bytes today and is not claimed to — both adapters land in the
 * initial bundle either way, see the measured note in `app.routes.ts`. It buys
 * the customer half of App ID a graph that does not include the staff half,
 * which is what makes a later lazy boundary or customer-only build possible;
 * `appid-customer-auth.import-graph.spec.ts` keeps the edge from returning.
 *
 * The token identity and its `providedIn: 'root'` factory are deliberately
 * unchanged, and `appid-auth.adapter.ts` re-exports both names, so every
 * existing consumer (`AppIdOperatorAdminAdapter`, the adapter specs) keeps
 * working untouched.
 */
export interface AppIdConfig {
  readonly enabled: boolean;
  readonly region: string;
  readonly tenantId: string;
  readonly staffClientId: string;
  /**
   * The customer application's client id (epic #261). Staff and customers share
   * one App ID *tenant* — there is no second pool — and are separated by being
   * two distinct App ID *applications*, because the client a grant is exchanged
   * under is what decides the scopes the resulting token carries (see
   * `infra/appid-token-relay/src/customer-token.ts`).
   *
   * Not read by the staff adapter, and deliberately not a fallback for
   * `staffClientId`: what keeps a customer token out of the staff gateway is
   * `verifyAccessToken`'s audience binding — a customer token's `aud` is this
   * id, the staff check demands `staffClientId`, so verification fails. It is
   * carried here so the customer half of the config lives beside the staff half
   * rather than in a second, drifting place, and so
   * {@link AppIdCustomerAuthAdapter} has it to bind its own audience against.
   */
  readonly customerClientId?: string;
  /** `infra/appid-token-relay` — holds the client secret App ID's token
   *  endpoint requires, which cannot live in this browser bundle. */
  readonly relayUrl: string;
  /**
   * The relay's customer sign-in route (`/appid/customer/token`) — a sibling of
   * `relayUrl`, not a variant of it. Its own field rather than something derived
   * from `relayUrl` by string surgery: the two are separately deployable (a
   * deployment can serve staff sign-in before the customer client's secret
   * lands, which is why the relay answers 502 rather than 404 there), and an
   * empty value states that plainly instead of pointing at a route that will
   * reject every grant.
   */
  readonly customerRelayUrl?: string;
}

/**
 * App ID configuration seam. Defaults to `environment.appId`; specs and
 * alternate deployments override it via the DI container.
 */
export const APPID_CONFIG = new InjectionToken<AppIdConfig>('APPID_CONFIG', {
  providedIn: 'root',
  factory: () => environment.appId as AppIdConfig,
});
