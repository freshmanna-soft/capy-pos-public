import { setTimeout as delay } from 'node:timers/promises';
import type { StoredDocument } from '../../shared/src/document-store.ts';
import type { CloudantStore } from './cloudant-store.ts';

export type CloudantSequence =
  | string
  | number
  | readonly unknown[]
  | Readonly<Record<string, unknown>>;

export interface CloudantChange {
  readonly db: string;
  readonly id: string;
  readonly seq: CloudantSequence;
}

export interface CloudantChangePage {
  readonly changes: readonly CloudantChange[];
  readonly lastSeq: CloudantSequence;
}

export type CloudantChangeSubscriber = (change: CloudantChange) => void;

const LONGPOLL_TIMEOUT_MS = 55_000;
const MAX_POLL_LIMIT = 1_000;
const INITIAL_BACKOFF_MS = 250;
const MAX_BACKOFF_MS = 30_000;

interface ChangeRow {
  readonly id?: unknown;
  readonly seq?: unknown;
}

interface ChangesBody {
  readonly results?: unknown;
  readonly last_seq?: unknown;
}

/** Shared, lazy `_changes` reader for checkout document invalidations. */
export class CloudantChangesFollower<T extends StoredDocument> {
  private readonly store: CloudantStore<T>;
  private readonly database: string;
  private readonly subscribers = new Set<CloudantChangeSubscriber>();
  private controller: AbortController | null = null;
  private loop: Promise<void> | null = null;
  private lastSeq: CloudantSequence = '0';

  constructor(store: CloudantStore<T>, database: string) {
    this.store = store;
    this.database = database;
  }

  async poll(
    since: CloudantSequence,
    limit: number,
    signal?: AbortSignal
  ): Promise<CloudantChangePage> {
    if (!Number.isInteger(limit) || limit < 1 || limit > MAX_POLL_LIMIT) {
      throw new Error(`Cloudant changes limit must be between 1 and ${MAX_POLL_LIMIT}.`);
    }
    return this.request(since, limit, false, signal);
  }

  subscribe(subscriber: CloudantChangeSubscriber): () => void {
    this.subscribers.add(subscriber);
    if (this.loop === null) {
      this.controller = new AbortController();
      this.loop = this.follow(this.controller.signal).finally(() => {
        this.loop = null;
        this.controller = null;
        if (this.subscribers.size > 0) {
          this.subscribeLoop();
        }
      });
    }
    return () => {
      this.subscribers.delete(subscriber);
      if (this.subscribers.size === 0) {
        this.controller?.abort();
      }
    };
  }

  private subscribeLoop(): void {
    this.controller = new AbortController();
    this.loop = this.follow(this.controller.signal).finally(() => {
      this.loop = null;
      this.controller = null;
      if (this.subscribers.size > 0) this.subscribeLoop();
    });
  }

  private async follow(signal: AbortSignal): Promise<void> {
    let backoffMs = INITIAL_BACKOFF_MS;
    while (!signal.aborted && this.subscribers.size > 0) {
      try {
        const page = await this.request(this.lastSeq, MAX_POLL_LIMIT, true, signal);
        this.lastSeq = page.lastSeq;
        for (const change of page.changes) {
          for (const subscriber of [...this.subscribers]) subscriber(change);
        }
        backoffMs = INITIAL_BACKOFF_MS;
      } catch (error) {
        if (signal.aborted || isAbortError(error)) return;
        await delay(backoffMs, undefined, { signal, ref: false }).catch((delayError) => {
          if (!isAbortError(delayError)) throw delayError;
        });
        backoffMs = Math.min(backoffMs * 2, MAX_BACKOFF_MS);
      }
    }
  }

  private async request(
    since: CloudantSequence,
    limit: number,
    longpoll: boolean,
    signal?: AbortSignal
  ): Promise<CloudantChangePage> {
    const query = new URLSearchParams({
      filter: '_selector',
      since: encodeSequence(since),
      limit: String(limit),
      include_docs: 'false',
      ...(longpoll ? { feed: 'longpoll', timeout: String(LONGPOLL_TIMEOUT_MS) } : {}),
    });
    const response = await this.store.databaseRequest(
      'POST',
      `/_changes?${query}`,
      { selector: { kind: { $eq: 'checkout' } } },
      signal
    );
    if (!response.ok) {
      throw new Error(`Cloudant changes request failed with ${response.status}.`);
    }
    const body = (await response.json()) as ChangesBody;
    if (!Array.isArray(body.results) || !isSequence(body.last_seq)) {
      throw new Error('Cloudant changes response is malformed.');
    }
    const changes = body.results.map((raw) => decodeRow(raw, this.database));
    return { changes, lastSeq: body.last_seq };
  }
}

function encodeSequence(sequence: CloudantSequence): string {
  return typeof sequence === 'string' ? sequence : JSON.stringify(sequence);
}

function decodeRow(raw: unknown, database: string): CloudantChange {
  if (!isRecord(raw)) throw new Error('Cloudant change row is malformed.');
  const row = raw as ChangeRow;
  if (typeof row.id !== 'string' || !isSequence(row.seq)) {
    throw new Error('Cloudant change row is malformed.');
  }
  return { db: database, id: row.id, seq: row.seq };
}

function isSequence(value: unknown): value is CloudantSequence {
  return (
    typeof value === 'string' ||
    typeof value === 'number' ||
    Array.isArray(value) ||
    isRecord(value)
  );
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isAbortError(error: unknown): boolean {
  return error instanceof Error && error.name === 'AbortError';
}
