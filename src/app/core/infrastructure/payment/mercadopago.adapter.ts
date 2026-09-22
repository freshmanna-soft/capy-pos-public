import { Injectable } from '@angular/core';
import { loadMercadoPago } from '@mercadopago/sdk-js';
import type {
  MercadoPagoPort,
  MercadoPagoPaymentResult,
} from '@core/application/ports/mercadopago.port';
import { environment } from '../../../../environments/environment';

/**
 * Shape of the MercadoPago global class injected by the SDK script.
 * Only the subset of the API used here is declared; the full SDK types live on
 * `window.MercadoPago` after the script loads.
 */
interface MercadoPagoInstance {
  bricks(): BricksBuilder;
}

interface BricksBuilder {
  create(brick: string, target: string, settings: BrickSettings): Promise<BrickController>;
}

interface BrickController {
  unmount(): void;
}

interface BrickSettings {
  initialization: { amount: number; preferenceId?: string };
  callbacks: {
    onReady: () => void;
    onError: (error: { type: string; message: string }) => void;
    onSubmit: (formData: CardData) => Promise<void>;
  };
  customization?: Record<string, unknown>;
}

interface CardData {
  token: string;
  issuer_id: string;
  payment_method_id: string;
  transaction_amount: number;
  installments: number;
  payer: { email: string; identification: { type: string; number: string } };
}

interface BackendPaymentResponse {
  id: string;
  status: 'approved' | 'pending' | 'rejected';
}

/** Extends Window so TypeScript knows the SDK is injected as a global. */
declare global {
  interface Window {
    MercadoPago: new (
      publicKey: string,
      options?: { locale?: string; advancedFraudPrevention?: boolean }
    ) => MercadoPagoInstance;
  }
}

/**
 * MercadoPago Payment Adapter — infrastructure layer.
 *
 * Wraps the MercadoPago browser SDK (`@mercadopago/sdk-js`) so the
 * checkout component only depends on the port interface, not on this class.
 *
 * Integration flow:
 *  1. `loadSdk()` injects the `sdk.mercadopago.com/js/v2` script once.
 *  2. `createAndRender()` mounts the **Card Payment Brick** inside the
 *     given container element.
 *  3. On `onSubmit` the adapter POSTs the card token to the operator
 *     backend (`preferenceApiUrl`). The backend holds the *access token* —
 *     that secret never enters this bundle.
 *  4. `destroy()` calls `controller.unmount()` to clean up the iframe.
 */
@Injectable()
export class MercadoPagoAdapter implements MercadoPagoPort {
  private sdkLoaded = false;
  private activeController: BrickController | null = null;

  isEnabled(): boolean {
    return environment.mercadopago.enabled;
  }

  async loadSdk(): Promise<void> {
    if (this.sdkLoaded) return;
    await loadMercadoPago();
    this.sdkLoaded = true;
  }

  async createAndRender(amount: number, containerId: string): Promise<MercadoPagoPaymentResult> {
    await this.loadSdk();

    const { publicKey, preferenceApiUrl } = environment.mercadopago;
    const mp = new window.MercadoPago(publicKey, { advancedFraudPrevention: true });

    // Use an async IIFE so we can await create() before callbacks fire.
    // This guarantees activeController is set for destroy() regardless of
    // whether onSubmit resolves the outer promise synchronously (test mocks)
    // or asynchronously (real SDK — user must click).
    return new Promise<MercadoPagoPaymentResult>((resolve, reject) => {
      const preferenceIdRef = { value: '' };

      void (async () => {
        try {
          const controller = await mp.bricks().create('cardPayment', containerId, {
            initialization: { amount },
            callbacks: {
              onReady: () => {
                // Brick finished rendering — nothing extra to do.
              },

              onSubmit: async (formData: CardData): Promise<void> => {
                try {
                  const response = await fetch(preferenceApiUrl, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ formData, amount }),
                  });

                  if (!response.ok) {
                    reject(new Error(`Payment request failed: ${response.status}`));
                    return;
                  }

                  const result = (await response.json()) as BackendPaymentResponse;
                  preferenceIdRef.value = result.id;

                  resolve({
                    status: result.status,
                    paymentId: result.id,
                    preferenceId: preferenceIdRef.value,
                    amount,
                    timestamp: new Date(),
                  });
                } catch (err) {
                  reject(err instanceof Error ? err : new Error('MercadoPago payment failed'));
                }
              },

              onError: (error: { type: string; message: string }): void => {
                // Non-critical errors are surfaced by the brick itself;
                // critical ones must reject the flow.
                if (error.type === 'critical') {
                  reject(new Error(`MercadoPago critical error: ${error.message}`));
                }
              },
            },
          });

          // Store after await so it is set before any sync onSubmit resolves.
          this.activeController = controller;
        } catch (err) {
          reject(err instanceof Error ? err : new Error('MercadoPago brick failed to create'));
        }
      })();
    });
  }

  destroy(): void {
    this.activeController?.unmount();
    this.activeController = null;
  }
}
