import {
  AbortError,
  ApiError,
  CheckoutPaymentIntent,
  Client,
  Environment,
  OrdersController,
  PaymentsController,
  ResponseValidationError,
  type CapturedPayment,
  type Order,
  type OrderAuthorizeResponse,
  type PaymentAuthorization,
} from '@paypal/paypal-server-sdk';
import { assertCheckoutQuote, type CheckoutQuote } from './checkout-pricing.ts';

export const PayPalOrderStatus = {
  CREATED: 'CREATED',
  APPROVED: 'APPROVED',
  VOIDED: 'VOIDED',
  COMPLETED: 'COMPLETED',
  PAYER_ACTION_REQUIRED: 'PAYER_ACTION_REQUIRED',
} as const;

export const PayPalAuthorizationStatus = {
  CREATED: 'CREATED',
  CAPTURED: 'CAPTURED',
  DENIED: 'DENIED',
  PARTIALLY_CAPTURED: 'PARTIALLY_CAPTURED',
  VOIDED: 'VOIDED',
  PENDING: 'PENDING',
} as const;

export const PayPalCaptureStatus = {
  COMPLETED: 'COMPLETED',
  DECLINED: 'DECLINED',
  PENDING: 'PENDING',
  FAILED: 'FAILED',
} as const;

export interface PayPalMoneySnapshot {
  readonly currencyCode: string;
  readonly value: string;
}

export interface PayPalAuthorizationSnapshot {
  readonly id: string;
  readonly status: string;
  readonly amount: PayPalMoneySnapshot;
  readonly customId: string | null;
  readonly invoiceId: string | null;
  readonly payeeMerchantId: string | null;
  /** Present after PayPal has linked this authorization to its final capture. */
  readonly relatedCaptureId: string | null;
}

export interface PayPalCaptureSnapshot {
  readonly id: string;
  readonly status: string;
  readonly amount: PayPalMoneySnapshot;
  readonly customId: string | null;
  readonly invoiceId: string | null;
  readonly payeeMerchantId: string | null;
  readonly finalCapture: boolean | null;
}

export interface PayPalPurchaseUnitSnapshot {
  readonly referenceId: string | null;
  readonly customId: string | null;
  readonly invoiceId: string | null;
  readonly amount: PayPalMoneySnapshot;
  readonly payeeMerchantId: string | null;
  readonly authorizations: readonly PayPalAuthorizationSnapshot[];
  readonly captures: readonly PayPalCaptureSnapshot[];
}

export interface PayPalOrderSnapshot {
  readonly id: string;
  readonly intent: string;
  readonly status: string;
  readonly purchaseUnits: readonly PayPalPurchaseUnitSnapshot[];
}

export interface CreatePayPalOrderInput {
  readonly checkoutId: string;
  readonly quote: CheckoutQuote;
  readonly expectedMerchantId: string;
  readonly requestId: string;
}

export interface PayPalGateway {
  createOrder(input: CreatePayPalOrderInput): Promise<PayPalOrderSnapshot>;
  getOrder(orderId: string): Promise<PayPalOrderSnapshot>;
  authorizeOrder(orderId: string, requestId: string): Promise<PayPalOrderSnapshot>;
  getAuthorization(authorizationId: string): Promise<PayPalAuthorizationSnapshot>;
  captureAuthorization(authorizationId: string, requestId: string): Promise<PayPalCaptureSnapshot>;
  getCapture(captureId: string): Promise<PayPalCaptureSnapshot>;
  voidAuthorization(
    authorizationId: string,
    requestId: string
  ): Promise<PayPalAuthorizationSnapshot | null>;
}

export interface ExpectedPayPalCheckoutFacts {
  readonly checkoutId: string;
  readonly quote: CheckoutQuote;
  readonly expectedMerchantId: string;
}

export interface ExpectedPayPalAuthorizationFacts extends ExpectedPayPalCheckoutFacts {
  readonly authorizationId: string;
}

export interface ExpectedPayPalCaptureFacts extends ExpectedPayPalCheckoutFacts {
  readonly captureId: string;
}

export type PayPalGatewayErrorCode =
  | 'aborted'
  | 'authentication'
  | 'conflict'
  | 'forbidden'
  | 'invalid-request'
  | 'malformed-response'
  | 'not-found'
  | 'provider-unavailable'
  | 'rate-limited'
  | 'transport';

export class PayPalGatewayError extends Error {
  readonly code: PayPalGatewayErrorCode;
  readonly ambiguous: boolean;
  readonly retryable: boolean;

  constructor(
    code: PayPalGatewayErrorCode,
    options: { readonly ambiguous: boolean; readonly retryable: boolean }
  ) {
    super(`PayPal operation failed: ${code}.`);
    this.name = 'PayPalGatewayError';
    this.code = code;
    this.ambiguous = options.ambiguous;
    this.retryable = options.retryable;
  }
}

interface PayPalSdkControllers {
  readonly orders: Pick<OrdersController, 'createOrder' | 'getOrder' | 'authorizeOrder'>;
  readonly payments: Pick<
    PaymentsController,
    'getAuthorizedPayment' | 'captureAuthorizedPayment' | 'getCapturedPayment' | 'voidPayment'
  >;
}

export interface PayPalSdkConfig {
  readonly clientId: string;
  readonly clientSecret: string;
  readonly environment: 'sandbox' | 'production';
  readonly timeoutMs: number;
}

export function createPayPalSdkGateway(config: PayPalSdkConfig): PayPalGateway {
  nonEmpty(config.clientId, 'PayPal client id');
  nonEmpty(config.clientSecret, 'PayPal client secret');
  if (!Number.isSafeInteger(config.timeoutMs) || config.timeoutMs < 1) {
    throw new Error('PayPal timeout must be a positive integer.');
  }
  const client = new Client({
    clientCredentialsAuthCredentials: {
      oAuthClientId: config.clientId,
      oAuthClientSecret: config.clientSecret,
    },
    environment: config.environment === 'production' ? Environment.Production : Environment.Sandbox,
    timeout: config.timeoutMs,
    httpClientOptions: {
      timeout: config.timeoutMs,
      retryConfig: { maxNumberOfRetries: 0, retryOnTimeout: false },
    },
  });
  return new PayPalSdkGateway(
    {
      orders: new OrdersController(client),
      payments: new PaymentsController(client),
    },
    config.timeoutMs
  );
}

/** Keeps every generated SDK type and error behind the provider-neutral port above. */
export class PayPalSdkGateway implements PayPalGateway {
  private readonly controllers: PayPalSdkControllers;
  private readonly timeoutMs: number;

  constructor(controllers: PayPalSdkControllers, timeoutMs: number) {
    if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1) {
      throw new Error('PayPal timeout must be a positive integer.');
    }
    this.controllers = controllers;
    this.timeoutMs = timeoutMs;
  }

  async createOrder(input: CreatePayPalOrderInput): Promise<PayPalOrderSnapshot> {
    assertCheckoutFacts(input);
    nonEmpty(input.requestId, 'requestId');
    return this.mutation(async (signal) => {
      const response = await this.controllers.orders.createOrder(
        {
          body: {
            intent: CheckoutPaymentIntent.Authorize,
            purchaseUnits: [
              {
                referenceId: input.checkoutId,
                customId: input.checkoutId,
                invoiceId: input.checkoutId,
                payee: { merchantId: input.expectedMerchantId },
                amount: {
                  currencyCode: input.quote.currency,
                  value: formatMinorUnits(input.quote.totalMinorUnits),
                  breakdown: {
                    itemTotal: {
                      currencyCode: input.quote.currency,
                      value: formatMinorUnits(input.quote.subtotalMinorUnits),
                    },
                    taxTotal: {
                      currencyCode: input.quote.currency,
                      value: formatMinorUnits(input.quote.taxMinorUnits),
                    },
                  },
                },
              },
            ],
          },
          paypalRequestId: input.requestId,
          prefer: 'return=representation',
        },
        { abortSignal: signal }
      );
      return mapOrder(response.result);
    });
  }

  async getOrder(orderId: string): Promise<PayPalOrderSnapshot> {
    nonEmpty(orderId, 'orderId');
    return this.query(async (signal) => {
      const response = await this.controllers.orders.getOrder(
        { id: orderId },
        { abortSignal: signal }
      );
      return mapOrder(response.result);
    });
  }

  async authorizeOrder(orderId: string, requestId: string): Promise<PayPalOrderSnapshot> {
    nonEmpty(orderId, 'orderId');
    nonEmpty(requestId, 'requestId');
    return this.mutation(async (signal) => {
      const response = await this.controllers.orders.authorizeOrder(
        {
          id: orderId,
          paypalRequestId: requestId,
          prefer: 'return=representation',
        },
        { abortSignal: signal }
      );
      return mapOrder(response.result);
    });
  }

  async getAuthorization(authorizationId: string): Promise<PayPalAuthorizationSnapshot> {
    nonEmpty(authorizationId, 'authorizationId');
    return this.query(async (signal) => {
      const response = await this.controllers.payments.getAuthorizedPayment(
        { authorizationId },
        { abortSignal: signal }
      );
      return mapAuthorization(response.result);
    });
  }

  async captureAuthorization(
    authorizationId: string,
    requestId: string
  ): Promise<PayPalCaptureSnapshot> {
    nonEmpty(authorizationId, 'authorizationId');
    nonEmpty(requestId, 'requestId');
    return this.mutation(async (signal) => {
      const response = await this.controllers.payments.captureAuthorizedPayment(
        {
          authorizationId,
          paypalRequestId: requestId,
          prefer: 'return=representation',
          body: { finalCapture: true },
        },
        { abortSignal: signal }
      );
      return mapCapture(response.result);
    });
  }

  async getCapture(captureId: string): Promise<PayPalCaptureSnapshot> {
    nonEmpty(captureId, 'captureId');
    return this.query(async (signal) => {
      const response = await this.controllers.payments.getCapturedPayment(
        { captureId },
        { abortSignal: signal }
      );
      return mapCapture(response.result);
    });
  }

  async voidAuthorization(
    authorizationId: string,
    requestId: string
  ): Promise<PayPalAuthorizationSnapshot | null> {
    nonEmpty(authorizationId, 'authorizationId');
    nonEmpty(requestId, 'requestId');
    return this.mutation(async (signal) => {
      const response = await this.controllers.payments.voidPayment(
        {
          authorizationId,
          paypalRequestId: requestId,
          prefer: 'return=representation',
        },
        { abortSignal: signal }
      );
      return response.result === null ? null : mapAuthorization(response.result);
    });
  }

  private async query<T>(call: (signal: AbortSignal) => Promise<T>): Promise<T> {
    return this.call(call, false);
  }

  private async mutation<T>(call: (signal: AbortSignal) => Promise<T>): Promise<T> {
    return this.call(call, true);
  }

  private async call<T>(call: (signal: AbortSignal) => Promise<T>, mutation: boolean): Promise<T> {
    try {
      return await call(AbortSignal.timeout(this.timeoutMs));
    } catch (error) {
      if (error instanceof PayPalGatewayError) throw error;
      throw classifySdkError(error, mutation);
    }
  }
}

function mapOrder(value: Order | OrderAuthorizeResponse): PayPalOrderSnapshot {
  const id = requiredString(value.id, 'order id');
  const intent = requiredString(value.intent, 'order intent');
  const status = requiredString(value.status, 'order status');
  if (!Array.isArray(value.purchaseUnits) || value.purchaseUnits.length !== 1) {
    malformed('order must contain one purchase unit');
  }
  const purchaseUnits = value.purchaseUnits.map((unit) => {
    const amount = mapMoney(unit.amount, 'purchase-unit amount');
    const authorizations = (unit.payments?.authorizations ?? []).map((authorization) =>
      mapAuthorization(authorization, unit.payee?.merchantId)
    );
    const captures = (unit.payments?.captures ?? []).map((capture) =>
      mapCapture(capture, unit.payee?.merchantId)
    );
    return Object.freeze({
      referenceId: optionalString(unit.referenceId, 'purchase-unit reference id'),
      customId: optionalString(unit.customId, 'purchase-unit custom id'),
      invoiceId: optionalString(unit.invoiceId, 'purchase-unit invoice id'),
      amount,
      payeeMerchantId: optionalString(unit.payee?.merchantId, 'purchase-unit payee merchant id'),
      authorizations: Object.freeze(authorizations),
      captures: Object.freeze(captures),
    });
  });
  return Object.freeze({ id, intent, status, purchaseUnits: Object.freeze(purchaseUnits) });
}

function mapAuthorization(
  value:
    | PaymentAuthorization
    | NonNullable<Order['purchaseUnits']>[number]['payments'] extends infer _
    ? {
        id?: string;
        status?: string;
        amount?: { currencyCode: string; value: string };
        customId?: string;
        invoiceId?: string;
        payee?: { merchantId?: string };
        supplementaryData?: { relatedIds?: { captureId?: string } };
      }
    : never,
  inheritedMerchantId?: string
): PayPalAuthorizationSnapshot {
  return Object.freeze({
    id: requiredString(value.id, 'authorization id'),
    status: requiredString(value.status, 'authorization status'),
    amount: mapMoney(value.amount, 'authorization amount'),
    customId: optionalString(value.customId, 'authorization custom id'),
    invoiceId: optionalString(value.invoiceId, 'authorization invoice id'),
    payeeMerchantId: optionalString(
      'payee' in value ? value.payee?.merchantId : inheritedMerchantId,
      'authorization payee merchant id'
    ),
    relatedCaptureId: optionalString(
      'supplementaryData' in value ? value.supplementaryData?.relatedIds?.captureId : undefined,
      'authorization related capture id'
    ),
  });
}

function mapCapture(
  value:
    | CapturedPayment
    | {
        id?: string;
        status?: string;
        amount?: { currencyCode: string; value: string };
        customId?: string;
        invoiceId?: string;
        payee?: { merchantId?: string };
        finalCapture?: boolean;
      },
  inheritedMerchantId?: string
): PayPalCaptureSnapshot {
  return Object.freeze({
    id: requiredString(value.id, 'capture id'),
    status: requiredString(value.status, 'capture status'),
    amount: mapMoney(value.amount, 'capture amount'),
    customId: optionalString(value.customId, 'capture custom id'),
    invoiceId: optionalString(value.invoiceId, 'capture invoice id'),
    payeeMerchantId: optionalString(
      'payee' in value ? value.payee?.merchantId : inheritedMerchantId,
      'capture payee merchant id'
    ),
    finalCapture:
      value.finalCapture === undefined
        ? null
        : typeof value.finalCapture === 'boolean'
          ? value.finalCapture
          : malformed('capture final-capture flag'),
  });
}

function mapMoney(
  value: { readonly currencyCode?: string; readonly value?: string } | undefined,
  label: string
): PayPalMoneySnapshot {
  if (value === undefined) malformed(label);
  return Object.freeze({
    currencyCode: requiredString(value.currencyCode, `${label} currency`),
    value: requiredString(value.value, `${label} value`),
  });
}

function requiredString(value: unknown, label: string): string {
  if (typeof value !== 'string' || value.length < 1 || value.length > 500) malformed(label);
  return value;
}

function optionalString(value: unknown, label: string): string | null {
  return value === undefined ? null : requiredString(value, label);
}

function malformed(detail: string): never {
  throw new PayPalGatewayError('malformed-response', {
    ambiguous: true,
    retryable: false,
  });
}

export interface ExpectedPayPalFacts {
  readonly checkoutId: string;
  readonly quote: CheckoutQuote;
  readonly merchantId: string;
}

export type PayPalFactMismatchCode =
  | 'authorization-count'
  | 'authorization-id'
  | 'authorization-status'
  | 'capture-id'
  | 'capture-status'
  | 'checkout-binding'
  | 'currency'
  | 'final-capture'
  | 'intent'
  | 'merchant'
  | 'order-id'
  | 'order-status'
  | 'purchase-unit-count'
  | 'total';

/** Safe to surface or log: it contains a fixed code and no provider response data. */
export class PayPalFactMismatchError extends Error {
  readonly code: PayPalFactMismatchCode;

  constructor(code: PayPalFactMismatchCode) {
    super(`PayPal order, authorization, or capture facts did not match checkout: ${code}.`);
    this.name = 'PayPalFactMismatchError';
    this.code = code;
  }
}

export function verifyPayPalOrder(
  order: PayPalOrderSnapshot,
  expected: ExpectedPayPalFacts & {
    readonly orderId?: string;
    readonly allowedStatuses: ReadonlySet<string>;
  }
): PayPalPurchaseUnitSnapshot {
  if (expected.orderId !== undefined && order.id !== expected.orderId) mismatch('order-id');
  if (order.intent !== 'AUTHORIZE') mismatch('intent');
  if (!expected.allowedStatuses.has(order.status)) mismatch('order-status');
  if (order.purchaseUnits.length !== 1) mismatch('purchase-unit-count');
  const unit = order.purchaseUnits[0]!;
  if (
    unit.referenceId !== expected.checkoutId ||
    unit.customId !== expected.checkoutId ||
    unit.invoiceId !== expected.checkoutId
  ) {
    mismatch('checkout-binding');
  }
  verifyMoney(unit.amount, expected.quote);
  if (unit.payeeMerchantId !== expected.merchantId) mismatch('merchant');
  return unit;
}

export function verifyPayPalAuthorization(
  authorization: PayPalAuthorizationSnapshot,
  expected: ExpectedPayPalFacts & {
    readonly authorizationId?: string;
    readonly allowedStatuses: ReadonlySet<string>;
  }
): void {
  if (expected.authorizationId !== undefined && authorization.id !== expected.authorizationId) {
    mismatch('authorization-id');
  }
  if (!expected.allowedStatuses.has(authorization.status)) mismatch('authorization-status');
  verifyPaymentBinding(authorization, expected);
}

export function verifyPayPalCapture(
  capture: PayPalCaptureSnapshot,
  expected: ExpectedPayPalFacts & {
    readonly captureId?: string;
    readonly allowedStatuses: ReadonlySet<string>;
  }
): void {
  if (expected.captureId !== undefined && capture.id !== expected.captureId) {
    mismatch('capture-id');
  }
  if (!expected.allowedStatuses.has(capture.status)) mismatch('capture-status');
  if (capture.finalCapture !== true) mismatch('final-capture');
  verifyPaymentBinding(capture, expected);
}

export function oneOrderAuthorization(
  unit: PayPalPurchaseUnitSnapshot
): PayPalAuthorizationSnapshot {
  if (unit.authorizations.length !== 1) mismatch('authorization-count');
  return unit.authorizations[0]!;
}

function verifyPaymentBinding(
  payment: PayPalAuthorizationSnapshot | PayPalCaptureSnapshot,
  expected: ExpectedPayPalFacts
): void {
  // PayPal's authorization and capture resources do not consistently repeat the
  // purchase unit's custom_id, invoice_id, or payee. The order is the authoritative
  // source for those facts, and its verified resource plus the stored provider-id
  // binding proves which checkout these child resources belong to. When PayPal does
  // repeat a fact it must still match; absence alone is not a mismatch.
  if (
    (payment.customId !== null && payment.customId !== expected.checkoutId) ||
    (payment.invoiceId !== null && payment.invoiceId !== expected.checkoutId)
  ) {
    mismatch('checkout-binding');
  }
  verifyMoney(payment.amount, expected.quote);
  if (payment.payeeMerchantId !== null && payment.payeeMerchantId !== expected.merchantId) {
    mismatch('merchant');
  }
}

function verifyMoney(money: PayPalMoneySnapshot, quote: CheckoutQuote): void {
  if (money.currencyCode !== quote.currency) mismatch('currency');
  if (money.value !== formatMinorUnits(quote.totalMinorUnits)) mismatch('total');
}

function mismatch(code: PayPalFactMismatchCode): never {
  throw new PayPalFactMismatchError(code);
}

export function formatMinorUnits(value: number): string {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new Error('PayPal amount must be a non-negative safe integer.');
  }
  const whole = Math.floor(value / 100);
  return `${whole}.${String(value % 100).padStart(2, '0')}`;
}

function assertCheckoutFacts(input: CreatePayPalOrderInput): void {
  nonEmpty(input.checkoutId, 'checkoutId');
  nonEmpty(input.expectedMerchantId, 'expectedMerchantId');
  assertCheckoutQuote(input.quote);
}

export function assertPayPalOrder(
  order: PayPalOrderSnapshot,
  expected: ExpectedPayPalCheckoutFacts,
  allowedStatuses: readonly string[]
): PayPalOrderSnapshot {
  verifyPayPalOrder(order, {
    checkoutId: expected.checkoutId,
    quote: expected.quote,
    merchantId: expected.expectedMerchantId,
    allowedStatuses: new Set(allowedStatuses),
  });
  return order;
}

export function assertPayPalAuthorization(
  authorization: PayPalAuthorizationSnapshot,
  expected: ExpectedPayPalAuthorizationFacts,
  allowedStatuses: readonly string[]
): PayPalAuthorizationSnapshot {
  verifyPayPalAuthorization(authorization, {
    checkoutId: expected.checkoutId,
    quote: expected.quote,
    merchantId: expected.expectedMerchantId,
    authorizationId: expected.authorizationId,
    allowedStatuses: new Set(allowedStatuses),
  });
  return authorization;
}

export function assertPayPalCapture(
  capture: PayPalCaptureSnapshot,
  expected: ExpectedPayPalCaptureFacts,
  allowedStatuses: readonly string[]
): PayPalCaptureSnapshot {
  verifyPayPalCapture(capture, {
    checkoutId: expected.checkoutId,
    quote: expected.quote,
    merchantId: expected.expectedMerchantId,
    captureId: expected.captureId,
    allowedStatuses: new Set(allowedStatuses),
  });
  return capture;
}

function classifySdkError(error: unknown, mutation: boolean): PayPalGatewayError {
  if (error instanceof AbortError) {
    return new PayPalGatewayError('aborted', {
      ambiguous: mutation,
      retryable: true,
    });
  }
  if (error instanceof ResponseValidationError) {
    return new PayPalGatewayError('malformed-response', {
      ambiguous: mutation,
      retryable: false,
    });
  }
  const status =
    error instanceof ApiError
      ? error.statusCode
      : typeof error === 'object' &&
          error !== null &&
          'statusCode' in error &&
          typeof (error as { statusCode?: unknown }).statusCode === 'number'
        ? (error as { statusCode: number }).statusCode
        : null;
  if (status !== null) {
    if (status === 400 || status === 422) {
      return new PayPalGatewayError('invalid-request', {
        ambiguous: false,
        retryable: false,
      });
    }
    if (status === 401) {
      return new PayPalGatewayError('authentication', {
        ambiguous: false,
        retryable: false,
      });
    }
    if (status === 403) {
      return new PayPalGatewayError('forbidden', {
        ambiguous: false,
        retryable: false,
      });
    }
    if (status === 404) {
      return new PayPalGatewayError('not-found', {
        ambiguous: false,
        retryable: false,
      });
    }
    if (status === 409) {
      return new PayPalGatewayError('conflict', {
        ambiguous: mutation,
        retryable: true,
      });
    }
    if (status === 408 || status === 429) {
      return new PayPalGatewayError(status === 429 ? 'rate-limited' : 'provider-unavailable', {
        ambiguous: mutation,
        retryable: true,
      });
    }
    if (status >= 500) {
      return new PayPalGatewayError('provider-unavailable', {
        ambiguous: mutation,
        retryable: true,
      });
    }
  }
  const code =
    typeof error === 'object' && error !== null && 'code' in error
      ? String((error as { code?: unknown }).code ?? '')
      : '';
  const timedOut = code === 'ECONNABORTED' || code === 'ETIMEDOUT';
  return new PayPalGatewayError(timedOut ? 'provider-unavailable' : 'transport', {
    ambiguous: mutation,
    retryable: true,
  });
}

function nonEmpty(value: unknown, label: string): asserts value is string {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new Error(`${label} is required.`);
  }
}
