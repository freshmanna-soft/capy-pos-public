/**
 * The persistence port, and the two things behind it.
 *
 * The story left the data store as an explicit open decision between Cloudant and
 * Databases for PostgreSQL. Cloudant is chosen: both AWS tables are id-keyed with
 * no secondary indexes and no query beyond get/scan
 * (`terraform/aws-demo/main.tf:114-134`), which is the shape Cloudant serves
 * directly, and it needs no schema migration story to stand up. Postgres would have
 * bought joins and transactions that nothing here asks for.
 *
 * ## Why a port at all, rather than calling Cloudant from `api.ts`
 *
 * Two reasons, both concrete:
 *
 * 1. `api.test.mjs` runs the whole route table — every status code, every
 *    permission refusal, the oversell guard — with no network and no IBM account.
 *    That is only possible if the routes depend on this interface rather than on
 *    HTTP.
 * 2. `npm start` is runnable on a laptop with `POS_API_STORE=memory`, so `smoke.mjs`
 *    exercises the real server over a real socket without provisioning anything.
 *
 * ## Why revisions are in the interface
 *
 * The AWS `sell-product` Lambda reads stock, compares it to the quantity, then
 * issues an unconditional `SET stock = stock - :qty`
 * (`terraform/aws-demo/lambda/sell-product/index.js`). Two tills selling the last
 * item at the same time both pass the check and both decrement: stock goes
 * negative and the shop has sold something it does not have. DynamoDB's atomic
 * counter hid half the problem and the missing condition expression exposed it
 * again.
 *
 * Cloudant has no atomic decrement, so pretending the write is a fire-and-forget
 * would reproduce that bug rather than inherit it. What Cloudant does have is
 * `_rev` optimistic concurrency: a `PUT` carrying a stale revision is refused with
 * a 409. Surfacing `rev` here lets `api.ts` do read-check-write as a
 * compare-and-swap with a bounded retry, which is the correction, and
 * `api.test.mjs` asserts it by racing two sells at the last unit.
 */

/** Everything stored here is addressed by a caller-visible `id`. */
export interface StoredDocument {
  readonly id: string;
}

/** A document together with the token required to overwrite or delete it. */
export interface Revision<T> {
  readonly document: T;
  readonly rev: string;
}

/** `conflict` means "someone else wrote first" — never "the write was invalid". */
export type WriteOutcome = 'written' | 'conflict';
export type CreateOutcome = 'created' | 'conflict';

export interface DocumentStore<T extends StoredDocument> {
  /** Every document. Both collections are small and unfiltered, exactly as the AWS scans were. */
  list(): Promise<readonly T[]>;
  read(id: string): Promise<Revision<T> | null>;
  /** Refuses to overwrite: a duplicate id is a `conflict`, which the API turns into 409. */
  create(document: T): Promise<CreateOutcome>;
  write(document: T, rev: string): Promise<WriteOutcome>;
  remove(id: string, rev: string): Promise<WriteOutcome>;
}

// ─── In-memory ────────────────────────────────────────────────────────────────

/**
 * The store `api.test.mjs` and local `npm start` use.
 *
 * Revisions are a monotonic counter rather than a hash: the contract this has to
 * honour is "a stale token is refused", and a counter honours it identically while
 * making a failing test readable (`2` tells you how many writes landed; a digest
 * does not).
 *
 * Documents are cloned on the way in and out. Without that, a caller mutating a
 * returned object would silently edit the store, and the oversell test would pass
 * for the wrong reason.
 */
export class MemoryStore<T extends StoredDocument> implements DocumentStore<T> {
  private readonly documents = new Map<string, { document: T; rev: number }>();

  constructor(seed: readonly T[] = []) {
    for (const document of seed) {
      this.documents.set(document.id, { document: structuredClone(document) as T, rev: 1 });
    }
  }

  async list(): Promise<readonly T[]> {
    return [...this.documents.values()].map((entry) => structuredClone(entry.document) as T);
  }

  async read(id: string): Promise<Revision<T> | null> {
    const entry = this.documents.get(id);
    return entry ? { document: structuredClone(entry.document) as T, rev: String(entry.rev) } : null;
  }

  async create(document: T): Promise<CreateOutcome> {
    if (this.documents.has(document.id)) {
      return 'conflict';
    }
    this.documents.set(document.id, { document: structuredClone(document) as T, rev: 1 });
    return 'created';
  }

  async write(document: T, rev: string): Promise<WriteOutcome> {
    const entry = this.documents.get(document.id);
    if (entry === undefined || String(entry.rev) !== rev) {
      return 'conflict';
    }
    this.documents.set(document.id, { document: structuredClone(document) as T, rev: entry.rev + 1 });
    return 'written';
  }

  async remove(id: string, rev: string): Promise<WriteOutcome> {
    const entry = this.documents.get(id);
    if (entry === undefined || String(entry.rev) !== rev) {
      return 'conflict';
    }
    this.documents.delete(id);
    return 'written';
  }
}

// ─── Cloudant ─────────────────────────────────────────────────────────────────

export interface CloudantConfig {
  /** Service instance URL, no trailing slash, e.g. `https://…-bluemix.cloudantnosqldb.appdomain.cloud`. */
  readonly url: string;
  readonly apiKey: string;
  readonly database: string;
}

/**
 * Minimal Cloudant client, over `fetch`, with no SDK.
 *
 * `@ibm-cloud/cloudant` would bring an SDK and its transitive tree into a package
 * whose two siblings have zero runtime dependencies. What this uses of Cloudant is
 * five HTTP calls and one IAM token exchange, all stable public API, so the SDK
 * would be carried for ergonomics this file does not need.
 *
 * Only `id` crosses the boundary: `_id` and `_rev` are Cloudant's own and are
 * stripped on the way out, so nothing above this line — and no API response — can
 * come to depend on the store being Cloudant.
 */
export class CloudantStore<T extends StoredDocument> implements DocumentStore<T> {
  private token: { value: string; expiresAtMs: number } | null = null;

  // Written as explicit fields rather than constructor parameter properties: this
  // package runs its TypeScript directly under Node's strip-only mode, which refuses
  // parameter properties because erasing them would have to emit assignments. `tsc`
  // accepts them, so the failure is at `npm start`, not at `npm run typecheck`.
  private readonly config: CloudantConfig;
  private readonly fetchImpl: typeof fetch;
  private readonly nowMs: () => number;

  constructor(
    config: CloudantConfig,
    /** Injected so `store.test.mjs` can drive every branch without a Cloudant instance. */
    fetchImpl: typeof fetch = fetch,
    nowMs: () => number = Date.now
  ) {
    this.config = config;
    this.fetchImpl = fetchImpl;
    this.nowMs = nowMs;
  }

  async list(): Promise<readonly T[]> {
    const response = await this.request('GET', `/_all_docs?include_docs=true`);
    if (!response.ok) {
      throw new Error(`Cloudant list failed with ${response.status}.`);
    }
    const body = (await response.json()) as { rows?: readonly { doc?: Record<string, unknown> }[] };
    const rows = body.rows ?? [];
    return rows
      // `_all_docs` includes design documents; they are not products.
      .filter((row) => row.doc !== undefined && !String(row.doc['_id'] ?? '').startsWith('_design/'))
      .map((row) => stripMeta<T>(row.doc as Record<string, unknown>));
  }

  async read(id: string): Promise<Revision<T> | null> {
    const response = await this.request('GET', `/${encodeURIComponent(id)}`);
    if (response.status === 404) {
      return null;
    }
    if (!response.ok) {
      throw new Error(`Cloudant read failed with ${response.status}.`);
    }
    const raw = (await response.json()) as Record<string, unknown>;
    const rev = raw['_rev'];
    if (typeof rev !== 'string') {
      throw new Error('Cloudant returned a document with no _rev.');
    }
    return { document: stripMeta<T>(raw), rev };
  }

  async create(document: T): Promise<CreateOutcome> {
    // No `_rev` in the body is itself the condition: Cloudant refuses a create over
    // an existing id with 409, so this needs no read-then-check and cannot race.
    const response = await this.request('PUT', `/${encodeURIComponent(document.id)}`, {
      ...document,
      _id: document.id,
    });
    if (response.status === 409) {
      return 'conflict';
    }
    if (!response.ok) {
      throw new Error(`Cloudant create failed with ${response.status}.`);
    }
    return 'created';
  }

  async write(document: T, rev: string): Promise<WriteOutcome> {
    const response = await this.request('PUT', `/${encodeURIComponent(document.id)}`, {
      ...document,
      _id: document.id,
      _rev: rev,
    });
    if (response.status === 409) {
      return 'conflict';
    }
    if (!response.ok) {
      throw new Error(`Cloudant write failed with ${response.status}.`);
    }
    return 'written';
  }

  async remove(id: string, rev: string): Promise<WriteOutcome> {
    const response = await this.request(
      'DELETE',
      `/${encodeURIComponent(id)}?rev=${encodeURIComponent(rev)}`
    );
    if (response.status === 409 || response.status === 404) {
      return 'conflict';
    }
    if (!response.ok) {
      throw new Error(`Cloudant delete failed with ${response.status}.`);
    }
    return 'written';
  }

  private async request(method: string, path: string, body?: unknown): Promise<Response> {
    const token = await this.bearerToken();
    return this.fetchImpl(`${this.config.url}/${encodeURIComponent(this.config.database)}${path}`, {
      method,
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: 'application/json',
        ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
  }

  /**
   * Exchange the IAM API key for a bearer token, cached until shortly before it
   * expires.
   *
   * The 60-second margin is what keeps a token that was valid when the request was
   * built from being expired when Cloudant reads it, which otherwise shows up as a
   * rare, unreproducible 401 under load rather than as a clock problem.
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

/** Drop Cloudant's `_id`/`_rev` so nothing downstream depends on the store's identity. */
function stripMeta<T>(raw: Record<string, unknown>): T {
  const { _id, _rev, ...rest } = raw;
  return { ...rest, id: typeof _id === 'string' ? _id : String(rest['id'] ?? '') } as T;
}
