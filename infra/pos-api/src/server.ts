/**
 * The HTTP adapter and the process entry point.
 *
 * Everything decision-shaped lives in `api.ts` and `session-auth.ts`; this file is
 * only sockets, environment and the three impure things (`Date`, `randomUUID`, the
 * store) that the route table takes as parameters so it can be tested without them.
 *
 * The same file serves local development and Code Engine. There is no `lambda.ts`
 * counterpart here, unlike the two sibling services: Code Engine runs the container
 * and listens on `PORT`, so the dev path and the deployed path are the same code,
 * and a dev-only shortcut cannot diverge from production behaviour the way a
 * separate handler can.
 *
 * Local startup also needs the checkout policy, PayPal sandbox credentials, HMAC
 * keyrings, and `ALLOWED_ORIGINS`; see `checkout-config.ts` and
 * `checkout-secrets.ts` for the complete environment contract.
 *
 * APPID_REGION/APPID_TENANT_ID/APPID_CLIENT_ID are optional — unset, this
 * verifies HS256 only, exactly as above. Set all three together to also accept
 * App ID's RS256 access tokens (see `session-auth.ts`'s own doc comment):
 *
 *   SESSION_JWT_SECRET=… POS_API_STORE=memory \
 *   APPID_REGION=us-south APPID_TENANT_ID=… APPID_CLIENT_ID=… npm start
 */
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { randomUUID } from 'node:crypto';
import { handle } from './api.ts';
import type { ApiDeps, ProductDocument, RolesDocument, TransactionDocument } from './api.ts';
import { handleCheckoutHttp } from './checkout-http.ts';
import { buildCheckoutRuntime, type CheckoutRuntime } from './checkout-runtime.ts';
import { CloudantStore } from './cloudant-store.ts';
import { MemoryStore } from '../../shared/src/document-store.ts';
import type { DocumentStore } from '../../shared/src/document-store.ts';
import type { CustomerVerificationConfig } from './customer-auth.ts';
import {
  CUSTOMER_LOYALTY_PATH,
  handleCustomerLoyaltyHttp,
  type CustomerLoyaltyProfileReader,
} from './customer-loyalty-http.ts';
import { CustomerProfileStore, type CustomerProfileDocument } from './customer-profile-store.ts';
import { CosImageStore } from './cos-image-store.ts';
import { MemoryImageStore } from '../../shared/src/image-store.ts';
import type { ImageStore } from '../../shared/src/image-store.ts';

const PORT = Number(process.env['PORT'] ?? 8790);

/**
 * The largest body accepted, in bytes.
 *
 * A product is a few hundred bytes and a sale is smaller. Without a cap, an
 * unauthenticated caller can make the process buffer without bound before
 * `authorize` is ever consulted — the check happens after the body is read, so the
 * cap is what makes the boundary hold against a body rather than a token.
 */
const MAX_BODY_BYTES = 64 * 1024;
const MAX_CHECKOUT_BODY_BYTES = 16 * 1024;
/** Raised limit for multipart image uploads (2 MiB). */
const MAX_IMAGE_BODY_BYTES = 2_097_152;

/**
 * Fail before listening, not on the first request.
 *
 * `authorize` answers 503 when the secret is empty, which is the right answer for an
 * env that changed under a running process. It is the wrong answer for a deployment
 * that was never configured: that should never accept traffic at all, because a
 * service returning 503 to every call looks like an outage to page someone about
 * rather than a revision that is missing a variable.
 */
function requireSecret(): string {
  const secret = process.env['SESSION_JWT_SECRET'] ?? '';
  if (secret.length === 0) {
    console.error(
      '[pos-api] SESSION_JWT_SECRET is not set. It must match the secret the browser ' +
        'signs sessions with (see src/app/core/infrastructure/auth/session-issuer.ts). Refusing to start.'
    );
    process.exit(1);
  }
  return secret;
}

/**
 * App ID verification is fully optional — three unset vars means exactly today's
 * HS256-only behaviour, not a misconfiguration. A *partial* set is refused the
 * same way an unset `SESSION_JWT_SECRET` is: "refuse to guess" rather than start
 * a revision that verifies RS256 tokens against the wrong tenant or audience.
 */
export function readAppIdConfig(
  environment: Readonly<Record<string, string | undefined>> = process.env
): { region: string; tenantId: string; audience: string } | undefined {
  const region = environment['APPID_REGION'] ?? '';
  const tenantId = environment['APPID_TENANT_ID'] ?? '';
  const audience = environment['APPID_CLIENT_ID'] ?? '';

  // "Configured at all" turns on `tenantId`/`audience` only, not `region`:
  // `region` has one sensible value across this whole estate (`us-south`) and
  // Terraform gives it a real default, so it is set on every deployment whether
  // or not App ID is actually wanted. Keying "unconfigured" off all three would
  // make that harmless default look like a *partial* App ID config and refuse
  // to start every deployment that has never touched these vars at all.
  if (tenantId.length === 0 && audience.length === 0) {
    return undefined;
  }
  if (tenantId.length === 0 || audience.length === 0 || region.length === 0) {
    console.error(
      '[pos-api] APPID_REGION, APPID_TENANT_ID and APPID_CLIENT_ID must be set together, ' +
        'or not at all. Refusing to start rather than verify App ID tokens against a partial config.'
    );
    process.exit(1);
  }
  return { region, tenantId, audience };
}

/** The customer audience is a separate non-secret verifier input, never a staff audience alias. */
export function readCustomerAppIdConfig(
  environment: Readonly<Record<string, string | undefined>> = process.env
): CustomerVerificationConfig | undefined {
  const region = environment['APPID_REGION'] ?? '';
  const tenantId = environment['APPID_TENANT_ID'] ?? '';
  const audience = environment['APPID_CUSTOMER_CLIENT_ID'] ?? '';
  if (audience.length === 0) return undefined;
  if (region.length === 0 || tenantId.length === 0) {
    throw new Error(
      'APPID_REGION and APPID_TENANT_ID are required when APPID_CUSTOMER_CLIENT_ID is set.'
    );
  }
  return { region, tenantId, audience };
}

/**
 * Choose the store from the environment, and refuse to guess.
 *
 * Cloudant when it is configured; memory only when explicitly asked for. The
 * explicit opt-in is the point: a silent fall back to memory on a missing
 * `CLOUDANT_APIKEY` would give a Code Engine revision that starts, answers 200,
 * passes its health check, and loses every sale on the next scale-to-zero.
 */
interface PosStores {
  readonly products: DocumentStore<ProductDocument>;
  readonly transactions: DocumentStore<TransactionDocument>;
  readonly roles: DocumentStore<RolesDocument>;
  readonly customerProfiles: DocumentStore<CustomerProfileDocument>;
  readonly cloudant?: { readonly url: string; readonly apiKey: string };
}

function buildStores(): PosStores {
  const url = process.env['CLOUDANT_URL'] ?? '';
  const apiKey = process.env['CLOUDANT_APIKEY'] ?? '';

  if (url.length > 0 && apiKey.length > 0) {
    const productsDb = process.env['CLOUDANT_PRODUCTS_DB'] ?? 'products';
    const transactionsDb = process.env['CLOUDANT_TRANSACTIONS_DB'] ?? 'transactions';
    const rolesDb = process.env['CLOUDANT_ROLES_DB'] ?? 'roles';
    const customerProfilesDb = process.env['CLOUDANT_CUSTOMER_PROFILES_DB'] ?? 'customer-profiles';
    console.log(
      `[pos-api] store: cloudant (${productsDb}, ${transactionsDb}, ${rolesDb}, ${customerProfilesDb})`
    );
    const cloudant = { url: url.replace(/\/+$/, ''), apiKey };
    return {
      cloudant,
      products: new CloudantStore<ProductDocument>({
        ...cloudant,
        database: productsDb,
      }),
      transactions: new CloudantStore<TransactionDocument>({
        ...cloudant,
        database: transactionsDb,
      }),
      roles: new CloudantStore<RolesDocument>({
        ...cloudant,
        database: rolesDb,
      }),
      customerProfiles: new CloudantStore<CustomerProfileDocument>({
        ...cloudant,
        database: customerProfilesDb,
      }),
    };
  }

  if (process.env['POS_API_STORE'] === 'memory') {
    console.warn('[pos-api] store: in-memory — data is lost on restart. Never deploy this.');
    return {
      products: new MemoryStore<ProductDocument>(),
      transactions: new MemoryStore<TransactionDocument>(),
      roles: new MemoryStore<RolesDocument>(),
      customerProfiles: new MemoryStore<CustomerProfileDocument>(),
    };
  }

  console.error(
    '[pos-api] No store configured. Set CLOUDANT_URL and CLOUDANT_APIKEY, or ' +
      'POS_API_STORE=memory for local development. Refusing to start.'
  );
  process.exit(1);
}

/**
 * Optional, unlike `requireSecret()` — an empty value means `GET
 * /internal/roles` always 503s (see `getRoles` in `api.ts`), which is exactly
 * today's behaviour for a deployment that has not opted into Phase 5's RBAC
 * centralization yet, not a reason to refuse to start.
 */
function readInternalSecret(): string {
  return process.env['INTERNAL_API_SECRET'] ?? '';
}

/**
 * Optional — an empty value means `POST /api/mercadopago/preference` always
 * 503s (see `createMercadoPagoPreference` in `api.ts`). This is deliberate:
 * a deployment that has never set MP_ACCESS_TOKEN should not crash; it simply
 * has MercadoPago unconfigured, and the 503 tells the browser that clearly.
 */
function readMpAccessToken(): string {
  return process.env['MP_ACCESS_TOKEN'] ?? '';
}

/**
 * Base URL of the Angular app — used as the origin for MercadoPago back_urls.
 * Defaults to http://localhost:4200 so local dev works without any extra config.
 * In production / Code Engine set APP_BASE_URL to the public HTTPS origin.
 */
function readAppBaseUrl(): string {
  const url = process.env['APP_BASE_URL'] ?? 'http://localhost:4200';
  // Strip trailing slash so back_url paths are always /payment/success etc.
  return url.replace(/\/+$/, '');
}

/**
 * Resolve the ISO 4217 currency code for MercadoPago preferences.
 *
 * Set MP_CURRENCY_ID explicitly to override. When unset, the site is inferred
 * from the access token's embedded site code (the third dash-segment of an
 * APP_USR token encodes the site: MLM → MXN, MLA → ARS, etc.).
 *
 * Site → currency map (all current MP markets):
 *   MLA → ARS (Argentina)   MLB → BRL (Brazil)    MLC → CLP (Chile)
 *   MLM → MXN (Mexico)      MCO → COP (Colombia)  MPE → PEN (Peru)
 *   MLU → UYU (Uruguay)     MRD → DOP (Dom. Rep.)
 */
function readMpCurrencyId(): string {
  const explicit = process.env['MP_CURRENCY_ID'] ?? '';
  if (explicit.length > 0) {
    console.log(`[pos-api] MercadoPago currency: ${explicit} (MP_CURRENCY_ID)`);
    return explicit;
  }

  // Try to infer from the access token. APP_USR tokens embed the site id
  // inside them (not as a cryptographic claim — just a readable prefix segment).
  const token = process.env['MP_ACCESS_TOKEN'] ?? '';
  const SITE_CURRENCY: Record<string, string> = {
    MLA: 'ARS', MLB: 'BRL', MLC: 'CLP', MLM: 'MXN',
    MCO: 'COP', MPE: 'PEN', MLU: 'UYU', MRD: 'DOP',
  };

  for (const [site, currency] of Object.entries(SITE_CURRENCY)) {
    // The site id appears as a standalone segment in the token string.
    if (token.includes(`-${site}-`) || token.includes(`_${site}_`)) {
      console.log(`[pos-api] MercadoPago currency: ${currency} (inferred from site ${site})`);
      return currency;
    }
  }

  console.warn(
    '[pos-api] MP_CURRENCY_ID not set and could not be inferred from MP_ACCESS_TOKEN. ' +
    'Defaulting to MXN. Set MP_CURRENCY_ID=<your currency> to override.'
  );
  return 'MXN';
}

/**
 * Choose the image store from the environment.
 *
 * IBM COS when all four vars are set; MemoryImageStore with a warning otherwise.
 * The explicit warning mirrors the `POS_API_STORE=memory` path in `buildStores()`:
 * a silent fallback would give a Code Engine revision that starts, passes its
 * health check, and discards every uploaded image on restart.
 */
function buildImageStore(): ImageStore {
  const endpoint = process.env['COS_ENDPOINT'] ?? '';
  const apiKey = process.env['COS_APIKEY'] ?? '';
  const bucket = process.env['COS_BUCKET'] ?? '';
  const publicUrlBase = process.env['COS_PUBLIC_URL_BASE'] ?? '';

  if (endpoint.length > 0 && apiKey.length > 0 && bucket.length > 0 && publicUrlBase.length > 0) {
    console.log(`[pos-api] image store: COS (${bucket})`);
    return new CosImageStore({ endpoint, apiKey, bucket, publicUrlBase });
  }

  console.warn('[pos-api] image store: in-memory — images are lost on restart. Set COS_ENDPOINT, COS_APIKEY, COS_BUCKET, COS_PUBLIC_URL_BASE to use IBM COS.');
  return new MemoryImageStore();
}

function buildRuntimeDeps(): {
  readonly api: ApiDeps;
  readonly checkout: CheckoutRuntime;
  readonly customerAuth?: CustomerVerificationConfig;
  readonly customerLoyalty: CustomerLoyaltyProfileReader;
} {
  const stores = buildStores();
  try {
    return {
      customerAuth: readCustomerAppIdConfig(),
      customerLoyalty: new CustomerProfileStore(stores.customerProfiles),
      api: {
        ...stores,
        imageStore: buildImageStore(),
        secret: requireSecret(),
        appId: readAppIdConfig(),
        internalSecret: readInternalSecret(),
        mpAccessToken: readMpAccessToken(),
        mpCurrencyId: readMpCurrencyId(),
        appBaseUrl: readAppBaseUrl(),
        nowSeconds: () => Math.floor(Date.now() / 1000),
        nowIso: () => new Date().toISOString(),
        newId: () => randomUUID(),
      },
      checkout: buildCheckoutRuntime({
        environment: process.env,
        products: stores.products,
        transactions: stores.transactions,
        cloudant: stores.cloudant,
      }),
    };
  } catch (error) {
    console.error('[pos-api] checkout configuration is invalid. Refusing to start.', error);
    process.exit(1);
  }
}

/**
 * CORS.
 *
 * `Authorization` in `Allow-Headers` is what makes the till able to send a token at
 * all — a preflight that omits it makes the browser drop the header and every call
 * arrives unauthenticated. `Expose-Headers` is what makes `X-Trace-Id` readable from
 * script: `sync.worker.ts:245` reads it off the response, and without the expose the
 * browser hides it even though it is on the wire. Both are the lesson recorded in
 * this repo when API Gateway's own CORS block stripped exactly these.
 */
export function readAllowedOrigins(
  environment: Readonly<Record<string, string | undefined>>
): Set<string> {
  const origins = (environment['ALLOWED_ORIGINS'] ?? '')
    .split(',')
    .map((value) => value.trim())
    .filter((value) => value.length > 0);
  if (origins.length === 0) throw new Error('ALLOWED_ORIGINS must contain at least one origin.');
  for (const origin of origins) {
    const parsed = new URL(origin);
    if (
      parsed.origin !== origin ||
      (parsed.protocol !== 'https:' && parsed.hostname !== 'localhost')
    ) {
      throw new Error('ALLOWED_ORIGINS contains an invalid origin.');
    }
  }
  return new Set(origins);
}

export function createPosRequestHandler(input: {
  readonly api: ApiDeps;
  readonly checkout: CheckoutRuntime;
  readonly customerAuth?: CustomerVerificationConfig;
  readonly customerLoyalty?: CustomerLoyaltyProfileReader;
  readonly allowedOrigins: ReadonlySet<string>;
  readonly newTraceId?: () => string;
}): (req: IncomingMessage, res: ServerResponse) => void {
  const newTraceId = input.newTraceId ?? randomUUID;
  return (req, res) => {
    const incoming = req.headers['x-trace-id'];
    const traceId = typeof incoming === 'string' && incoming.length > 0 ? incoming : newTraceId();
    const origin = singleHeader(req.headers.origin);
    const cors = corsHeaders(origin, input.allowedOrigins);

    // Path only: a query string is not part of any route here, and leaving it on
    // would make `/api/health?x=1` a 404.
    const path = (req.url ?? '/').split('?')[0] ?? '/';

    const checkoutRoute = path.startsWith('/api/self-checkout/checkouts');
    const customerLoyaltyRoute = path === CUSTOMER_LOYALTY_PATH;
    const privateCustomerRoute = checkoutRoute || customerLoyaltyRoute;
    const responsePolicy = privateCustomerRoute
      ? { 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer' }
      : {};

    const send = (status: number, body: unknown, headers: Record<string, string> = {}): void => {
      res.writeHead(status, {
        ...cors,
        ...responsePolicy,
        ...headers,
        'Content-Type': 'application/json',
        'X-Trace-Id': traceId,
      });
      res.end(JSON.stringify(body));
    };

    if (origin !== undefined && cors['Access-Control-Allow-Origin'] === undefined) {
      send(403, { error: 'Origin not allowed.' });
      return;
    }

    if (req.method === 'OPTIONS') {
      res
        .writeHead(204, {
          ...cors,
          ...responsePolicy,
          'X-Trace-Id': traceId,
          'Access-Control-Allow-Headers':
            'Content-Type, Authorization, X-Trace-Id, Idempotency-Key, X-Checkout-Token',
          'Access-Control-Allow-Methods': 'GET, POST, PUT, PATCH, DELETE, OPTIONS',
          'Access-Control-Max-Age': '600',
        })
        .end();
      return;
    }

    // Detect multipart image upload routes to apply the raised body limit and
    // pass raw bytes rather than a JSON-parsed body.
    const reqContentType = (req.headers['content-type'] ?? '').toLowerCase();
    const isImageUpload =
      (req.method ?? '').toUpperCase() === 'POST' &&
      /^\/api\/products\/[^/]+\/image$/.test(path) &&
      reqContentType.startsWith('multipart/');

    const maxBodyBytes = isImageUpload
      ? MAX_IMAGE_BODY_BYTES
      : privateCustomerRoute
        ? MAX_CHECKOUT_BODY_BYTES
        : MAX_BODY_BYTES;

    const chunks: Buffer[] = [];
    let received = 0;
    let aborted = false;

    req.on('data', (chunk: Buffer) => {
      if (aborted) return;
      received += chunk.length;
      if (received > maxBodyBytes) {
        aborted = true;
        send(413, { error: 'Request body too large.' });
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });

    req.on('end', () => {
      if (aborted) return;
      void (async () => {
        const rawBuffer = Buffer.concat(chunks);
        let body: unknown;
        let rawBody: Uint8Array | undefined;

        if (isImageUpload) {
          // For multipart routes pass the raw bytes — JSON.parse would corrupt
          // binary data and the route handler does its own framing.
          rawBody = new Uint8Array(rawBuffer);
        } else {
          const raw = rawBuffer.toString('utf8');
          if (raw.trim().length > 0) {
            try {
              body = JSON.parse(raw);
            } catch {
              send(400, { error: 'Body must be JSON.' });
              return;
            }
          }
        }

        const internalSecretHeader = req.headers['x-internal-secret'];
        try {
          if (customerLoyaltyRoute) {
            const loyaltyResponse =
              input.customerLoyalty === undefined
                ? { status: 503, body: { error: 'Customer loyalty is unavailable.' } }
                : await handleCustomerLoyaltyHttp(
                    {
                      method: req.method ?? 'GET',
                      path,
                      authorization: req.headers.authorization,
                    },
                    {
                      profiles: input.customerLoyalty,
                      customerAuth: input.customerAuth,
                      nowSeconds: input.api.nowSeconds,
                      nowIso: input.api.nowIso,
                    }
                  );
            if (loyaltyResponse !== null) {
              send(loyaltyResponse.status, loyaltyResponse.body);
              return;
            }
          }
          const checkoutResponse = await handleCheckoutHttp(
            {
              method: req.method ?? 'GET',
              path,
              authorization: req.headers.authorization,
              idempotencyKey: singleHeader(req.headers['idempotency-key']),
              checkoutToken: singleHeader(req.headers['x-checkout-token']),
              body,
            },
            {
              checkout: input.checkout.service,
              rateLimiter: input.checkout.rateLimiter,
              rateLimitKey: clientRateLimitKey(req),
              customerAuth: input.customerAuth,
              nowSeconds: input.api.nowSeconds,
            }
          );
          if (checkoutResponse !== null) {
            const retryAfter = retryAfterHeader(checkoutResponse.body);
            send(
              checkoutResponse.status,
              checkoutResponse.body,
              retryAfter === undefined ? {} : { 'Retry-After': retryAfter }
            );
            return;
          }
          const response = await handle(
            {
              method: req.method ?? 'GET',
              path,
              authorization: req.headers.authorization,
              internalSecret:
                typeof internalSecretHeader === 'string' ? internalSecretHeader : undefined,
              body,
              rawBody,
              contentType: reqContentType,
            },
            input.api
          );
          send(response.status, response.body);
        } catch (error) {
          console.error(`[pos-api] request failed`, { traceId, path, method: req.method, error });
          send(502, { error: 'The API is unavailable.' });
        }
      })();
    });
  };
}

function corsHeaders(
  origin: string | undefined,
  allowed: ReadonlySet<string>
): Record<string, string> {
  return origin !== undefined && allowed.has(origin)
    ? {
        'Access-Control-Allow-Origin': origin,
        'Access-Control-Expose-Headers': 'X-Trace-Id, Retry-After',
        Vary: 'Origin',
      }
    : { Vary: 'Origin' };
}

function singleHeader(value: string | readonly string[] | undefined): string | undefined {
  return typeof value === 'string' ? value : undefined;
}

export function clientRateLimitKey(req: IncomingMessage, trustedProxyHops = 1): string {
  const raw = req.headers['x-forwarded-for'];
  const forwarded = Array.isArray(raw) ? raw.join(',') : raw;
  const entries = (forwarded ?? '')
    .split(',')
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);
  const hops = Math.max(1, Math.floor(trustedProxyHops));
  const address =
    entries[Math.max(0, entries.length - hops)] ?? req.socket.remoteAddress ?? 'unknown';
  return address.slice(0, 500);
}

function retryAfterHeader(body: unknown): string | undefined {
  if (body === null || typeof body !== 'object') return undefined;
  const value = (body as { retryAfterSeconds?: unknown }).retryAfterSeconds;
  return Number.isSafeInteger(value) && (value as number) > 0 ? String(value) : undefined;
}

export function startPosServer(): ReturnType<typeof createServer> {
  const deps = buildRuntimeDeps();
  let allowedOrigins: ReadonlySet<string>;
  try {
    allowedOrigins = readAllowedOrigins(process.env);
  } catch (error) {
    console.error('[pos-api] CORS configuration is invalid. Refusing to start.', error);
    process.exit(1);
  }
  const server = createServer(createPosRequestHandler({ ...deps, allowedOrigins }));
  return server.listen(PORT, () => {
    console.log(`[pos-api] listening on http://localhost:${PORT}/api/health`);
  });
}

if (process.env['NODE_ENV'] !== 'test') startPosServer();
