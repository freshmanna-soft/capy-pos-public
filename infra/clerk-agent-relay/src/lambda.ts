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
 * **The 401 below checks only that a bearer token is *present*, and there is no
 * authorizer behind it verifying one.** Epic #195 established that no
 * `aws_apigatewayv2_authorizer` was ever built, so the previous version of this
 * docblock — "authorization proper is the gateway's job, this is belt to those
 * braces" — was braces to a belt that did not exist. Presence is not verification:
 * `Authorization: Bearer x` satisfies it.
 *
 * The deployed path is now the container, not this function: story #197 moved the
 * service to IBM Cloud Code Engine, where `server.ts` verifies the token's signature,
 * expiry and `sale:process` permission via `session-guard.ts`. This file is kept as
 * the dormant AWS template `terraform/aws-demo` is, and must not be put in front of
 * an API Gateway route without that same check — a misconfigured route in front of a
 * *tool-capable* model on the shop's key is an open, metered path that can also
 * change a cart.
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
