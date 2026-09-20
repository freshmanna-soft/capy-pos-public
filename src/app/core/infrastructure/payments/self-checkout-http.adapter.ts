import { Injectable, inject } from '@angular/core';
import { CUSTOMER_AUTH_GATEWAY } from '@core/application/auth/ports/customer-auth-gateway.port';
import {
  CreatedSelfCheckout,
  SelfCheckoutGateway,
  SelfCheckoutGatewayError,
  SelfCheckoutItemRequest,
  SelfCheckoutStatus,
} from '@core/application/ports/self-checkout-gateway.port';
import { environment } from '../../../../environments/environment';
import { isCreatedSelfCheckout, isSelfCheckoutStatus } from './self-checkout-response.validation';

interface ErrorBody {
  readonly error?: unknown;
  readonly retryable?: unknown;
}

@Injectable()
export class SelfCheckoutHttpAdapter implements SelfCheckoutGateway {
  private readonly customerAuth = inject(CUSTOMER_AUTH_GATEWAY);
  private readonly endpoint = `${environment.apiUrl}/self-checkout/checkouts`;

  create(
    items: readonly SelfCheckoutItemRequest[],
    idempotencyKey: string
  ): Promise<CreatedSelfCheckout> {
    return this.request(
      this.endpoint,
      {
        method: 'POST',
        headers: { 'Idempotency-Key': idempotencyKey },
        body: JSON.stringify({ items }),
      },
      isCreatedSelfCheckout,
      'create'
    );
  }

  status(checkoutId: string, checkoutToken: string): Promise<SelfCheckoutStatus> {
    return this.request(
      this.checkoutUrl(checkoutId),
      {
        method: 'GET',
        headers: { 'X-Checkout-Token': checkoutToken },
      },
      isSelfCheckoutStatus,
      'status'
    );
  }

  complete(checkoutId: string, checkoutToken: string): Promise<SelfCheckoutStatus> {
    return this.request(
      `${this.checkoutUrl(checkoutId)}/complete`,
      {
        method: 'POST',
        headers: { 'X-Checkout-Token': checkoutToken },
      },
      isSelfCheckoutStatus,
      'complete'
    );
  }

  private checkoutUrl(checkoutId: string): string {
    return `${this.endpoint}/${encodeURIComponent(checkoutId)}`;
  }

  private async request<T>(
    url: string,
    init: RequestInit,
    validate: (value: unknown) => value is T,
    operation: 'create' | 'status' | 'complete'
  ): Promise<T> {
    const headers = new Headers(init.headers);
    headers.set('Content-Type', 'application/json');
    const customerToken = this.customerAuth.getAccessToken();
    if (customerToken !== null) headers.set('Authorization', `Bearer ${customerToken}`);

    let response: Response;
    try {
      response = await fetch(url, { ...init, headers });
    } catch {
      throw new SelfCheckoutGatewayError('network-error', true, true);
    }

    const body: unknown = await response.json().catch(() => ({}));
    if (!response.ok) {
      const error: ErrorBody = typeof body === 'object' && body !== null ? body : {};
      const code = typeof error.error === 'string' ? error.error : `http-${response.status}`;
      throw new SelfCheckoutGatewayError(
        code,
        error.retryable === true,
        response.status >= 500 || isAmbiguousConflict(operation, code),
        response.status
      );
    }
    if (!validate(body)) {
      throw new SelfCheckoutGatewayError('invalid-server-response', false, true, response.status);
    }
    return body;
  }
}

function isAmbiguousConflict(operation: 'create' | 'status' | 'complete', code: string): boolean {
  if (operation === 'status') return false;
  if (operation === 'create') return code === 'conflict';
  return code === 'conflict' || code === 'manual-review' || code === 'checkout-busy';
}
