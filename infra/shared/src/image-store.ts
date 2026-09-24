/**
 * The image-persistence port and its in-memory implementation.
 *
 * `CosImageStore` (in `infra/pos-api`) fulfils this interface in production by
 * writing to an IBM Cloud Object Storage bucket. `MemoryImageStore` fulfils it for
 * local development and CI — it encodes the bytes as a `data:` URI so callers that
 * render `<img src="...">` work without a network.
 *
 * The interface is intentionally narrow: `upload` is the only operation because
 * delete and list are not needed by the upload endpoint and adding them here would
 * imply every implementation must implement them — COS would have to, Firestore
 * would have to — for no caller.
 */

/** Store an image binary and return its public URL. */
export interface ImageStore {
  upload(productId: string, mimeType: string, data: Uint8Array): Promise<string>;
}

// ─── In-memory ────────────────────────────────────────────────────────────────

/**
 * The store `api.test.mjs` and local `npm start` use.
 *
 * Encodes the bytes as a base64 `data:` URI so callers that render the returned
 * URL in an `<img>` tag see the actual image without a network — identical
 * fail-safe pattern to `MemoryStore` in `document-store.ts`.
 */
export class MemoryImageStore implements ImageStore {
  private readonly images = new Map<string, string>();

  async upload(productId: string, mimeType: string, data: Uint8Array): Promise<string> {
    const base64 = Buffer.from(data).toString('base64');
    const url = `data:${mimeType};base64,${base64}`;
    this.images.set(productId, url);
    return url;
  }
}
