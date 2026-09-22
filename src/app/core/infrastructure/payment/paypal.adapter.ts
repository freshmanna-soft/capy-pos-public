import { Injectable } from '@angular/core';
import type { PayPalPort, PayPalPaymentResult } from '@core/application/ports/paypal.port';
import { environment } from '../../../../environments/environment';

/**
 * Shape of the PayPal JS SDK namespace injected by the CDN script.
 * Only the subset used here is declared.
 */
interface PayPalNamespace {
  Buttons(config: PayPalButtonsConfig): PayPalButtonsWidget;
}

interface PayPalButtonsWidget {
  render(selector: string): Promise<void>;
  close(): Promise<void>;
}

interface PayPalButtonsConfig {
  createOrder(): Promise<string>;
  onApprove(data: { orderID: string }): Promise<void>;
  onError(err: unknown): void;
  onCancel(): void;
}

interface BackendOrderResponse {
  id: string;
  status: string;
}

/** Extends Window so TypeScript knows the SDK is injected as a global. */
declare global {
  interface Window {
    paypal?: PayPalNamespace;
  }
}

/**
 * PayPal Payment Adapter — infrastructure layer.
 *
 * Wraps the PayPal JavaScript SDK (loaded via CDN script tag) so the
 * checkout component only depends on the port interface, not this class.
 *
 * Integration flow:
 *  1. `loadSdk()` injects the PayPal JS SDK script once with the configured
 *     client ID. Idempotent — safe to call multiple times.
 *  2. `createAndRender()` renders PayPal Buttons inside the given container,
 *     creates an order on the operator backend via `preferenceApiUrl`, and
 *     resolves when the buyer approves or an error occurs.
 *  3. The operator backend captures the order using the server-side access
 *     token. That secret never enters this browser bundle.
 *  4. `destroy()` calls `buttons.close()` to clean up the widget.
 */
@Injectable()
export class PayPalAdapter implements PayPalPort {
  private sdkLoaded = false;
  private activeWidget: PayPalButtonsWidget | null = null;

  isEnabled(): boolean {
    return environment.paypal.enabled;
  }

  async loadSdk(): Promise<void> {
    if (this.sdkLoaded || window.paypal) {
      this.sdkLoaded = true;
      return;
    }

    const { clientId } = environment.paypal;

    await new Promise<void>((resolve, reject) => {
      const script = document.createElement('script');
      script.src = `https://www.paypal.com/sdk/js?client-id=${clientId}&currency=USD`;
      script.async = true;
      script.onload = () => {
        this.sdkLoaded = true;
        resolve();
      };
      script.onerror = () => reject(new Error('Failed to load PayPal JS SDK'));
      document.head.appendChild(script);
    });
  }

  async createAndRender(amount: number, containerId: string): Promise<PayPalPaymentResult> {
    await this.loadSdk();

    const { preferenceApiUrl } = environment.paypal;

    return new Promise<PayPalPaymentResult>((resolve, reject) => {
      // paypal is guaranteed to be available after loadSdk resolves.
      const paypal = window.paypal!;

      const buttons = paypal.Buttons({
        createOrder: async (): Promise<string> => {
          const response = await fetch(preferenceApiUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ amount }),
          });

          if (!response.ok) {
            throw new Error(`PayPal order creation failed: ${response.status}`);
          }

          const data = (await response.json()) as BackendOrderResponse;
          return data.id;
        },

        onApprove: async (data: { orderID: string }): Promise<void> => {
          resolve({
            status: 'completed',
            orderId: data.orderID,
            amount,
            timestamp: new Date(),
          });
        },

        onError: (err: unknown): void => {
          const message = err instanceof Error ? err.message : 'PayPal payment error';
          reject(new Error(message));
        },

        onCancel: (): void => {
          resolve({
            status: 'failed',
            orderId: '',
            amount,
            timestamp: new Date(),
          });
        },
      });

      this.activeWidget = buttons;

      buttons.render(`#${containerId}`).catch((err: unknown) => {
        const message = err instanceof Error ? err.message : 'PayPal render failed';
        reject(new Error(message));
      });
    });
  }

  destroy(): void {
    if (this.activeWidget) {
      this.activeWidget.close().catch(() => {
        // Ignore close errors — the widget may already be gone.
      });
      this.activeWidget = null;
    }
  }
}
