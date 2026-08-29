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
import { Permission, authorize } from './session-auth.ts';
import type { DocumentStore, StoredDocument } from '../../shared/src/document-store.ts';

/** The catalogue document. Field-for-field what `create-product/index.js` writes. */
export interface ProductDocument extends StoredDocument {
  readonly name: string;
  readonly price: number;
  readonly category: string;
  readonly stock: number;
  readonly description: string;
  readonly isActive?: boolean;
  readonly createdAt: string;
  readonly updatedAt: string;
}

/** The sale record. Field-for-field what `sell-product/index.js` writes, plus attribution. */
export interface TransactionDocument extends StoredDocument {
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

export interface ApiRequest {
  readonly method: string;
  /** Path only — `server.ts` has already removed any query string. */
  readonly path: string;
  readonly authorization: string | undefined;
  /** Parsed JSON body, or `undefined` when there was none. */
  readonly body: unknown;
}

export interface ApiResponse {
  readonly status: number;
  readonly body: unknown;
}

export interface ApiDeps {
  readonly products: DocumentStore<ProductDocument>;
  readonly transactions: DocumentStore<TransactionDocument>;
  readonly secret: string;
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

  const outcome = authorize(request.authorization, route.permission, deps.secret, deps.nowSeconds());
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
      return sellProduct(route.id, request.body, outcome.claims.operatorId, outcome.claims.tenantId, deps);
    case 'listTransactions':
      return { status: 200, body: await listTransactions(deps) };
  }
}

// ─── Routing ──────────────────────────────────────────────────────────────────

type Route =
  | { readonly kind: 'health' }
  | { readonly kind: 'listProducts'; readonly permission: Permission }
  | { readonly kind: 'createProduct'; readonly permission: Permission }
  | { readonly kind: 'listTransactions'; readonly permission: Permission }
  | { readonly kind: 'replaceProduct'; readonly permission: Permission; readonly id: string }
  | { readonly kind: 'patchProduct'; readonly permission: Permission; readonly id: string }
  | { readonly kind: 'deleteProduct'; readonly permission: Permission; readonly id: string }
  | { readonly kind: 'sellProduct'; readonly permission: Permission; readonly id: string };

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
  if (segments[0] !== 'api') {
    return null;
  }

  const upper = method.toUpperCase();

  if (segments.length === 2 && segments[1] === 'health') {
    return upper === 'GET' ? { kind: 'health' } : null;
  }

  if (segments.length === 2 && segments[1] === 'transactions') {
    return upper === 'GET'
      ? { kind: 'listTransactions', permission: Permission.VIEW_TRANSACTIONS }
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
        health: 'GET /api/health',
      },
    },
  };
}

async function listProducts(deps: ApiDeps): Promise<{ products: readonly ProductDocument[]; count: number }> {
  const products = await deps.products.list();
  return { products, count: products.length };
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
): Promise<{ transactions: readonly TransactionDocument[]; count: number }> {
  const transactions = [...(await deps.transactions.list())].sort((left, right) => {
    const leftMs = Date.parse(right.timestamp);
    const rightMs = Date.parse(left.timestamp);
    return (Number.isNaN(leftMs) ? -Infinity : leftMs) - (Number.isNaN(rightMs) ? -Infinity : rightMs);
  });
  return { transactions, count: transactions.length };
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
  return { status: 201, body: { product } };
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

  const replacement: ProductDocument = {
    id,
    name: fields.name,
    price: fields.price,
    category: fields.category,
    stock: readStock(body['stock']),
    description: asString(body['description']) ?? '',
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
  return { status: 200, body: { product: replacement } };
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

  const updated = { ...existing.document, ...patch, updatedAt: deps.nowIso() } as ProductDocument;
  const outcome = await deps.products.write(updated, existing.rev);
  if (outcome === 'conflict') {
    return { status: 409, body: { error: 'Product was modified concurrently. Retry.' } };
  }
  return { status: 200, body: { product: updated } };
}

async function deleteProduct(id: string, deps: ApiDeps): Promise<ApiResponse> {
  const existing = await deps.products.read(id);
  if (existing === null) {
    return { status: 404, body: { error: 'Product not found', productId: id } };
  }
  const outcome = await deps.products.remove(id, existing.rev);
  if (outcome === 'conflict') {
    return { status: 409, body: { error: 'Product was modified concurrently. Retry.' } };
  }
  return { status: 200, body: { message: 'Product deleted', product: existing.document } };
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
    if (product.stock < quantity) {
      return {
        status: 400,
        body: {
          error: 'Insufficient stock',
          productId: id,
          available: product.stock,
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

    const transaction: TransactionDocument = {
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
