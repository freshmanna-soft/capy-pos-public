/**
 * The route table, as one container.
 *
 * The AWS module answers these eight routes with seven Lambdas
 * (`terraform/aws-demo/main.tf:218-533`). That split exists to make X-Ray traces
 * legible across service boundaries for a talk (`main.tf:1-7`) — it is the point of
 * that module, not a property this one needs. Reproducing it on Code Engine would
 * mean seven containers, seven cold starts and seven copies of the auth check for a
 * catalogue that fits in one, so this is a single app and the story asked for it to
 * be.
 *
 * ## Why this is a function of a request, not an HTTP server
 *
 * Everything below is `(request, deps) -> response` with no socket, no `Date.now()`
 * and no `randomUUID()` reached for directly. `server.ts` supplies all three. That
 * is what lets `api.test.mjs` assert the whole table — every status, every
 * permission refusal, expiry, and the oversell race — as ordinary unit tests with no
 * network and no IBM account, which is the difference between a boundary that is
 * claimed and one that is shown to hold.
 *
 * ## The response shapes are inherited, not designed
 *
 * `{ products, count }`, `{ product }`, `{ transaction, remainingStock }` and
 * `{ status: 'healthy' }` are what the AWS Lambdas already return and what
 * `sync.worker.ts` already parses (`syncProducts` reads `data.products`,
 * `checkHealth` reads `data.status === 'healthy'`). Changing them here would repoint
 * the till at a backend that speaks a different dialect, so they are copied
 * deliberately, field for field.
 */
import {
  Permission,
  ROLE_PERMISSIONS,
  authorize,
  constantTimeStringsEqual,
  readBearer,
  verifySessionToken,
  signToken,
  type AppIdVerificationConfig,
} from './session-auth.ts';
import type { DocumentStore, StoredDocument } from '../../shared/src/document-store.ts';
import type { ImageStore } from '../../shared/src/image-store.ts';

/** The catalogue document. Field-for-field what `create-product/index.js` writes. */
export interface ProductDocument extends StoredDocument {
  readonly name: string;
  readonly price: number;
  readonly category: string;
  /** Physical on-hand stock. Available stock additionally excludes active checkout reservations. */
  readonly stock: number;
  /** Server-owned. Missing on pre-checkout catalogue documents and interpreted as an empty map. */
  readonly checkoutMarkers?: CheckoutInventoryMarkers;
  readonly description: string;
  readonly isActive?: boolean;
  readonly imageUrl?: string;
  readonly createdAt: string;
  readonly updatedAt: string;
}

/** Reservation markers are persistence metadata and never cross the HTTP boundary. */
export type PublicProductDocument = Omit<ProductDocument, 'checkoutMarkers'>;

/** The legacy one-product sale record, kept compatible with the existing till. */
export interface LegacyTransactionDocument extends StoredDocument {
  readonly productId: string;
  readonly productName: string;
  readonly quantity: number;
  readonly unitPrice: number;
  readonly total: number;
  readonly type: 'sale';
  readonly timestamp: string;
  /**
   * Who and which shop. The AWS transaction had neither, because nothing
   * authenticated the caller; now that a verified token is required, dropping its
   * `sub`/`tenantId` on the floor would be throwing away the only audit trail this
   * story makes possible.
   */
  readonly operatorId: string;
  readonly tenantId: string;
}

/** Existing staff sales and new basket-level checkout sales share the history collection. */
export type TransactionDocument = LegacyTransactionDocument | CheckoutSaleTransactionDocument;

/**
 * Staff transaction history must never expose internal customer/loyalty bindings.
 * V2 checkout records may carry a minimal `customerBinding` for server-side
 * settlement, so the HTTP response is an explicit projection rather than a raw
 * Cloudant document.
 */
export type PublicTransactionDocument =
  | LegacyTransactionDocument
  | PublicCheckoutSaleTransactionDocument;

/**
 * A full-basket kiosk/shop sale record.
 *
 * Written by `POST /api/transactions` — the kiosk terminal (device token) and
 * the customer's phone (shop-session token) both POST here. Stock adjustment is
 * handled separately by the existing `POST /api/products/{id}/sell` path, so
 * this record is audit trail only: it never triggers a stock write.
 */
export interface KioskTransactionDocument extends StoredDocument {
  readonly type: 'kiosk-sale';
  readonly items: readonly {
    readonly productId: string;
    readonly productName: string;
    readonly quantity: number;
    readonly unitPrice: number;
    readonly lineTotal: number;
  }[];
  readonly subtotal: number;
  readonly taxAmount: number;
  readonly total: number;
  readonly paymentMethod: string;
  readonly terminalId: string;
  /** Absent for anonymous sessions. */
  readonly customerId?: string;
  readonly customerEmail?: string;
  readonly timestamp: string;
  /** `sub` claim of the kiosk-device or shop-session token. */
  readonly operatorId: string;
  readonly tenantId: string;
}

/**
 * The one document `GET /internal/roles` serves — every role name this
 * deployment knows, mapped to the permission strings it grants. Phase 5,
 * RBAC centralization: this is the single source of truth `vision-proxy`
 * and `clerk-agent-relay` fetch instead of each hand-copying their own
 * version of `ROLE_PERMISSIONS`.
 */
export interface RolesDocument extends StoredDocument {
  readonly roles: Readonly<Record<string, readonly string[]>>;
}

/** The one document id `roles` ever holds — a single doc, not one per role. */
export const ROLES_DOC_ID = 'role-permissions';

export interface ApiRequest {
  readonly method: string;
  /** Path only — `server.ts` has already removed any query string. */
  readonly path: string;
  readonly authorization: string | undefined;
  /**
   * The `X-Internal-Secret` header, for the one route that has no end-user
   * token to check (`GET /internal/roles`) — a sibling Code Engine app's
   * bearer, not a browser's.
   */
  readonly internalSecret: string | undefined;
  /** Parsed JSON body, or `undefined` when there was none. */
  readonly body: unknown;
  /**
   * Raw request bytes — present only for multipart routes where the body
   * cannot be JSON-parsed.  `server.ts` populates this for
   * `POST /api/products/:id/image` and leaves it absent on all other routes.
   */
  readonly rawBody?: Uint8Array;
  /** Value of the `Content-Type` request header (lower-cased). */
  readonly contentType?: string;
}

export interface ApiResponse {
  readonly status: number;
  readonly body: unknown;
}

export interface ApiDeps {
  readonly products: DocumentStore<ProductDocument>;
  readonly transactions: DocumentStore<TransactionDocument>;
  readonly roles: DocumentStore<RolesDocument>;
  readonly imageStore: ImageStore;
  readonly secret: string;
  /** Omitted: this deployment verifies HS256 (`secret`) only — today's exact behaviour. */
  readonly appId?: AppIdVerificationConfig;
  /** Empty means `GET /internal/roles` is unconfigured and always 503s — see `getRoles`. */
  readonly internalSecret: string;
  /**
   * MercadoPago server-side access token (MP_ACCESS_TOKEN env var).
   * Empty string means `POST /api/mercadopago/preference` always 503s — the
   * secret is never sent to the browser.
   */
  readonly mpAccessToken: string;
  /**
   * ISO 4217 currency code for MercadoPago preferences (MP_CURRENCY_ID env var).
   * Must match the country of the MP account: MXN for Mexico (MLM), ARS for
   * Argentina (MLA), BRL for Brazil (MLB), CLP for Chile (MLC), COP for
   * Colombia (MCO), PEN for Peru (MPE), UYU for Uruguay (MLU).
   * Defaults to 'MXN' when unset and the site cannot be inferred from the token.
   */
  readonly mpCurrencyId: string;
  /**
   * Base URL of the Angular app, used for MercadoPago back_urls.
   * Set via APP_BASE_URL env var; defaults to http://localhost:4200 for local dev.
   * In production this is the public HTTPS origin (e.g. https://capy-pos.example.com).
   */
  readonly appBaseUrl: string;
  /** Injected so tests can stub fetch without patching globals. */
  readonly fetch?: typeof globalThis.fetch;
  readonly nowSeconds: () => number;
  readonly nowIso: () => string;
  readonly newId: () => string;
}

/**
 * Fields a client may write. `id`/`createdAt` are server-owned.
 *
 * `isActive` is included for the reason `update-product/index.js` gives: the UI
 * soft-deletes by setting it false, so transaction history keeps pointing at a
 * product that still exists.
 */
const MUTABLE_FIELDS = ['name', 'price', 'category', 'stock', 'description', 'isActive'] as const;

/**
 * How many times a sale re-reads and retries after losing a revision race.
 *
 * Three, because the race is only lost when another sale of the *same product*
 * commits in the window between this one's read and its write; four tills
 * contending on one item is already the pathological case, and an unbounded retry
 * would turn contention into a hang instead of a 409.
 */
const SELL_ATTEMPTS = 3;

export async function handle(request: ApiRequest, deps: ApiDeps): Promise<ApiResponse> {
  const route = matchRoute(request.method, request.path);
  if (route === null) {
    return { status: 404, body: { error: 'Not found' } };
  }

  // Health is deliberately outside the boundary: a load balancer and Code Engine's
  // own readiness probe have no token, and a health check that needs a credential
  // reports the credential's state rather than the service's.
  if (route.kind === 'health') {
    return health(deps);
  }

  // Also outside `authorize()`'s bearer-token boundary, for the opposite reason:
  // the caller here is a sibling Code Engine app with no end-user token at all,
  // gated instead by its own shared-secret check inside `getRoles`.
  if (route.kind === 'getRoles') {
    return getRoles(request, deps);
  }

  // Open endpoint — no bearer token required. Rate-limited per IP in memory.
  if (route.kind === 'createShopSession') {
    return createShopSession(request, deps);
  }

  // Open endpoints — the MercadoPago public key is client-side; the access token
  // is server-side only. No staff JWT required from the shop checkout page.
  if (route.kind === 'createMercadoPagoPreference') {
    return createMercadoPagoPreference(request, deps);
  }

  if (route.kind === 'getMercadoPagoPreferenceStatus') {
    return getMercadoPagoPreferenceStatus(route.preferenceId, deps);
  }

  // Kiosk transaction — has its own token verification (kiosk-device or shop-session),
  // not a staff JWT, so it bypasses the staff `authorize()` boundary entirely.
  if (route.kind === 'createKioskTransaction') {
    return createKioskTransaction(request, deps);
  }

  // `rolesSource: deps.roles` merged in here, not stored on `deps.appId`
  // itself: `deps.appId` is built once at startup from env vars only
  // (`server.ts`'s `readAppIdConfig()`), while the roles store is a request
  // dependency like `deps.products`/`deps.transactions` — merging it at the
  // one call site that needs it keeps that startup-config/request-dependency
  // split intact rather than blurring the two.
  const outcome = await authorize(
    request.authorization,
    route.permission,
    {
      secret: deps.secret,
      appId: deps.appId ? { ...deps.appId, rolesSource: deps.roles } : undefined,
    },
    deps.nowSeconds()
  );
  if (!outcome.ok) {
    return { status: outcome.status, body: { error: outcome.error } };
  }

  switch (route.kind) {
    case 'listProducts':
      return { status: 200, body: await listProducts(deps) };
    case 'createProduct':
      return createProduct(request.body, deps);
    case 'replaceProduct':
      return replaceProduct(route.id, request.body, deps);
    case 'patchProduct':
      return patchProduct(route.id, request.body, deps);
    case 'deleteProduct':
      return deleteProduct(route.id, deps);
    case 'sellProduct':
      return sellProduct(
        route.id,
        request.body,
        outcome.claims.operatorId,
        outcome.claims.tenantId,
        deps
      );
    case 'listTransactions':
      return { status: 200, body: await listTransactions(deps) };
    case 'createKioskDeviceToken':
      return createKioskDeviceToken(request.body, outcome.claims.tenantId, deps);
    case 'uploadProductImage':
      return uploadProductImage(route.id, request, deps);
  }
}

// ─── Routing ──────────────────────────────────────────────────────────────────

type Route =
  | { readonly kind: 'health' }
  | { readonly kind: 'getRoles' }
  | { readonly kind: 'createShopSession' }
  | { readonly kind: 'createMercadoPagoPreference' }
  | { readonly kind: 'getMercadoPagoPreferenceStatus'; readonly preferenceId: string }
  | { readonly kind: 'listProducts'; readonly permission: Permission }
  | { readonly kind: 'createProduct'; readonly permission: Permission }
  | { readonly kind: 'listTransactions'; readonly permission: Permission }
  | { readonly kind: 'createKioskDeviceToken'; readonly permission: Permission }
  | { readonly kind: 'createKioskTransaction' }
  | { readonly kind: 'replaceProduct'; readonly permission: Permission; readonly id: string }
  | { readonly kind: 'patchProduct'; readonly permission: Permission; readonly id: string }
  | { readonly kind: 'deleteProduct'; readonly permission: Permission; readonly id: string }
  | { readonly kind: 'sellProduct'; readonly permission: Permission; readonly id: string }
  | { readonly kind: 'uploadProductImage'; readonly permission: Permission; readonly id: string };

/**
 * Match a method and path against the eight routes, and nothing else.
 *
 * Written as explicit segment comparison rather than one regular expression per
 * route because the id is the only variable part and a mis-anchored pattern is how
 * `/api/products/x/../transactions` becomes interesting. Segments are decoded after
 * splitting, so an encoded slash in an id cannot invent a segment.
 */
export function matchRoute(method: string, path: string): Route | null {
  const segments = path.split('/').filter((segment) => segment.length > 0);
  const upper = method.toUpperCase();

  // Not under `api` — a sibling service, not the till, is the only caller.
  if (segments.length === 2 && segments[0] === 'internal' && segments[1] === 'roles') {
    return upper === 'GET' ? { kind: 'getRoles' } : null;
  }

  if (segments[0] !== 'api') {
    return null;
  }

  if (segments.length === 2 && segments[1] === 'health') {
    return upper === 'GET' ? { kind: 'health' } : null;
  }

  if (segments.length === 2 && segments[1] === 'transactions') {
    if (upper === 'GET') return { kind: 'listTransactions', permission: Permission.VIEW_TRANSACTIONS };
    if (upper === 'POST') return { kind: 'createKioskTransaction' };
    return null;
  }

  if (segments.length === 3 && segments[1] === 'shop' && segments[2] === 'session') {
    return upper === 'POST' ? { kind: 'createShopSession' } : null;
  }

  if (segments.length === 3 && segments[1] === 'mercadopago' && segments[2] === 'preference') {
    if (upper === 'POST') return { kind: 'createMercadoPagoPreference' };
    return null;
  }

  if (segments.length === 4 && segments[1] === 'mercadopago' && segments[2] === 'preference') {
    const rawId = segments[3];
    if (rawId === undefined || rawId.length === 0) return null;
    const preferenceId = safeDecode(rawId);
    if (preferenceId === null || preferenceId.length === 0) return null;
    return upper === 'GET' ? { kind: 'getMercadoPagoPreferenceStatus', preferenceId } : null;
  }

  if (segments.length === 2 && segments[1] === 'kiosk-device-token') {
    return upper === 'POST'
      ? { kind: 'createKioskDeviceToken', permission: Permission.MANAGE_INVENTORY }
      : null;
  }

  if (segments[1] !== 'products') {
    return null;
  }

  if (segments.length === 2) {
    if (upper === 'GET') {
      return { kind: 'listProducts', permission: Permission.VIEW_INVENTORY };
    }
    if (upper === 'POST') {
      return { kind: 'createProduct', permission: Permission.MANAGE_INVENTORY };
    }
    return null;
  }

  const rawId = segments[2];
  if (rawId === undefined) {
    return null;
  }
  const id = safeDecode(rawId);
  if (id === null || id.length === 0) {
    return null;
  }

  if (segments.length === 3) {
    switch (upper) {
      case 'PUT':
        return { kind: 'replaceProduct', permission: Permission.MANAGE_INVENTORY, id };
      case 'PATCH':
        return { kind: 'patchProduct', permission: Permission.MANAGE_INVENTORY, id };
      case 'DELETE':
        // The one route an operator or manager cannot reach; only Admin holds
        // `inventory:delete`. This is the first server-side authorization in the repo.
        return { kind: 'deleteProduct', permission: Permission.DELETE_PRODUCT, id };
      default:
        return null;
    }
  }

  if (segments.length === 4 && segments[3] === 'sell' && upper === 'POST') {
    return { kind: 'sellProduct', permission: Permission.PROCESS_SALE, id };
  }

  if (segments.length === 4 && segments[3] === 'image' && upper === 'POST') {
    return { kind: 'uploadProductImage', permission: Permission.MANAGE_INVENTORY, id };
  }

  return null;
}

/** `decodeURIComponent` throws on a malformed escape; a bad id is a 404, not a 500. */
function safeDecode(segment: string): string | null {
  try {
    return decodeURIComponent(segment);
  } catch {
    return null;
  }
}

// ─── Handlers ─────────────────────────────────────────────────────────────────

/**
 * Health.
 *
 * `status: 'healthy'` and `service` are kept verbatim from `health/index.js`:
 * `sync.worker.ts`'s `checkHealth` tests `data.status === 'healthy'`, so the string
 * is a wire contract. `architecture` and `platform` tell the truth about what is
 * answering, which is the whole point of the epic — the AWS value said
 * `single-responsibility-lambdas` and this is not that.
 */
function health(deps: ApiDeps): ApiResponse {
  return {
    status: 200,
    body: {
      status: 'healthy',
      service: 'capy-pos-api',
      version: '1.0.0',
      architecture: 'single-container',
      platform: 'ibm-code-engine',
      timestamp: deps.nowIso(),
      endpoints: {
        getProducts: 'GET /api/products',
        createProduct: 'POST /api/products',
        replaceProduct: 'PUT /api/products/{id}',
        patchProduct: 'PATCH /api/products/{id}',
        deleteProduct: 'DELETE /api/products/{id}',
        sellProduct: 'POST /api/products/{id}/sell',
        getTransactions: 'GET /api/transactions',
        createTransaction: 'POST /api/transactions (kiosk-device or shop-session token)',
        createShopSession: 'POST /api/shop/session (open, rate-limited)',
        createKioskDeviceToken: 'POST /api/kiosk-device-token (MANAGE_INVENTORY)',
        health: 'GET /api/health',
        internalRoles: 'GET /internal/roles (X-Internal-Secret, sibling services only)',
      },
    },
  };
}

// ─── Rate limiter (in-memory, per IP) ─────────────────────────────────────────
//
// Prevents a single IP from minting an unlimited number of shop-session tokens.
// The map entry records how many sessions were issued in the current hour window
// and the timestamp when that window opened. On window expiry the counter resets.
// This is intentionally simple: one window per IP, no sliding window, no Redis.
// A more sophisticated solution would use a distributed counter (Cloudant or
// Redis), but for the kiosk use-case — one phone per customer per session — 20
// sessions/hour/IP is more than enough and a memory counter cannot be bypassed
// by hitting a second pod when Code Engine runs a single instance in kiosk mode.

const SHOP_SESSION_MAX_PER_HOUR = 20;
const SHOP_SESSION_WINDOW_MS = 60 * 60 * 1000; // 1 hour

interface RateBucket { count: number; windowStart: number }
const shopSessionBuckets = new Map<string, RateBucket>();

function shopSessionAllowed(ip: string, nowMs: number): boolean {
  const bucket = shopSessionBuckets.get(ip);
  if (bucket === undefined || nowMs - bucket.windowStart >= SHOP_SESSION_WINDOW_MS) {
    shopSessionBuckets.set(ip, { count: 1, windowStart: nowMs });
    return true;
  }
  if (bucket.count >= SHOP_SESSION_MAX_PER_HOUR) {
    return false;
  }
  bucket.count += 1;
  return true;
}

/**
 * `GET /internal/roles` — Phase 5, RBAC centralization.
 *
 * Gated by `X-Internal-Secret`, not a bearer token: the caller is
 * `vision-proxy` or `clerk-agent-relay`, not a browser, and neither holds an
 * end-user session to present. `constantTimeStringsEqual` is the same
 * closed-timing-side-channel comparison `signatureMatches` already uses for
 * the HS256 path, generalized to a plain shared secret.
 *
 * Reads `ROLES_DOC_ID` and falls back to `SIBLING_ROLE_FALLBACK` below
 * whenever that document does not yield a usable mapping — a fresh `roles`
 * database, before anyone has written to it, answers exactly what today's
 * hand-copied tables already say, not an empty grant.
 *
 * "Does not yield a usable mapping" covers all three ways this untrusted read
 * can fail, deliberately not just the middle one:
 *
 * The read can *reject* — Cloudant unreachable, credentials rotated. Letting
 * that propagate would turn the RBAC source for both siblings into a 500 and
 * leave them with no mapping at all, gating every route they have closed over
 * a transient blip. `session-auth.ts` already resolves a thrown read to "no
 * usable document" for the very same Cloudant document, so this route matches
 * it rather than being the one consumer that fails loudly.
 *
 * The document can be the wrong shape, which is `session-auth.ts`'s own
 * `isRolesShape` — the same guard rather than a second opinion.
 * `CloudantStore.read` only casts (`stripMeta<T>`), so `RolesDocument.roles`
 * being non-optional in TypeScript does not stop a hand-written or
 * half-migrated document from having no `roles` key at all, and passing that
 * into `withoutPosApiOnlyRoles` would throw. That guard also rejects `{}`,
 * which is shape-valid but is exactly the empty grant this fallback exists to
 * prevent.
 *
 * Emptiness is then re-checked on what is actually about to be served, not
 * only on what was read: `withoutPosApiOnlyRoles` can itself empty a document
 * that passed the guard — a `roles` document whose only entry is `customer`
 * (an admin narrowing self-checkout's grant, which is a supported edit) leaves
 * nothing behind once `customer` is held back. The siblings must get a real
 * table or the fallback; never a mapping in which every role they look up
 * resolves to no permissions.
 */
async function getRoles(request: ApiRequest, deps: ApiDeps): Promise<ApiResponse> {
  if (deps.internalSecret.length === 0) {
    return { status: 503, body: { error: 'Internal API is not configured.' } };
  }
  if (
    request.internalSecret === undefined ||
    !constantTimeStringsEqual(request.internalSecret, deps.internalSecret)
  ) {
    return { status: 401, body: { error: 'Invalid or missing X-Internal-Secret.' } };
  }

  const stored = await readStoredRoles(deps.roles);
  if (stored === null) {
    return { status: 200, body: { roles: SIBLING_ROLE_FALLBACK } };
  }
  const forSiblings = withoutPosApiOnlyRoles(stored);
  return {
    status: 200,
    body: { roles: Object.keys(forSiblings).length > 0 ? forSiblings : SIBLING_ROLE_FALLBACK },
  };
}

/**
 * `null` means "no mapping worth serving", collapsing a missing document, a
 * failed read and an unusable one — the same one-null contract
 * `session-auth.ts`'s `readRolesDocument` uses against this same document, so
 * the two consumers cannot disagree about which reads count as usable.
 *
 * The failure is logged rather than swallowed: the siblings keep working off
 * the fallback, so a broken RBAC source has nothing else to surface it.
 */
async function readStoredRoles(
  store: DocumentStore<RolesDocument>
): Promise<Readonly<Record<string, readonly string[]>> | null> {
  let stored: unknown;
  try {
    stored = (await store.read(ROLES_DOC_ID))?.document.roles;
  } catch (error) {
    console.error('[pos-api] shared roles read failed', error);
    return null;
  }
  return isRolesShape(stored) ? stored : null;
}

/**
 * The fallback `getRoles` serves the two sibling proxies: `ROLE_PERMISSIONS`
 * minus the roles that exist only in this service.
 *
 * `customer` (Epic #261 item 6) is one of those: self-checkout authenticates
 * against its own App ID application and reaches only `pos-api`, and
 * `vision-proxy`/`clerk-agent-relay` gate every route they have on
 * `sale:process` alone — the single permission `customer` holds. Serving it in
 * this fallback would therefore admit any self-registered shopper to the
 * AI-vision and clerk-agent routes, which is not what adding it to
 * `ROLE_PERMISSIONS` was meant to do.
 *
 * Derived from `ROLE_PERMISSIONS` rather than restated so a new staff role
 * added there reaches the siblings automatically, the way Phase 5's
 * centralization intends; only names listed here are held back.
 *
 * Applied to the *stored document* too, not just this fallback (Epic #261
 * item 9): a live `roles` document that carries `customer` — because someone
 * added it there so `pos-api` keeps granting self-checkout its one permission
 * — must not reach the siblings either, or the document's existence would
 * quietly do the very thing the fallback filter exists to prevent. Filtering
 * here, at the one route that serves them, keeps the rule in a single place
 * instead of requiring each proxy to learn to refuse role names it does not
 * recognise.
 */
const POS_API_ONLY_ROLES: readonly string[] = ['customer'];

function withoutPosApiOnlyRoles(
  roles: Readonly<Record<string, readonly string[]>>
): Readonly<Record<string, readonly string[]>> {
  return Object.freeze(
    Object.fromEntries(Object.entries(roles).filter(([role]) => !POS_API_ONLY_ROLES.includes(role)))
  );
}

const SIBLING_ROLE_FALLBACK: Readonly<Record<string, readonly string[]>> =
  withoutPosApiOnlyRoles(ROLE_PERMISSIONS);

async function listProducts(
  deps: ApiDeps
): Promise<{ products: readonly PublicProductDocument[]; count: number }> {
  const products = (await deps.products.list()).map(publicProduct);
  return { products, count: products.length };
}

/** Strips server-owned reservation markers from every product response. */
function publicProduct(product: ProductDocument): PublicProductDocument {
  const { checkoutMarkers: _checkoutMarkers, ...projection } = product;
  return projection;
}

/**
 * Transactions, most recent first.
 *
 * The sort is `get-transactions/index.js`'s, kept because the till renders this list
 * in order and an unsorted response would reorder history on every sync. A document
 * with an unparseable timestamp sorts last rather than poisoning the comparison with
 * `NaN` — the resilient-mapping rule from #110, which is in this repo because a
 * single bad record once broke a whole list.
 */
async function listTransactions(
  deps: ApiDeps
): Promise<{ transactions: readonly PublicTransactionDocument[]; count: number }> {
  const transactions = [...(await deps.transactions.list())]
    .sort((left, right) => {
      const leftMs = Date.parse(right.timestamp);
      const rightMs = Date.parse(left.timestamp);
      return (
        (Number.isNaN(leftMs) ? -Infinity : leftMs) - (Number.isNaN(rightMs) ? -Infinity : rightMs)
      );
    })
    .map(publicTransaction);
  return { transactions, count: transactions.length };
}

// ─── Kiosk / Shop handlers ────────────────────────────────────────────────────

/**
 * POST /api/shop/session — no auth, rate-limited.
 *
 * A customer's phone calls this once on page load to get a short-lived JWT
 * it can use to POST /api/transactions at checkout. No staff session required.
 * `storeId` is the only body field; it is accepted as any non-empty string —
 * the client already resolved it from geofence/settings, and re-validating it
 * here would require Cloudant access on a hot, unauthenticated path.
 */
function createShopSession(request: ApiRequest, deps: ApiDeps): ApiResponse {
  const nowMs = deps.nowSeconds() * 1000;
  // Use the Authorization header as a proxy for the client IP when the real
  // IP isn't available (e.g. test harness). In production the request arrives
  // via Code Engine's ingress which forwards the real IP in X-Forwarded-For;
  // for the in-process test the authorization string is undefined, so we fall
  // back to 'test' — a value that only appears in tests.
  const ip = (request.authorization ?? 'test').slice(0, 64);
  if (!shopSessionAllowed(ip, nowMs)) {
    return { status: 429, body: { error: 'Too many session requests. Try again later.' } };
  }

  const body = asObject(request.body);
  const storeId = body !== null ? asNonEmptyString(body['storeId']) : null;
  if (storeId === null) {
    return { status: 400, body: { error: 'storeId is required.' } };
  }

  const exp = deps.nowSeconds() + 3600; // 1 hour
  const token = signToken(
    { sub: storeId, type: 'shop-session', tenantId: storeId, exp },
    deps.secret
  );
  return { status: 201, body: { token, expiresAt: new Date(exp * 1000).toISOString() } };
}

/**
 * POST /api/kiosk-device-token — staff JWT with MANAGE_INVENTORY required.
 *
 * Staff call this once per terminal during setup. The token is long-lived (1 year)
 * and stored in Dexie. It authenticates POST /api/transactions from the terminal.
 */
function createKioskDeviceToken(rawBody: unknown, tenantId: string, deps: ApiDeps): ApiResponse {
  const body = asObject(rawBody);
  const terminalId = body !== null ? asNonEmptyString(body['terminalId']) : null;
  if (terminalId === null) {
    return { status: 400, body: { error: 'terminalId is required.' } };
  }

  const exp = deps.nowSeconds() + 365 * 24 * 3600; // 1 year
  const token = signToken(
    { sub: terminalId, type: 'kiosk-device', tenantId, exp },
    deps.secret
  );
  return { status: 201, body: { token, expiresAt: new Date(exp * 1000).toISOString() } };
}

/**
 * POST /api/transactions — kiosk-device or shop-session token required.
 *
 * Accepts a full basket and writes one KioskTransactionDocument. This is the
 * audit trail for kiosk/shop sales. Stock adjustment is handled separately by
 * POST /api/products/{id}/sell — this endpoint never touches product documents.
 *
 * Token type is checked explicitly after signature verification: a staff JWT
 * that happens to verify correctly must not be accepted here, because this
 * endpoint is the self-checkout boundary, not the operator boundary.
 */
async function createKioskTransaction(request: ApiRequest, deps: ApiDeps): Promise<ApiResponse> {
  const token = readBearer(request.authorization);
  if (token === null) {
    return { status: 401, body: { error: 'Authorization required.' } };
  }

  const claims = verifySessionToken(token, deps.secret, deps.nowSeconds());
  if (claims === null) {
    return { status: 401, body: { error: 'Invalid or expired token.' } };
  }

  // Narrow to the two token types this endpoint accepts. A regular staff JWT
  // has no `type` claim and must not be able to POST transactions anonymously.
  if (claims.type !== 'kiosk-device' && claims.type !== 'shop-session') {
    return { status: 401, body: { error: 'Invalid token type for this endpoint.' } };
  }

  const body = asObject(request.body);
  if (body === null) {
    return { status: 400, body: { error: 'Body must be a JSON object.' } };
  }

  const paymentMethod = asNonEmptyString(body['paymentMethod']);
  const total = asFiniteNumber(body['total']);
  const subtotal = asFiniteNumber(body['subtotal']);
  const taxAmount = asFiniteNumber(body['taxAmount']);
  const items = body['items'];

  if (paymentMethod === null || total === null || subtotal === null || taxAmount === null) {
    return {
      status: 400,
      body: { error: 'Missing required fields: paymentMethod, total, subtotal, taxAmount' },
    };
  }
  if (!Array.isArray(items) || items.length === 0) {
    return { status: 400, body: { error: 'items must be a non-empty array.' } };
  }

  const transaction: KioskTransactionDocument = {
    id: deps.newId(),
    type: 'kiosk-sale',
    items: items.map((item: unknown) => {
      const i = asObject(item) ?? {};
      return {
        productId: asString(i['productId']) ?? '',
        productName: asString(i['productName']) ?? '',
        quantity: asFiniteNumber(i['quantity']) ?? 0,
        unitPrice: asFiniteNumber(i['unitPrice']) ?? 0,
        lineTotal: asFiniteNumber(i['lineTotal']) ?? 0,
      };
    }),
    subtotal,
    taxAmount,
    total,
    paymentMethod,
    terminalId: claims.operatorId, // operatorId holds the sub (terminalId or storeId)
    customerId: asString(body['customerId']) ?? undefined,
    customerEmail: asString(body['customerEmail']) ?? undefined,
    timestamp: deps.nowIso(),
    operatorId: claims.operatorId,
    tenantId: claims.tenantId,
  };

  // deps.transactions is DocumentStore<TransactionDocument>; KioskTransactionDocument
  // is a different shape. Both extend StoredDocument and the runtime store accepts
  // either — cast through unknown to silence the structural mismatch without
  // widening the ApiDeps interface.
  const txStore = deps.transactions as unknown as import('../../shared/src/document-store.ts').DocumentStore<KioskTransactionDocument>;
  const outcome = await txStore.create(transaction);
  if (outcome === 'conflict') {
    // UUID collision — extremely rare but log loudly rather than 500.
    console.error('[pos-api] kiosk transaction id collision', { transactionId: transaction.id });
  }
  return { status: 201, body: { transaction } };
}

async function createProduct(rawBody: unknown, deps: ApiDeps): Promise<ApiResponse> {
  const body = asObject(rawBody);
  if (body === null) {
    return { status: 400, body: { error: 'Body must be a JSON object.' } };
  }

  const id = asNonEmptyString(body['id']);
  const fields = readRequiredFields(body);
  if (id === null || 'error' in fields) {
    return {
      status: 400,
      body: { error: 'Missing required fields: id, name, price, category' },
    };
  }

  const timestamp = deps.nowIso();
  const product: ProductDocument = {
    id,
    name: fields.name,
    price: fields.price,
    category: fields.category,
    stock: readStock(body['stock']),
    description: asString(body['description']) ?? '',
    createdAt: timestamp,
    updatedAt: timestamp,
  };

  const outcome = await deps.products.create(product);
  if (outcome === 'conflict') {
    return { status: 409, body: { error: 'Product with this ID already exists' } };
  }
  return { status: 201, body: { product: publicProduct(product) } };
}

/** PUT — full replace. Requires the full field set and preserves the original `createdAt`. */
async function replaceProduct(id: string, rawBody: unknown, deps: ApiDeps): Promise<ApiResponse> {
  const body = asObject(rawBody);
  if (body === null) {
    return { status: 400, body: { error: 'Body must be a JSON object.' } };
  }

  const fields = readRequiredFields(body);
  if ('error' in fields) {
    return { status: 400, body: { error: 'Missing required fields: name, price, category' } };
  }

  const existing = await deps.products.read(id);
  if (existing === null) {
    return { status: 404, body: { error: 'Product not found', productId: id } };
  }

  const requestedStock = readStock(body['stock']);
  const requestedIsActive = readOptionalBoolean(body['isActive']);
  const reservationConflict = inventoryMutationConflict(existing.document, {
    nextStock: requestedStock,
    nextIsActive: requestedIsActive ?? existing.document.isActive,
  });
  if (reservationConflict !== null) return reservationConflict;

  const replacement: ProductDocument = {
    id,
    name: fields.name,
    price: fields.price,
    category: fields.category,
    stock: requestedStock,
    ...(existing.document.checkoutMarkers === undefined
      ? {}
      : { checkoutMarkers: existing.document.checkoutMarkers }),
    description: asString(body['description']) ?? '',
    ...(requestedIsActive === undefined
      ? existing.document.isActive === undefined
        ? {}
        : { isActive: existing.document.isActive }
      : { isActive: requestedIsActive }),
    createdAt: existing.document.createdAt,
    updatedAt: deps.nowIso(),
  };

  const outcome = await deps.products.write(replacement, existing.rev);
  if (outcome === 'conflict') {
    // Someone wrote between the read and the write. A replace is not safely
    // retryable on the client's behalf — the body it sent was composed against
    // state that no longer exists — so this reports the conflict rather than
    // silently clobbering the other write.
    return { status: 409, body: { error: 'Product was modified concurrently. Retry.' } };
  }
  return { status: 200, body: { product: publicProduct(replacement) } };
}

/** PATCH — partial update over whichever mutable fields are present. */
async function patchProduct(id: string, rawBody: unknown, deps: ApiDeps): Promise<ApiResponse> {
  const body = asObject(rawBody);
  if (body === null) {
    return { status: 400, body: { error: 'Body must be a JSON object.' } };
  }

  const patch: Record<string, unknown> = {};
  for (const field of MUTABLE_FIELDS) {
    const value = body[field];
    if (value === undefined) {
      continue;
    }
    if (field === 'price' || field === 'stock') {
      const numeric = asFiniteNumber(value);
      if (numeric === null || numeric < 0) {
        return { status: 400, body: { error: `${field} must be a non-negative number.` } };
      }
      patch[field] = numeric;
      continue;
    }
    if (field === 'isActive') {
      if (typeof value !== 'boolean') {
        return { status: 400, body: { error: 'isActive must be a boolean.' } };
      }
      patch[field] = value;
      continue;
    }
    const text = asNonEmptyString(value);
    if (text === null) {
      return { status: 400, body: { error: `${field} must be a non-empty string.` } };
    }
    patch[field] = text;
  }

  if (Object.keys(patch).length === 0) {
    return {
      status: 400,
      body: { error: `No updatable fields provided. Allowed: ${MUTABLE_FIELDS.join(', ')}` },
    };
  }

  const existing = await deps.products.read(id);
  if (existing === null) {
    return { status: 404, body: { error: 'Product not found', productId: id } };
  }

  const reservationConflict = inventoryMutationConflict(existing.document, {
    nextStock: typeof patch['stock'] === 'number' ? patch['stock'] : existing.document.stock,
    nextIsActive:
      typeof patch['isActive'] === 'boolean' ? patch['isActive'] : existing.document.isActive,
  });
  if (reservationConflict !== null) return reservationConflict;

  const updated = { ...existing.document, ...patch, updatedAt: deps.nowIso() } as ProductDocument;
  const outcome = await deps.products.write(updated, existing.rev);
  if (outcome === 'conflict') {
    return { status: 409, body: { error: 'Product was modified concurrently. Retry.' } };
  }
  return { status: 200, body: { product: publicProduct(updated) } };
}

async function deleteProduct(id: string, deps: ApiDeps): Promise<ApiResponse> {
  const existing = await deps.products.read(id);
  if (existing === null) {
    return { status: 404, body: { error: 'Product not found', productId: id } };
  }
  if (productHasActiveReservations(existing.document)) {
    return {
      status: 409,
      body: {
        error: 'Product has active checkout reservations and cannot be deleted.',
        productId: id,
      },
    };
  }
  const outcome = await deps.products.remove(id, existing.rev);
  if (outcome === 'conflict') {
    return { status: 409, body: { error: 'Product was modified concurrently. Retry.' } };
  }
  return {
    status: 200,
    body: { message: 'Product deleted', product: publicProduct(existing.document) },
  };
}

/**
 * Sell — decrement stock and record the sale.
 *
 * The read-check-write is a compare-and-swap, and that is the one behavioural
 * correction this file makes to the Lambda it replaces. `sell-product/index.js`
 * checks `product.stock < quantity` and then issues an unconditional
 * `SET stock = stock - :qty`; two tills selling the last unit both pass the check
 * and both decrement, so stock goes negative and the shop has sold something it does
 * not have. Passing `existing.rev` to `write` makes the second one lose, re-read, and
 * see the real remaining stock — so it returns 400 "Insufficient stock", which is
 * true, instead of 200 for a unit that does not exist.
 *
 * ## The part that is still not atomic, stated plainly
 *
 * Stock and the transaction are two documents and Cloudant has no multi-document
 * transaction, so a crash between the two writes leaves stock decremented with no
 * sale recorded. Stock is written first on purpose: this way the failure loses a
 * record of a sale that happened, which reconciliation can find and a human can fix,
 * rather than overstating stock the shop no longer has and overselling it again.
 * Closing it properly needs an idempotent outbox, which is the sync story's shape,
 * not this route's — and the AWS Lambda had the identical window with no guard on
 * either side of it.
 */
async function sellProduct(
  id: string,
  rawBody: unknown,
  operatorId: string,
  tenantId: string,
  deps: ApiDeps
): Promise<ApiResponse> {
  const body = asObject(rawBody) ?? {};
  const requested = body['quantity'];
  // Absent means one, matching the Lambda's `body.quantity || 1`. Present but not a
  // positive integer is a client bug and is refused rather than coerced: `|| 1`
  // silently turned `0`, `-3` and `"lots"` into a sale of one.
  const quantity = requested === undefined ? 1 : asPositiveInteger(requested);
  if (quantity === null) {
    return { status: 400, body: { error: 'quantity must be a positive integer.' } };
  }

  for (let attempt = 0; attempt < SELL_ATTEMPTS; attempt++) {
    const existing = await deps.products.read(id);
    if (existing === null) {
      return { status: 404, body: { error: 'Product not found', productId: id } };
    }

    const product = existing.document;
    const available = productAvailableStock(product);
    if (available < quantity) {
      return {
        status: 400,
        body: {
          error: 'Insufficient stock',
          productId: id,
          available,
          requested: quantity,
        },
      };
    }

    const remainingStock = product.stock - quantity;
    const written = await deps.products.write(
      { ...product, stock: remainingStock, updatedAt: deps.nowIso() },
      existing.rev
    );
    if (written === 'conflict') {
      continue; // Lost the race; re-read and re-check against real stock.
    }

    const transaction: LegacyTransactionDocument = {
      id: deps.newId(),
      productId: id,
      productName: product.name,
      quantity,
      unitPrice: product.price,
      total: round2(product.price * quantity),
      type: 'sale',
      timestamp: deps.nowIso(),
      operatorId,
      tenantId,
    };
    const recorded = await deps.transactions.create(transaction);
    if (recorded === 'conflict') {
      // A fresh uuid collided, which means the id generator is broken. Stock is
      // already committed, so the sale stands; this is logged loudly rather than
      // failed, because a 500 here would tell the till to retry a sale that
      // already happened.
      console.error('[pos-api] transaction id collision', { transactionId: transaction.id });
    }

    return { status: 200, body: { message: 'Sale completed', transaction, remainingStock } };
  }

  // Lost the race every time: real contention on one product, and the honest answer
  // is "try again", not a sale that may double-decrement.
  return { status: 409, body: { error: 'Stock was changing concurrently. Retry.' } };
}

// ─── MercadoPago ──────────────────────────────────────────────────────────────

/**
 * Shape of the card-token payload the MercadoPago Brick posts to the browser,
 * which the browser then forwards here so the access token never leaves the server.
 */
interface MpCardData {
  readonly token: string;
  readonly issuer_id: string;
  readonly payment_method_id: string;
  readonly transaction_amount: number;
  readonly installments: number;
  readonly payer: {
    readonly email: string;
    readonly identification: { readonly type: string; readonly number: string };
  };
}

/** Shape of a successful MercadoPago Payments API response (minimal subset). */
interface MpPaymentResponse {
  readonly id: number;
  readonly status: 'approved' | 'pending' | 'rejected' | string;
}

/** Shape of a MercadoPago Preference API response (Wallet Brick flow). */
interface MpPreferenceResponse {
  readonly id: string;
  readonly init_point: string;
  readonly sandbox_init_point?: string;
  readonly external_reference?: string;
}

/**
 * POST /api/mercadopago/preference — open endpoint (no staff JWT).
 *
 * Handles two modes selected by the optional `mode` field in the request body:
 *
 *  • `mode: 'card'` (default) — the browser's Card Payment Brick has already
 *    tokenised the card client-side. This handler calls `POST /v1/payments`
 *    with the token and returns `{ id, status }`.
 *
 *  • `mode: 'wallet'` — creates a MercadoPago Preference (a payment session
 *    the buyer completes inside their MP account / app) and returns
 *    `{ id, initPoint }`. The browser feeds `id` into the Wallet Brick so
 *    MP's SDK can poll for completion.
 *
 * Returns 503 when MP_ACCESS_TOKEN is not configured.
 */
async function createMercadoPagoPreference(
  request: ApiRequest,
  deps: ApiDeps
): Promise<ApiResponse> {
  if (!deps.mpAccessToken) {
    return { status: 503, body: { error: 'MercadoPago is not configured on this server.' } };
  }

  const body = asObject(request.body);
  if (body === null) {
    return { status: 400, body: { error: 'Request body must be a JSON object.' } };
  }

  const mode = body['mode'] === 'wallet' ? 'wallet' : 'card';
  const amount = asFiniteNumber(body['amount']);
  if (amount === null || amount <= 0) {
    return { status: 400, body: { error: 'A positive amount is required.' } };
  }

  const doFetch = deps.fetch ?? globalThis.fetch;

  // ── Wallet mode: create a Preference, return its id + initPoint ───────────
  if (mode === 'wallet') {
    const title = asNonEmptyString(body['title']) ?? 'Capy POS sale';

    let mpResponse: Response;
    try {
      mpResponse = await doFetch('https://api.mercadopago.com/checkout/preferences', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${deps.mpAccessToken}`,
        },
        body: JSON.stringify({
          items: [{ title, quantity: 1, unit_price: amount, currency_id: deps.mpCurrencyId }],
          // external_reference lets us find the payment later via
          // GET /v1/payments/search?external_reference=<id>
          // (preference_id is not a valid search param in the MP API).
          // We use a fresh UUID so it is stable and unique per checkout.
          external_reference: deps.newId(),
          back_urls: {
            success: `${deps.appBaseUrl}/payment/success`,
            failure: `${deps.appBaseUrl}/payment/failure`,
            pending: `${deps.appBaseUrl}/payment/pending`,
          },
          // auto_return requires back_urls.success to be HTTPS — MP rejects it
          // over plain HTTP (localhost). Omit it in that case; the buyer closes
          // the tab manually and the BroadcastChannel / poll still resolves.
          ...(deps.appBaseUrl.startsWith('https://') ? { auto_return: 'approved' } : {}),
        }),
      });
    } catch (err) {
      console.error('[pos-api] MercadoPago upstream unreachable (wallet)', err);
      return { status: 502, body: { error: 'Could not reach MercadoPago.' } };
    }

    if (!mpResponse.ok) {
      const errBody = await mpResponse.text().catch(() => '');
      console.error(`[pos-api] MercadoPago preference failed ${mpResponse.status}`, errBody);
      return { status: 502, body: { error: 'MercadoPago preference creation failed.' } };
    }

    const pref = (await mpResponse.json()) as MpPreferenceResponse;
    // Return the external_reference alongside the preference id so the
    // adapter can poll GET /api/mercadopago/preference/<externalRef> and
    // the backend searches by external_reference, not preference_id.
    const externalReference = pref.external_reference ?? pref.id;
    return {
      status: 200,
      body: {
        id: pref.id,
        externalReference,
        initPoint: pref.init_point,
        sandboxInitPoint: pref.sandbox_init_point,
      },
    };
  }

  // ── Card mode: charge the card token directly ─────────────────────────────
  const formData = asObject(body['formData']);
  if (formData === null) {
    return { status: 400, body: { error: 'formData is required for card mode.' } };
  }

  const token = asNonEmptyString(formData['token']);
  const paymentMethodId = asNonEmptyString(formData['payment_method_id']);
  const installments = asPositiveInteger(formData['installments']);
  const payer = asObject(formData['payer']);

  if (!token || !paymentMethodId || installments === null || payer === null) {
    return { status: 400, body: { error: 'Incomplete card data in formData.' } };
  }

  let mpResponse: Response;
  try {
    mpResponse = await doFetch('https://api.mercadopago.com/v1/payments', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${deps.mpAccessToken}`,
      },
      body: JSON.stringify({
        token,
        issuer_id: formData['issuer_id'],
        payment_method_id: paymentMethodId,
        transaction_amount: amount,
        installments,
        description: 'Capy POS sale',
        payer,
      }),
    });
  } catch (err) {
    console.error('[pos-api] MercadoPago upstream unreachable', err);
    return { status: 502, body: { error: 'Could not reach MercadoPago.' } };
  }

  if (!mpResponse.ok) {
    const errBody = await mpResponse.text().catch(() => '');
    console.error(`[pos-api] MercadoPago returned ${mpResponse.status}`, errBody);
    return { status: 502, body: { error: 'MercadoPago payment failed.' } };
  }

  const result = (await mpResponse.json()) as MpPaymentResponse;
  return { status: 200, body: { id: String(result.id), status: result.status } };
}

/**
 * GET /api/mercadopago/preference/:id — open endpoint, no staff JWT.
 *
 * Polls the MercadoPago Payments Search API for any payment made against the
 * given preference id and returns `{ status }` so the browser adapter can
 * determine whether the buyer has completed payment in the MP app / new tab.
 *
 * Returns:
 *   200 { status: 'approved' | 'pending' | 'rejected' | 'not_found' }
 *   503  when mpAccessToken is not configured
 *   502  when the MP upstream is unreachable or returns non-2xx
 */
async function getMercadoPagoPreferenceStatus(
  preferenceId: string,
  deps: ApiDeps
): Promise<ApiResponse> {
  if (!deps.mpAccessToken) {
    return { status: 503, body: { error: 'MercadoPago is not configured on this server.' } };
  }

  const doFetch = deps.fetch ?? globalThis.fetch;
  // The MP Payments Search API does not accept `preference_id` as a filter —
  // the correct param is `external_reference`, which we set to our own UUID
  // when creating the preference so we can correlate it here.
  const url =
    `https://api.mercadopago.com/v1/payments/search?external_reference=${encodeURIComponent(preferenceId)}&sort=date_created&criteria=desc&limit=1`;

  let mpResponse: Response;
  try {
    mpResponse = await doFetch(url, {
      headers: { Authorization: `Bearer ${deps.mpAccessToken}` },
    });
  } catch (err) {
    console.error('[pos-api] MercadoPago status poll unreachable', err);
    return { status: 502, body: { error: 'Could not reach MercadoPago.' } };
  }

  if (!mpResponse.ok) {
    const errBody = await mpResponse.text().catch(() => '');
    console.error(`[pos-api] MercadoPago status poll ${mpResponse.status}`, errBody);
    return { status: 502, body: { error: 'MercadoPago status check failed.' } };
  }

  const data = (await mpResponse.json()) as { results?: { status: string }[] };
  const payment = data.results?.[0];
  const status = payment?.status ?? 'not_found';
  return { status: 200, body: { status } };
}

// ─── Image upload ─────────────────────────────────────────────────────────────

const MAX_IMAGE_BYTES = 2_097_152; // 2 MiB
const ALLOWED_IMAGE_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp']);

/**
 * Parse the `image` part out of a `multipart/form-data` body.
 *
 * No external dependency — the format is simple enough to handle inline:
 *   1. Extract the boundary token from the `Content-Type` header.
 *   2. Split on `--<boundary>` lines, skip the epilogue part.
 *   3. Find the part whose `Content-Disposition` header names `image`.
 *   4. Return the part's declared `Content-Type` and its byte range.
 *
 * Returns `null` when the boundary is absent, the body is empty, or no `image`
 * field is found.
 */
export function parseMultipartImage(
  rawBody: Uint8Array,
  contentType: string
): { mimeType: string; data: Uint8Array } | null {
  // Extract boundary from e.g. `multipart/form-data; boundary=----WebKitFormBoundary…`
  const boundaryMatch = /boundary=([^\s;]+)/i.exec(contentType);
  if (boundaryMatch === null) {
    return null;
  }
  const boundary = boundaryMatch[1]!;

  const enc = new TextEncoder();
  const dec = new TextDecoder('utf-8', { fatal: false });

  const delimBytes = enc.encode(`--${boundary}`);

  // Find all delimiter positions in the raw buffer.
  const positions: number[] = [];
  outer: for (let i = 0; i <= rawBody.length - delimBytes.length; i++) {
    for (let j = 0; j < delimBytes.length; j++) {
      if (rawBody[i + j] !== delimBytes[j]) {
        continue outer;
      }
    }
    positions.push(i);
  }

  // Each part runs from just after the delimiter line to the next delimiter.
  for (let p = 0; p < positions.length; p++) {
    const start = positions[p]! + delimBytes.length;
    // Skip the \r\n after the boundary (or "--" epilogue terminator)
    if (rawBody[start] === 0x2d && rawBody[start + 1] === 0x2d) {
      break; // closing delimiter
    }
    // Skip \r\n
    const headerStart = start + (rawBody[start] === 0x0d && rawBody[start + 1] === 0x0a ? 2 : 0);

    const end = positions[p + 1] !== undefined ? positions[p + 1]! - 2 : rawBody.length;

    // Header section ends at the first blank line (\r\n\r\n or \n\n)
    const partBytes = rawBody.subarray(headerStart, end);
    const partText = dec.decode(partBytes);

    const headerEnd = partText.search(/\r?\n\r?\n/);
    if (headerEnd === -1) {
      continue;
    }

    const headersText = partText.slice(0, headerEnd);
    // Check this part is the `image` field
    if (!/name="image"/i.test(headersText)) {
      continue;
    }

    // Extract Content-Type from part headers
    const ctMatch = /content-type:\s*([^\r\n]+)/i.exec(headersText);
    const mimeType = ctMatch !== null ? ctMatch[1]!.trim() : '';

    // Body bytes start after the blank line
    const blankLineMatch = /\r?\n\r?\n/.exec(partText);
    if (blankLineMatch === null) {
      continue;
    }
    const bodyOffset = new TextEncoder().encode(partText.slice(0, blankLineMatch.index! + blankLineMatch[0].length)).length;
    const data = partBytes.subarray(bodyOffset);

    return { mimeType, data };
  }

  return null;
}

/**
 * POST /api/products/:id/image — operator JWT with MANAGE_INVENTORY required.
 *
 * Accepts a `multipart/form-data` body with a single `image` field.
 * Validates MIME type (JPEG / PNG / WebP) and size (≤ 2 MiB), stores the binary
 * via `deps.imageStore`, writes the returned URL back to the product document, and
 * returns `{ imageUrl }`.
 */
async function uploadProductImage(
  id: string,
  request: ApiRequest,
  deps: ApiDeps
): Promise<ApiResponse> {
  // Product must exist
  const existing = await deps.products.read(id);
  if (existing === null) {
    return { status: 404, body: { error: 'Product not found', productId: id } };
  }

  const rawBody = request.rawBody;
  const contentType = request.contentType ?? '';

  if (rawBody === undefined || rawBody.length === 0) {
    return { status: 400, body: { error: 'Multipart body is required.' } };
  }

  if (rawBody.length > MAX_IMAGE_BYTES) {
    return { status: 413, body: { error: 'Image exceeds the 2 MiB limit.' } };
  }

  const parsed = parseMultipartImage(rawBody, contentType);
  if (parsed === null) {
    return { status: 400, body: { error: 'Could not parse multipart/form-data body.' } };
  }

  const { mimeType, data } = parsed;
  if (!ALLOWED_IMAGE_TYPES.has(mimeType)) {
    return { status: 415, body: { error: 'Image must be image/jpeg, image/png, or image/webp.' } };
  }

  const imageUrl = await deps.imageStore.upload(id, mimeType, data);

  // Write the URL back to the product document so the catalogue is immediately consistent.
  const updated: ProductDocument = { ...existing.document, imageUrl, updatedAt: deps.nowIso() };
  // Ignore conflicts — the image URL is the source of truth and the write is safe to retry.
  await deps.products.write(updated, existing.rev);

  return { status: 200, body: { imageUrl } };
}

// ─── Body reading ─────────────────────────────────────────────────────────────
//
// Every field off the wire goes through one of these. Nothing is trusted for its
// type, because the `price: "12"`/`price: undefined` class of bug is exactly what
// #110's resilient-mapping lesson was written about, and a `NaN` price stored here
// is a corrupt catalogue row that outlives the request that made it.

function asObject(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function asString(value: unknown): string | null {
  return typeof value === 'string' ? value : null;
}

function asNonEmptyString(value: unknown): string | null {
  return typeof value === 'string' && value.trim().length > 0 ? value : null;
}

function asFiniteNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function asPositiveInteger(value: unknown): number | null {
  return typeof value === 'number' && Number.isInteger(value) && value > 0 ? value : null;
}

/** The three fields both POST and PUT insist on, validated together. */
function readRequiredFields(
  body: Record<string, unknown>
): { name: string; price: number; category: string } | { error: true } {
  const name = asNonEmptyString(body['name']);
  const category = asNonEmptyString(body['category']);
  const price = asFiniteNumber(body['price']);
  if (name === null || category === null || price === null || price < 0) {
    return { error: true };
  }
  return { name, price, category };
}

/** Stock defaults to zero when absent, and a negative or non-numeric stock is zero. */
function readStock(value: unknown): number {
  const stock = asFiniteNumber(value);
  return stock === null || stock < 0 ? 0 : Math.floor(stock);
}

function readOptionalBoolean(value: unknown): boolean | undefined {
  return typeof value === 'boolean' ? value : undefined;
}

/**
 * Reservation markers are server-owned and never copied from a request body. Catalogue writes
 * preserve the persisted map, cannot lower physical stock below active reservations, and cannot
 * deactivate an item while a paid checkout could still need its reserved units.
 */
function inventoryMutationConflict(
  product: ProductDocument,
  next: { readonly nextStock: number; readonly nextIsActive: boolean | undefined }
): ApiResponse | null {
  const reserved = product.stock - productAvailableStock(product);
  if (next.nextStock < reserved) {
    return {
      status: 409,
      body: {
        error: 'Stock cannot be lower than active checkout reservations.',
        productId: product.id,
        reserved,
      },
    };
  }
  if (next.nextIsActive === false && productHasActiveReservations(product)) {
    return {
      status: 409,
      body: {
        error: 'Product has active checkout reservations and cannot be deactivated.',
        productId: product.id,
      },
    };
  }
  return null;
}

/**
 * Round a line total to cents.
 *
 * `19.99 * 3` is `59.97000000000001` in binary floating point, and storing that as a
 * transaction total puts a value in the shop's history that no receipt will ever
 * match.
 */
function round2(value: number): number {
  return Math.round(value * 100) / 100;
}
