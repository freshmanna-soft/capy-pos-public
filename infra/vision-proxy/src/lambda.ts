import { identify, validate } from './identify.js';

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
 * Authorization is the gateway's job, not this function's — attach the same
 * authorizer the rest of the Capy-POS API uses. The client sends its bearer token
 * on every call for exactly that reason.
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
