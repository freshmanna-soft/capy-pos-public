import { Injectable, inject } from '@angular/core';
import { CartService } from '@core/application/services/cart.service';
import { PaymentResult } from '@features/pos-terminal/components/checkout/checkout.component';
import { environment } from '../../../../environments/environment';

/** sessionStorage key used by ShopComponent (ST-2). */
const SESSION_TOKEN_KEY = 'shop-session-token';

/**
 * Thrown when POST /api/transactions returns a non-2xx response or fails
 * with a network error. The calling component catches this to preserve the
 * cart and show a retry banner.
 */
export class RemoteTransactionFailedError extends Error {
  constructor(reason: string) {
    super(`Remote transaction failed: ${reason}`);
    this.name = 'RemoteTransactionFailedError';
  }
}

/**
 * TransactionRemoteService
 *
 * Handles the POST /api/transactions call for both kiosk and shop flows.
 *
 * Token resolution:
 *  - Physical kiosk terminal: caller passes `deviceToken` from Dexie settings.
 *  - Customer phone (/shop):  caller passes `sessionStorage['shop-session-token']`.
 *  - POS terminal (no kiosk): no token → service is a no-op, returns silently.
 *
 * Called from PosFacade.checkout() BEFORE the cart is cleared.
 * On failure, throws `RemoteTransactionFailedError` so the facade rejects
 * and the cart is preserved for retry.
 */
@Injectable({ providedIn: 'root' })
export class TransactionRemoteService {
  private readonly cart = inject(CartService);

  /**
   * Returns the shop-session token from sessionStorage, if present.
   * Used by ShopComponent path; returns null on a physical kiosk or POS.
   */
  getShopSessionToken(): string | null {
    return sessionStorage.getItem(SESSION_TOKEN_KEY);
  }

  /**
   * POST the full basket to /api/transactions.
   *
   * @param paymentResult   Payment result from CheckoutComponent.
   * @param token           Bearer token (kiosk-device or shop-session JWT).
   * @param customerId      Optional — present when a customer signed in.
   * @param customerEmail   Optional — present when a customer signed in.
   *
   * @throws RemoteTransactionFailedError on non-2xx or network error.
   */
  async persistTransaction(
    paymentResult: PaymentResult,
    token: string,
    customerId?: string,
    customerEmail?: string
  ): Promise<void> {
    const items = this.cart.items();
    const subtotal = this.cart.subtotal();
    const tax = this.cart.tax();
    const total = this.cart.total();

    const body = {
      paymentMethod: paymentResult.method,
      subtotal,
      taxAmount: tax,
      total,
      items: items.map((item) => ({
        productId: item.product.id,
        productName: item.product.name,
        quantity: item.quantity,
        unitPrice: item.product.price,
        lineTotal: Math.round(item.product.price * item.quantity * 100) / 100,
      })),
      ...(customerId !== undefined ? { customerId } : {}),
      ...(customerEmail !== undefined ? { customerEmail } : {}),
    };

    let response: Response;
    try {
      response = await fetch(`${environment.apiUrl}/transactions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify(body),
      });
    } catch (err) {
      throw new RemoteTransactionFailedError(err instanceof Error ? err.message : 'Network error');
    }

    if (!response.ok) {
      throw new RemoteTransactionFailedError(`HTTP ${response.status}`);
    }
  }
}
