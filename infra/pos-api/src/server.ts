/**
 * The HTTP adapter and the process entry point.
 *
 * Everything decision-shaped lives in `api.ts` and `session-auth.ts`; this file is
 * only sockets, environment and the three impure things (`Date`, `randomUUID`, the
 * store) that the route table takes as parameters so it can be tested without them.
 *
 * The same file serves local development and Code Engine. There is no `lambda.ts`
 * counterpart here, unlike the two sibling services: Code Engine runs the container
 * and listens on `PORT`, so the dev path and the deployed path are the same code,
 * and a dev-only shortcut cannot diverge from production behaviour the way a
 * separate handler can.
 *
 *   SESSION_JWT_SECRET=… POS_API_STORE=memory npm start      # laptop, port 8790
 *   SESSION_JWT_SECRET=… CLOUDANT_URL=… CLOUDANT_APIKEY=… npm start
 *
 * APPID_REGION/APPID_TENANT_ID/APPID_CLIENT_ID are optional — unset, this
 * verifies HS256 only, exactly as above. Set all three together to also accept
 * App ID's RS256 access tokens (see `session-auth.ts`'s own doc comment):
 *
 *   SESSION_JWT_SECRET=… POS_API_STORE=memory \
 *   APPID_REGION=us-south APPID_TENANT_ID=… APPID_CLIENT_ID=… npm start
 */
import { createServer } from 'node:http';
import { randomUUID } from 'node:crypto';
import { handle } from './api.ts';
import type { ApiDeps, ProductDocument, TransactionDocument } from './api.ts';
import { CloudantStore } from './cloudant-store.ts';
import { MemoryStore } from '../../shared/src/document-store.ts';
import type { DocumentStore } from '../../shared/src/document-store.ts';

const PORT = Number(process.env['PORT'] ?? 8790);

/**
 * The largest body accepted, in bytes.
 *
 * A product is a few hundred bytes and a sale is smaller. Without a cap, an
 * unauthenticated caller can make the process buffer without bound before
 * `authorize` is ever consulted — the check happens after the body is read, so the
 * cap is what makes the boundary hold against a body rather than a token.
 */
const MAX_BODY_BYTES = 64 * 1024;

/**
 * Fail before listening, not on the first request.
 *
 * `authorize` answers 503 when the secret is empty, which is the right answer for an
 * env that changed under a running process. It is the wrong answer for a deployment
 * that was never configured: that should never accept traffic at all, because a
 * service returning 503 to every call looks like an outage to page someone about
 * rather than a revision that is missing a variable.
 */
function requireSecret(): string {
  const secret = process.env['SESSION_JWT_SECRET'] ?? '';
  if (secret.length === 0) {
    console.error(
      '[pos-api] SESSION_JWT_SECRET is not set. It must match the secret the browser ' +
        'signs sessions with (see src/app/core/infrastructure/auth/session-issuer.ts). Refusing to start.'
    );
    process.exit(1);
  }
  return secret;
}

/**
 * App ID verification is fully optional — three unset vars means exactly today's
 * HS256-only behaviour, not a misconfiguration. A *partial* set is refused the
 * same way an unset `SESSION_JWT_SECRET` is: "refuse to guess" rather than start
 * a revision that verifies RS256 tokens against the wrong tenant or audience.
 */
function readAppIdConfig(): { region: string; tenantId: string; audience: string } | undefined {
  const region = process.env['APPID_REGION'] ?? '';
  const tenantId = process.env['APPID_TENANT_ID'] ?? '';
  const audience = process.env['APPID_CLIENT_ID'] ?? '';

  // "Configured at all" turns on `tenantId`/`audience` only, not `region`:
  // `region` has one sensible value across this whole estate (`us-south`) and
  // Terraform gives it a real default, so it is set on every deployment whether
  // or not App ID is actually wanted. Keying "unconfigured" off all three would
  // make that harmless default look like a *partial* App ID config and refuse
  // to start every deployment that has never touched these vars at all.
  if (tenantId.length === 0 && audience.length === 0) {
    return undefined;
  }
  if (tenantId.length === 0 || audience.length === 0 || region.length === 0) {
    console.error(
      '[pos-api] APPID_REGION, APPID_TENANT_ID and APPID_CLIENT_ID must be set together, ' +
        'or not at all. Refusing to start rather than verify App ID tokens against a partial config.'
    );
    process.exit(1);
  }
  return { region, tenantId, audience };
}

/**
 * Choose the store from the environment, and refuse to guess.
 *
 * Cloudant when it is configured; memory only when explicitly asked for. The
 * explicit opt-in is the point: a silent fall back to memory on a missing
 * `CLOUDANT_APIKEY` would give a Code Engine revision that starts, answers 200,
 * passes its health check, and loses every sale on the next scale-to-zero.
 */
function buildStores(): {
  products: DocumentStore<ProductDocument>;
  transactions: DocumentStore<TransactionDocument>;
} {
  const url = process.env['CLOUDANT_URL'] ?? '';
  const apiKey = process.env['CLOUDANT_APIKEY'] ?? '';

  if (url.length > 0 && apiKey.length > 0) {
    const productsDb = process.env['CLOUDANT_PRODUCTS_DB'] ?? 'products';
    const transactionsDb = process.env['CLOUDANT_TRANSACTIONS_DB'] ?? 'transactions';
    console.log(`[pos-api] store: cloudant (${productsDb}, ${transactionsDb})`);
    return {
      products: new CloudantStore<ProductDocument>({
        url: url.replace(/\/+$/, ''),
        apiKey,
        database: productsDb,
      }),
      transactions: new CloudantStore<TransactionDocument>({
        url: url.replace(/\/+$/, ''),
        apiKey,
        database: transactionsDb,
      }),
    };
  }

  if (process.env['POS_API_STORE'] === 'memory') {
    console.warn('[pos-api] store: in-memory — data is lost on restart. Never deploy this.');
    return { products: new MemoryStore<ProductDocument>(), transactions: new MemoryStore<TransactionDocument>() };
  }

  console.error(
    '[pos-api] No store configured. Set CLOUDANT_URL and CLOUDANT_APIKEY, or ' +
      'POS_API_STORE=memory for local development. Refusing to start.'
  );
  process.exit(1);
}

const deps: ApiDeps = {
  ...buildStores(),
  secret: requireSecret(),
  appId: readAppIdConfig(),
  nowSeconds: () => Math.floor(Date.now() / 1000),
  nowIso: () => new Date().toISOString(),
  newId: () => randomUUID(),
};

/**
 * CORS.
 *
 * `Authorization` in `Allow-Headers` is what makes the till able to send a token at
 * all — a preflight that omits it makes the browser drop the header and every call
 * arrives unauthenticated. `Expose-Headers` is what makes `X-Trace-Id` readable from
 * script: `sync.worker.ts:245` reads it off the response, and without the expose the
 * browser hides it even though it is on the wire. Both are the lesson recorded in
 * this repo when API Gateway's own CORS block stripped exactly these.
 */
const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Trace-Id',
  'Access-Control-Allow-Methods': 'GET, POST, PUT, PATCH, DELETE, OPTIONS',
  'Access-Control-Expose-Headers': 'X-Trace-Id',
  'Access-Control-Max-Age': '600',
} as const;

createServer((req, res) => {
  // Honour the caller's trace id when it sent one — `trace-context.interceptor.ts`
  // does — so one id spans the browser span and this request's logs. Otherwise mint
  // one, because a log line with no correlation id is a log line nobody can follow.
  const incoming = req.headers['x-trace-id'];
  const traceId = typeof incoming === 'string' && incoming.length > 0 ? incoming : randomUUID();

  const send = (status: number, body: unknown): void => {
    res.writeHead(status, { ...CORS, 'Content-Type': 'application/json', 'X-Trace-Id': traceId });
    res.end(JSON.stringify(body));
  };

  if (req.method === 'OPTIONS') {
    res.writeHead(204, { ...CORS, 'X-Trace-Id': traceId }).end();
    return;
  }

  const chunks: Buffer[] = [];
  let received = 0;
  let aborted = false;

  req.on('data', (chunk: Buffer) => {
    if (aborted) {
      return;
    }
    received += chunk.length;
    if (received > MAX_BODY_BYTES) {
      aborted = true;
      send(413, { error: 'Request body too large.' });
      req.destroy();
      return;
    }
    chunks.push(chunk);
  });

  req.on('end', () => {
    if (aborted) {
      return;
    }
    void (async () => {
      const raw = Buffer.concat(chunks).toString('utf8');

      let body: unknown;
      if (raw.trim().length > 0) {
        try {
          body = JSON.parse(raw);
        } catch {
          send(400, { error: 'Body must be JSON.' });
          return;
        }
      }

      // Path only: a query string is not part of any route here, and leaving it on
      // would make `/api/health?x=1` a 404.
      const path = (req.url ?? '/').split('?')[0] ?? '/';

      try {
        const response = await handle(
          { method: req.method ?? 'GET', path, authorization: req.headers.authorization, body },
          deps
        );
        send(response.status, response.body);
      } catch (error) {
        // The store threw — Cloudant unreachable, IAM refusing the key. The message
        // stays in the log and out of the response: it names hosts and databases,
        // and the caller can do nothing with it but learn the shape of the backend.
        console.error(`[pos-api] request failed`, { traceId, path, method: req.method, error });
        send(502, { error: 'The API is unavailable.' });
      }
    })();
  });
}).listen(PORT, () => {
  console.log(`[pos-api] listening on http://localhost:${PORT}/api/health`);
});
