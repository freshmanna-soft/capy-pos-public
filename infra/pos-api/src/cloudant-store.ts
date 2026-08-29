/**
 * The Cloudant implementation of `DocumentStore`.
 *
 * The story left the data store as an explicit open decision between Cloudant and
 * Databases for PostgreSQL. Cloudant is chosen: both AWS tables are id-keyed with
 * no secondary indexes and no query beyond get/scan
 * (`terraform/aws-demo/main.tf:114-134`), which is the shape Cloudant serves
 * directly, and it needs no schema migration story to stand up. Postgres would have
 * bought joins and transactions that nothing here asks for.
 *
 * The port itself — and `MemoryStore`, which every route test in this package runs
 * on — moved to `infra/shared/src/document-store.ts` (story #204), because a
 * Firestore or DynamoDB build wants the same interface and the same in-memory
 * double. This file is the part that could not go with it: it is Cloudant, and
 * nothing else can use it.
 * Read `infra/shared/README.md` for what the port requires of an implementation; the
 * `rev` handling below is this file honouring it.
 */
import type {
  CreateOutcome,
  DocumentStore,
  Revision,
  StoredDocument,
  WriteOutcome,
} from '../../shared/src/document-store.ts';

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
    /** Injected so `cloudant-store.test.mjs` can drive every branch without a Cloudant instance. */
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
