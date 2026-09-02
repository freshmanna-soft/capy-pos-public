/**
 * The process entry point: environment, sockets, and nothing that decides anything.
 *
 * Same split as `infra/clerk-agent-relay/src/server.ts` and the same reason for
 * it: fail before listening, not on the first request, and hold no logic a test
 * cannot exercise without a bound port.
 *
 *   APPID_REGION=us-south APPID_TENANT_ID=… APPID_CLIENT_ID=… APPID_CLIENT_SECRET=… \
 *   ALLOWED_ORIGINS=http://localhost:4200 npm start                # laptop, port 8792
 *
 * Then set `appId.enabled = true` and `appId.relayUrl =
 * 'http://localhost:8792/appid/token'` in the environment file you are serving.
 */
import { createServer } from 'node:http';
import { relay } from './relay.ts';
import { validate, MAX_BODY_BYTES } from './validate.ts';
import { createRequestListener } from './http.ts';
import { readAllowedOrigins } from './cors.ts';

const PORT = Number(process.env['PORT'] ?? 8792);

const ROUTE = '/appid/token';

/**
 * Fail before listening, not on the first request.
 *
 * Unlike the sibling proxies' `authorize()` (503 for a secret that changed
 * under a running process), a missing App ID credential here has no per-request
 * fallback to report — every single call needs it, so there's nothing to gain
 * by deferring the failure past startup.
 */
function requireConfig(): {
  region: string;
  tenantId: string;
  clientId: string;
  clientSecret: string;
  origins: readonly string[];
} {
  const region = process.env['APPID_REGION'] ?? '';
  const tenantId = process.env['APPID_TENANT_ID'] ?? '';
  const clientId = process.env['APPID_CLIENT_ID'] ?? '';
  const clientSecret = process.env['APPID_CLIENT_SECRET'] ?? '';

  if (region.length === 0 || tenantId.length === 0 || clientId.length === 0 || clientSecret.length === 0) {
    console.error(
      '[appid-relay] APPID_REGION, APPID_TENANT_ID, APPID_CLIENT_ID and APPID_CLIENT_SECRET ' +
        "must all be set — this service's whole purpose is attaching the client secret to " +
        'every App ID token request, so there is no partial-config mode to fall back to. Refusing to start.'
    );
    process.exit(1);
  }

  const origins = readAllowedOrigins(process.env['ALLOWED_ORIGINS']);
  if (origins.length === 0) {
    console.error(
      '[appid-relay] ALLOWED_ORIGINS is not set. Give it a comma-separated list of browser ' +
        'origins (e.g. http://localhost:4200). Refusing to start: the alternative — ' +
        'Access-Control-Allow-Origin: * in front of the login endpoint — would let any page ' +
        "on the internet spend attempts against the real tenant."
    );
    process.exit(1);
  }

  console.log(`[appid-relay] origins: ${origins.join(', ')}`);
  return { region, tenantId, clientId, clientSecret, origins };
}

const { region, tenantId, clientId, clientSecret, origins } = requireConfig();

createServer(
  createRequestListener({
    logPrefix: '[appid-relay]',
    route: ROUTE,
    origins,
    maxBodyBytes: MAX_BODY_BYTES,
    validate,
    handle: (request) => relay(request, { region, tenantId, clientId, clientSecret }),
    unavailable: 'The sign-in service is unavailable.',
  })
).listen(PORT, () => {
  console.log(`[appid-relay] listening on http://localhost:${PORT}${ROUTE}`);
});
