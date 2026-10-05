import { createHash } from 'node:crypto';
import type { DocumentStore, StoredDocument } from '../../shared/src/document-store.ts';
import type { ProductDocument } from './api.ts';

/**
 * Idempotent ingestion of a till's `SaleCompleted` event (#357, Epic #349 Phase B).
 *
 * `POST /api/products/{id}/sell` admits it cannot be made safe: its stock write and
 * its transaction record are two documents, and a retry after a lost response sells
 * twice. This is the "idempotent outbox" that route's comment asks for. Every step
 * is either guarded by a marker or replay-safe, so a client can resend an event as
 * often as it likes and stock moves exactly once.
 *
 * 1. Validate the event and bind it to the token's tenant.
 * 2. Claim `sale-event:<eventId>` with a fingerprint of the payload. A different
 *    fingerprint under the same id is a `conflict`; an `applied` claim is a
 *    `duplicate`; a `received` claim is an earlier run that died, and is resumed.
 * 3. Per product: re-read it and compare-and-swap `stock -= qty` together with an
 *    `eventMarkers[eventId]` entry. A product already carrying the marker is skipped,
 *    which is what makes a crash between products converge on replay.
 * 4. Compare-and-swap the claim to `applied`.
 *
 * Overselling (decision on #357, revised 2026-10-05): the sale already happened at
 * the till, so it is always applied. Stock floors at 0 rather than going negative,
 * because the checkout reservation code treats negative stock as corrupt; the units
 * sold beyond stock accumulate in `oversoldQuantity` and set `oversold`, until a
 * staff restock clears both.
 *
 * Markers grow with every sale a product appears in and are never pruned here
 * (Epic #349, open question 9).
 */

export const SALE_EVENT_TYPE = 'sale.completed';
/** Attempts per product, and for the final claim update, before answering `retry`. */
export const SALE_EVENT_CAS_ATTEMPTS = 5;
const MAX_LINES = 200;

export interface SaleEventLine {
  readonly productId: string;
  readonly quantity: number;
  readonly unitPrice: number;
}

/** The wire shape the till's outbox sends (#359). */
export interface SaleEventInput {
  readonly eventId: string;
  readonly type: string;
  /** Optional; when present it must match the token's tenant. */
  readonly tenantId?: string;
  readonly correlationId?: string;
  readonly payload: {
    readonly transactionId: string;
    readonly items: readonly SaleEventLine[];
    readonly amount: number;
    readonly method: string;
    readonly customerId?: string;
    readonly occurredAt: string;
  };
}

export interface SaleEventClaims {
  readonly tenantId: string;
  readonly operatorId: string;
}

/** One applied sale on a product: the idempotency marker for that event. */
export interface SaleEventMarker {
  readonly quantity: number;
  readonly appliedAt: string;
}
export type SaleEventMarkers = Readonly<Record<string, SaleEventMarker>>;

/** The claim and record of one ingested event. */
export interface SaleEventDocument extends StoredDocument {
  readonly kind: 'sale-event';
  readonly eventId: string;
  readonly status: 'received' | 'applied';
  readonly fingerprint: string;
  readonly tenantId: string;
  readonly operatorId: string;
  readonly transactionId: string;
  readonly lines: readonly { readonly productId: string; readonly quantity: number }[];
  readonly correlationId?: string;
  readonly occurredAt: string;
  readonly receivedAt: string;
  readonly appliedAt?: string;
}

export type SaleEventResult =
  | {
      readonly eventId: string;
      readonly status: 'applied';
      /** Products this sale took past their stock. */
      readonly oversold: readonly string[];
      /** Products that no longer exist; their lines could not be applied. */
      readonly missing: readonly string[];
    }
  | { readonly eventId: string; readonly status: 'duplicate' }
  | {
      readonly eventId: string;
      readonly status: 'conflict' | 'rejected' | 'retry';
      readonly error: string;
    };

export interface SaleEventDeps {
  readonly products: DocumentStore<ProductDocument>;
  readonly saleEvents: DocumentStore<SaleEventDocument>;
  readonly nowIso: () => string;
}

export function saleEventId(eventId: string): string {
  return `sale-event:${eventId}`;
}

export async function applySaleEvent(
  input: SaleEventInput,
  claims: SaleEventClaims,
  deps: SaleEventDeps
): Promise<SaleEventResult> {
  const eventId = typeof input?.eventId === 'string' ? input.eventId : '';
  const validated = validate(input, claims);
  if ('error' in validated) return { eventId, status: 'rejected', error: validated.error };
  const { lines, fingerprint } = validated;

  const claim = await claimEvent(input, claims, lines, fingerprint, deps);
  if (claim !== 'proceed') return { eventId, ...claim };

  const oversold: string[] = [];
  const missing: string[] = [];
  for (const line of lines) {
    const outcome = await applyLine(eventId, line, deps);
    if (outcome === 'retry') {
      return { eventId, status: 'retry', error: `Product ${line.productId} is busy; resend.` };
    }
    if (outcome === 'missing') missing.push(line.productId);
    if (outcome === 'oversold') oversold.push(line.productId);
  }

  if (!(await markApplied(eventId, deps))) {
    return { eventId, status: 'retry', error: 'The event record is busy; resend.' };
  }
  return { eventId, status: 'applied', oversold, missing };
}

// ─── Steps ────────────────────────────────────────────────────────────────────

type ValidatedEvent = {
  readonly lines: readonly { readonly productId: string; readonly quantity: number }[];
  readonly fingerprint: string;
};

function validate(
  input: SaleEventInput,
  claims: SaleEventClaims
): ValidatedEvent | { error: string } {
  if (!isNonEmptyString(input?.eventId) || input.eventId.length > 200) {
    return { error: 'eventId must be a non-empty string.' };
  }
  if (input.type !== SALE_EVENT_TYPE) return { error: `type must be ${SALE_EVENT_TYPE}.` };
  if (input.tenantId !== undefined && input.tenantId !== claims.tenantId) {
    return { error: 'The event belongs to another tenant.' };
  }
  const payload = input.payload;
  if (typeof payload !== 'object' || payload === null) return { error: 'payload is required.' };
  if (!isNonEmptyString(payload.transactionId)) return { error: 'transactionId is required.' };
  if (!isNonEmptyString(payload.occurredAt)) return { error: 'occurredAt is required.' };
  if (!Array.isArray(payload.items) || payload.items.length === 0) {
    return { error: 'items must be a non-empty array.' };
  }
  if (payload.items.length > MAX_LINES) return { error: `At most ${MAX_LINES} items.` };

  // Lines for the same product are merged: one marker per product per event, so a
  // second line for it must not be mistaken for an already-applied one.
  const quantities = new Map<string, number>();
  for (const item of payload.items) {
    if (!isNonEmptyString(item?.productId)) return { error: 'Every item needs a productId.' };
    if (!Number.isSafeInteger(item.quantity) || item.quantity < 1) {
      return { error: 'Every item quantity must be a positive integer.' };
    }
    quantities.set(item.productId, (quantities.get(item.productId) ?? 0) + item.quantity);
  }
  const lines = [...quantities.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([productId, quantity]) => ({ productId, quantity }));

  return { lines, fingerprint: fingerprintOf(claims.tenantId, payload.transactionId, lines) };
}

/**
 * The payload as the ledger sees it. Item order and how a product's quantity was
 * split across lines do not change what the sale did, so neither changes this.
 */
function fingerprintOf(
  tenantId: string,
  transactionId: string,
  lines: readonly { productId: string; quantity: number }[]
): string {
  return createHash('sha256')
    .update(JSON.stringify({ tenantId, transactionId, lines }))
    .digest('base64url');
}

async function claimEvent(
  input: SaleEventInput,
  claims: SaleEventClaims,
  lines: ValidatedEvent['lines'],
  fingerprint: string,
  deps: SaleEventDeps
): Promise<'proceed' | { status: 'duplicate' } | { status: 'conflict'; error: string }> {
  const record: SaleEventDocument = {
    id: saleEventId(input.eventId),
    kind: 'sale-event',
    eventId: input.eventId,
    status: 'received',
    fingerprint,
    tenantId: claims.tenantId,
    operatorId: claims.operatorId,
    transactionId: input.payload.transactionId,
    lines,
    ...(isNonEmptyString(input.correlationId) ? { correlationId: input.correlationId } : {}),
    occurredAt: input.payload.occurredAt,
    receivedAt: deps.nowIso(),
  };
  if ((await deps.saleEvents.create(record)) === 'created') return 'proceed';

  const existing = await deps.saleEvents.read(record.id);
  // Created and removed between our two calls: nothing sensible to compare against.
  if (existing === null) {
    return { status: 'conflict', error: 'The event record changed while reading it; resend.' };
  }
  if (existing.document.fingerprint !== fingerprint) {
    return { status: 'conflict', error: 'This eventId was already used for a different sale.' };
  }
  if (existing.document.status === 'applied') return { status: 'duplicate' };
  // `received`: an earlier attempt died part-way. The markers make resuming safe.
  return 'proceed';
}

async function applyLine(
  eventId: string,
  line: { productId: string; quantity: number },
  deps: SaleEventDeps
): Promise<'applied' | 'oversold' | 'already' | 'missing' | 'retry'> {
  for (let attempt = 0; attempt < SALE_EVENT_CAS_ATTEMPTS; attempt += 1) {
    const current = await deps.products.read(line.productId);
    if (current === null) return 'missing';
    const product = current.document;
    const markers = product.eventMarkers ?? {};
    if (markers[eventId] !== undefined) return 'already';

    const shortfall = Math.max(0, line.quantity - product.stock);
    const now = deps.nowIso();
    const next: ProductDocument = {
      ...product,
      stock: Math.max(0, product.stock - line.quantity),
      eventMarkers: { ...markers, [eventId]: { quantity: line.quantity, appliedAt: now } },
      ...(shortfall > 0
        ? { oversold: true, oversoldQuantity: (product.oversoldQuantity ?? 0) + shortfall }
        : {}),
      updatedAt: now,
    };
    if ((await deps.products.write(next, current.rev)) === 'written') {
      return shortfall > 0 ? 'oversold' : 'applied';
    }
  }
  return 'retry';
}

async function markApplied(eventId: string, deps: SaleEventDeps): Promise<boolean> {
  for (let attempt = 0; attempt < SALE_EVENT_CAS_ATTEMPTS; attempt += 1) {
    const current = await deps.saleEvents.read(saleEventId(eventId));
    if (current === null) return false;
    if (current.document.status === 'applied') return true;
    const applied: SaleEventDocument = {
      ...current.document,
      status: 'applied',
      appliedAt: deps.nowIso(),
    };
    if ((await deps.saleEvents.write(applied, current.rev)) === 'written') return true;
  }
  return false;
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0;
}
