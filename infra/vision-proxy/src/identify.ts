import Anthropic from '@anthropic-ai/sdk';
// Types are imported with `import type` and values without, because Node runs
// this file by stripping the types rather than compiling it: a type name left in
// a value import survives the strip and then fails at runtime as a missing
// export. `verbatimModuleSyntax` in tsconfig.json makes that a compile error
// instead of a startup crash.
import type {
  CatalogHint,
  IdentifyRequest,
  RecognitionResult,
  VisionCandidate,
} from './recognition-contract.ts';
import {
  MAX_CATALOG_FIELD_CHARS,
  RECOGNITION_SCHEMA,
  SYSTEM_PROMPT,
  formatCatalog,
} from './recognition-contract.ts';

/**
 * Claude Opus 5. Do not downgrade this to save money without measuring first —
 * a cheaper model that misidentifies one item in twenty costs more in refunds
 * and lost trust than the entire recognition bill.
 *
 * The cost dials that are safe to turn, in order of effect: the client's capture
 * resolution (`CAPTURE_MAX_EDGE` in camera.service.ts, quadratic in tokens), the
 * frame gate's thresholds, and `effort` below.
 */
const MODEL = 'claude-opus-5';

/**
 * Low effort. The task is perception plus a short sentence, not reasoning, and
 * low effort keeps output tokens and latency down where a cashier is waiting.
 *
 * Thinking stays on (adaptive). It is not disabled because on this model
 * disabling it can leak `<thinking>` tags into the response — and low effort
 * already delivers the saving that disabling was meant to buy.
 */
const EFFORT = 'low';

/** The response is one small JSON object; this is generous. */
const MAX_TOKENS = 1024;

/** Guard against a pathological payload; 3 MB of base64 is a huge frame already. */
export const MAX_IMAGE_BYTES = 3_000_000;

/**
 * The largest request body the HTTP boundary accepts, in bytes.
 *
 * `server.ts` imports this and hands it to `createRequestListener`; it is the only
 * definition of the cap in the service. That matters because a transport cap at or
 * below the frame cap would 413 frames this module considers legal, and that failure
 * looks like a network fault rather than the configuration mistake it is. Derived
 * here, next to `MAX_IMAGE_BYTES`, so raising the frame cap carries the transport cap
 * with it.
 *
 * Two suites hold that up, because the first round of this story had the derivation
 * written twice — once here and once in `server.ts` — which is the drift the comment
 * claimed to prevent: `identify.test.mjs` serializes the largest frame `validate`
 * accepts — full catalog included — and asserts it fits under this number and is not
 * dwarfed by it, and `session-guard.test.mjs` asserts `server.ts` imports the cap
 * rather than computing a second one. The slack covers the catalog and the JSON
 * envelope.
 */
export const MAX_BODY_BYTES = MAX_IMAGE_BYTES + 512 * 1024;

/**
 * A shop with more than this many active products needs a retrieval step first.
 *
 * Applied in `sanitizeCatalog` and nowhere else. `identify` used to slice to it a
 * second time, which is the same two-definitions-of-one-cap shape review caught on
 * `MAX_BODY_BYTES`: the copy that is not the one callers reach is the copy that
 * drifts.
 */
export const MAX_CATALOG_ENTRIES = 400;

const client = new Anthropic();

/**
 * Identify the product in one frame.
 *
 * Prompt caching shapes this request. Render order is system then messages, and
 * the cache is a prefix match, so everything stable — the instructions and the
 * catalog — goes in `system` with a cache breakpoint, and the one thing that
 * changes every call, the image, goes in the user turn after it. Get that
 * ordering backwards and every request pays full price for the catalog.
 */
export async function identify(request: IdentifyRequest): Promise<RecognitionResult> {
  // No slicing and no sanitizing here: `validate` is the only way to build an
  // `IdentifyRequest`, and both entry points — `server.ts` via `http.ts`, and the
  // dormant `lambda.ts` — run it before reaching this line.
  const { catalog } = request;
  if (catalog.length === 0) {
    return { candidates: [], utterance: 'There is nothing in the catalog to match against.', empty: true };
  }

  const message = await client.messages.create({
    model: MODEL,
    max_tokens: MAX_TOKENS,
    thinking: { type: 'adaptive' },
    output_config: {
      effort: EFFORT,
      format: { type: 'json_schema', schema: RECOGNITION_SCHEMA },
    },
    system: [
      { type: 'text', text: SYSTEM_PROMPT },
      {
        type: 'text',
        text: formatCatalog(catalog),
        // Breakpoint after the catalog: subsequent calls with the same catalog
        // read this prefix at roughly a tenth of the input price.
        cache_control: { type: 'ephemeral' },
      },
    ],
    messages: [
      {
        role: 'user',
        content: [
          // Image before text: the model reads content in order, and the
          // question is about the picture.
          {
            type: 'image',
            source: { type: 'base64', media_type: request.mediaType, data: request.image },
          },
          { type: 'text', text: 'What product from the catalog is being held up?' },
        ],
      },
    ],
  });

  // Check the stop reason before touching content. A safety decline returns HTTP
  // 200 with an empty content array, so `content[0]` would throw on exactly the
  // frames least worth crashing over.
  if (message.stop_reason === 'refusal') {
    console.warn('[vision] request declined', message.stop_details?.category ?? 'unknown');
    return { candidates: [], utterance: "I can't look at that one.", empty: true };
  }

  logUsage(message.usage);
  return parse(message, catalog);
}

/**
 * Parse the structured response.
 *
 * The schema guarantees the shape but not the semantics: it cannot stop the model
 * naming a product id that isn't in the catalog, or returning a confidence of 4.
 * Both are checked here, because the next stop for this data is a cart.
 */
function parse(message: Anthropic.Message, catalog: CatalogHint[]): RecognitionResult {
  const text = message.content
    .filter((block): block is Anthropic.TextBlock => block.type === 'text')
    .map((block) => block.text)
    .join('');

  let parsed: { candidates?: unknown; utterance?: unknown };
  try {
    parsed = JSON.parse(text) as { candidates?: unknown; utterance?: unknown };
  } catch {
    console.error('[vision] response was not JSON despite the schema');
    return { candidates: [], utterance: 'Let me look again.', empty: true };
  }

  const byId = new Map(catalog.map((hint) => [hint.id, hint]));
  const raw = Array.isArray(parsed.candidates) ? parsed.candidates : [];

  const candidates: VisionCandidate[] = [];
  for (const entry of raw) {
    if (typeof entry !== 'object' || entry === null) {
      continue;
    }
    const record = entry as Record<string, unknown>;
    const productId = record['productId'];
    const confidence = record['confidence'];
    if (typeof productId !== 'string' || typeof confidence !== 'number') {
      continue;
    }
    const hint = byId.get(productId);
    if (!hint) {
      // A hallucinated id. Dropping it is the whole reason the catalog is sent.
      console.warn(`[vision] dropped unknown product id ${productId}`);
      continue;
    }
    candidates.push({
      productId,
      // Trust the catalog's name over the model's, so the spoken name and the
      // receipt always agree.
      label: hint.name,
      confidence: Math.min(1, Math.max(0, confidence)),
    });
  }

  candidates.sort((a, b) => b.confidence - a.confidence);
  const top = candidates.slice(0, 3);

  const utterance =
    typeof parsed.utterance === 'string' && parsed.utterance.trim().length > 0
      ? parsed.utterance.trim()
      : 'Let me look again.';

  return { candidates: top, utterance, empty: top.length === 0 };
}

/**
 * One line per call with the token split.
 *
 * Worth keeping: `cache_read_input_tokens` staying at zero across calls is the
 * only visible symptom of a broken cache prefix, and that quietly multiplies the
 * bill without changing any behaviour.
 */
function logUsage(usage: Anthropic.Usage): void {
  console.log(
    '[vision] usage',
    JSON.stringify({
      input: usage.input_tokens,
      cacheRead: usage.cache_read_input_tokens ?? 0,
      cacheWrite: usage.cache_creation_input_tokens ?? 0,
      output: usage.output_tokens,
    })
  );
}

/**
 * Strip anything that could break out of the row it is rendered in, then cap it.
 *
 * Control characters, newlines and tabs all go: `formatCatalog` renders the catalog
 * as tab-separated rows under category headings, so a product name containing a
 * newline can otherwise start a row of its own — and one containing a tab can start
 * a column of its own — inside a *cached* block. That is the cheapest prompt
 * injection there is, and the shop's own inventory form is where the text comes
 * from, so it is not trusted text just because it is not a stranger's.
 *
 * Byte-identical to `sanitizeText` in the relay's `validate.ts` on purpose, but not
 * shared: each service is a standalone container with its own `rootDir`, and the
 * drift check in `session-guard.test.mjs` only covers files that exist twice by
 * necessity. Two small copies are cheaper than adding a third to that list.
 */
export function sanitizeText(value: string, maxChars: number): string {
  return value
    .replace(/[\u0000-\u001f\u007f-\u009f]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, maxChars);
}

/**
 * Turn a caller's array into the `CatalogHint[]` `formatCatalog` renders.
 *
 * This is the function whose absence review caught. `validate` used to check
 * `Array.isArray(catalog)` and then cast the array through — `catalog as
 * CatalogHint[]` — so every per-entry guarantee in the type was a claim nobody
 * checked. A single entry missing `category` (`{ id: 'p-1', name: 'Beans' }`, the
 * shape a hand-written client sends) reached `hint.category.length` in
 * `formatCatalog` and threw a `TypeError`, which `http.ts` caught with the model
 * errors and reported as a 502 `unavailable`: a bad request, blamed on the service,
 * arriving as "she didn't catch it" at the till.
 *
 * Entries without a usable id and name are dropped rather than repaired, matching
 * `sanitizeCatalog` in the relay: a product with no name cannot be spoken and one
 * with no id cannot be added to a cart, so carrying it into the prompt only costs
 * tokens. Unlike the relay, an id here is also rendered and expected back — the
 * model returns one and `parse` looks it up — so it is capped to the same width as
 * everything else that is rendered, and an id longer than that is not an id.
 */
export function sanitizeCatalog(raw: unknown[]): CatalogHint[] {
  const hints: CatalogHint[] = [];
  for (const entry of raw.slice(0, MAX_CATALOG_ENTRIES)) {
    if (typeof entry !== 'object' || entry === null) {
      continue;
    }
    const record = entry as Record<string, unknown>;
    const id = sanitizeText(asString(record['id']), MAX_CATALOG_FIELD_CHARS);
    const name = sanitizeText(asString(record['name']), MAX_CATALOG_FIELD_CHARS);
    if (id.length === 0 || name.length === 0) {
      continue;
    }
    const emoji = sanitizeText(asString(record['emoji']), MAX_CATALOG_FIELD_CHARS);
    hints.push({
      id,
      name,
      sku: sanitizeText(asString(record['sku']), MAX_CATALOG_FIELD_CHARS),
      category: sanitizeText(asString(record['category']), MAX_CATALOG_FIELD_CHARS),
      ...(emoji.length > 0 ? { emoji } : {}),
    });
  }
  return hints;
}

/** Validate the client payload before spending anything on it. */
export function validate(body: unknown): IdentifyRequest | { error: string } {
  if (typeof body !== 'object' || body === null) {
    return { error: 'Body must be a JSON object.' };
  }
  const record = body as Record<string, unknown>;
  const image = record['image'];
  const mediaType = record['mediaType'];
  const catalog = record['catalog'];

  if (typeof image !== 'string' || image.length === 0) {
    return { error: 'image must be a base64 string.' };
  }
  if (image.length > MAX_IMAGE_BYTES) {
    return { error: 'image is too large.' };
  }
  if (mediaType !== 'image/jpeg' && mediaType !== 'image/png' && mediaType !== 'image/webp') {
    return { error: 'mediaType must be image/jpeg, image/png or image/webp.' };
  }
  if (!Array.isArray(catalog)) {
    return { error: 'catalog must be an array.' };
  }

  // No cast. Every field of every hint is now something this function produced.
  //
  // A catalog that sanitizes to nothing is not a rejection, which is where this
  // deliberately differs from the relay's 400: `identify` answers an empty catalog
  // with "there is nothing in the catalog to match against" and spends nothing, and
  // the till has one honest thing to say either way. The relay refuses instead
  // because its tools resolve spoken names *against* the catalog, so a hop with an
  // empty one has no work it could do.
  return { image, mediaType, catalog: sanitizeCatalog(catalog) };
}

function asString(value: unknown): string {
  return typeof value === 'string' ? value : '';
}
