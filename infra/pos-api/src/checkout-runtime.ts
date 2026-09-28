import { createHash, randomUUID } from 'node:crypto';
import type { DocumentStore } from '../../shared/src/document-store.ts';
import type { ProductDocument, TransactionDocument } from './api.ts';
import { loadCheckoutConfig } from './checkout-config.ts';
import { CloudantDueCheckoutReader } from './cloudant-checkout-store.ts';
import { createPayPalSdkGateway } from './checkout-paypal.ts';
import { FixedWindowCheckoutRateLimiter } from './checkout-rate-limit.ts';
import { loadCheckoutSecrets } from './checkout-secrets.ts';
import { CheckoutService } from './checkout-service.ts';
import {
  DocumentCheckoutStore,
  MemoryDueCheckoutReader,
  type CheckoutRepository,
  type CheckoutStoredDocument,
} from './checkout-store.ts';
import { CloudantStore } from './cloudant-store.ts';
import { MemoryStore } from '../../shared/src/document-store.ts';

export interface CheckoutRuntime {
  readonly service: CheckoutService;
  readonly checkouts: CheckoutRepository;
  readonly rateLimiter: FixedWindowCheckoutRateLimiter;
}

/**
 * Returns a disabled stub runtime when CHECKOUT_ENABLED is absent or false.
 * All routes handled by the stub immediately return 503 so the rest of the
 * API keeps working — operators can sell via MercadoPago/cash without PayPal
 * being configured.
 */
function buildDisabledCheckoutRuntime(): CheckoutRuntime {
  const disabled = () => Promise.reject(new Error('Checkout is disabled on this instance.'));
  return Object.freeze({
    checkouts: {
      get: disabled, create: disabled, update: disabled, delete: disabled,
      list: disabled, findByIdempotencyKey: disabled,
    } as unknown as CheckoutRepository,
    rateLimiter: { check: () => ({ allowed: false, retryAfterMs: 0 }) } as unknown as FixedWindowCheckoutRateLimiter,
    service: { createCheckout: disabled, captureCheckout: disabled, cancelCheckout: disabled, getCheckout: disabled } as unknown as CheckoutService,
  });
}

export function buildCheckoutRuntime(input: {
  readonly environment: Readonly<Record<string, string | undefined>>;
  readonly products: DocumentStore<ProductDocument>;
  readonly transactions: DocumentStore<TransactionDocument>;
  readonly cloudant?: { readonly url: string; readonly apiKey: string };
  readonly nowIso?: () => string;
  readonly newId?: () => string;
}): CheckoutRuntime {
  // CHECKOUT_ENABLED must be explicitly set to "true" to activate PayPal
  // checkout. When absent (the default — Terraform only sets it when
  // needs_checkout = true) the server starts normally and all checkout
  // endpoints return 503 rather than crashing at startup.
  if (input.environment['CHECKOUT_ENABLED'] !== 'true') {
    return buildDisabledCheckoutRuntime();
  }

  const mode = input.environment['NODE_ENV'] === 'production' ? 'production' : 'development';
  const config = loadCheckoutConfig(input.environment, mode);
  const secrets = loadCheckoutSecrets(input.environment);
  const checkoutDocuments: DocumentStore<CheckoutStoredDocument> = input.cloudant
    ? new CloudantStore<CheckoutStoredDocument>({
        ...input.cloudant,
        database: input.environment['CLOUDANT_CHECKOUTS_DB'] ?? 'checkouts',
      })
    : memoryCheckoutStore(input.environment);
  const dueReader =
    checkoutDocuments instanceof CloudantStore
      ? new CloudantDueCheckoutReader(checkoutDocuments)
      : new MemoryDueCheckoutReader(checkoutDocuments);
  const checkouts = new DocumentCheckoutStore(
    checkoutDocuments,
    (value) => createHash('sha256').update(value).digest('base64url'),
    dueReader
  );
  return Object.freeze({
    checkouts,
    service: new CheckoutService({
      checkouts,
      products: input.products,
      transactions: input.transactions,
      paypal: createPayPalSdkGateway({
        clientId: config.paypalClientId,
        clientSecret: config.paypalClientSecret,
        environment: config.paypalEnvironment,
        timeoutMs: config.paypalTimeoutMs,
      }),
      config,
      secrets,
      nowIso: input.nowIso ?? (() => new Date().toISOString()),
      newId: input.newId ?? randomUUID,
    }),
    rateLimiter: new FixedWindowCheckoutRateLimiter({
      maxRequests: integerEnvironment(
        input.environment,
        'CHECKOUT_RATE_LIMIT_REQUESTS',
        60,
        1,
        1000
      ),
      windowMs: integerEnvironment(
        input.environment,
        'CHECKOUT_RATE_LIMIT_WINDOW_MS',
        60_000,
        1000,
        3_600_000
      ),
      maxKeys: integerEnvironment(
        input.environment,
        'CHECKOUT_RATE_LIMIT_MAX_KEYS',
        10_000,
        1,
        100_000
      ),
    }),
  });
}

function memoryCheckoutStore(
  environment: Readonly<Record<string, string | undefined>>
): MemoryStore<CheckoutStoredDocument> {
  if (environment['POS_API_STORE'] !== 'memory') {
    throw new Error('Checkout persistence requires Cloudant outside explicit memory development.');
  }
  return new MemoryStore<CheckoutStoredDocument>();
}

function integerEnvironment(
  environment: Readonly<Record<string, string | undefined>>,
  name: string,
  fallback: number,
  minimum: number,
  maximum: number
): number {
  const raw = environment[name];
  if (raw === undefined) return fallback;
  if (!/^[1-9]\d*$/.test(raw)) throw new Error(`${name} must be a positive base-10 integer.`);
  const parsed = Number(raw);
  if (!Number.isSafeInteger(parsed) || parsed < minimum || parsed > maximum) {
    throw new Error(`${name} is outside its allowed range.`);
  }
  return parsed;
}
