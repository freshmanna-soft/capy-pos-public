/**
 * Mercado Pago Point (card machine) charges, via the Orders API.
 *
 * The till asks the server to push a charge to a linked Point terminal; the
 * customer pays on the device; the till polls for the outcome. Three routes,
 * all behind a staff JWT with `sale:process` (see `api.ts`):
 *
 *   POST /api/mercadopago/point/orders             create the charge
 *   GET  /api/mercadopago/point/orders/:id         read its status
 *   POST /api/mercadopago/point/orders/:id/cancel  cancel it
 *
 * ## Why these are NOT open like the wallet routes
 *
 * The wallet/preference routes are open because the shop and kiosk hold no staff
 * token. These start a charge on a physical card machine, so an open route would
 * let anyone on the internet put a charge of any amount in front of a customer.
 *
 * ## Why the terminal is an allow-list
 *
 * The browser knows which device a lane is linked to, but the browser is not
 * trusted: `MP_POINT_TERMINAL_IDS` is the set of devices this deployment may
 * charge, and anything outside it is refused.
 *
 * ## Sale identity
 *
 * `externalReference` is the till's own transaction id. Mercado Pago keeps it on
 * the order, so a charge, its webhook and the recorded sale all join on it.
 */
import { createHmac, timingSafeEqual } from 'node:crypto';
import type { ApiDeps, ApiRequest, ApiResponse } from './api.ts';

const MP_ORDERS_URL = 'https://api.mercadopago.com/v1/orders';

/** How long an unpaid order stays on the device before Mercado Pago expires it. */
const POINT_ORDER_TTL = 'PT5M';

/** Upstream calls must never hang a till. */
const MP_TIMEOUT_MS = 10_000;

/** A charge above this is a typo or abuse, not a corner-shop sale. */
const MAX_AMOUNT = 1_000_000;

/**
 * Mercado Pago rejects a Point order below this with
 * `'$.transactions.payments[0].amount' Must be greater than or equal to 5.00`.
 * Checked here so the till gets a clear 400 instead of a generic 502.
 */
const MIN_AMOUNT = 5;

/** The till's transaction ids (`TXN-<UUID>`) fit; anything exotic is refused. */
const EXTERNAL_REFERENCE_PATTERN = /^[A-Za-z0-9_-]{1,64}$/;

/** Order ids Mercado Pago mints (`ORD…`) are alphanumeric; refuse anything else. */
const ORDER_ID_PATTERN = /^[A-Za-z0-9-]{1,128}$/;

interface UpstreamResult {
  readonly ok: boolean;
  readonly status: number;
  readonly body: Record<string, unknown>;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

/** "24.00" from 24 — integer cents, so floats never reach the wire. */
export function formatAmount(amount: number): string {
  const cents = Math.round(amount * 100);
  const whole = Math.trunc(cents / 100);
  const fraction = String(cents % 100).padStart(2, '0');
  return `${whole}.${fraction}`;
}

async function callMercadoPago(
  deps: ApiDeps,
  method: 'GET' | 'POST',
  url: string,
  extraHeaders: Record<string, string>,
  body?: unknown
): Promise<UpstreamResult | null> {
  const doFetch = deps.fetch ?? globalThis.fetch;
  try {
    const response = await doFetch(url, {
      method,
      headers: {
        Authorization: `Bearer ${deps.mpAccessToken}`,
        ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
        ...extraHeaders,
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      signal: AbortSignal.timeout(MP_TIMEOUT_MS),
    });
    const parsed = await response.json().catch(() => ({}));
    return { ok: response.ok, status: response.status, body: asRecord(parsed) ?? {} };
  } catch (err) {
    console.error('[pos-api] MercadoPago Point upstream unreachable', err);
    return null;
  }
}

/** The few fields the till needs, whatever else Mercado Pago sends back. */
function summarize(order: Record<string, unknown>): Record<string, unknown> {
  const transactions = asRecord(order['transactions']);
  const payments = Array.isArray(transactions?.['payments']) ? transactions['payments'] : [];
  const payment = asRecord(payments[0]);
  return {
    id: typeof order['id'] === 'string' ? order['id'] : '',
    status: typeof order['status'] === 'string' ? order['status'] : '',
    statusDetail: typeof order['status_detail'] === 'string' ? order['status_detail'] : '',
    externalReference:
      typeof order['external_reference'] === 'string' ? order['external_reference'] : '',
    paymentId: typeof payment?.['id'] === 'string' ? payment['id'] : '',
  };
}

/** Webhook statuses that are final for the till; anything else is ignored. */
const WEBHOOK_STATUSES = new Set([
  'processed',
  'canceled',
  'expired',
  'failed',
  'refunded',
  'action_required',
]);

/** Most recent webhook-confirmed orders kept in memory; oldest evicted first. */
const ORDER_CACHE_LIMIT = 200;

function parseSignature(header: string | undefined): { ts: string; v1: string } | null {
  if (header === undefined) return null;
  let ts = '';
  let v1 = '';
  for (const part of header.split(',')) {
    const [key, value] = part.split('=', 2).map((piece) => piece.trim());
    if (key === 'ts' && value) ts = value;
    if (key === 'v1' && value) v1 = value;
  }
  return ts !== '' && v1 !== '' ? { ts, v1 } : null;
}

/** True when `x-signature` is the HMAC-SHA256 of Mercado Pago's documented manifest. */
function signatureMatches(
  secret: string,
  dataId: string,
  requestId: string | undefined,
  signature: { ts: string; v1: string }
): boolean {
  // A part whose value is absent is left out of the manifest, per the docs.
  const manifest =
    `id:${dataId.toLowerCase()};` +
    (requestId ? `request-id:${requestId};` : '') +
    `ts:${signature.ts};`;
  const expected = createHmac('sha256', secret).update(manifest).digest();
  const received = Buffer.from(signature.v1, 'hex');
  return received.length === expected.length && timingSafeEqual(received, expected);
}

/**
 * POST /api/mercadopago/webhook — Mercado Pago's `order` notifications.
 *
 * Called by Mercado Pago, so there is no staff JWT; the HMAC signature (secret from
 * the MP panel) is the only gate. A verified notification records the order's final
 * status so the till's next status check can answer without waiting on the
 * upstream, and so the sale (`external_reference`) shows up in the server log.
 * Always answers fast (MP retries after 22s) and with generic errors.
 */
export function receivePointWebhook(request: ApiRequest, deps: ApiDeps): ApiResponse {
  const secret = deps.mpWebhookSecret;
  if (!secret) {
    return { status: 503, body: { error: 'Webhook is not configured on this server.' } };
  }

  const dataId = new URLSearchParams(request.query ?? '').get('data.id') ?? '';
  const signature = parseSignature(request.mpSignature);
  if (
    !ORDER_ID_PATTERN.test(dataId) ||
    signature === null ||
    !signatureMatches(secret, dataId, request.mpRequestId, signature)
  ) {
    return { status: 401, body: { error: 'Invalid signature.' } };
  }

  const data = asRecord(asRecord(request.body)?.['data']);
  const summary = data === null ? null : summarize(data);
  if (
    summary === null ||
    typeof summary['id'] !== 'string' ||
    summary['id'].toLowerCase() !== dataId.toLowerCase() ||
    !WEBHOOK_STATUSES.has(String(summary['status']))
  ) {
    // Verified but not an order status we act on (or a mismatched body): accept
    // it so Mercado Pago stops retrying.
    return { status: 200, body: { received: true } };
  }

  const cache = deps.mpPointOrderCache;
  if (cache) {
    const key = summary['id'];
    // A refund is the last word on an order; a replayed older message must not undo it.
    if (cache.get(key)?.['status'] !== 'refunded') {
      cache.delete(key);
      cache.set(key, summary);
      if (cache.size > ORDER_CACHE_LIMIT) {
        const oldest = cache.keys().next().value;
        if (oldest !== undefined) cache.delete(oldest);
      }
    }
  }
  console.log(
    '[pos-api] MercadoPago Point webhook',
    JSON.stringify({
      orderId: summary['id'],
      status: summary['status'],
      externalReference: summary['externalReference'],
    })
  );
  return { status: 200, body: { received: true } };
}

function notConfigured(deps: ApiDeps): ApiResponse | null {
  if (!deps.mpAccessToken || !deps.mpPointTerminalIds || deps.mpPointTerminalIds.length === 0) {
    return { status: 503, body: { error: 'Mercado Pago Point is not configured on this server.' } };
  }
  return null;
}

/** POST /api/mercadopago/point/orders */
export async function createPointOrder(body: unknown, deps: ApiDeps): Promise<ApiResponse> {
  const unconfigured = notConfigured(deps);
  if (unconfigured) return unconfigured;

  const input = asRecord(body);
  if (input === null) {
    return { status: 400, body: { error: 'Request body must be a JSON object.' } };
  }

  const amount = input['amount'];
  if (
    typeof amount !== 'number' ||
    !Number.isFinite(amount) ||
    amount <= 0 ||
    amount > MAX_AMOUNT
  ) {
    return { status: 400, body: { error: 'A positive amount is required.' } };
  }
  if (amount < MIN_AMOUNT) {
    return {
      status: 400,
      body: { error: `The minimum card machine charge is ${formatAmount(MIN_AMOUNT)}.` },
    };
  }

  const externalReference = input['externalReference'];
  if (
    typeof externalReference !== 'string' ||
    !EXTERNAL_REFERENCE_PATTERN.test(externalReference)
  ) {
    return { status: 400, body: { error: 'A valid externalReference is required.' } };
  }

  const terminalId = input['terminalId'];
  if (typeof terminalId !== 'string' || !deps.mpPointTerminalIds?.includes(terminalId)) {
    return { status: 400, body: { error: 'Unknown card machine.' } };
  }

  const upstream = await callMercadoPago(
    deps,
    'POST',
    MP_ORDERS_URL,
    // Derived from the sale, not random: a retry after a network timeout reuses
    // the key, so Mercado Pago returns the same order instead of charging twice.
    { 'X-Idempotency-Key': `point-create-${externalReference}` },
    {
      type: 'point',
      external_reference: externalReference,
      expiration_time: POINT_ORDER_TTL,
      description: 'Capy POS sale',
      transactions: { payments: [{ amount: formatAmount(amount) }] },
      config: { point: { terminal_id: terminalId } },
    }
  );

  if (upstream === null) {
    return { status: 502, body: { error: 'Could not reach Mercado Pago.' } };
  }
  if (!upstream.ok) {
    // Stringified: console's default depth prints nested `details` as `[Array]`,
    // which hides the one field that says which property Mercado Pago rejected.
    console.error(
      `[pos-api] MercadoPago Point create failed ${upstream.status}`,
      JSON.stringify(upstream.body)
    );
    if (upstream.status === 409) {
      return { status: 409, body: { error: 'The card machine is busy with another charge.' } };
    }
    return { status: 502, body: { error: 'Mercado Pago could not start the charge.' } };
  }

  return { status: 201, body: summarize(upstream.body) };
}

/** GET /api/mercadopago/point/orders/:id */
export async function getPointOrder(orderId: string, deps: ApiDeps): Promise<ApiResponse> {
  const unconfigured = notConfigured(deps);
  if (unconfigured) return unconfigured;

  if (!ORDER_ID_PATTERN.test(orderId)) {
    return { status: 400, body: { error: 'Invalid order id.' } };
  }

  // A signed webhook already told us this order's final status.
  const confirmed = deps.mpPointOrderCache?.get(orderId);
  if (confirmed !== undefined) return { status: 200, body: confirmed };

  const upstream = await callMercadoPago(
    deps,
    'GET',
    `${MP_ORDERS_URL}/${encodeURIComponent(orderId)}`,
    {}
  );
  if (upstream === null) {
    return { status: 502, body: { error: 'Could not reach Mercado Pago.' } };
  }
  if (!upstream.ok) {
    console.error(
      `[pos-api] MercadoPago Point status failed ${upstream.status}`,
      JSON.stringify(upstream.body)
    );
    return { status: 502, body: { error: 'Mercado Pago status check failed.' } };
  }

  return { status: 200, body: summarize(upstream.body) };
}

/**
 * POST /api/mercadopago/point/orders/:id/cancel
 *
 * A `created` order cancels at once (upstream 200). One already `at_terminal` is
 * only *requested* to cancel (upstream 202): the customer may still pay, so the
 * answer carries `pending: true` and the till keeps polling for the final status.
 */
export async function cancelPointOrder(orderId: string, deps: ApiDeps): Promise<ApiResponse> {
  const unconfigured = notConfigured(deps);
  if (unconfigured) return unconfigured;

  if (!ORDER_ID_PATTERN.test(orderId)) {
    return { status: 400, body: { error: 'Invalid order id.' } };
  }

  const upstream = await callMercadoPago(
    deps,
    'POST',
    `${MP_ORDERS_URL}/${encodeURIComponent(orderId)}/cancel`,
    {
      'X-Idempotency-Key': `point-cancel-${orderId}`,
      'x-allow-cancelable-status': 'at_terminal',
    }
  );
  if (upstream === null) {
    return { status: 502, body: { error: 'Could not reach Mercado Pago.' } };
  }
  if (!upstream.ok) {
    console.error(
      `[pos-api] MercadoPago Point cancel failed ${upstream.status}`,
      JSON.stringify(upstream.body)
    );
    return { status: 502, body: { error: 'Mercado Pago could not cancel the charge.' } };
  }

  return { status: 200, body: { ...summarize(upstream.body), pending: upstream.status === 202 } };
}
