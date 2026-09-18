import type { CheckoutService } from './checkout-service.ts';
import { CheckoutServiceError } from './checkout-service.ts';

export interface CheckoutHttpRequest {
  readonly method: string;
  readonly path: string;
  readonly idempotencyKey: string | undefined;
  readonly checkoutToken: string | undefined;
  readonly body: unknown;
}

export interface CheckoutHttpResponse {
  readonly status: number;
  readonly body: unknown;
}

export interface CheckoutRateLimitResult {
  readonly allowed: boolean;
  readonly retryAfterSeconds?: number;
}

export interface CheckoutRateLimiter {
  consume(key: string): CheckoutRateLimitResult;
}

export interface CheckoutHttpDeps {
  readonly checkout: CheckoutService;
  readonly rateLimiter: CheckoutRateLimiter;
  readonly rateLimitKey: string;
}

export type CheckoutHttpRoute =
  | Readonly<{ kind: 'create' }>
  | Readonly<{ kind: 'status'; checkoutId: string }>
  | Readonly<{ kind: 'complete'; checkoutId: string }>;

export function matchCheckoutRoute(method: string, path: string): CheckoutHttpRoute | null {
  const segments = path.split('/');
  if (
    segments[0] !== '' ||
    segments[1] !== 'api' ||
    segments[2] !== 'self-checkout' ||
    segments[3] !== 'checkouts'
  ) {
    return null;
  }
  const upper = method.toUpperCase();
  if (segments.length === 4) return upper === 'POST' ? { kind: 'create' } : null;
  const checkoutId = decodePathSegment(segments[4]);
  if (checkoutId === null) return null;
  if (segments.length === 5) return upper === 'GET' ? { kind: 'status', checkoutId } : null;
  if (segments.length === 6 && segments[5] === 'complete') {
    return upper === 'POST' ? { kind: 'complete', checkoutId } : null;
  }
  return null;
}

export async function handleCheckoutHttp(
  request: CheckoutHttpRequest,
  deps: CheckoutHttpDeps
): Promise<CheckoutHttpResponse | null> {
  const route = matchCheckoutRoute(request.method, request.path);
  if (route === null) return null;
  const limit = deps.rateLimiter.consume(deps.rateLimitKey);
  if (!limit.allowed) {
    return {
      status: 429,
      body: {
        error: 'checkout-rate-limited',
        retryAfterSeconds: boundedRetryAfter(limit.retryAfterSeconds),
      },
    };
  }

  try {
    switch (route.kind) {
      case 'create':
        return {
          status: 201,
          body: await deps.checkout.create(request.body, request.idempotencyKey ?? ''),
        };
      case 'status':
        return {
          status: 200,
          body: await deps.checkout.status(route.checkoutId, request.checkoutToken ?? ''),
        };
      case 'complete':
        return {
          status: 200,
          body: await deps.checkout.complete(route.checkoutId, request.checkoutToken ?? ''),
        };
    }
  } catch (error) {
    return checkoutErrorResponse(error);
  }
}

function checkoutErrorResponse(error: unknown): CheckoutHttpResponse {
  if (!(error instanceof CheckoutServiceError)) throw error;
  const statuses: Readonly<Record<CheckoutServiceError['code'], number>> = {
    'bad-request': 400,
    'idempotency-conflict': 409,
    forbidden: 403,
    'not-found': 404,
    'out-of-stock': 409,
    'provider-unavailable': 503,
    conflict: 409,
    'manual-review': 409,
  };
  return {
    status: statuses[error.code],
    body: { error: error.code, retryable: error.retryable },
  };
}

function decodePathSegment(value: string | undefined): string | null {
  if (value === undefined) return null;
  try {
    const decoded = decodeURIComponent(value);
    return decoded.includes('/') ? null : decoded;
  } catch {
    return null;
  }
}

function boundedRetryAfter(value: number | undefined): number {
  return Number.isSafeInteger(value) && value !== undefined && value > 0
    ? Math.min(value, 3600)
    : 1;
}
