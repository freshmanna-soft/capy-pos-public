/**
 * Recognition DTOs — the wire shape between the POS and whatever is doing the
 * looking (a mock, a Claude vision proxy, an on-device model later).
 *
 * These live in the application layer because both the port and its adapters
 * depend on them, and neither should import from the other.
 */

/**
 * The slice of a product the recognizer needs in order to name it.
 *
 * Sending the catalog with every frame is what makes recognition usable in a
 * shop: the model chooses from products this till actually sells and hands back
 * an id the cart can use, instead of free-associating ("a green fruit").
 */
export interface CatalogHint {
  id: string;
  name: string;
  sku: string;
  category: string;
  emoji?: string;
}

/** One thing the recognizer thinks it might be looking at. */
export interface VisionCandidate {
  /** Must match a `CatalogHint.id` — the cart is keyed on it. */
  productId: string;
  /** Human-readable name, for display and for speech. */
  label: string;
  /** 0..1. Callers should treat anything outside that range as untrusted. */
  confidence: number;
}

/** What one look at one frame produced. */
export interface RecognitionResult {
  /** Highest confidence first. Empty when nothing was recognized. */
  candidates: VisionCandidate[];
  /** What the clerk should say out loud. Always safe to speak verbatim. */
  utterance: string;
  /** True when the frame held nothing identifiable — not an error. */
  empty: boolean;
}

/** A single request to identify one frame. */
export interface RecognitionRequest {
  /** Bare base64 — no `data:` prefix. */
  imageBase64: string;
  mediaType: 'image/jpeg';
  catalog: CatalogHint[];
}

/** An empty result, for the "nothing there" and "call failed" paths. */
export function emptyRecognition(utterance: string): RecognitionResult {
  return { candidates: [], utterance, empty: true };
}
