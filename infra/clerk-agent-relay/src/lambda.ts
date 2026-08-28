import { relay } from './relay.ts';
import { hasBearerToken, validate } from './validate.ts';

/** Minimal API Gateway proxy shapes — avoids a dependency on @types/aws-lambda. */
interface ProxyEvent {
  body?: string | null;
  isBase64Encoded?: boolean;
  httpMethod?: string;
  headers?: Record<string, string | undefined>;
  requestContext?: { http?: { method?: string } };
}
interface ProxyResult {
  statusCode: number;
  headers: Record<string, string>;
  body: string;
}

/**
 * API Gateway handler for POST {apiUrl}/clerk/agent.
 *
 * Authorization proper is the gateway's job here as it is for the vision proxy —
 * attach the same authorizer the rest of the Capy-POS API uses. The 401 below is
 * belt to that braces, and it is here rather than only there because the failure it
 * guards is worse on this route: a misconfigured route in front of a *tool-capable*
 * model on the shop's key is an open, metered path that can also change a cart.
 * Presence only; see `hasBearerToken`.
 */
export async function handler(event: ProxyEvent): Promise<ProxyResult> {
  const method = event.requestContext?.http?.method ?? event.httpMethod ?? 'POST';
  if (method !== 'POST') {
    return reply(405, { error: 'Use POST.' });
  }
  if (!hasBearerToken(event.headers ?? {})) {
    return reply(401, { error: 'Authorization required.' });
  }

  let parsed: unknown;
  try {
    const raw = event.isBase64Encoded && event.body
      ? Buffer.from(event.body, 'base64').toString('utf8')
      : (event.body ?? '');
    parsed = JSON.parse(raw);
  } catch {
    return reply(400, { error: 'Body must be JSON.' });
  }

  const request = validate(parsed);
  if ('error' in request) {
    return reply(400, { error: request.error });
  }

  try {
    return reply(200, await relay(request));
  } catch (error) {
    // Never leak a model error, a key, or a stack to the till. The client turns any
    // non-200 into `unavailableStep()`, which says nothing out loud and lets the
    // cashier carry on with the keyword parser — see `clerk-agent.port.ts`.
    console.error('[clerk-agent] hop failed', error);
    return reply(502, { error: 'The clerk is unavailable.' });
  }
}

function reply(statusCode: number, body: unknown): ProxyResult {
  return {
    statusCode,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
    body: JSON.stringify(body),
  };
}
