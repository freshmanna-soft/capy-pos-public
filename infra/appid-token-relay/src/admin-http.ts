/**
 * The transport boundary for this relay's admin-only staff-management routes.
 *
 * Same order as `infra/clerk-agent-relay/src/http.ts` (OPTIONS before auth, origin
 * before route, auth before body, body cap while streaming) — see that file's own
 * doc comment for why each step is where it is. The one real difference: five
 * routes, not one, matched explicitly by method+path rather than through a
 * generic router. Five is not enough to earn an abstraction the rest of this
 * codebase doesn't otherwise need — a handful of similar branches read more
 * honestly than a route table built to hold them.
 *
 * `GET /appid/admin/roles` exists so the browser never invents an App ID role
 * id itself: `AppIdOperatorAdminAdapter.listAssignableRoles()` calls it to get
 * the three built-in role names' *real* App ID role ids, then sends one of
 * those ids straight back on `create`/`reassignRole` — this boundary never
 * resolves a role by name on that path, only when building this one list.
 */
import type { IncomingMessage, ServerResponse } from 'node:http';
import { authorize, type AuthConfig } from './admin-auth.ts';
import { corsHeaders, originAllowed } from './cors.ts';

export const ALLOWED_METHODS = 'GET, POST, PUT, DELETE, OPTIONS';
const STAFF_ROUTE = '/appid/admin/staff';
const ROLES_ROUTE = '/appid/admin/roles';
const ROLE_ROUTE_SUFFIX = '/role';

interface Rejection {
  readonly error: string;
}

export interface CreateStaffRequest {
  readonly email: string;
  readonly roleId: string;
}

export interface AssignRoleRequest {
  readonly roleId: string;
}

export interface AdminBoundaryConfig {
  readonly logPrefix: string;
  readonly auth: AuthConfig;
  readonly origins: readonly string[];
  readonly maxBodyBytes: number;
  readonly validateCreate: (body: unknown) => CreateStaffRequest | Rejection;
  readonly validateAssignRole: (body: unknown) => AssignRoleRequest | Rejection;
  readonly listRoles: () => Promise<unknown>;
  readonly list: () => Promise<unknown>;
  readonly create: (request: CreateStaffRequest) => Promise<unknown>;
  readonly reassignRole: (userId: string, request: AssignRoleRequest) => Promise<unknown>;
  readonly revoke: (userId: string) => Promise<void>;
  readonly unavailable: string;
  readonly nowSeconds?: () => number;
}

export function createAdminRequestListener(
  config: AdminBoundaryConfig
): (req: IncomingMessage, res: ServerResponse) => void {
  const clock = config.nowSeconds ?? ((): number => Math.floor(Date.now() / 1000));

  return (req, res) => {
    const origin = req.headers.origin;
    const cors = corsHeaders(origin, config.origins, ALLOWED_METHODS);

    const send = (status: number, body: unknown): void => {
      res.writeHead(status, { ...cors, 'Content-Type': 'application/json' });
      res.end(body === undefined ? '' : JSON.stringify(body));
    };

    if (req.method === 'OPTIONS') {
      res.writeHead(204, cors).end();
      return;
    }

    if (!originAllowed(origin, config.origins)) {
      send(403, { error: 'Origin is not allowed.' });
      return;
    }

    const path = req.url?.split('?')[0] ?? '';
    const userId = matchRoleRoutePath(path);
    const isStaffRoute = path === STAFF_ROUTE;
    const isRolesRoute = path === ROLES_ROUTE;

    if (!isStaffRoute && !isRolesRoute && userId === null) {
      send(404, { error: `${STAFF_ROUTE}, ${ROLES_ROUTE}, or ${STAFF_ROUTE}/{id}${ROLE_ROUTE_SUFFIX}` });
      return;
    }

    void (async () => {
      const outcome = await authorize(req.headers.authorization, config.auth, clock());
      if (!outcome.ok) {
        send(outcome.status, { error: outcome.error });
        return;
      }

      // Every GET needs no body — dispatch before the body-reading listener,
      // the same way a route with nothing to wait for always has in this codebase.
      if (isRolesRoute && req.method === 'GET') {
        await respond(send, config, outcome.claims.operatorId, () => config.listRoles());
        return;
      }
      if (isStaffRoute && req.method === 'GET') {
        await respond(send, config, outcome.claims.operatorId, () => config.list());
        return;
      }
      if (userId !== null && req.method === 'DELETE') {
        await respond(send, config, outcome.claims.operatorId, () => config.revoke(userId));
        return;
      }

      const wantsBody =
        (isStaffRoute && req.method === 'POST') || (userId !== null && req.method === 'PUT');
      if (!wantsBody) {
        send(404, { error: `${STAFF_ROUTE}, ${ROLES_ROUTE}, or ${STAFF_ROUTE}/{id}${ROLE_ROUTE_SUFFIX}` });
        return;
      }

      readBody(req, res, config.maxBodyBytes, send, async (parsed) => {
        if (isStaffRoute) {
          const request = config.validateCreate(parsed);
          if (isRejection(request)) {
            send(400, { error: request.error });
            return;
          }
          await respond(send, config, outcome.claims.operatorId, () => config.create(request));
          return;
        }

        // userId is non-null here — wantsBody guarantees it (the PUT branch).
        const request = config.validateAssignRole(parsed);
        if (isRejection(request)) {
          send(400, { error: request.error });
          return;
        }
        await respond(send, config, outcome.claims.operatorId, () => config.reassignRole(userId as string, request));
      });
    })();
  };
}

/** `/appid/admin/staff/{id}/role` → `{id}`, or `null` if the path doesn't match that shape at all. */
function matchRoleRoutePath(path: string): string | null {
  const prefix = `${STAFF_ROUTE}/`;
  if (!path.startsWith(prefix) || !path.endsWith(ROLE_ROUTE_SUFFIX)) {
    return null;
  }
  const id = path.slice(prefix.length, -ROLE_ROUTE_SUFFIX.length);
  return id.length > 0 ? decodeURIComponent(id) : null;
}

async function respond(
  send: (status: number, body: unknown) => void,
  config: Pick<AdminBoundaryConfig, 'logPrefix' | 'unavailable'>,
  operatorId: string,
  action: () => Promise<unknown>
): Promise<void> {
  try {
    const result = await action();
    send(result === undefined ? 204 : 200, result);
  } catch (error) {
    // Never leak a Management API error, a token, or a stack to the caller —
    // same reasoning as every other proxy's `handle` failure path in this repo.
    console.error(`${config.logPrefix} admin request failed`, { operatorId, error });
    send(502, { error: config.unavailable });
  }
}

function readBody(
  req: IncomingMessage,
  res: ServerResponse,
  maxBodyBytes: number,
  send: (status: number, body: unknown) => void,
  onParsed: (parsed: unknown) => Promise<void>
): void {
  const chunks: Buffer[] = [];
  let received = 0;
  let aborted = false;

  req.on('data', (chunk: Buffer) => {
    if (aborted) {
      return;
    }
    received += chunk.length;
    if (received > maxBodyBytes) {
      aborted = true;
      send(413, { error: 'Request body too large.' });
      // Stop reading, then drop the socket once the reply is on the wire —
      // destroying it on the spot races the write and can cut the 413 the
      // caller needs in order to learn to send less (same fix as the sibling
      // proxies' `http.ts`).
      req.pause();
      res.on('finish', () => req.destroy());
      return;
    }
    chunks.push(chunk);
  });

  req.on('end', () => {
    if (aborted) {
      return;
    }
    void (async () => {
      let parsed: unknown;
      try {
        parsed = JSON.parse(Buffer.concat(chunks).toString('utf8'));
      } catch {
        send(400, { error: 'Body must be JSON.' });
        return;
      }
      await onParsed(parsed);
    })();
  });
}

function isRejection(result: unknown): result is Rejection {
  return (
    typeof result === 'object' &&
    result !== null &&
    'error' in result &&
    typeof (result as Rejection).error === 'string'
  );
}
