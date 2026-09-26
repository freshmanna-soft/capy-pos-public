/**
 * IBM Cloud Object Storage implementation of `ImageStore`.
 *
 * Uses the S3-compatible COS HTTP API — a PUT to
 * `${endpoint}/${bucket}/${productId}` with an IAM bearer token.  The token
 * exchange is identical to `CloudantStore.bearerToken()`: fetch from the IBM IAM
 * endpoint, cache until 60 s before expiry.
 *
 * No SDK dependency: what this uses of COS is one HTTP call and one IAM token
 * exchange, both stable public API — the same reasoning that keeps `CloudantStore`
 * SDK-free applies here.
 */
import type { ImageStore } from '../../shared/src/image-store.ts';

export interface CosConfig {
  /** COS service endpoint, no trailing slash, e.g. `https://s3.us-south.cloud-object-storage.appdomain.cloud`. */
  readonly endpoint: string;
  readonly apiKey: string;
  readonly bucket: string;
  /** Base URL for public reads, no trailing slash, e.g. `https://s3.us-south.cloud-object-storage.appdomain.cloud/my-bucket`. */
  readonly publicUrlBase: string;
}

/**
 * Stores product images in an IBM COS bucket.
 *
 * The object key is `productId` — one image per product, no versioning.  A second
 * upload for the same product silently replaces the previous one, which is the
 * intended behaviour: the operator is updating the image, not appending to a
 * history.
 */
export class CosImageStore implements ImageStore {
  private token: { value: string; expiresAtMs: number } | null = null;

  // Explicit fields — Node strip-only mode refuses constructor parameter
  // properties (same constraint as CloudantStore; see its comment).
  private readonly config: CosConfig;
  private readonly fetchImpl: typeof fetch;
  private readonly nowMs: () => number;

  constructor(
    config: CosConfig,
    /** Injected so tests can drive every branch without a real COS instance. */
    fetchImpl: typeof fetch = fetch,
    nowMs: () => number = Date.now
  ) {
    this.config = config;
    this.fetchImpl = fetchImpl;
    this.nowMs = nowMs;
  }

  async upload(productId: string, mimeType: string, data: Uint8Array): Promise<string> {
    const token = await this.bearerToken();
    const url = `${this.config.endpoint}/${encodeURIComponent(this.config.bucket)}/${encodeURIComponent(productId)}`;
    const response = await this.fetchImpl(url, {
      method: 'PUT',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': mimeType,
        'Content-Length': String(data.length),
      },
      body: data,
    });
    if (!response.ok) {
      throw new Error(`COS upload failed with ${response.status}.`);
    }
    return `${this.config.publicUrlBase}/${encodeURIComponent(productId)}`;
  }

  /**
   * Exchange the IAM API key for a bearer token, cached until shortly before it
   * expires.  Identical implementation to `CloudantStore.bearerToken()`.
   */
  private async bearerToken(): Promise<string> {
    const current = this.token;
    if (current !== null && current.expiresAtMs > this.nowMs()) {
      return current.value;
    }

    const response = await this.fetchImpl('https://iam.cloud.ibm.com/identity/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
      body: new URLSearchParams({
        grant_type: 'urn:ibm:params:oauth:grant-type:apikey',
        apikey: this.config.apiKey,
      }).toString(),
    });
    if (!response.ok) {
      throw new Error(`IAM token exchange failed with ${response.status}.`);
    }
    const body = (await response.json()) as { access_token?: unknown; expires_in?: unknown };
    if (typeof body.access_token !== 'string') {
      throw new Error('IAM token exchange returned no access_token.');
    }
    const lifetimeSeconds = typeof body.expires_in === 'number' ? body.expires_in : 3600;
    this.token = {
      value: body.access_token,
      expiresAtMs: this.nowMs() + Math.max(0, lifetimeSeconds - 60) * 1000,
    };
    return body.access_token;
  }
}
