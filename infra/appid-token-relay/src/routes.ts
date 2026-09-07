/**
 * The route table: which path belongs to which boundary, and a real 404 for
 * every path that belongs to none.
 *
 * Before this file, `server.ts` dispatched
 * `startsWith(admin) ? admin : path === forgotPassword ? forgotPassword : token`
 * — prefix-match-else-**default**. Every unknown path landed on the token
 * listener, and 404'd only because that listener independently re-checked the
 * path against its own `route`. Two checks accidentally agreeing is not a route
 * table: the next route added to the default arm's *other* side would have been
 * served by whichever branch happened to come first, and an unknown path would
 * have reached a real App ID call rather than a 404.
 *
 * So dispatch is declared, not derived: one entry per boundary, matched
 * exactly (or by prefix, for the admin routes whose `{id}` segment
 * `admin-http.ts` resolves itself), and anything unmatched answered here.
 *
 * ## The order, and why it is this order
 *
 * 1. A matched route is handed over **untouched** — including its `OPTIONS`.
 *    Each boundary advertises the methods *it* serves and owns its own
 *    preflight (`POST, OPTIONS` for the token route, four verbs for admin);
 *    flattening that into one answer for every path would make this file lie
 *    about what the route does.
 * 2. `OPTIONS` on an unrouted path → 204, the same answer the old default arm
 *    gave. A preflight carries none of the real request, and a 404'd preflight
 *    surfaces in a browser as "CORS preflight did not succeed" — strictly less
 *    informative than the 404 the real request is about to get anyway.
 * 3. Origin → 403, *before* the route match, exactly as every route in this
 *    service already does (see `http.ts`'s own documented order). The answer an
 *    unlisted origin gets must not depend on whether it guessed a real path.
 * 4. Route → 404, with the CORS headers on it, so a browser can actually read
 *    the 404 rather than reporting a CORS failure and hiding the real cause.
 */
import type { IncomingMessage, ServerResponse } from 'node:http';
import { corsHeaders, originAllowed } from './cors.ts';

export type RequestListener = (req: IncomingMessage, res: ServerResponse) => void;

export interface Route {
  /**
   * `exact` — the request path must equal `path`. `prefix` — it must start with
   * it, for a boundary that matches its own sub-paths (`admin-http.ts`).
   */
  readonly match: 'exact' | 'prefix';
  /** The path, with no query string and no trailing wildcard, e.g. `/appid/token`. */
  readonly path: string;
  /** The methods this route's own boundary serves, e.g. `POST, OPTIONS`. Unioned for an unrouted preflight. */
  readonly methods: string;
  /** The boundary itself, which still owns CORS, auth, body caps and validation for its own path. */
  readonly listener: RequestListener;
}

export interface RouterConfig {
  readonly routes: readonly Route[];
  /** Browser origins that may be answered. Never a wildcard. */
  readonly origins: readonly string[];
}

/** The request path with the query string dropped — a query is never part of a route. */
export function requestPath(url: string | undefined): string {
  return url?.split('?')[0] ?? '';
}

/**
 * The one entry that claims this path, or `null`.
 *
 * Exact entries are considered before prefix ones, so the result never depends
 * on the table's declaration order — a prefix that happens to cover an exact
 * route cannot shadow it.
 */
export function matchRoute(routes: readonly Route[], path: string): Route | null {
  return (
    routes.find((route) => route.match === 'exact' && route.path === path) ??
    routes.find((route) => route.match === 'prefix' && path.startsWith(route.path)) ??
    null
  );
}

/**
 * Every method any route serves, `OPTIONS` last — the `Access-Control-Allow-Methods`
 * for a path no route claims. Derived from the table so it cannot drift from it.
 */
export function allowedMethods(routes: readonly Route[]): string {
  const methods = new Set(
    routes.flatMap((route) =>
      route.methods
        .split(',')
        .map((method) => method.trim())
        .filter((method) => method.length > 0)
    )
  );
  methods.delete('OPTIONS');
  return [...methods, 'OPTIONS'].join(', ');
}

/** One route as the 404 names it: a prefix route gets the star it actually behaves like. */
export function routeLabel(route: Route): string {
  return route.match === 'prefix' ? `${route.path}*` : route.path;
}

/**
 * The 404 body's `error`: the routes this service really serves, in table order.
 * Same "here is what exists instead" shape as `admin-http.ts`'s own 404.
 */
export function describeRoutes(routes: readonly Route[]): string {
  const labels = routes.map(routeLabel);
  if (labels.length < 2) {
    return labels.join('');
  }
  return `${labels.slice(0, -1).join(', ')}, or ${labels[labels.length - 1]}`;
}

/** Build the dispatching listener. Hand it to `createServer`. */
export function createRouter(config: RouterConfig): RequestListener {
  const methods = allowedMethods(config.routes);
  const known = describeRoutes(config.routes);

  return (req, res) => {
    const route = matchRoute(config.routes, requestPath(req.url));
    if (route !== null) {
      route.listener(req, res);
      return;
    }

    const origin = req.headers.origin;
    const cors = corsHeaders(origin, config.origins, methods);

    if (req.method === 'OPTIONS') {
      res.writeHead(204, cors).end();
      return;
    }

    const send = (status: number, body: unknown): void => {
      res.writeHead(status, { ...cors, 'Content-Type': 'application/json' });
      res.end(JSON.stringify(body));
    };

    if (!originAllowed(origin, config.origins)) {
      send(403, { error: 'Origin is not allowed.' });
      return;
    }

    send(404, { error: known });
  };
}
