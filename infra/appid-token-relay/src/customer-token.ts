/**
 * `POST /appid/customer/token` — the same password/refresh grant as the staff
 * route, exchanged under a **different App ID application**.
 *
 * ## Why this is a second route and not a flag on the first
 *
 * Staff and customers live in the same App ID tenant (one tenant, not a second
 * billable pool — see epic #261), but as two separate *applications*. The client
 * the grant is exchanged under is what decides the scopes the resulting token
 * carries: staff's client grants the staff scopes `pos-api` maps to real
 * permissions, the customer client grants only `customer`. So the credential pair
 * is the entire difference between the two routes, and it is not a parameter a
 * caller may pick — a browser that could choose its own client id would choose
 * staff's. Hence one route per client, each wired to its own credentials in
 * `server.ts`, and no fallback in here.
 *
 * Everything else is deliberately shared: `validate()` (the same two grants —
 * a customer signs in and refreshes exactly like staff does) and `relay()` (the
 * same App ID token endpoint, the same multipart form, the same
 * pass-App-ID's-answer-through-verbatim contract). Only the `Authorization:
 * Basic` pair differs.
 *
 * ## Why an unconfigured customer client throws
 *
 * `APPID_CUSTOMER_CLIENT_ID`/`_SECRET` are optional at startup, like
 * `APPID_MANAGEMENT_APIKEY` — a deployment that has not yet run epic #261's
 * item 25 (the Terraform secret) must keep signing staff in exactly as before
 * rather than refusing to boot over a route it does not use yet. But an empty
 * pair must not reach App ID: `relay()` would send `Basic base64(":")`, App ID
 * would answer `invalid_client`, and `http.ts` passes a well-formed OAuth error
 * through verbatim — so a *deployment* mistake would surface to a customer as
 * "your credentials are wrong". Throwing instead routes it to the boundary's own
 * generic 502, which is what a service-side misconfiguration actually is, and the
 * real reason lands in the relay's log where an operator can see it.
 */
import { relay, type RelayConfig, type RelayResponse } from './relay.ts';
import type { TokenRequest } from './validate.ts';

/** The customer sign-in path. A sibling of `/appid/token`, not a variant of it. */
export const CUSTOMER_TOKEN_ROUTE = '/appid/customer/token';

/**
 * The customer half of the App ID config: the shared tenant, and the customer
 * application's own credentials. Deliberately does *not* name the staff pair —
 * a config object that carried both would make a fallback to staff's client one
 * typo away.
 */
export interface CustomerTokenConfig {
  readonly region: string;
  readonly tenantId: string;
  readonly customerClientId: string;
  readonly customerClientSecret: string;
}

/** The token exchange itself. `relay()` in production; stubbed in tests. */
export type TokenExchange = (request: TokenRequest, config: RelayConfig) => Promise<RelayResponse>;

/**
 * Whether this deployment can serve customer sign-in at all. Both halves are
 * required: an id without a secret cannot build the Basic header App ID needs,
 * and a secret without an id has nothing to identify. `server.ts` reads this only
 * to warn at startup — the route is registered either way, so an unconfigured
 * deployment answers a 502 (this service is not ready) rather than a 404 (this
 * route does not exist), which would be a lie the moment the secret lands.
 */
export function customerClientConfigured(config: CustomerTokenConfig): boolean {
  return config.customerClientId.length > 0 && config.customerClientSecret.length > 0;
}

/**
 * The `handle` for `createRequestListener` — resolves with App ID's real
 * status and body, and throws only for what really is this service's problem
 * (a transport failure from `relay()`, or the customer client not being
 * configured at all).
 */
export function createCustomerTokenHandler(
  config: CustomerTokenConfig,
  exchange: TokenExchange = relay
): (request: TokenRequest) => Promise<RelayResponse> {
  return (request) => {
    if (!customerClientConfigured(config)) {
      // Rejected before the call, so no attempt is spent against the real
      // tenant under a half-built Basic header — see this file's header.
      return Promise.reject(
        new Error(
          'APPID_CUSTOMER_CLIENT_ID and APPID_CUSTOMER_CLIENT_SECRET must both be set to serve ' +
            `${CUSTOMER_TOKEN_ROUTE}. Refusing to exchange a customer grant under any other client.`
        )
      );
    }

    return exchange(request, {
      region: config.region,
      tenantId: config.tenantId,
      clientId: config.customerClientId,
      clientSecret: config.customerClientSecret,
    });
  };
}
