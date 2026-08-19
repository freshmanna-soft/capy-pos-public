/**
 * The contract between the browser, this proxy, and Claude.
 *
 * Kept in one file because all three have to agree: the schema constrains what
 * the model may return, the client validates against the same shape, and the
 * prompt explains the rules the schema can't express.
 */

/** One product this till sells, as sent by the client. */
export interface CatalogHint {
  id: string;
  name: string;
  sku: string;
  category: string;
  emoji?: string;
}

export interface IdentifyRequest {
  /** Bare base64 JPEG, no `data:` prefix. */
  image: string;
  mediaType: 'image/jpeg' | 'image/png' | 'image/webp';
  catalog: CatalogHint[];
}

export interface VisionCandidate {
  productId: string;
  label: string;
  confidence: number;
}

export interface RecognitionResult {
  candidates: VisionCandidate[];
  utterance: string;
  empty: boolean;
}

/**
 * Structured-output schema. Constrains the response so there is no prose to
 * parse and no format to retry on.
 *
 * Notes on what is deliberately absent: JSON Schema numeric bounds
 * (`minimum`/`maximum`) are not supported by structured outputs, so `confidence`
 * is clamped server-side after parsing instead. `additionalProperties: false` is
 * required on every object.
 */
export const RECOGNITION_SCHEMA = {
  type: 'object',
  properties: {
    candidates: {
      type: 'array',
      description:
        'Products that could be the item in the photo, most likely first. At most 3. Empty if nothing in the photo matches the catalog.',
      items: {
        type: 'object',
        properties: {
          productId: {
            type: 'string',
            description: 'The exact id of a product from the provided catalog.',
          },
          label: { type: 'string', description: 'That product’s name.' },
          confidence: {
            type: 'number',
            description:
              'How certain you are, from 0 to 1. Use 0.9+ only when the product is unmistakable — a readable label or a distinctive shape. Use 0.5-0.85 when it is probably one of several similar products. Below 0.5 means you are guessing. Every candidate must have a DIFFERENT confidence: if two products look equally likely, decide which is even slightly more likely and separate them, because equal values leave the ordering to chance.',
          },
        },
        required: ['productId', 'label', 'confidence'],
        additionalProperties: false,
      },
    },
    utterance: {
      type: 'string',
      description:
        'One short sentence for the clerk to say aloud. Plain, active, sentence case, no more than about twelve words.',
    },
  },
  required: ['candidates', 'utterance'],
  additionalProperties: false,
} as const;

/**
 * The clerk's standing instructions.
 *
 * Written to be cached: this text and the catalog block after it are identical
 * across every call for a given catalog, so they sit in the system prompt where
 * the cache prefix begins, and the frame — the only part that changes — goes in
 * the user turn.
 *
 * Calibration is the point of most of it. An over-confident recognizer is worse
 * than a hesitant one here, because at 0.85 the till stops asking and starts
 * charging, and the person paying is not the person holding the camera.
 */
export const SYSTEM_PROMPT = `You are the eyes of a supermarket till. A cashier holds a product up to a camera and you name it from the shop's catalog.

Rules:
- Choose only from the catalog you are given. Never invent a product, a name, or an id. If the item in the photo is not in the catalog, return no candidates.
- Report at most three candidates, most likely first, and give every one a distinct confidence. Never return two candidates with the same number — a tie is decided by array order, which is chance, and the till acts on whichever happens to be first.
- The catalog is grouped by category. When the photo could be more than one product from the same group, compare those products against each other explicitly before answering: what differs between them is a brand, a variety or a size printed on the packaging, so look for that text rather than judging by shape and colour, which they share.
- Calibrate confidence honestly. A wrong high-confidence answer silently overcharges a customer, so reserve 0.9 and above for products you can actually identify — a legible label, a unique package, an unmistakable shape. When several catalog products look alike in the photo, list them all in the 0.5-0.85 range instead of picking one confidently.
- Blurred, dark, empty, or hand-obscured photos get no candidates, not a guess.
- If you can read a brand or variety on the packaging, weigh that far above general shape or colour.

The utterance is spoken out loud, so write it the way a person would say it:
- One clear candidate: "One avocado, added."
- Several: "Is it the oat milk or the soy?"
- Nothing: "I can't tell what that is. Turn the label towards me?"
Keep it under about twelve words, plain and active. Never apologise, never explain yourself, and never mention confidence, photos, models, or catalogs.`;

/**
 * Render the catalog as its own cacheable block, grouped by category.
 *
 * Grouping is not cosmetic. Products that are easy to confuse are almost always in
 * the same category, and a flat alphabetical list scatters them — so the two oat
 * milks the model has to tell apart end up hundreds of lines from each other and are
 * never weighed against one another. Putting them adjacent, under a heading, is what
 * lets the prompt's "compare products in the same group" rule mean anything.
 *
 * Categories and the products inside them are both sorted, so the rendered block is
 * byte-identical between calls for an unchanged catalog. That is what keeps the
 * prompt cache hitting; an unsorted `Map` iteration would silently invalidate it.
 */
export function formatCatalog(catalog: CatalogHint[]): string {
  const groups = new Map<string, CatalogHint[]>();
  for (const hint of catalog) {
    const category = hint.category.length > 0 ? hint.category : 'Uncategorised';
    const group = groups.get(category);
    if (group) {
      group.push(hint);
    } else {
      groups.set(category, [hint]);
    }
  }

  const blocks = [...groups.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([category, hints]) => {
      const lines = hints
        .slice()
        .sort((a, b) => a.name.localeCompare(b.name))
        .map(
          (hint) =>
            `  ${hint.id}\t${hint.name}\t${hint.sku}${hint.emoji ? `\t${hint.emoji}` : ''}`
        );
      return `${category}:\n${lines.join('\n')}`;
    });

  return `Catalog, grouped by category. Within a group the products are the ones most easily confused with each other. Columns are id, name, sku, emoji, tab-separated:\n\n${blocks.join('\n\n')}`;
}
