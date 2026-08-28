/**
 * The bound `/vision/identify` gets for free, earned by hand.
 *
 * The vision proxy is safe almost by accident: its input is one image plus one
 * catalog, and `RECOGNITION_SCHEMA` constrains its output, so there is nothing a
 * caller can shape. This relay has no such natural bound. The port's contract
 * requires the *browser* to hold and resend a growing transcript of prior
 * assistant blocks and tool results across hops, so if this file simply forwarded
 * what arrived, the service would be a general-purpose Claude proxy behind the
 * shop's key: any caller could burn the org's tokens on arbitrary prompts, or
 * fabricate assistant turns and `tool_result`s to steer the model around a system
 * prompt it never sees.
 *
 * Three bounds, in the order they matter:
 *
 * 1. **Shape.** No `messages`, no `system`, no `tools`, no model name is read off
 *    the body at all — `RelayRequest` has no field for any of them. What the
 *    client sends is an utterance, a catalog, its own live till state, and the
 *    transcript.
 * 2. **Size.** Named caps below, in the style of `MAX_IMAGE_BYTES` /
 *    `MAX_CATALOG_ENTRIES`. `MAX_TRANSCRIPT_HOPS` is deliberately *not* the
 *    client's `MAX_HOPS`: that budget is enforced in the browser, and a
 *    browser-side budget is not a security boundary.
 * 3. **Self-consistency.** Every tool result the client sends back must answer a
 *    `tool_use` in the assistant block immediately preceding it in the same
 *    payload, and the answers must cover those calls exactly. That is checkable
 *    with no session store and no server-side transcript, which is what keeps the
 *    relay stateless per hop while still refusing a forged turn.
 *
 * Nothing here trusts the client to have sanitized anything, because the client
 * is the thing being bounded.
 */
import { CLERK_AGENT_TOOL_NAMES, MAX_CATALOG_FIELD_CHARS } from './agent-contract.ts';
import type {
  AgentBlock,
  AgentExchange,
  AgentMemory,
  AgentToolResult,
  AgentTurnContext,
  CatalogHint,
  RelayRequest,
} from './agent-contract.ts';

/**
 * Server-side hop ceiling, independent of the client's `MAX_HOPS` (3).
 *
 * One above it, so ordinary drift in the browser's budget cannot start rejecting
 * legitimate hops, and low enough that a caller ignoring its budget entirely
 * cannot walk a transcript up indefinitely. `transcript.length` is the hop index,
 * so a client at `MAX_HOPS = 3` never sends more than 2.
 */
export const MAX_TRANSCRIPT_HOPS = 4;

/** A spoken phrase. Web Speech does not produce more than this in one final result. */
export const MAX_UTTERANCE_CHARS = 500;

/** A shop with more than this many active products needs a retrieval step first. */
export const MAX_CATALOG_ENTRIES = 400;

/** The browser keeps six turns; this is slack, not a target. */
export const MAX_MEMORY_TURNS = 12;

/** Assistant blocks in one hop: text, thinking, and a handful of tool calls. */
export const MAX_ASSISTANT_BLOCKS = 24;

/** Tool calls the model may make in one hop, and therefore results per hop. */
export const MAX_TOOL_RESULTS = 12;

/** Whole-transcript byte ceiling, so many small blocks cost no less than a few large ones. */
export const MAX_TRANSCRIPT_CHARS = 200_000;

/**
 * The largest request body the HTTP boundary accepts, in bytes.
 *
 * Here, derived from `MAX_TRANSCRIPT_CHARS`, rather than written as its own number in
 * `server.ts`: a transport cap at or below the transcript cap would 413 transcripts
 * this module considers legal, and that failure looks like a network fault rather
 * than the configuration mistake it is. Co-located so the relationship is impossible
 * to break by editing one file, and asserted in `validate.test.mjs` so the slack is a
 * decision rather than an accident. The slack covers the catalog, the cart and the
 * JSON envelope.
 */
export const MAX_BODY_BYTES = MAX_TRANSCRIPT_CHARS + 64 * 1024;

/** One tool result's summarized output. Tool results are counted facts, not records. */
export const MAX_TOOL_OUTPUT_CHARS = 4_000;

/** Cart lines and on-screen choices the client may describe. */
export const MAX_CART_LINES = 200;
export const MAX_OFFER_LINES = 8;

const TOOL_NAMES = new Set<string>(CLERK_AGENT_TOOL_NAMES);

/** A validation refusal. Bounded prose, never a model error and never a stack. */
export interface RelayRejection {
  error: string;
}

/**
 * Whether the caller presented a bearer token. **Presence only — this verifies
 * nothing.** `Authorization: Bearer x` satisfies it.
 *
 * Used only by `lambda.ts`, the dormant AWS path. It used to be described as "the
 * belt to the gateway authorizer's braces"; epic #195 established there was no
 * authorizer, which left this as the entire check on a tool-capable model.
 *
 * The deployed path does not rely on it: `server.ts` calls `authorize` in
 * `session-guard.ts`, which verifies the signature, the expiry and the
 * `sale:process` permission. Prefer that for any new entry point.
 */
export function hasBearerToken(headers: Record<string, string | undefined>): boolean {
  for (const [name, value] of Object.entries(headers)) {
    if (name.toLowerCase() !== 'authorization') {
      continue;
    }
    return typeof value === 'string' && /^Bearer\s+\S/i.test(value);
  }
  return false;
}

/**
 * Strip anything that could break out of the row, line or fence it is rendered in,
 * then cap it.
 *
 * Control characters, newlines and tabs all go — a product name containing a
 * newline can otherwise start a line of its own inside the fenced catalog block,
 * which is the cheapest prompt injection there is. Applied to catalog fields, the
 * utterance and remembered phrases alike: all three are free text that reaches the
 * model, and only the catalog's is cached.
 */
export function sanitizeText(value: string, maxChars: number): string {
  return value
    .replace(/[\u0000-\u001f\u007f-\u009f]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, maxChars);
}

/**
 * Sanitize the catalog into the shape `formatCatalog` renders.
 *
 * Entries without a usable id and name are dropped rather than repaired: an
 * unnamed product cannot be spoken, looked up or added, so carrying it into the
 * prompt only costs tokens. The id survives validation because the browser needs
 * it in the request it already has — it is `formatCatalog` that refuses to render
 * it.
 */
export function sanitizeCatalog(raw: unknown[]): CatalogHint[] {
  const hints: CatalogHint[] = [];
  for (const entry of raw.slice(0, MAX_CATALOG_ENTRIES)) {
    if (typeof entry !== 'object' || entry === null) {
      continue;
    }
    const record = entry as Record<string, unknown>;
    const id = asString(record['id']);
    const name = sanitizeText(asString(record['name']), MAX_CATALOG_FIELD_CHARS);
    if (id.length === 0 || name.length === 0) {
      continue;
    }
    const emoji = sanitizeText(asString(record['emoji']), MAX_CATALOG_FIELD_CHARS);
    hints.push({
      id: id.slice(0, MAX_CATALOG_FIELD_CHARS),
      name,
      sku: sanitizeText(asString(record['sku']), MAX_CATALOG_FIELD_CHARS),
      category: sanitizeText(asString(record['category']), MAX_CATALOG_FIELD_CHARS),
      ...(emoji.length > 0 ? { emoji } : {}),
    });
  }
  return hints;
}

/** Validate the client payload before spending anything on it. */
export function validate(body: unknown): RelayRequest | RelayRejection {
  if (typeof body !== 'object' || body === null) {
    return { error: 'Body must be a JSON object.' };
  }
  const record = body as Record<string, unknown>;

  const utterance = sanitizeText(asString(record['utterance']), MAX_UTTERANCE_CHARS);
  if (utterance.length === 0) {
    return { error: 'utterance must be a non-empty string.' };
  }
  const rawCatalog = record['catalog'];
  if (!Array.isArray(rawCatalog)) {
    return { error: 'catalog must be an array.' };
  }
  const catalog = sanitizeCatalog(rawCatalog);
  if (catalog.length === 0) {
    return { error: 'catalog must contain at least one named product.' };
  }

  const context = validateContext(record['context']);
  if ('error' in context) {
    return context;
  }
  const memory = validateMemory(record['memory']);
  if ('error' in memory) {
    return memory;
  }
  const transcript = validateTranscript(record['transcript']);
  if ('error' in transcript) {
    return transcript;
  }

  return { utterance, catalog, context, memory, transcript };
}

function validateContext(raw: unknown): AgentTurnContext | RelayRejection {
  if (typeof raw !== 'object' || raw === null) {
    return { error: 'context must be an object.' };
  }
  const record = raw as Record<string, unknown>;
  const cartLines = record['cartLines'];
  const offer = record['offer'];
  if (!Array.isArray(cartLines) || cartLines.length > MAX_CART_LINES) {
    return { error: 'context.cartLines must be an array within the line cap.' };
  }
  if (!Array.isArray(offer) || offer.length > MAX_OFFER_LINES) {
    return { error: 'context.offer must be an array within the offer cap.' };
  }

  return {
    cartLines: cartLines.flatMap((line) => {
      const name = sanitizeText(readField(line, 'name'), MAX_CATALOG_FIELD_CHARS);
      return name.length > 0 ? [{ name, quantity: asCount(readValue(line, 'quantity')) }] : [];
    }),
    totalItems: asCount(record['totalItems']),
    total: asMoney(record['total']),
    offer: offer.flatMap((line) => {
      const label = sanitizeText(readField(line, 'label'), MAX_CATALOG_FIELD_CHARS);
      return label.length > 0 ? [{ position: asCount(readValue(line, 'position')), label }] : [];
    }),
    cartChangedThisTurn: record['cartChangedThisTurn'] === true,
  };
}

function validateMemory(raw: unknown): AgentMemory[] | RelayRejection {
  if (raw === undefined) {
    return [];
  }
  if (!Array.isArray(raw)) {
    return { error: 'memory must be an array.' };
  }
  if (raw.length > MAX_MEMORY_TURNS) {
    return { error: `memory may carry at most ${MAX_MEMORY_TURNS} turns.` };
  }
  return raw.flatMap((entry) => {
    const phrase = sanitizeText(readField(entry, 'phrase'), MAX_UTTERANCE_CHARS);
    if (phrase.length === 0) {
      return [];
    }
    // Tool *names* only, and only names we recognise: a remembered turn is an
    // audit line, and a logged catalog is not one. `productIds` is dropped
    // outright — the model is never shown an id, so a remembered one is dead
    // weight the browser is welcome to keep and this relay will not render.
    const tools = readValue(entry, 'tools');
    return [
      {
        phrase,
        tools: Array.isArray(tools)
          ? tools.filter((name): name is string => typeof name === 'string' && TOOL_NAMES.has(name))
          : [],
        productIds: [],
      },
    ];
  });
}

/**
 * The load-bearing check.
 *
 * Per hop: the assistant blocks are objects, every `tool_use` among them names a
 * real tool, and the results answer exactly those calls — no result whose id the
 * relay never issued on this exchange, no duplicate answers, and no call left
 * unanswered. The last of those three is not only a forgery bound: the Messages
 * API rejects a turn with an unanswered `tool_use`, and catching it here makes it
 * a bounded 400 rather than a 502 with a model error behind it.
 */
function validateTranscript(raw: unknown): AgentExchange[] | RelayRejection {
  if (raw === undefined) {
    return [];
  }
  if (!Array.isArray(raw)) {
    return { error: 'transcript must be an array.' };
  }
  if (raw.length > MAX_TRANSCRIPT_HOPS) {
    return { error: `transcript may carry at most ${MAX_TRANSCRIPT_HOPS} hops.` };
  }
  if (JSON.stringify(raw).length > MAX_TRANSCRIPT_CHARS) {
    return { error: 'transcript is too large.' };
  }

  const exchanges: AgentExchange[] = [];
  for (const entry of raw) {
    const exchange = validateExchange(entry);
    if ('error' in exchange) {
      return exchange;
    }
    exchanges.push(exchange);
  }
  return exchanges;
}

function validateExchange(raw: unknown): AgentExchange | RelayRejection {
  if (typeof raw !== 'object' || raw === null) {
    return { error: 'Each transcript hop must be an object.' };
  }
  const record = raw as Record<string, unknown>;
  const assistant = record['assistant'];
  const results = record['results'];

  if (
    !Array.isArray(assistant) ||
    assistant.length === 0 ||
    assistant.length > MAX_ASSISTANT_BLOCKS
  ) {
    return { error: 'Each hop needs a non-empty assistant block list within the block cap.' };
  }
  if (!Array.isArray(results) || results.length > MAX_TOOL_RESULTS) {
    return { error: 'Each hop needs a results array within the result cap.' };
  }

  const issued = issuedCallIds(assistant);
  if ('error' in issued) {
    return issued;
  }
  const answers = checkedResults(results, issued.ids);
  if ('error' in answers) {
    return answers;
  }
  if (answers.results.length !== issued.ids.size) {
    return { error: 'Every tool call in a hop must be answered exactly once.' };
  }

  return { assistant: assistant as AgentBlock[], results: answers.results };
}

/** The `tool_use` ids this relay could plausibly have issued in one hop. */
function issuedCallIds(assistant: unknown[]): { ids: Set<string> } | RelayRejection {
  const ids = new Set<string>();
  for (const block of assistant) {
    if (typeof block !== 'object' || block === null) {
      return { error: 'Assistant blocks must be objects.' };
    }
    const record = block as Record<string, unknown>;
    if (record['type'] !== 'tool_use') {
      continue;
    }
    const id = asString(record['id']);
    if (id.length === 0 || ids.has(id)) {
      return { error: 'Each tool call in a hop needs its own id.' };
    }
    if (!TOOL_NAMES.has(asString(record['name']))) {
      // A `tool_use` naming something outside the tuple was never issued by this
      // relay, whatever its id says.
      return { error: 'A replayed tool call names a tool this relay does not offer.' };
    }
    ids.add(id);
  }
  return { ids };
}

function checkedResults(
  results: unknown[],
  issued: Set<string>
): { results: AgentToolResult[] } | RelayRejection {
  const answered = new Set<string>();
  const checked: AgentToolResult[] = [];
  for (const result of results) {
    if (typeof result !== 'object' || result === null) {
      return { error: 'Tool results must be objects.' };
    }
    const record = result as Record<string, unknown>;
    const id = asString(record['id']);
    // The whole point: an id we did not issue in the immediately preceding
    // assistant block is a fabricated turn, and it is refused before a single
    // token is spent on it.
    if (!issued.has(id) || answered.has(id)) {
      return { error: 'A tool result does not answer a tool call from the hop before it.' };
    }
    const output = record['output'];
    if (typeof output !== 'object' || output === null) {
      return { error: 'Each tool result needs an output object.' };
    }
    if (JSON.stringify(output).length > MAX_TOOL_OUTPUT_CHARS) {
      return { error: 'A tool result is too large.' };
    }
    answered.add(id);
    checked.push({
      id,
      output: output as Record<string, unknown>,
      ...(record['isError'] === true ? { isError: true } : {}),
    });
  }
  return { results: checked };
}

function readValue(raw: unknown, key: string): unknown {
  return typeof raw === 'object' && raw !== null ? (raw as Record<string, unknown>)[key] : undefined;
}

function readField(raw: unknown, key: string): string {
  return asString(readValue(raw, key));
}

function asString(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

/** A non-negative whole number, or zero. Never NaN, never Infinity. */
function asCount(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? Math.floor(value) : 0;
}

/** A non-negative amount, rounded to cents. The till's number, restated safely. */
function asMoney(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0
    ? Math.round(value * 100) / 100
    : 0;
}
