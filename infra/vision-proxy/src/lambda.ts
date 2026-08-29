import { identify, validate } from './identify.ts';

/** Minimal API Gateway proxy shapes — avoids a dependency on @types/aws-lambda. */
interface ProxyEvent {
  body?: string | null;
  isBase64Encoded?: boolean;
  httpMethod?: string;
  requestContext?: { http?: { method?: string } };
}
interface ProxyResult {
  statusCode: number;
  headers: Record<string, string>;
  body: string;
}

/**
 * API Gateway handler for POST {apiUrl}/vision/identify.
 *
 * **This handler has no authorization of any kind, and there is no authorizer to
 * delegate it to.** Epic #195 established that: `terraform/aws-demo/main.tf` has no
 * `aws_apigatewayv2_authorizer` resource, so the previous version of this docblock —
 * "authorization is the gateway's job, attach the same authorizer the rest of the API
 * uses" — described a component nobody ever built.
 *
 * The deployed path is now the container, not this function: story #197 moved the
 * service to IBM Cloud Code Engine, where `server.ts` verifies the session token and
 * pins CORS itself via `session-guard.ts`. This file is kept as the dormant AWS
 * template `terraform/aws-demo` is, and must not be put in front of an API Gateway
 * route without a real authorizer or the same `authorize` call `server.ts` makes —
 * an unauthenticated recognition endpoint is an open, metered path to a paid model.
 */
export async function handler(event: ProxyEvent): Promise<ProxyResult> {
  const method = event.requestContext?.http?.method ?? event.httpMethod ?? 'POST';
  if (method !== 'POST') {
    return reply(405, { error: 'Use POST.' });
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
    return reply(200, await identify(request));
  } catch (error) {
    // Never leak a model error, a key, or a stack to the till. The client treats
    // any non-200 as "she didn't catch it" and the cashier tries again.
    console.error('[vision] recognition failed', error);
    return reply(502, { error: 'Recognition is unavailable.' });
  }
}

function reply(statusCode: number, body: unknown): ProxyResult {
  return {
    statusCode,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
    body: JSON.stringify(body),
  };
}
