import type { DocumentStore } from '../../shared/src/document-store.ts';
import type { ApiDeps, ApiRequest, ApiResponse, KioskTransactionDocument } from './api.ts';
import { authorize, Permission, readBearer, verifySessionToken } from './session-auth.ts';
import {
  applySaleEvent,
  type SaleEventDocument,
  type SaleEventInput,
  type SaleEventResult,
} from './sale-events.ts';

/** Most events one request may carry (#358). The client's outbox drains in pages of this. */
export const MAX_EVENTS_PER_BATCH = 50;

/** Token types issued to self-service devices rather than staff. */
const DEVICE_TOKEN_TYPES: ReadonlySet<string> = new Set(['kiosk-device', 'shop-session']);

/**
 * `POST /api/events`: a till's outbox drains its sale events here (#358, #359).
 *
 * Off unless `EVENTS_INGEST_ENABLED` is set: then the route answers 404, exactly as
 * if it did not exist.
 *
 * Who may publish (decision on #358):
 * - **Staff** need `PROCESS_SALE`, the same permission a sale already needs.
 * - **Kiosk-device and shop-session tokens** are accepted too, under a guardrail. A
 *   `/shop` session belongs to an anonymous phone, so an event from one is applied
 *   only when it matches a sale pos-api already recorded through
 *   `POST /api/transactions`: the same tenant, transaction id and line items.
 *   Anything else is `rejected`, so made-up sales cannot lower stock, and a device can
 *   only touch the products its recorded sale names.
 *
 * Events are applied one at a time, in order. Two in one batch often share a product,
 * and running them concurrently would only make them fight over its `_rev`. The
 * response is 200 with one result per event; a failure of one never fails the rest.
 */
export async function ingestEvents(request: ApiRequest, deps: ApiDeps): Promise<ApiResponse> {
  if (!deps.eventsIngestEnabled) return { status: 404, body: { error: 'Not found' } };

  const caller = await identifyCaller(request, deps);
  if ('status' in caller) return caller;

  const body = request.body;
  const events =
    typeof body === 'object' && body !== null && !Array.isArray(body)
      ? (body as Record<string, unknown>)['events']
      : undefined;
  if (!Array.isArray(events) || events.length === 0) {
    return { status: 400, body: { error: 'events must be a non-empty array.' } };
  }
  if (events.length > MAX_EVENTS_PER_BATCH) {
    return {
      status: 400,
      body: { error: `At most ${MAX_EVENTS_PER_BATCH} events per request.` },
    };
  }

  const saleEvents = deps.transactions as unknown as DocumentStore<SaleEventDocument>;
  const kioskSales = caller.device ? await recordedKioskSales(deps, caller.tenantId) : null;
  const results: SaleEventResult[] = [];
  for (const raw of events) {
    const event = raw as SaleEventInput;
    const eventId = typeof event?.eventId === 'string' ? event.eventId : '';
    if (kioskSales !== null && !matchesRecordedSale(event, kioskSales)) {
      results.push({
        eventId,
        status: 'rejected',
        error: 'No recorded sale matches this event.',
      });
      continue;
    }
    try {
      results.push(
        await applySaleEvent(
          event,
          { tenantId: caller.tenantId, operatorId: caller.operatorId },
          { products: deps.products, saleEvents, nowIso: deps.nowIso }
        )
      );
    } catch (error) {
      // A store failure on one event: the client resends it; the markers make that safe.
      console.error('[pos-api] sale event failed', { eventId, error });
      results.push({ eventId, status: 'retry', error: 'The event could not be applied; resend.' });
    }
  }
  return { status: 200, body: { results } };
}

type Caller = { device: boolean; tenantId: string; operatorId: string };

async function identifyCaller(request: ApiRequest, deps: ApiDeps): Promise<Caller | ApiResponse> {
  const token = readBearer(request.authorization);
  if (token === null) return { status: 401, body: { error: 'Authorization required.' } };

  const session = verifySessionToken(token, deps.secret, deps.nowSeconds());
  if (session?.type !== undefined && DEVICE_TOKEN_TYPES.has(session.type)) {
    return { device: true, tenantId: session.tenantId, operatorId: session.operatorId };
  }

  const outcome = await authorize(
    request.authorization,
    Permission.PROCESS_SALE,
    {
      secret: deps.secret,
      appId: deps.appId ? { ...deps.appId, rolesSource: deps.roles } : undefined,
    },
    deps.nowSeconds()
  );
  if (!outcome.ok) return { status: outcome.status, body: { error: outcome.error } };
  return {
    device: false,
    tenantId: outcome.claims.tenantId,
    operatorId: outcome.claims.operatorId,
  };
}

/** The tenant's recorded kiosk/shop sales, keyed by the till's own transaction id. */
async function recordedKioskSales(
  deps: ApiDeps,
  tenantId: string
): Promise<ReadonlyMap<string, KioskTransactionDocument>> {
  const byClientId = new Map<string, KioskTransactionDocument>();
  for (const document of await deps.transactions.list()) {
    const sale = document as unknown as KioskTransactionDocument;
    if (sale.type === 'kiosk-sale' && sale.tenantId === tenantId && sale.clientTransactionId) {
      byClientId.set(sale.clientTransactionId, sale);
    }
  }
  return byClientId;
}

/** The event names the recorded sale's transaction and exactly its products and quantities. */
function matchesRecordedSale(
  event: SaleEventInput,
  sales: ReadonlyMap<string, KioskTransactionDocument>
): boolean {
  const transactionId = event?.payload?.transactionId;
  if (typeof transactionId !== 'string') return false;
  const recorded = sales.get(transactionId);
  if (!recorded || !Array.isArray(event.payload.items)) return false;
  return sameQuantities(quantitiesOf(event.payload.items), quantitiesOf(recorded.items));
}

function quantitiesOf(
  items: readonly { readonly productId: unknown; readonly quantity: unknown }[]
): Map<string, number> {
  const totals = new Map<string, number>();
  for (const item of items) {
    const id = String(item?.productId ?? '');
    totals.set(id, (totals.get(id) ?? 0) + Number(item?.quantity ?? NaN));
  }
  return totals;
}

function sameQuantities(left: Map<string, number>, right: Map<string, number>): boolean {
  if (left.size !== right.size) return false;
  for (const [id, quantity] of left) {
    if (!(right.get(id) === quantity)) return false;
  }
  return true;
}
