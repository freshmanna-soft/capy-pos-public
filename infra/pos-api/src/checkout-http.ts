import { CheckoutServiceError } from './checkout-service.ts';
import {
  authenticateOptionalCustomer,
  type CustomerPrincipal,
  type CustomerVerificationConfig,
} from './customer-auth.ts';

export interface CheckoutHttpRequest {
  readonly method: string;
  readonly path: string;
  readonly authorization: string | readonly string[] | undefined;
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

export interface CheckoutHttpCheckoutService {
  create(
    body: unknown,
    idempotencyKey: string,
    customer?: CustomerPrincipal | null
  ): Promise<unknown>;
  status(checkoutId: string, checkoutToken: string): Promise<unknown>;
  complete(checkoutId: string, checkoutToken: string): Promise<unknown>;
}

export interface CheckoutHttpDeps {
  readonly checkout: CheckoutHttpCheckoutService;
  readonly rateLimiter: CheckoutRateLimiter;
  readonly rateLimitKey: string;
  readonly customerAuth?: CustomerVerificationConfig;
  readonly nowSeconds?: () => number;
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
      case 'create': {
        const customer = await authenticateOptionalCustomer(
          optionalAuthorization(request.authorization),
          deps.customerAuth,
          (deps.nowSeconds ?? (() => Math.floor(Date.now() / 1000)))()
        );
        if (!customer.ok) return { status: customer.status, body: { error: customer.error } };
        return {
          status: 201,
          body: await createCheckout(
            deps.checkout,
            request.body,
            request.idempotencyKey ?? '',
            customer.principal
          ),
        };
      }
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

function optionalAuthorization(value: string | readonly string[] | undefined): string | undefined {
  if (value === undefined || typeof value === 'string') return value;
  // A repeated Authorization header is present but invalid. Preserve "present"
  // so strict optional auth rejects it instead of silently creating a guest.
  return '';
}

function createCheckout(
  checkout: CheckoutHttpCheckoutService,
  body: unknown,
  idempotencyKey: string,
  customer: CustomerPrincipal | null
): Promise<unknown> {
  return checkout.create(body, idempotencyKey, customer);
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
