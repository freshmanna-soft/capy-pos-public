/**
 * The CORS boundary for a proxy that runs as a plain container.
 *
 * Deliberately NOT `session-guard.ts` (the name `infra/vision-proxy` and
 * `infra/clerk-agent-relay` use for their copy of this file) — this service does
 * not guard a session, it *issues* one. Every caller here is, by definition,
 * someone who does not have a valid session token yet: requiring one would make
 * signing in impossible. So this file carries only the origin/CORS logic those two
 * services also have, with none of the bearer-token verification — there is
 * nothing to verify a caller against before they have signed in.
 *
 * Same "a copy is only safe if drift is loud" reasoning as the other two: each
 * service is a standalone container with its own `tsconfig` `rootDir` and its own
 * image, and TypeScript refuses to compile a source file from outside `rootDir`
 * (TS6059), so a shared module would mean a shared build context none of these
 * three deliberately have. `cors.test.mjs` asserts this file is actually imported
 * by `server.ts`/`http.ts` and that no route answers `Access-Control-Allow-Origin: *`
 * — the same class of "written, deployed, imported by nothing" bug epic #195 found
 * once already.
 */

/**
 * Parse `ALLOWED_ORIGINS` — a comma-separated list of browser origins.
 *
 * Trailing slashes are stripped and the result deduplicated, because an `Origin`
 * header never carries a path and a list entry that does would silently match
 * nothing. An empty result is the signal `server.ts` uses to refuse to start.
 */
export function readAllowedOrigins(raw: string | undefined): readonly string[] {
  if (typeof raw !== 'string') {
    return [];
  }
  return [
    ...new Set(
      raw
        .split(',')
        .map((entry) => entry.trim().replace(/\/+$/, ''))
        .filter((entry) => entry.length > 0)
    ),
  ];
}

/**
 * Whether a request's `Origin` may be answered.
 *
 * A *missing* Origin passes: `curl`/`smoke.mjs`/any server-to-server caller sends
 * none. A *present but unlisted* one is refused outright rather than merely left
 * without an `Access-Control-Allow-Origin` header — omitting the header stops a
 * compliant browser reading the reply, but the request has already reached App ID
 * by then, which is exactly the exposure this check exists to close (an unlisted
 * page spending a login attempt against the real tenant).
 */
export function originAllowed(origin: string | undefined, allowed: readonly string[]): boolean {
  if (typeof origin !== 'string' || origin.length === 0 || origin === 'null') {
    return typeof origin !== 'string' || origin.length === 0;
  }
  return allowed.includes(origin.replace(/\/+$/, ''));
}

/**
 * CORS headers for one response. Never `*`.
 *
 * The allowed origin is echoed back, which is what `Vary: Origin` is for: without
 * it a shared cache can hand one origin's allow header to another.
 */
export function corsHeaders(
  origin: string | undefined,
  allowed: readonly string[],
  methods: string
): Record<string, string> {
  // `Authorization` is only ever sent by the admin staff-management routes
  // (`admin-http.ts`) — this service's original token route needs no header
  // beyond `Content-Type`, but allowing both unconditionally is harmless for
  // it and required for the other, same convention as `session-guard.ts`'s
  // own `corsHeaders` in the sibling proxies.
  const headers: Record<string, string> = {
    Vary: 'Origin',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Access-Control-Allow-Methods': methods,
    'Access-Control-Max-Age': '600',
  };
  if (typeof origin === 'string' && origin.length > 0 && originAllowed(origin, allowed)) {
    headers['Access-Control-Allow-Origin'] = origin;
  }
  return headers;
}
