/**
 * A Cloudant-shaped `fetch`, for driving `CloudantStore` without an IBM account.
 *
 * It models exactly the six calls `cloudant-store.ts` makes — the IAM token
 * exchange, `_all_docs`, GET/PUT/DELETE of one document — with CouchDB's revision
 * rules: a `PUT` with no `_rev` over an existing id is a 409, a `PUT` or `DELETE`
 * carrying a `_rev` that is not the current one is a 409, and a missing document is
 * a 404.
 *
 * What a suite built on this proves: that `CloudantStore` maps those HTTP answers
 * onto the port's outcomes, threads the revision token through unchanged, and sends
 * a bearer token it actually obtained. What it cannot prove: that Cloudant behaves
 * the way this file says it does. `smoke.mjs` against a real instance is the only
 * thing that shows that, which is why it exists and why it writes for real.
 */

const IAM_TOKEN_URL = 'https://iam.cloud.ibm.com/identity/token';

/**
 * @param {object} [options]
 * @param {string} [options.url] Service instance URL the store will be configured with.
 * @param {string} [options.database] The one database this fake serves; anything else 404s.
 * @param {number} [options.expiresIn] What the IAM exchange claims, in seconds.
 */
export function createCloudantFake({
  url = 'https://example-bluemix.cloudantnosqldb.appdomain.cloud',
  database = 'products',
  expiresIn = 3600,
} = {}) {
  /** id → { body: string (JSON, without _id/_rev), rev: string } */
  const documents = new Map();
  const calls = [];
  let tokenExchanges = 0;
  let issuedToken = '';
  let revSerial = 0;
  let sequenceSerial = 0;
  const changes = [];
  const changeWaiters = new Set();
  /** Status to answer the next document request with, for the failure branches. */
  let failNextWith = 0;

  const nextRev = () => {
    revSerial += 1;
    // Shaped like Cloudant's `2-9f2a…` rather than a bare counter, so nothing that
    // reads this token can quietly come to depend on it being a number.
    return `${revSerial}-${revSerial.toString(16).padStart(4, '0')}`;
  };

  const nextSequence = () => `seq-${++sequenceSerial}-opaque`;

  const recordChange = (id, entry, deleted = false) => {
    changes.push({
      id,
      seq: nextSequence(),
      kind: entry?.body ? JSON.parse(entry.body).kind : undefined,
      deleted,
    });
    for (const wake of changeWaiters) wake();
    changeWaiters.clear();
  };

  const json = (status, body) =>
    new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

  const fetchImpl = async (target, init = {}) => {
    const method = init.method ?? 'GET';
    const requested = new URL(String(target));
    calls.push({ method, url: String(target), headers: init.headers ?? {} });

    if (`${requested.origin}${requested.pathname}` === IAM_TOKEN_URL) {
      tokenExchanges += 1;
      issuedToken = `iam-access-token-${tokenExchanges}`;
      return json(200, { access_token: issuedToken, expires_in: expiresIn });
    }

    const authorization = (init.headers ?? {})['Authorization'];
    if (authorization !== `Bearer ${issuedToken}`) {
      return json(401, { error: 'unauthorized' });
    }

    const [db, ...rest] = requested.pathname.replace(/^\//, '').split('/');
    if (decodeURIComponent(db) !== database) {
      return json(404, { error: 'not_found', reason: 'Database does not exist.' });
    }

    if (failNextWith !== 0) {
      const status = failNextWith;
      failNextWith = 0;
      return json(status, { error: 'server_error' });
    }

    const target0 = rest.map(decodeURIComponent).join('/');

    if (method === 'GET' && target0 === '_all_docs') {
      return json(200, {
        rows: [...documents.entries()].map(([id, entry]) => ({
          id,
          doc: { ...JSON.parse(entry.body), _id: id, _rev: entry.rev },
        })),
      });
    }

    if (method === 'POST' && target0 === '_changes') {
      const selector = JSON.parse(String(init.body ?? '{}')).selector ?? {};
      const wantedKind = selector.kind?.$eq;
      const sinceParam = requested.searchParams.get('since') ?? '0';
      let sinceValue = sinceParam;
      try {
        sinceValue = JSON.parse(sinceParam);
      } catch {
        // String sequence tokens are sent verbatim by Cloudant clients.
      }
      const start =
        sinceValue === '0'
          ? 0
          : Math.max(0, changes.findIndex((row) => row.seq === sinceValue) + 1);
      const limit = Number(requested.searchParams.get('limit') ?? 100);
      const page = () => {
        const candidates = changes.slice(start);
        const consumed = [];
        const selected = [];
        for (const row of candidates) {
          consumed.push(row);
          if (wantedKind === undefined || row.kind === wantedKind) selected.push(row);
          if (selected.length === limit) break;
        }
        const results = selected.map(({ kind, ...row }) => row);
        const remaining = candidates.slice(consumed.length);
        return {
          results,
          last_seq: consumed.length > 0 ? consumed.at(-1).seq : sinceValue,
          pending: remaining.filter((row) => wantedKind === undefined || row.kind === wantedKind)
            .length,
        };
      };
      let body = page();
      if (body.results.length === 0 && requested.searchParams.get('feed') === 'longpoll') {
        await new Promise((resolve, reject) => {
          const wake = () => {
            init.signal?.removeEventListener('abort', abort);
            resolve();
          };
          const abort = () => {
            changeWaiters.delete(wake);
            reject(init.signal.reason ?? new DOMException('Aborted', 'AbortError'));
          };
          if (init.signal?.aborted) return abort();
          changeWaiters.add(wake);
          init.signal?.addEventListener('abort', abort, { once: true });
        });
        body = page();
      }
      return json(200, body);
    }

    const entry = documents.get(target0);

    if (method === 'GET') {
      return entry === undefined
        ? json(404, { error: 'not_found' })
        : json(200, { ...JSON.parse(entry.body), _id: target0, _rev: entry.rev });
    }

    if (method === 'PUT') {
      const { _id, _rev, ...document } = JSON.parse(String(init.body));
      if (entry === undefined ? _rev !== undefined : _rev !== entry.rev) {
        return json(409, { error: 'conflict', reason: 'Document update conflict.' });
      }
      const rev = nextRev();
      const nextEntry = { body: JSON.stringify(document), rev };
      documents.set(target0, nextEntry);
      recordChange(target0, nextEntry);
      return json(entry === undefined ? 201 : 200, { ok: true, id: target0, rev });
    }

    if (method === 'DELETE') {
      if (entry === undefined) {
        return json(404, { error: 'not_found' });
      }
      if (requested.searchParams.get('rev') !== entry.rev) {
        return json(409, { error: 'conflict', reason: 'Document update conflict.' });
      }
      documents.delete(target0);
      recordChange(target0, entry, true);
      return json(200, { ok: true, id: target0, rev: nextRev() });
    }

    return json(405, { error: 'method_not_allowed' });
  };

  return {
    url,
    database,
    fetchImpl,
    /** Calls seen, IAM exchange included, in order. */
    calls,
    get tokenExchanges() {
      return tokenExchanges;
    },
    /** Put a document in place without going through the store. */
    seed(document) {
      const { id, ...rest } = document;
      const entry = { body: JSON.stringify(rest), rev: nextRev() };
      documents.set(id, entry);
      recordChange(id, entry);
      return entry.rev;
    },
    /** Design documents come back from `_all_docs` and are not products. */
    seedDesignDocument(name) {
      documents.set(`_design/${name}`, { body: JSON.stringify({ views: {} }), rev: nextRev() });
    },
    /** Answer the next document request with `status`, then behave normally again. */
    failNextRequestWith(status) {
      failNextWith = status;
    },
  };
}
