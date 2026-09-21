import { createHash, createHmac, timingSafeEqual } from 'node:crypto';
import type { DocumentStore } from '../../shared/src/document-store.ts';
import type { ProductDocument, TransactionDocument } from './api.ts';
import type { CheckoutConfig } from './checkout-config.ts';
import {
  CHECKOUT_TRANSACTION_SCHEMA_VERSION_V2,
  CheckoutTransactionCorruptionError,
  checkoutInventoryOf,
  persistCheckoutTransaction,
  productAvailableStock,
} from './checkout-fulfillment.ts';
import { CheckoutInventoryError, commit, release, reserve } from './checkout-inventory.ts';
import {
  PayPalAuthorizationStatus,
  PayPalCaptureStatus,
  PayPalFactMismatchError,
  PayPalGatewayError,
  PayPalOrderStatus,
  oneOrderAuthorization,
  verifyPayPalAuthorization,
  verifyPayPalCapture,
  verifyPayPalOrder,
  type PayPalAuthorizationSnapshot,
  type PayPalCaptureSnapshot,
  type PayPalGateway,
  type PayPalOrderSnapshot,
} from './checkout-paypal.ts';
import {
  CheckoutRequestValidationError,
  checkoutQuotesEqual,
  parseCheckoutCreateRequest,
  priceCheckout,
  type CheckoutCreateRequest,
  type CheckoutQuote,
} from './checkout-pricing.ts';
import {
  CheckoutState,
  isTerminalCheckoutState,
  type CheckoutState as State,
} from './checkout-state.ts';
import {
  CHECKOUT_FINGERPRINT_VERSION_V2,
  CHECKOUT_SCHEMA_VERSION_V2,
  type BindingResult,
  type CheckoutCustomerBinding,
  type CheckoutDocument,
  type CheckoutLoyaltyProjection,
  type CheckoutReceiptProjection,
  type CheckoutRepository,
  type IdempotencyFingerprintBinding,
  type PublicCheckoutLoyalty,
  type VersionedCheckout,
} from './checkout-store.ts';
import type { CustomerPrincipal } from './customer-auth.ts';
import { pointsForSelfCheckout, SELF_CHECKOUT_LOYALTY_POLICY_VERSION } from './loyalty-policy.ts';

export interface CheckoutSecrets {
  readonly idempotencyHmacKeys: Readonly<Record<string, string>>;
  readonly capabilityHmacKeys: Readonly<Record<string, string>>;
}

export interface CheckoutServiceDeps {
  readonly checkouts: CheckoutRepository;
  readonly products: DocumentStore<ProductDocument>;
  readonly transactions: DocumentStore<TransactionDocument>;
  readonly paypal: PayPalGateway;
  readonly config: CheckoutConfig;
  readonly secrets: CheckoutSecrets;
  readonly nowIso: () => string;
  readonly newId: () => string;
}

export interface CreatedCheckoutProjection {
  readonly checkoutId: string;
  readonly paypalOrderId: string;
  readonly checkoutToken: string;
  readonly state: 'awaiting-approval';
  readonly quote: CheckoutQuote;
}

export type CheckoutStatusProjection = Readonly<{
  checkoutId: string;
  state: State;
  quote: CheckoutQuote;
  paypalOrderId: string | null;
  receipt: CheckoutReceiptProjection | null;
  loyalty: PublicCheckoutLoyalty;
  failure: Readonly<{ code: string; retryable: boolean }> | null;
}>;

export interface CheckoutReconciliationLease {
  readonly ownerId: string;
  readonly leaseId: string;
}

export type CheckoutReconcileResult =
  | Readonly<{ outcome: 'reconciled'; status: CheckoutStatusProjection }>
  | Readonly<{ outcome: 'busy' }>;

export class CheckoutServiceError extends Error {
  readonly code:
    | 'bad-request'
    | 'idempotency-conflict'
    | 'forbidden'
    | 'not-found'
    | 'out-of-stock'
    | 'provider-unavailable'
    | 'conflict'
    | 'manual-review';
  readonly retryable: boolean;

  constructor(code: CheckoutServiceError['code'], retryable = false) {
    super(`Checkout operation failed: ${code}.`);
    this.name = 'CheckoutServiceError';
    this.code = code;
    this.retryable = retryable;
  }
}

class CheckoutProductPersistenceError extends Error {
  readonly code = 'missing';

  constructor() {
    super('Checkout product is missing.');
    this.name = 'CheckoutProductPersistenceError';
  }
}

export class CheckoutProviderBindingPersistenceError extends Error {
  readonly code = 'provider-binding-persistence';
  readonly retryable = true;

  constructor() {
    super('Checkout provider reference binding could not be persisted.');
    this.name = 'CheckoutProviderBindingPersistenceError';
  }
}

export class CheckoutProviderBindingCollisionError extends Error {
  readonly code: 'provider-binding-conflict' | 'provider-binding-digest-collision';

  constructor(outcome: 'conflict' | 'digest-collision') {
    const code =
      outcome === 'conflict' ? 'provider-binding-conflict' : 'provider-binding-digest-collision';
    super(`Checkout provider reference binding failed: ${code}.`);
    this.name = 'CheckoutProviderBindingCollisionError';
    this.code = code;
  }
}

const CAS_ATTEMPTS = 5;
const RECONCILE_STEPS = 24;
const MAX_PROVIDER_ATTEMPTS = 8;
const LEASE_DURATION_MS = 30_000;
const CREATE_RETRY_MS = 2_000;
const PROVIDER_RETRY_MS = 5_000;
const COMMIT_RETRY_MS = 2_000;
const CHECKOUT_LIFETIME_MS = 30 * 60 * 1000;
const APPROVED_ORDER_STATUSES = new Set<string>([PayPalOrderStatus.APPROVED]);
const CREATED_OR_APPROVED_ORDER_STATUSES = new Set<string>([
  PayPalOrderStatus.CREATED,
  PayPalOrderStatus.APPROVED,
  PayPalOrderStatus.PAYER_ACTION_REQUIRED,
]);
const CREATED_AUTHORIZATION_STATUSES = new Set<string>([PayPalAuthorizationStatus.CREATED]);
const VOIDED_AUTHORIZATION_STATUSES = new Set<string>([
  PayPalAuthorizationStatus.VOIDED,
  PayPalAuthorizationStatus.DENIED,
]);
const COMPLETED_CAPTURE_STATUSES = new Set<string>([PayPalCaptureStatus.COMPLETED]);

export class CheckoutService {
  private readonly deps: CheckoutServiceDeps;

  constructor(deps: CheckoutServiceDeps) {
    secretFor(
      deps.secrets.idempotencyHmacKeys,
      deps.config.idempotencyKeyVersion,
      'Checkout idempotency HMAC key'
    );
    secretFor(
      deps.secrets.capabilityHmacKeys,
      deps.config.capabilityKeyVersion,
      'Checkout capability HMAC key'
    );
    this.deps = deps;
  }

  async create(
    rawBody: unknown,
    rawIdempotencyKey: string,
    customer: CustomerPrincipal | null = null
  ): Promise<CreatedCheckoutProjection> {
    let request: CheckoutCreateRequest;
    try {
      request = parseCheckoutCreateRequest(rawBody, this.deps.config);
    } catch (error) {
      if (error instanceof CheckoutRequestValidationError) {
        throw new CheckoutServiceError('bad-request');
      }
      throw error;
    }
    const idempotencyKey = boundedHeader(rawIdempotencyKey, 'Idempotency-Key');
    const customerBinding = checkoutCustomerBinding(customer);
    const fingerprintBinding = this.fingerprintBinding(customerBinding);
    const requestFingerprint = digestCanonicalRequest(
      request.items,
      customerBinding,
      fingerprintBinding.requestFingerprintVersion === CHECKOUT_FINGERPRINT_VERSION_V2
    );
    const idempotency = await this.lookupIdempotency(
      idempotencyKey,
      requestFingerprint,
      fingerprintBinding
    );
    if (idempotency.lookup.outcome === 'conflict') {
      throw new CheckoutServiceError('idempotency-conflict');
    }
    if (idempotency.lookup.outcome === 'digest-collision') {
      throw new CheckoutServiceError('conflict');
    }
    if (customerBinding.kind === 'customer' && this.deps.config.checkoutV2WritesEnabled !== true) {
      // Compatibility-only revisions must not silently persist an authenticated
      // purchase as a guest V1 record. Activation is an explicit deployment gate.
      throw new CheckoutServiceError('provider-unavailable', true);
    }
    if (idempotency.lookup.outcome === 'replay') {
      const existing = await this.deps.checkouts.read(idempotency.lookup.checkoutId);
      if (existing !== null) {
        const checkoutToken = this.checkoutCapability(
          existing.document.id,
          existing.document.capabilityKeyVersion
        );
        return this.resumeCreateReplay(existing.document.id, checkoutToken, {
          keyHash: idempotency.keyHash,
          keyVersion: idempotency.keyVersion,
          requestFingerprint,
          fingerprintBinding,
          quote: existing.document.quote,
          now: this.now(),
        });
      }
    }
    const products = await this.readProducts(request.items.map((item) => item.productId));
    let quote: CheckoutQuote;
    try {
      quote = priceCheckout(request, products, this.deps.config);
    } catch (error) {
      if (error instanceof CheckoutRequestValidationError) {
        throw new CheckoutServiceError('bad-request');
      }
      throw error;
    }
    if (idempotency.lookup.outcome === 'missing') {
      for (const line of quote.lines) {
        const product = products.get(line.productId)!;
        if (productAvailableStock(product) < line.quantity) {
          throw new CheckoutServiceError('out-of-stock');
        }
      }
    }
    const proposedCheckoutId = checkoutIdentifier(this.deps.newId());
    const now = this.now();
    const claim =
      idempotency.lookup.outcome === 'replay'
        ? { outcome: 'replay' as const, checkoutId: idempotency.lookup.checkoutId }
        : await this.deps.checkouts.claimIdempotency({
            keyHash: idempotency.keyHash,
            keyVersion: idempotency.keyVersion,
            requestFingerprint,
            ...fingerprintBinding,
            checkoutId: proposedCheckoutId,
            nowIso: now,
          });
    if (claim.outcome === 'conflict') throw new CheckoutServiceError('idempotency-conflict');
    if (claim.outcome === 'digest-collision') throw new CheckoutServiceError('conflict');

    const checkoutId = claim.checkoutId;
    const checkoutToken = this.checkoutCapability(checkoutId);
    if (claim.outcome === 'replay') {
      return this.resumeCreateReplay(checkoutId, checkoutToken, {
        keyHash: idempotency.keyHash,
        keyVersion: idempotency.keyVersion,
        requestFingerprint,
        fingerprintBinding,
        quote,
        now,
      });
    }

    const checkout = this.newCheckout(
      checkoutId,
      checkoutToken,
      idempotency.keyHash,
      idempotency.keyVersion,
      requestFingerprint,
      fingerprintBinding,
      quote,
      now
    );
    if ((await this.deps.checkouts.create(checkout)) === 'conflict') {
      throw new CheckoutServiceError('conflict', true);
    }
    const requested = await this.transition(checkoutId, CheckoutState.CREATE_ORDER_REQUESTED, {
      nextActionAt: addMilliseconds(now, CREATE_RETRY_MS),
    });
    return this.createPayPalOrder(requested, checkoutToken);
  }

  async status(checkoutId: string, checkoutToken: string): Promise<CheckoutStatusProjection> {
    const checkout = await this.authorizedCheckout(checkoutId, checkoutToken);
    return projectStatus(checkout.document);
  }

  async complete(checkoutId: string, checkoutToken: string): Promise<CheckoutStatusProjection> {
    const checkout = await this.authorizedCheckout(checkoutId, checkoutToken);
    if (isTerminalCheckoutState(checkout.document.state)) return projectStatus(checkout.document);
    const lease = {
      ownerId: `checkout-client:${checkout.document.id}`,
      leaseId: reconciliationIdentifier(this.deps.newId(), 'lease id'),
    };
    const result = await this.reconcile(checkout.document.id, lease);
    return result.outcome === 'reconciled'
      ? result.status
      : projectStatus((await this.requireCheckout(checkout.document.id)).document);
  }

  async reconcile(
    checkoutId: string,
    lease: CheckoutReconciliationLease
  ): Promise<CheckoutReconcileResult> {
    const id = checkoutIdentifier(checkoutId);
    const ownerId = reconciliationIdentifier(lease.ownerId, 'lease owner');
    const leaseId = reconciliationIdentifier(lease.leaseId, 'lease id');
    const before = await this.requireCheckout(id);
    if (isTerminalCheckoutState(before.document.state)) {
      return { outcome: 'reconciled', status: projectStatus(before.document) };
    }
    const now = this.now();
    const acquired = await this.deps.checkouts.tryAcquireLease({
      checkoutId: id,
      ownerId,
      leaseId,
      nowIso: now,
      expiresAtIso: addMilliseconds(now, LEASE_DURATION_MS),
    });
    if (acquired.outcome === 'busy') return { outcome: 'busy' };
    if (acquired.outcome === 'not-found') throw new CheckoutServiceError('not-found');
    if (acquired.outcome === 'conflict') throw new CheckoutServiceError('conflict', true);

    const heldLease = { ownerId, leaseId };
    try {
      return {
        outcome: 'reconciled',
        status: await this.runReconciliation(id, heldLease),
      };
    } finally {
      const latest = await this.deps.checkouts.read(id);
      if (latest?.document.lease !== null) {
        const released = await this.deps.checkouts.releaseLease({
          checkoutId: id,
          ownerId,
          leaseId,
          nowIso: this.now(),
        });
        if (released === 'conflict') throw new CheckoutServiceError('conflict', true);
      }
    }
  }

  private async runReconciliation(
    checkoutId: string,
    lease: CheckoutReconciliationLease
  ): Promise<CheckoutStatusProjection> {
    for (let step = 0; step < RECONCILE_STEPS; step += 1) {
      let current = await this.requireCheckout(checkoutId);
      if (isTerminalCheckoutState(current.document.state)) return projectStatus(current.document);
      await this.renewReconciliationLease(checkoutId, lease);
      current = await this.requireCheckout(checkoutId);
      this.assertReconciliationLease(current.document, lease);
      switch (current.document.state) {
        case CheckoutState.CREATE_ORDER_REQUESTED:
        case CheckoutState.RECONCILE_CREATE_ORDER_UNKNOWN:
          await this.createPayPalOrder(
            current,
            this.checkoutCapability(current.document.id, current.document.capabilityKeyVersion),
            lease
          );
          continue;
        case CheckoutState.AWAITING_APPROVAL:
          if (Date.parse(this.now()) >= Date.parse(current.document.expiresAt)) {
            await this.expireAwaitingApproval(current, lease);
          } else if (!(await this.beginAuthorizationIfApproved(current, lease))) {
            return projectStatus((await this.requireCheckout(checkoutId)).document);
          }
          continue;
        case CheckoutState.AUTHORIZE_REQUESTED:
          await this.authorize(current, lease);
          continue;
        case CheckoutState.RECONCILE_AUTHORIZE_UNKNOWN:
          await this.reconcileAuthorize(current, lease);
          continue;
        case CheckoutState.AUTHORIZED:
          await this.transition(
            checkoutId,
            CheckoutState.RESERVING,
            { nextActionAt: this.now() },
            lease
          );
          continue;
        case CheckoutState.RESERVING:
          await this.reserveBasket(current, lease);
          continue;
        case CheckoutState.RESERVED:
          await this.transition(
            checkoutId,
            CheckoutState.CAPTURE_REQUESTED,
            { nextActionAt: addMilliseconds(this.now(), PROVIDER_RETRY_MS) },
            lease
          );
          continue;
        case CheckoutState.CAPTURE_REQUESTED:
          await this.capture(current, lease);
          continue;
        case CheckoutState.RECONCILE_CAPTURE_UNKNOWN:
          await this.reconcileCapture(current, lease);
          continue;
        case CheckoutState.CAPTURED_PENDING_COMMIT:
        case CheckoutState.RECONCILE_CAPTURED:
          await this.transition(
            checkoutId,
            CheckoutState.COMMITTING,
            { nextActionAt: addMilliseconds(this.now(), COMMIT_RETRY_MS) },
            lease
          );
          continue;
        case CheckoutState.COMMITTING:
          await this.commitBasket(current, lease);
          continue;
        case CheckoutState.NEVER_CAPTURE_VOID_REQUESTED:
          await this.voidAuthorization(current, lease);
          continue;
        case CheckoutState.RECONCILE_VOID_UNKNOWN:
          await this.reconcileVoid(current, lease);
          continue;
        case CheckoutState.CONFIRMED_NON_CAPTURABLE:
          await this.releaseBasket(current, lease);
          continue;
        default:
          throw new CheckoutServiceError('provider-unavailable', true);
      }
    }
    throw new CheckoutServiceError('conflict', true);
  }

  private async lookupIdempotency(
    idempotencyKey: string,
    requestFingerprint: string,
    fingerprintBinding: IdempotencyFingerprintBinding
  ): Promise<{
    readonly keyHash: string;
    readonly keyVersion: string;
    readonly lookup: Awaited<ReturnType<CheckoutRepository['lookupIdempotency']>>;
  }> {
    const versions = [
      this.deps.config.idempotencyKeyVersion,
      ...Object.keys(this.deps.secrets.idempotencyHmacKeys).filter(
        (version) => version !== this.deps.config.idempotencyKeyVersion
      ),
    ];
    for (const keyVersion of versions) {
      const keyHash = keyedDigest(
        secretFor(
          this.deps.secrets.idempotencyHmacKeys,
          keyVersion,
          'Checkout idempotency HMAC key'
        ),
        `store\0${this.deps.config.storeId}\0idempotency\0${idempotencyKey}`
      );
      const lookup = await this.deps.checkouts.lookupIdempotency({
        keyHash,
        keyVersion,
        requestFingerprint,
        ...fingerprintBinding,
      });
      if (lookup.outcome !== 'missing') return { keyHash, keyVersion, lookup };
    }
    const keyVersion = this.deps.config.idempotencyKeyVersion;
    return {
      keyVersion,
      keyHash: keyedDigest(
        secretFor(
          this.deps.secrets.idempotencyHmacKeys,
          keyVersion,
          'Checkout idempotency HMAC key'
        ),
        `store\0${this.deps.config.storeId}\0idempotency\0${idempotencyKey}`
      ),
      lookup: { outcome: 'missing' },
    };
  }

  private fingerprintBinding(
    customerBinding: CheckoutCustomerBinding
  ): IdempotencyFingerprintBinding {
    if (this.deps.config.checkoutV2WritesEnabled === true) {
      return {
        requestFingerprintVersion: CHECKOUT_FINGERPRINT_VERSION_V2,
        customerBinding,
      };
    }
    // Compatibility release: anonymous requests continue to write/read exact V1.
    // An authenticated request is deliberately V2-shaped even while writes are off,
    // so it conflicts with (and can never inherit) a V1 item-only claim.
    return customerBinding.kind === 'guest'
      ? {}
      : {
          requestFingerprintVersion: CHECKOUT_FINGERPRINT_VERSION_V2,
          customerBinding,
        };
  }

  private async resumeCreateReplay(
    checkoutId: string,
    checkoutToken: string,
    expected: {
      readonly keyHash: string;
      readonly keyVersion: string;
      readonly requestFingerprint: string;
      readonly fingerprintBinding: IdempotencyFingerprintBinding;
      readonly quote: CheckoutQuote;
      readonly now: string;
    }
  ): Promise<CreatedCheckoutProjection> {
    const existing = await this.deps.checkouts.read(checkoutId);
    if (existing === null) {
      const recovered = this.newCheckout(
        checkoutId,
        checkoutToken,
        expected.keyHash,
        expected.keyVersion,
        expected.requestFingerprint,
        expected.fingerprintBinding,
        expected.quote,
        expected.now
      );
      if ((await this.deps.checkouts.create(recovered)) === 'conflict') {
        return this.resumeCreateReplay(checkoutId, checkoutToken, expected);
      }
      const requested = await this.transition(checkoutId, CheckoutState.CREATE_ORDER_REQUESTED, {
        nextActionAt: addMilliseconds(expected.now, CREATE_RETRY_MS),
      });
      return this.createPayPalOrder(requested, checkoutToken);
    }
    this.assertCreateReplayBindings(existing.document, expected);
    switch (existing.document.state) {
      case CheckoutState.CREATING: {
        const requested = await this.transition(checkoutId, CheckoutState.CREATE_ORDER_REQUESTED, {
          nextActionAt: addMilliseconds(this.now(), CREATE_RETRY_MS),
        });
        return this.createPayPalOrder(requested, checkoutToken);
      }
      case CheckoutState.CREATE_ORDER_REQUESTED:
      case CheckoutState.RECONCILE_CREATE_ORDER_UNKNOWN:
        return this.createPayPalOrder(existing, checkoutToken);
      case CheckoutState.AWAITING_APPROVAL:
        return createdProjection(existing.document, checkoutToken);
      default:
        if (existing.document.paypalOrderId !== null) {
          return createdProjection(existing.document, checkoutToken);
        }
        throw new CheckoutServiceError(
          isTerminalCheckoutState(existing.document.state) ? 'manual-review' : 'conflict',
          !isTerminalCheckoutState(existing.document.state)
        );
    }
  }

  private newCheckout(
    checkoutId: string,
    checkoutToken: string,
    keyHash: string,
    keyVersion: string,
    requestFingerprint: string,
    fingerprintBinding: IdempotencyFingerprintBinding,
    quote: CheckoutQuote,
    now: string
  ): CheckoutDocument {
    const versioned =
      fingerprintBinding.requestFingerprintVersion === CHECKOUT_FINGERPRINT_VERSION_V2
        ? {
            schemaVersion: CHECKOUT_SCHEMA_VERSION_V2,
            requestFingerprintVersion: CHECKOUT_FINGERPRINT_VERSION_V2,
            customerBinding: fingerprintBinding.customerBinding,
            loyalty: loyaltyObligation(
              fingerprintBinding.customerBinding,
              quote.totalMinorUnits,
              this.deps.config.customerLoyaltyEnabled === true,
              now
            ),
          }
        : {};
    return {
      id: checkoutId,
      kind: 'checkout',
      idempotencyKeyHash: keyHash,
      idempotencyKeyVersion: keyVersion,
      requestFingerprint,
      ...versioned,
      capabilityTokenHash: this.capabilityHash(checkoutToken),
      capabilityKeyVersion: this.deps.config.capabilityKeyVersion,
      storeId: this.deps.config.storeId,
      expectedPayPalMerchantId: this.deps.config.expectedPayPalMerchantId,
      state: CheckoutState.CREATING,
      quote,
      paypalOrderId: null,
      paypalAuthorizationId: null,
      paypalCaptureId: null,
      paypalRequestIds: {
        createOrder: operationRequestId(checkoutId, 'create'),
        authorizeOrder: operationRequestId(checkoutId, 'authorize'),
        captureAuthorization: operationRequestId(checkoutId, 'capture'),
        voidAuthorization: operationRequestId(checkoutId, 'void'),
      },
      receipt: null,
      lastFailure: null,
      attempts: 0,
      nextActionAt: now,
      lease: null,
      createdAt: now,
      updatedAt: now,
      expiresAt: addMilliseconds(now, CHECKOUT_LIFETIME_MS),
    };
  }

  private assertCreateReplayBindings(
    checkout: CheckoutDocument,
    expected: {
      readonly keyHash: string;
      readonly keyVersion: string;
      readonly requestFingerprint: string;
      readonly fingerprintBinding: IdempotencyFingerprintBinding;
      readonly quote: CheckoutQuote;
    }
  ): void {
    if (
      checkout.idempotencyKeyHash !== expected.keyHash ||
      checkout.idempotencyKeyVersion !== expected.keyVersion ||
      checkout.requestFingerprint !== expected.requestFingerprint ||
      !checkoutMatchesFingerprintBinding(checkout, expected.fingerprintBinding) ||
      checkout.storeId !== this.deps.config.storeId ||
      checkout.expectedPayPalMerchantId !== this.deps.config.expectedPayPalMerchantId ||
      checkout.quote.currency !== expected.quote.currency ||
      checkout.quote.taxRateBasisPoints !== expected.quote.taxRateBasisPoints ||
      !checkoutQuotesEqual(checkout.quote, expected.quote) ||
      !constantTimeEqual(
        checkout.capabilityTokenHash,
        this.capabilityHash(
          this.checkoutCapability(checkout.id, checkout.capabilityKeyVersion),
          checkout.capabilityKeyVersion
        )
      )
    ) {
      throw new CheckoutServiceError('conflict');
    }
  }

  private async createPayPalOrder(
    checkout: VersionedCheckout,
    checkoutToken: string,
    lease?: CheckoutReconciliationLease
  ): Promise<CreatedCheckoutProjection> {
    let order: PayPalOrderSnapshot;
    if (lease !== undefined)
      await this.assertLeaseBeforeProviderMutation(checkout.document.id, lease);
    try {
      order = await this.deps.paypal.createOrder({
        checkoutId: checkout.document.id,
        quote: checkout.document.quote,
        expectedMerchantId: checkout.document.expectedPayPalMerchantId,
        requestId: checkout.document.paypalRequestIds.createOrder,
      });
    } catch (error) {
      await this.recordProviderFailure(
        checkout.document.id,
        error,
        CheckoutState.RECONCILE_CREATE_ORDER_UNKNOWN,
        CheckoutState.MANUAL_REVIEW_CREATE_UNKNOWN,
        lease
      );
      throw providerServiceError(error);
    }
    if (lease !== undefined) await this.assertLeaseBeforeLocalMutation(checkout.document.id, lease);
    try {
      verifyPayPalOrder(order, {
        ...expectedFacts(checkout.document),
        allowedStatuses: CREATED_OR_APPROVED_ORDER_STATUSES,
      });
      await this.bindReference('order', order.id, checkout.document.id);
    } catch (error) {
      if (error instanceof CheckoutProviderBindingPersistenceError) {
        await this.recordProviderFailure(
          checkout.document.id,
          error,
          CheckoutState.RECONCILE_CREATE_ORDER_UNKNOWN,
          CheckoutState.MANUAL_REVIEW_CREATE_UNKNOWN,
          lease
        );
      } else {
        await this.recordProviderMismatch(
          checkout.document.id,
          error,
          CheckoutState.MANUAL_REVIEW_CREATE_UNKNOWN,
          lease
        );
      }
      throw providerServiceError(error);
    }
    const next = await this.transition(
      checkout.document.id,
      CheckoutState.AWAITING_APPROVAL,
      {
        paypalOrderId: order.id,
        nextActionAt: checkout.document.expiresAt,
        lastFailure: null,
      },
      lease
    );
    return createdProjection(next.document, checkoutToken);
  }

  private async beginAuthorizationIfApproved(
    checkout: VersionedCheckout,
    lease: CheckoutReconciliationLease
  ): Promise<boolean> {
    const orderId = requiredProviderId(checkout.document.paypalOrderId);
    let order: PayPalOrderSnapshot;
    await this.assertLeaseBeforeProviderMutation(checkout.document.id, lease);
    try {
      order = await this.deps.paypal.getOrder(orderId);
    } catch (error) {
      if (isRetryableProviderError(error)) {
        await this.recordProviderRetrievalFailure(
          checkout.document.id,
          error,
          CheckoutState.AWAITING_APPROVAL,
          CheckoutState.MANUAL_REVIEW_AWAITING_APPROVAL,
          lease
        );
      } else {
        await this.recordProviderMismatch(
          checkout.document.id,
          error,
          CheckoutState.MANUAL_REVIEW_AWAITING_APPROVAL,
          lease
        );
      }
      throw providerServiceError(error);
    }
    await this.assertLeaseBeforeLocalMutation(checkout.document.id, lease);
    let unit;
    try {
      unit = verifyPayPalOrder(order, {
        ...expectedFacts(checkout.document),
        orderId,
        allowedStatuses: CREATED_OR_APPROVED_ORDER_STATUSES,
      });
    } catch (error) {
      await this.recordProviderMismatch(
        checkout.document.id,
        error,
        CheckoutState.MANUAL_REVIEW_AWAITING_APPROVAL,
        lease
      );
      throw providerServiceError(error);
    }
    if (unit.authorizations.length > 0) {
      await this.transition(
        checkout.document.id,
        CheckoutState.MANUAL_REVIEW_AWAITING_APPROVAL,
        {
          lastFailure: failure('authorization-without-request', false, this.now()),
          nextActionAt: null,
          lease: null,
        },
        lease
      );
      throw new CheckoutServiceError('manual-review');
    }
    if (order.status !== PayPalOrderStatus.APPROVED) return false;
    return this.beginAuthorizationBeforeExpiry(checkout.document.id, lease);
  }

  private async beginAuthorizationBeforeExpiry(
    checkoutId: string,
    lease: CheckoutReconciliationLease
  ): Promise<boolean> {
    for (let attempt = 0; attempt < CAS_ATTEMPTS; attempt += 1) {
      const current = await this.requireCheckout(checkoutId);
      if (current.document.state !== CheckoutState.AWAITING_APPROVAL) {
        throw new CheckoutServiceError('conflict', true);
      }
      const now = this.now();
      const expired = Date.parse(now) >= Date.parse(current.document.expiresAt);
      const next: CheckoutDocument = {
        ...current.document,
        state: expired ? CheckoutState.EXPIRED : CheckoutState.AUTHORIZE_REQUESTED,
        nextActionAt: expired ? null : addMilliseconds(now, PROVIDER_RETRY_MS),
        lease: expired ? null : current.document.lease,
        updatedAt: now,
      };
      if (
        (await this.deps.checkouts.compareAndSwap(checkoutId, next, current.revision, {
          ownerId: lease.ownerId,
          leaseId: lease.leaseId,
          nowIso: now,
        })) === 'written'
      ) {
        return !expired;
      }
    }
    throw new CheckoutServiceError('conflict', true);
  }

  private async authorize(
    checkout: VersionedCheckout,
    lease: CheckoutReconciliationLease
  ): Promise<void> {
    const orderId = requiredProviderId(checkout.document.paypalOrderId);
    let order: PayPalOrderSnapshot;
    await this.assertLeaseBeforeProviderMutation(checkout.document.id, lease);
    try {
      order = await this.deps.paypal.authorizeOrder(
        orderId,
        checkout.document.paypalRequestIds.authorizeOrder
      );
    } catch (error) {
      await this.recordProviderFailure(
        checkout.document.id,
        error,
        CheckoutState.RECONCILE_AUTHORIZE_UNKNOWN,
        CheckoutState.MANUAL_REVIEW_AUTHORIZE_UNKNOWN,
        lease
      );
      throw providerServiceError(error);
    }
    await this.assertLeaseBeforeLocalMutation(checkout.document.id, lease);
    try {
      await this.acceptAuthorization(checkout.document, order, lease);
    } catch (error) {
      if (error instanceof CheckoutServiceError && error.code === 'conflict') throw error;
      if (error instanceof CheckoutProviderBindingPersistenceError) {
        await this.recordProviderFailure(
          checkout.document.id,
          error,
          CheckoutState.RECONCILE_AUTHORIZE_UNKNOWN,
          CheckoutState.MANUAL_REVIEW_AUTHORIZE_UNKNOWN,
          lease
        );
      } else {
        await this.recordProviderMismatch(
          checkout.document.id,
          error,
          CheckoutState.MANUAL_REVIEW_AUTHORIZE_UNKNOWN,
          lease
        );
      }
      throw providerServiceError(error);
    }
  }

  private async reconcileAuthorize(
    checkout: VersionedCheckout,
    lease: CheckoutReconciliationLease
  ): Promise<void> {
    const orderId = requiredProviderId(checkout.document.paypalOrderId);
    try {
      await this.assertLeaseBeforeProviderMutation(checkout.document.id, lease);
      const order = await this.deps.paypal.getOrder(orderId);
      const unit = verifyPayPalOrder(order, {
        ...expectedFacts(checkout.document),
        orderId,
        allowedStatuses: new Set([
          PayPalOrderStatus.APPROVED,
          PayPalOrderStatus.COMPLETED,
          PayPalOrderStatus.VOIDED,
        ]),
      });
      await this.assertLeaseBeforeLocalMutation(checkout.document.id, lease);
      if (unit.authorizations.length === 0 && order.status === PayPalOrderStatus.APPROVED) {
        if (Date.parse(this.now()) >= Date.parse(checkout.document.expiresAt)) {
          await this.transition(
            checkout.document.id,
            CheckoutState.EXPIRED,
            { nextActionAt: null, lease: null },
            lease
          );
        } else {
          await this.transition(
            checkout.document.id,
            CheckoutState.AUTHORIZE_REQUESTED,
            { nextActionAt: this.now() },
            lease
          );
        }
        return;
      }
      await this.acceptAuthorization(checkout.document, order, lease);
    } catch (error) {
      if (error instanceof CheckoutServiceError && error.code === 'conflict') throw error;
      if (isRetryableProviderError(error)) {
        await this.recordProviderRetrievalFailure(
          checkout.document.id,
          error,
          CheckoutState.RECONCILE_AUTHORIZE_UNKNOWN,
          CheckoutState.MANUAL_REVIEW_AUTHORIZE_UNKNOWN,
          lease
        );
      } else {
        await this.recordProviderMismatch(
          checkout.document.id,
          error,
          CheckoutState.MANUAL_REVIEW_AUTHORIZE_UNKNOWN,
          lease
        );
      }
      throw providerServiceError(error);
    }
  }

  private async acceptAuthorization(
    checkout: CheckoutDocument,
    order: PayPalOrderSnapshot,
    lease: CheckoutReconciliationLease
  ): Promise<void> {
    const orderId = requiredProviderId(checkout.paypalOrderId);
    const unit = verifyPayPalOrder(order, {
      ...expectedFacts(checkout),
      orderId,
      allowedStatuses: new Set([PayPalOrderStatus.COMPLETED, PayPalOrderStatus.APPROVED]),
    });
    const authorization = oneOrderAuthorization(unit);
    verifyPayPalAuthorization(authorization, {
      ...expectedFacts(checkout),
      allowedStatuses: CREATED_AUTHORIZATION_STATUSES,
    });
    await this.bindReference('authorization', authorization.id, checkout.id);
    await this.transition(
      checkout.id,
      CheckoutState.AUTHORIZED,
      {
        paypalAuthorizationId: authorization.id,
        nextActionAt: this.now(),
        lastFailure: null,
      },
      lease
    );
  }

  private async reserveBasket(
    checkout: VersionedCheckout,
    lease: CheckoutReconciliationLease
  ): Promise<void> {
    try {
      for (const line of checkout.document.quote.lines) {
        await this.assertLeaseBeforeLocalMutation(checkout.document.id, lease);
        await this.mutateProduct(line.productId, (product) => {
          if (product.isActive === false) throw new CheckoutServiceError('out-of-stock');
          const inventory = reserve(
            checkoutInventoryOf(product),
            checkout.document.id,
            line.quantity,
            this.now()
          );
          return { ...product, ...inventory, updatedAt: this.now() };
        });
      }
      await this.transition(
        checkout.document.id,
        CheckoutState.RESERVED,
        { nextActionAt: this.now(), lastFailure: null },
        lease
      );
    } catch (error) {
      if (isReservationFailure(error)) {
        await this.transition(
          checkout.document.id,
          CheckoutState.NEVER_CAPTURE_VOID_REQUESTED,
          {
            lastFailure: failure(
              error instanceof CheckoutServiceError && error.code === 'conflict'
                ? 'reservation-conflict'
                : 'out-of-stock',
              error instanceof CheckoutServiceError && error.retryable,
              this.now()
            ),
            nextActionAt: this.now(),
          },
          lease
        );
        return;
      }
      throw error;
    }
  }

  private async capture(
    checkout: VersionedCheckout,
    lease: CheckoutReconciliationLease
  ): Promise<void> {
    const authorizationId = requiredProviderId(checkout.document.paypalAuthorizationId);
    let capture: PayPalCaptureSnapshot;
    await this.assertLeaseBeforeProviderMutation(checkout.document.id, lease);
    try {
      capture = await this.deps.paypal.captureAuthorization(
        authorizationId,
        checkout.document.paypalRequestIds.captureAuthorization
      );
    } catch (error) {
      await this.recordProviderFailure(
        checkout.document.id,
        error,
        CheckoutState.RECONCILE_CAPTURE_UNKNOWN,
        CheckoutState.MANUAL_REVIEW_CAPTURE_UNKNOWN,
        lease
      );
      throw providerServiceError(error);
    }
    await this.assertLeaseBeforeLocalMutation(checkout.document.id, lease);
    try {
      await this.acceptCapture(checkout.document, capture, lease);
    } catch (error) {
      if (error instanceof CheckoutServiceError && error.code === 'conflict') {
        await this.recordProviderFailure(
          checkout.document.id,
          error,
          CheckoutState.RECONCILE_CAPTURE_UNKNOWN,
          CheckoutState.MANUAL_REVIEW_CAPTURE_UNKNOWN,
          lease
        );
        throw error;
      }
      if (error instanceof CheckoutProviderBindingPersistenceError) {
        await this.recordProviderFailure(
          checkout.document.id,
          error,
          CheckoutState.RECONCILE_CAPTURE_UNKNOWN,
          CheckoutState.MANUAL_REVIEW_CAPTURE_UNKNOWN,
          lease
        );
      } else {
        await this.recordProviderMismatch(
          checkout.document.id,
          error,
          CheckoutState.MANUAL_REVIEW_CAPTURE_UNKNOWN,
          lease
        );
      }
      throw providerServiceError(error);
    }
  }

  private async reconcileCapture(
    checkout: VersionedCheckout,
    lease: CheckoutReconciliationLease
  ): Promise<void> {
    await this.assertLeaseBeforeProviderMutation(checkout.document.id, lease);
    if (checkout.document.paypalCaptureId !== null) {
      try {
        const capture = await this.deps.paypal.getCapture(checkout.document.paypalCaptureId);
        await this.assertLeaseBeforeLocalMutation(checkout.document.id, lease);
        await this.acceptCapture(checkout.document, capture, lease);
        return;
      } catch (error) {
        await this.recordCaptureReconciliationFailure(checkout.document.id, error, lease);
        throw providerServiceError(error);
      }
    }
    const authorizationId = requiredProviderId(checkout.document.paypalAuthorizationId);
    try {
      const authorization = await this.deps.paypal.getAuthorization(authorizationId);
      await this.assertLeaseBeforeLocalMutation(checkout.document.id, lease);
      if (authorization.status === PayPalAuthorizationStatus.CAPTURED) {
        if (authorization.relatedCaptureId === null) {
          await this.transition(
            checkout.document.id,
            CheckoutState.MANUAL_REVIEW_CAPTURE_UNKNOWN,
            {
              lastFailure: failure('capture-id-unknown', false, this.now()),
              nextActionAt: null,
              lease: null,
            },
            lease
          );
          throw new CheckoutServiceError('manual-review');
        }
        await this.assertLeaseBeforeProviderMutation(checkout.document.id, lease);
        const capture = await this.deps.paypal.getCapture(authorization.relatedCaptureId);
        await this.assertLeaseBeforeLocalMutation(checkout.document.id, lease);
        await this.acceptCapture(checkout.document, capture, lease);
        return;
      }
      verifyPayPalAuthorization(authorization, {
        ...expectedFacts(checkout.document),
        authorizationId,
        allowedStatuses: new Set([
          PayPalAuthorizationStatus.CREATED,
          PayPalAuthorizationStatus.VOIDED,
          PayPalAuthorizationStatus.DENIED,
        ]),
      });
      if (authorization.status === PayPalAuthorizationStatus.CREATED) {
        await this.transition(
          checkout.document.id,
          CheckoutState.CAPTURE_REQUESTED,
          { nextActionAt: this.now() },
          lease
        );
      } else {
        await this.transition(
          checkout.document.id,
          CheckoutState.CONFIRMED_NON_CAPTURABLE,
          { nextActionAt: this.now() },
          lease
        );
      }
    } catch (error) {
      await this.recordCaptureReconciliationFailure(checkout.document.id, error, lease);
      throw providerServiceError(error);
    }
  }

  private async recordCaptureReconciliationFailure(
    checkoutId: string,
    error: unknown,
    lease: CheckoutReconciliationLease
  ): Promise<void> {
    if (error instanceof CheckoutServiceError) throw error;
    if (isRetryableProviderError(error)) {
      await this.recordProviderRetrievalFailure(
        checkoutId,
        error,
        CheckoutState.RECONCILE_CAPTURE_UNKNOWN,
        CheckoutState.MANUAL_REVIEW_CAPTURE_UNKNOWN,
        lease
      );
      return;
    }
    await this.recordProviderMismatch(
      checkoutId,
      error,
      CheckoutState.MANUAL_REVIEW_CAPTURE_UNKNOWN,
      lease
    );
  }

  private async acceptCapture(
    checkout: CheckoutDocument,
    capture: PayPalCaptureSnapshot,
    lease: CheckoutReconciliationLease
  ): Promise<void> {
    verifyPayPalCapture(capture, {
      ...expectedFacts(checkout),
      allowedStatuses: COMPLETED_CAPTURE_STATUSES,
    });
    await this.bindReference('capture', capture.id, checkout.id);
    await this.transition(
      checkout.id,
      CheckoutState.CAPTURED_PENDING_COMMIT,
      {
        paypalCaptureId: capture.id,
        nextActionAt: this.now(),
        lastFailure: null,
      },
      lease
    );
  }

  private async commitBasket(
    checkout: VersionedCheckout,
    lease: CheckoutReconciliationLease
  ): Promise<void> {
    const captureId = requiredProviderId(checkout.document.paypalCaptureId);
    const completedAt = this.now();
    try {
      for (const line of checkout.document.quote.lines) {
        await this.assertLeaseBeforeLocalMutation(checkout.document.id, lease);
        await this.mutateProduct(line.productId, (product) => {
          const inventory = commit(checkoutInventoryOf(product), checkout.document.id, completedAt);
          return { ...product, ...inventory, updatedAt: completedAt };
        });
      }
      await this.assertLeaseBeforeLocalMutation(checkout.document.id, lease);
      const v2 = checkout.document.schemaVersion === CHECKOUT_SCHEMA_VERSION_V2;
      const customer =
        v2 && checkout.document.customerBinding?.kind === 'customer'
          ? {
              customerKey: checkout.document.customerBinding.customerKey,
              keyVersion: checkout.document.customerBinding.keyVersion,
            }
          : null;
      const persisted = await persistCheckoutTransaction(this.deps.transactions, {
        checkoutId: checkout.document.id,
        paypalCaptureId: captureId,
        storeId: checkout.document.storeId,
        quote: checkout.document.quote,
        completedAt,
        ...(v2
          ? {
              schemaVersion: CHECKOUT_TRANSACTION_SCHEMA_VERSION_V2,
              customerBinding: customer,
            }
          : {}),
      });
      const receipt: CheckoutReceiptProjection = v2
        ? {
            transactionId: persisted.transaction.id,
            checkoutId: checkout.document.id,
            quote: checkout.document.quote,
            paypalCaptureId: captureId,
            completedAt: persisted.transaction.timestamp,
            schemaVersion: CHECKOUT_SCHEMA_VERSION_V2,
            requestFingerprintVersion: CHECKOUT_FINGERPRINT_VERSION_V2,
          }
        : {
            transactionId: persisted.transaction.id,
            checkoutId: checkout.document.id,
            quote: checkout.document.quote,
            paypalCaptureId: captureId,
            completedAt: persisted.transaction.timestamp,
          };
      await this.transition(
        checkout.document.id,
        CheckoutState.COMPLETED,
        {
          receipt,
          nextActionAt: null,
          lastFailure: null,
          lease: null,
        },
        lease
      );
    } catch (error) {
      const latest = await this.requireCheckout(checkout.document.id);
      if (latest.document.state === CheckoutState.COMPLETED) return;
      if (latest.document.state === CheckoutState.COMMITTING && isCapturedCommitCorruption(error)) {
        await this.transition(
          checkout.document.id,
          CheckoutState.MANUAL_REVIEW_CAPTURED,
          {
            lastFailure: failure(localCorruptionCode(error), false, this.now()),
            nextActionAt: null,
            lease: null,
          },
          lease
        );
        throw new CheckoutServiceError('manual-review');
      }
      if (latest.document.state === CheckoutState.COMMITTING) {
        await this.transition(
          checkout.document.id,
          CheckoutState.RECONCILE_CAPTURED,
          {
            lastFailure: failure('commit-pending', true, this.now()),
            nextActionAt: addMilliseconds(this.now(), COMMIT_RETRY_MS),
          },
          lease
        );
      }
      throw new CheckoutServiceError('conflict', true);
    }
  }

  private async voidAuthorization(
    checkout: VersionedCheckout,
    lease: CheckoutReconciliationLease
  ): Promise<void> {
    const authorizationId = requiredProviderId(checkout.document.paypalAuthorizationId);
    let authorization: PayPalAuthorizationSnapshot | null;
    await this.assertLeaseBeforeProviderMutation(checkout.document.id, lease);
    try {
      authorization = await this.deps.paypal.voidAuthorization(
        authorizationId,
        checkout.document.paypalRequestIds.voidAuthorization
      );
    } catch (error) {
      await this.recordProviderFailure(
        checkout.document.id,
        error,
        CheckoutState.RECONCILE_VOID_UNKNOWN,
        CheckoutState.MANUAL_REVIEW_AUTHORIZED,
        lease
      );
      throw providerServiceError(error);
    }
    await this.assertLeaseBeforeLocalMutation(checkout.document.id, lease);
    try {
      if (authorization !== null) this.verifyVoided(checkout.document, authorization);
      await this.transition(
        checkout.document.id,
        CheckoutState.CONFIRMED_NON_CAPTURABLE,
        { nextActionAt: this.now(), lastFailure: null },
        lease
      );
    } catch (error) {
      if (error instanceof CheckoutServiceError && error.code === 'conflict') throw error;
      await this.recordProviderMismatch(
        checkout.document.id,
        error,
        CheckoutState.MANUAL_REVIEW_AUTHORIZED,
        lease
      );
      throw providerServiceError(error);
    }
  }

  private async reconcileVoid(
    checkout: VersionedCheckout,
    lease: CheckoutReconciliationLease
  ): Promise<void> {
    const authorizationId = requiredProviderId(checkout.document.paypalAuthorizationId);
    try {
      await this.assertLeaseBeforeProviderMutation(checkout.document.id, lease);
      const authorization = await this.deps.paypal.getAuthorization(authorizationId);
      await this.assertLeaseBeforeLocalMutation(checkout.document.id, lease);
      this.verifyVoided(checkout.document, authorization);
      await this.transition(
        checkout.document.id,
        CheckoutState.CONFIRMED_NON_CAPTURABLE,
        { nextActionAt: this.now(), lastFailure: null },
        lease
      );
    } catch (error) {
      if (error instanceof CheckoutServiceError && error.code === 'conflict') throw error;
      if (isRetryableProviderError(error)) {
        await this.recordProviderRetrievalFailure(
          checkout.document.id,
          error,
          CheckoutState.RECONCILE_VOID_UNKNOWN,
          CheckoutState.MANUAL_REVIEW_AUTHORIZED,
          lease
        );
      } else {
        await this.recordProviderMismatch(
          checkout.document.id,
          error,
          CheckoutState.MANUAL_REVIEW_AUTHORIZED,
          lease
        );
      }
      throw providerServiceError(error);
    }
  }

  private verifyVoided(
    checkout: CheckoutDocument,
    authorization: PayPalAuthorizationSnapshot
  ): void {
    verifyPayPalAuthorization(authorization, {
      ...expectedFacts(checkout),
      authorizationId: requiredProviderId(checkout.paypalAuthorizationId),
      allowedStatuses: VOIDED_AUTHORIZATION_STATUSES,
    });
  }

  private async releaseBasket(
    checkout: VersionedCheckout,
    lease: CheckoutReconciliationLease
  ): Promise<void> {
    try {
      for (const line of checkout.document.quote.lines) {
        await this.assertLeaseBeforeLocalMutation(checkout.document.id, lease);
        await this.mutateProduct(line.productId, (product) => {
          const inventory = release(checkoutInventoryOf(product), checkout.document.id);
          return { ...product, ...inventory, updatedAt: this.now() };
        });
      }
      await this.transition(
        checkout.document.id,
        CheckoutState.VOIDED,
        { nextActionAt: null, lease: null },
        lease
      );
    } catch (error) {
      if (!isReservationReleaseCorruption(error)) throw error;
      await this.transition(
        checkout.document.id,
        CheckoutState.MANUAL_REVIEW_AUTHORIZED,
        {
          lastFailure: failure(localCorruptionCode(error), false, this.now()),
          nextActionAt: null,
          lease: null,
        },
        lease
      );
      throw new CheckoutServiceError('manual-review');
    }
  }

  private async expireAwaitingApproval(
    checkout: VersionedCheckout,
    lease: CheckoutReconciliationLease
  ): Promise<void> {
    await this.assertLeaseBeforeProviderMutation(checkout.document.id, lease);
    let order: PayPalOrderSnapshot;
    try {
      order = await this.deps.paypal.getOrder(requiredProviderId(checkout.document.paypalOrderId));
    } catch (error) {
      await this.recordProviderFailure(
        checkout.document.id,
        error,
        CheckoutState.AWAITING_APPROVAL,
        CheckoutState.MANUAL_REVIEW_AWAITING_APPROVAL,
        lease
      );
      throw providerServiceError(error);
    }
    await this.assertLeaseBeforeLocalMutation(checkout.document.id, lease);
    let authorizationCount: number;
    try {
      const unit = verifyPayPalOrder(order, {
        ...expectedFacts(checkout.document),
        orderId: requiredProviderId(checkout.document.paypalOrderId),
        allowedStatuses: new Set([
          PayPalOrderStatus.CREATED,
          PayPalOrderStatus.APPROVED,
          PayPalOrderStatus.PAYER_ACTION_REQUIRED,
          PayPalOrderStatus.VOIDED,
        ]),
      });
      authorizationCount = unit.authorizations.length;
    } catch (error) {
      await this.recordProviderMismatch(
        checkout.document.id,
        error,
        CheckoutState.MANUAL_REVIEW_AWAITING_APPROVAL,
        lease
      );
      throw providerServiceError(error);
    }
    if (authorizationCount > 0) {
      await this.transition(
        checkout.document.id,
        CheckoutState.MANUAL_REVIEW_AWAITING_APPROVAL,
        {
          lastFailure: failure('authorization-without-request', false, this.now()),
          nextActionAt: null,
          lease: null,
        },
        lease
      );
      throw new CheckoutServiceError('manual-review');
    }
    await this.transition(
      checkout.document.id,
      CheckoutState.EXPIRED,
      { nextActionAt: null, lease: null },
      lease
    );
  }

  private async renewReconciliationLease(
    checkoutId: string,
    lease: CheckoutReconciliationLease
  ): Promise<void> {
    const now = this.now();
    const result = await this.deps.checkouts.renewLease({
      checkoutId,
      ownerId: lease.ownerId,
      leaseId: lease.leaseId,
      nowIso: now,
      expiresAtIso: addMilliseconds(now, LEASE_DURATION_MS),
    });
    if (result !== 'written') throw new CheckoutServiceError('conflict', true);
  }

  private assertReconciliationLease(
    checkout: CheckoutDocument,
    lease: CheckoutReconciliationLease
  ): void {
    if (
      checkout.lease?.ownerId !== lease.ownerId ||
      checkout.lease.leaseId !== lease.leaseId ||
      Date.parse(checkout.lease.expiresAt) <= Date.parse(this.now())
    ) {
      throw new CheckoutServiceError('conflict', true);
    }
  }

  private async assertLeaseBeforeProviderMutation(
    checkoutId: string,
    lease: CheckoutReconciliationLease
  ): Promise<void> {
    await this.renewReconciliationLease(checkoutId, lease);
    this.assertReconciliationLease((await this.requireCheckout(checkoutId)).document, lease);
  }

  private async assertLeaseBeforeLocalMutation(
    checkoutId: string,
    lease: CheckoutReconciliationLease
  ): Promise<void> {
    this.assertReconciliationLease((await this.requireCheckout(checkoutId)).document, lease);
  }

  private async recordProviderFailure(
    checkoutId: string,
    error: unknown,
    ambiguousState: State,
    definitiveState: State,
    lease?: CheckoutReconciliationLease
  ): Promise<void> {
    const ambiguous = error instanceof PayPalGatewayError ? error.ambiguous : true;
    const current = await this.requireCheckout(checkoutId);
    const exhausted = current.document.attempts + 1 >= MAX_PROVIDER_ATTEMPTS;
    const terminal = !ambiguous || exhausted;
    await this.transition(
      checkoutId,
      terminal ? definitiveState : ambiguousState,
      {
        lastFailure: failure(providerErrorCode(error), !terminal, this.now()),
        nextActionAt: terminal ? null : providerRetryAt(this.now(), current.document.attempts + 1),
        attemptsIncrement: true,
        ...(terminal ? { lease: null } : {}),
      },
      lease
    );
  }

  private async recordProviderMismatch(
    checkoutId: string,
    error: unknown,
    manualReviewState: State,
    lease?: CheckoutReconciliationLease
  ): Promise<void> {
    if (error instanceof CheckoutServiceError && error.code === 'conflict') throw error;
    await this.transition(
      checkoutId,
      manualReviewState,
      {
        lastFailure: failure(providerErrorCode(error), false, this.now()),
        nextActionAt: null,
        lease: null,
        attemptsIncrement: true,
      },
      lease
    );
  }

  private async recordProviderRetrievalFailure(
    checkoutId: string,
    error: unknown,
    retryState: State,
    terminalState: State,
    lease: CheckoutReconciliationLease
  ): Promise<void> {
    const current = await this.requireCheckout(checkoutId);
    const exhausted = current.document.attempts + 1 >= MAX_PROVIDER_ATTEMPTS;
    await this.transition(
      checkoutId,
      exhausted ? terminalState : retryState,
      {
        lastFailure: failure(providerErrorCode(error), !exhausted, this.now()),
        nextActionAt: exhausted ? null : providerRetryAt(this.now(), current.document.attempts + 1),
        attemptsIncrement: true,
        ...(exhausted ? { lease: null } : {}),
      },
      lease
    );
  }

  private async transition(
    checkoutId: string,
    state: State,
    patch: Partial<CheckoutDocument> & { readonly attemptsIncrement?: boolean },
    lease?: CheckoutReconciliationLease
  ): Promise<VersionedCheckout> {
    for (let attempt = 0; attempt < CAS_ATTEMPTS; attempt += 1) {
      const current = await this.requireCheckout(checkoutId);
      const { attemptsIncrement, ...documentPatch } = patch;
      const updatedAt = this.now();
      const next: CheckoutDocument = {
        ...current.document,
        ...documentPatch,
        state,
        attempts: current.document.attempts + (attemptsIncrement === true ? 1 : 0),
        updatedAt,
      };
      if (
        (await this.deps.checkouts.compareAndSwap(
          checkoutId,
          next,
          current.revision,
          lease === undefined
            ? undefined
            : { ownerId: lease.ownerId, leaseId: lease.leaseId, nowIso: updatedAt }
        )) === 'written'
      ) {
        return this.requireCheckout(checkoutId);
      }
    }
    throw new CheckoutServiceError('conflict', true);
  }

  private async mutateProduct(
    productId: string,
    mutation: (product: ProductDocument) => ProductDocument
  ): Promise<void> {
    for (let attempt = 0; attempt < CAS_ATTEMPTS; attempt += 1) {
      const current = await this.deps.products.read(productId);
      if (current === null) throw new CheckoutProductPersistenceError();
      const next = mutation(current.document);
      if ((await this.deps.products.write(next, current.rev)) === 'written') return;
    }
    throw new CheckoutServiceError('conflict', true);
  }

  private async readProducts(productIds: readonly string[]): Promise<Map<string, ProductDocument>> {
    const products = new Map<string, ProductDocument>();
    for (const productId of productIds) {
      const revision = await this.deps.products.read(productId);
      if (revision === null || revision.document.isActive === false) {
        throw new CheckoutServiceError('bad-request');
      }
      products.set(productId, revision.document);
    }
    return products;
  }

  private async authorizedCheckout(
    checkoutId: string,
    checkoutToken: string
  ): Promise<VersionedCheckout> {
    let id: string;
    let token: string;
    try {
      id = checkoutIdentifier(checkoutId);
      token = boundedHeader(checkoutToken, 'X-Checkout-Token');
    } catch (error) {
      if (error instanceof CheckoutServiceError && error.code === 'bad-request') {
        throw new CheckoutServiceError('not-found');
      }
      throw error;
    }
    const checkout = await this.requireCheckout(id);
    const candidate = this.capabilityHash(token, checkout.document.capabilityKeyVersion);
    if (!constantTimeEqual(candidate, checkout.document.capabilityTokenHash)) {
      throw new CheckoutServiceError('not-found');
    }
    return checkout;
  }

  private async requireCheckout(checkoutId: string): Promise<VersionedCheckout> {
    const checkout = await this.deps.checkouts.read(checkoutIdentifier(checkoutId));
    if (checkout === null) throw new CheckoutServiceError('not-found');
    return checkout;
  }

  private checkoutCapability(
    checkoutId: string,
    keyVersion = this.deps.config.capabilityKeyVersion
  ): string {
    return keyedDigest(
      secretFor(this.deps.secrets.capabilityHmacKeys, keyVersion, 'Checkout capability HMAC key'),
      `version\0${keyVersion}\0checkout\0${checkoutId}`
    );
  }

  private capabilityHash(
    token: string,
    keyVersion = this.deps.config.capabilityKeyVersion
  ): string {
    return keyedDigest(
      secretFor(this.deps.secrets.capabilityHmacKeys, keyVersion, 'Checkout capability HMAC key'),
      `version\0${keyVersion}\0capability\0${token}`
    );
  }

  private async bindReference(
    referenceKind: 'order' | 'authorization' | 'capture',
    referenceId: string,
    checkoutId: string
  ): Promise<void> {
    let binding: BindingResult;
    try {
      binding = await this.deps.checkouts.bindProviderReference({
        referenceKind,
        referenceId,
        checkoutId,
        nowIso: this.now(),
      });
    } catch {
      throw new CheckoutProviderBindingPersistenceError();
    }
    assertBinding(binding);
  }

  private now(): string {
    const value = this.deps.nowIso();
    const epoch = Date.parse(value);
    if (!Number.isFinite(epoch) || new Date(epoch).toISOString() !== value) {
      throw new Error('Checkout clock must return canonical UTC ISO timestamps.');
    }
    return value;
  }
}

function createdProjection(
  checkout: CheckoutDocument,
  checkoutToken: string
): CreatedCheckoutProjection {
  return {
    checkoutId: checkout.id,
    paypalOrderId: requiredProviderId(checkout.paypalOrderId),
    checkoutToken,
    state: 'awaiting-approval',
    quote: checkout.quote,
  };
}

function projectStatus(checkout: CheckoutDocument): CheckoutStatusProjection {
  return {
    checkoutId: checkout.id,
    state: checkout.state,
    quote: checkout.quote,
    paypalOrderId: checkout.paypalOrderId,
    receipt: checkout.receipt,
    loyalty: publicCheckoutLoyalty(checkout.loyalty),
    failure:
      checkout.lastFailure === null
        ? null
        : { code: checkout.lastFailure.code, retryable: checkout.lastFailure.retryable },
  };
}

function expectedFacts(checkout: CheckoutDocument): {
  checkoutId: string;
  quote: CheckoutQuote;
  merchantId: string;
} {
  return {
    checkoutId: checkout.id,
    quote: checkout.quote,
    merchantId: checkout.expectedPayPalMerchantId,
  };
}

function digestCanonicalRequest(
  items: readonly Readonly<{ productId: string; quantity: number }>[],
  customerBinding: CheckoutCustomerBinding,
  v2: boolean
): string {
  const canonical = v2
    ? {
        version: CHECKOUT_FINGERPRINT_VERSION_V2,
        items: items.map((item) => [item.productId, item.quantity]),
        customerBinding,
      }
    : { items: items.map((item) => [item.productId, item.quantity]) };
  return createHash('sha256').update(JSON.stringify(canonical)).digest('base64url');
}

function checkoutCustomerBinding(customer: CustomerPrincipal | null): CheckoutCustomerBinding {
  return customer === null ? { kind: 'guest' } : { kind: 'customer', ...customer };
}

function checkoutMatchesFingerprintBinding(
  checkout: CheckoutDocument,
  expected: IdempotencyFingerprintBinding
): boolean {
  if (expected.requestFingerprintVersion !== CHECKOUT_FINGERPRINT_VERSION_V2) {
    return checkout.schemaVersion === undefined;
  }
  if (
    checkout.schemaVersion !== CHECKOUT_SCHEMA_VERSION_V2 ||
    checkout.requestFingerprintVersion !== CHECKOUT_FINGERPRINT_VERSION_V2 ||
    checkout.customerBinding === undefined
  ) {
    return false;
  }
  return JSON.stringify(checkout.customerBinding) === JSON.stringify(expected.customerBinding);
}

function loyaltyObligation(
  binding: CheckoutCustomerBinding,
  totalMinorUnits: number,
  enabled: boolean,
  now: string
): CheckoutLoyaltyProjection {
  if (!enabled || binding.kind === 'guest') return { status: 'not-applicable' };
  const pointsEarned = pointsForSelfCheckout(totalMinorUnits);
  return {
    status: pointsEarned === 0 ? 'awarded' : 'pending',
    customerKey: binding.customerKey,
    pointsEarned,
    policyVersion: SELF_CHECKOUT_LOYALTY_POLICY_VERSION,
    nextActionAt: pointsEarned === 0 ? null : now,
    attempts: 0,
    lease: null,
  };
}

function publicCheckoutLoyalty(
  loyalty: CheckoutLoyaltyProjection | undefined
): PublicCheckoutLoyalty {
  if (loyalty === undefined || loyalty.status === 'not-applicable') {
    return { status: 'not-applicable' };
  }
  return {
    status: loyalty.status,
    pointsEarned: loyalty.pointsEarned,
    policyVersion: loyalty.policyVersion,
  };
}

function keyedDigest(key: string, value: string): string {
  return createHmac('sha256', key).update(value).digest('base64url');
}

function constantTimeEqual(left: string, right: string): boolean {
  const leftBytes = Buffer.from(left, 'utf8');
  const rightBytes = Buffer.from(right, 'utf8');
  return leftBytes.length === rightBytes.length && timingSafeEqual(leftBytes, rightBytes);
}

function checkoutIdentifier(value: string): string {
  if (
    typeof value !== 'string' ||
    value.length < 1 ||
    value.length > 200 ||
    value.startsWith('checkout-claim:') ||
    /[\u0000-\u001f\u007f]/.test(value)
  ) {
    throw new CheckoutServiceError('bad-request');
  }
  return value;
}

function reconciliationIdentifier(value: string, label: string): string {
  if (
    typeof value !== 'string' ||
    value.length < 1 ||
    value.length > 200 ||
    /[\u0000-\u001f\u007f]/.test(value)
  ) {
    throw new CheckoutServiceError('bad-request');
  }
  void label;
  return value;
}

function operationRequestId(checkoutId: string, operation: string): string {
  return createHash('sha256').update(`capy-pos\0${checkoutId}\0${operation}`).digest('base64url');
}

function boundedHeader(value: string, label: string): string {
  if (
    typeof value !== 'string' ||
    value.length < 16 ||
    value.length > 500 ||
    /[\u0000-\u001f\u007f]/.test(value)
  ) {
    throw new CheckoutServiceError('bad-request');
  }
  void label;
  return value;
}

function addMilliseconds(value: string, milliseconds: number): string {
  return new Date(Date.parse(value) + milliseconds).toISOString();
}

function providerRetryAt(now: string, attempts: number): string {
  const exponent = Math.min(Math.max(attempts - 1, 0), 6);
  return addMilliseconds(now, PROVIDER_RETRY_MS * 2 ** exponent);
}

function failure(code: string, retryable: boolean, at: string): CheckoutDocument['lastFailure'] {
  return { code, retryable, at, detail: 'See server telemetry for correlation details.' };
}

function isReservationFailure(error: unknown): boolean {
  return (
    error instanceof CheckoutProductPersistenceError ||
    (error instanceof CheckoutInventoryError && error.code === 'insufficient-stock') ||
    (error instanceof CheckoutServiceError &&
      (error.code === 'out-of-stock' || error.code === 'conflict'))
  );
}

function isCapturedCommitCorruption(error: unknown): boolean {
  return (
    error instanceof CheckoutTransactionCorruptionError ||
    error instanceof CheckoutProductPersistenceError ||
    error instanceof CheckoutInventoryError
  );
}

function isReservationReleaseCorruption(error: unknown): boolean {
  return (
    error instanceof CheckoutProductPersistenceError || error instanceof CheckoutInventoryError
  );
}

function localCorruptionCode(error: unknown): string {
  if (error instanceof CheckoutTransactionCorruptionError) {
    return error.code === 'binding-conflict'
      ? 'transaction-binding-conflict'
      : 'transaction-invalid-record';
  }
  if (error instanceof CheckoutProductPersistenceError) return 'product-missing';
  if (error instanceof CheckoutInventoryError) return `inventory-${error.code}`;
  return 'local-corruption';
}

function providerErrorCode(error: unknown): string {
  if (error instanceof PayPalGatewayError) return `paypal-${error.code}`;
  if (error instanceof PayPalFactMismatchError) return `paypal-fact-${error.code}`;
  if (error instanceof CheckoutProviderBindingPersistenceError) return error.code;
  if (error instanceof CheckoutProviderBindingCollisionError) return error.code;
  return 'paypal-unknown';
}

function isRetryableProviderError(error: unknown): boolean {
  return (
    (error instanceof PayPalGatewayError && error.retryable) ||
    error instanceof CheckoutProviderBindingPersistenceError
  );
}

function providerServiceError(error: unknown): CheckoutServiceError {
  if (error instanceof CheckoutServiceError) return error;
  const retryable = isRetryableProviderError(error);
  return new CheckoutServiceError(retryable ? 'provider-unavailable' : 'manual-review', retryable);
}

function assertBinding(binding: BindingResult): void {
  if (binding.outcome === 'conflict' || binding.outcome === 'digest-collision') {
    throw new CheckoutProviderBindingCollisionError(binding.outcome);
  }
}

function requiredProviderId(value: string | null): string {
  if (value === null) throw new CheckoutServiceError('manual-review');
  return value;
}

function secretFor(
  keys: Readonly<Record<string, string>>,
  keyVersion: string,
  label: string
): string {
  const value = keys[keyVersion];
  if (typeof value !== 'string' || value.length < 32) {
    throw new Error(`${label} version is unavailable or too short.`);
  }
  return value;
}
