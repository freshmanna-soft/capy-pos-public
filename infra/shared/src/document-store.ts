/**
 * The persistence port every Capy-POS backend stores documents through, and the
 * in-memory implementation of it.
 *
 * Extracted from `infra/pos-api/src/store.ts` (story #204) with no change in
 * behaviour. It lives here because it is the one data-portability abstraction in the
 * repo that is not about a single cloud: `pos-api` fulfils it with Cloudant, a GCP
 * build would fulfil it with Firestore and an AWS-native one with DynamoDB, and all
 * three want the same interface and the same `MemoryStore` to test against. The
 * IBM-specific implementation stayed behind in `pos-api`, because nothing else can
 * use it.
 *
 * What an implementation must guarantee is written twice on purpose: as prose in
 * `infra/shared/README.md`, and as assertions in `document-store-contract.mjs`,
 * which every implementation is expected to run.
 *
 * ## Why a port at all, rather than each service calling its database directly
 *
 * Two reasons, both concrete, both from `pos-api`:
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
 * item at the same time both pass the check and both decrement: stock goes negative
 * and the shop has sold something it does not have. DynamoDB's atomic counter hid
 * half the problem and the missing condition expression exposed it again.
 *
 * Cloudant has no atomic decrement, so pretending the write is a fire-and-forget
 * would reproduce that bug rather than inherit it. What Cloudant does have is `_rev`
 * optimistic concurrency: a `PUT` carrying a stale revision is refused with a 409.
 * Surfacing `rev` here lets a caller do read-check-write as a compare-and-swap with
 * a bounded retry, which is the correction, and `api.test.mjs` asserts it by racing
 * two sells at the last unit.
 *
 * That is why `rev` is not an implementation detail a new backend may drop: a store
 * whose `write` ignores the token it was handed compiles against this interface and
 * silently reintroduces the oversell.
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
  /** Every document. Both of `pos-api`'s collections are small and unfiltered, exactly as the AWS scans were. */
  list(): Promise<readonly T[]>;
  read(id: string): Promise<Revision<T> | null>;
  /** Refuses to overwrite: a duplicate id is a `conflict`, which the API turns into 409. */
  create(document: T): Promise<CreateOutcome>;
  write(document: T, rev: string): Promise<WriteOutcome>;
  remove(id: string, rev: string): Promise<WriteOutcome>;
}

// ─── In-memory ────────────────────────────────────────────────────────────────

/**
 * The store `api.test.mjs` and local `npm start` use — and the one a new backend's
 * tests can substitute for anything above the port.
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
