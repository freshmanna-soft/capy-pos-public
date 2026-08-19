import Anthropic from '@anthropic-ai/sdk';
import {
  CatalogHint,
  IdentifyRequest,
  RECOGNITION_SCHEMA,
  RecognitionResult,
  SYSTEM_PROMPT,
  VisionCandidate,
  formatCatalog,
} from './recognition-contract.js';

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
/** A shop with more than this many active products needs a retrieval step first. */
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
  const catalog = request.catalog.slice(0, MAX_CATALOG_ENTRIES);
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

  return { image, mediaType, catalog: catalog as CatalogHint[] };
}
