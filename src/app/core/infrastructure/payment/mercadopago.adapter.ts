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
  create(
    brick: string,
    target: string,
    settings: BrickSettings | WalletBrickSettings
  ): Promise<BrickController>;
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

/** Settings shape for the Wallet Brick (`brick: 'wallet'`). */
interface WalletBrickSettings {
  initialization: { preferenceId: string; redirectMode?: 'self' | 'blank' };
  callbacks: {
    onReady: () => void;
    onError: (error: { type: string; message: string }) => void;
    onSubmit?: () => void;
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

/** Response from POST /api/mercadopago/preference in wallet mode. */
interface BackendWalletResponse {
  id: string;
  /** UUID we set as external_reference on the MP preference — used as the poll key. */
  externalReference: string;
  initPoint: string;
  sandboxInitPoint?: string;
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
 * Two flows are supported:
 *
 *  **Card Brick** (`createAndRender`):
 *  1. `loadSdk()` injects the script once.
 *  2. The Card Payment Brick collects card details in an iframe.
 *  3. On `onSubmit` the adapter POSTs `{ mode:'card', formData, amount }` to
 *     the operator backend. The backend holds the access token — it never
 *     enters this bundle.
 *  4. `destroy()` unmounts the iframe.
 *
 *  **Wallet Brick** (`createWalletBrick`):
 *  1. The adapter POSTs `{ mode:'wallet', amount }` to the backend, which
 *     creates a MercadoPago Preference and returns `{ id, initPoint }`.
 *  2. The Wallet Brick is mounted with the preference id. The buyer pays
 *     from their MercadoPago account / scans a QR in the MP app.
 *  3. MP confirms via the `onSubmit` callback; the adapter resolves.
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

  /**
   * **Wallet Brick mode.**
   *
   * Flow:
   * 1. POSTs `{ mode:'wallet', amount }` to the backend → receives `{ id, initPoint }`.
   * 2. Mounts the Wallet Brick with the preference id. The buyer sees the Pay button.
   * 3. When the buyer clicks Pay (`onSubmit`), the Brick opens MP's checkout in a
   *    new tab. We start polling `GET /api/mercadopago/preference/:id` every 2 s.
   * 4. Once MP marks the payment `approved` or `rejected`, we resolve/reject.
   *    After 10 minutes without a terminal status we resolve `pending` so the
   *    operator can decide.
   */
  async createWalletBrick(
    amount: number,
    containerId: string,
    onPollingStarted?: () => void
  ): Promise<MercadoPagoPaymentResult> {
    await this.loadSdk();

    const { publicKey, preferenceApiUrl } = environment.mercadopago;
    // Derive the status-poll URL from the preference URL (same base path + /:id)
    const preferenceStatusBaseUrl = preferenceApiUrl; // we append /<id> below

    // Step 1 — create a MercadoPago Preference on the backend.
    let prefResponse: Response;
    try {
      prefResponse = await fetch(preferenceApiUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mode: 'wallet', amount }),
      });
    } catch {
      throw new Error('MercadoPago: could not reach the payment server. Is it running?');
    }

    if (!prefResponse.ok) {
      const errBody = (await prefResponse.json().catch(() => ({}))) as Record<string, unknown>;
      const detail =
        typeof errBody['error'] === 'string' ? errBody['error'] : `HTTP ${prefResponse.status}`;
      if (prefResponse.status === 503) {
        throw new Error('MercadoPago is not configured on the server. Set MP_ACCESS_TOKEN.');
      }
      throw new Error(`MercadoPago preference failed: ${detail}`);
    }

    const pref = (await prefResponse.json()) as BackendWalletResponse;
    const preferenceId = pref.id;
    // Use externalReference as the poll key — the backend searches by
    // external_reference, not preference_id (MP's search API rejects that param).
    const pollKey = pref.externalReference ?? pref.id;

    // Step 2 — mount the Wallet Brick.
    const mp = new window.MercadoPago(publicKey, { advancedFraudPrevention: true });

    return new Promise<MercadoPagoPaymentResult>((resolve, reject) => {
      let pollInterval: ReturnType<typeof setInterval> | null = null;
      let timeoutHandle: ReturnType<typeof setTimeout> | null = null;
      let resolved = false;
      let broadcastChannel: BroadcastChannel | null = null;

      const cleanup = (): void => {
        if (pollInterval !== null) clearInterval(pollInterval);
        if (timeoutHandle !== null) clearTimeout(timeoutHandle);
        broadcastChannel?.close();
        broadcastChannel = null;
      };

      const settle = (status: 'approved' | 'pending' | 'rejected', paymentId?: string): void => {
        if (resolved) return;
        resolved = true;
        cleanup();
        if (status === 'rejected') {
          reject(new Error('MercadoPago payment was rejected.'));
        } else {
          resolve({
            status,
            paymentId: paymentId ?? preferenceId,
            preferenceId,
            amount,
            timestamp: new Date(),
          });
        }
      };

      /**
       * Listen on BroadcastChannel 'mp-payment-result'.
       * PaymentCallbackComponent posts { paymentId, status, preferenceId } when
       * MercadoPago redirects the buyer tab to /payment/success|failure|pending.
       * This settles the promise immediately — no polling round-trip needed.
       */
      const listenForCallback = (): void => {
        try {
          broadcastChannel = new BroadcastChannel('mp-payment-result');
          broadcastChannel.onmessage = (
            event: MessageEvent<{ paymentId: string; status: string; preferenceId: string }>
          ) => {
            const { status, paymentId } = event.data;
            if (status === 'approved') settle('approved', paymentId);
            else if (status === 'failure' || status === 'rejected') settle('rejected', paymentId);
            else settle('pending', paymentId); // pending / unknown
          };
        } catch {
          // BroadcastChannel not available (e.g. unit-test environment) — polling covers it.
        }
      };

      /**
       * Poll `GET /api/mercadopago/preference/:id` every 2 s.
       * Acts as a fallback when the back_url broadcast cannot fire (popup blocked,
       * cross-origin tab, test environment).
       *
       * IMPORTANT: polling intentionally does NOT settle on `rejected`.
       * Within a single MP checkout session the buyer can fail one payment method
       * and immediately retry with another — MP keeps the same tab open and only
       * redirects (triggering the BroadcastChannel) when the session is truly done.
       * Settling rejected here would close the channel before the successful
       * retry broadcast arrives, making a succeeded payment appear as a failure.
       *
       * Polling only promotes to `approved`. The broadcast handles `rejected`.
       */
      const startPolling = (): void => {
        onPollingStarted?.();
        pollInterval = setInterval(() => {
          void fetch(`${preferenceStatusBaseUrl}/${encodeURIComponent(pollKey)}`)
            .then((r) => r.json() as Promise<{ status: string }>)
            .then(({ status }) => {
              if (status === 'approved') settle('approved');
              // rejected / pending / not_found → keep polling; final verdict
              // comes from the back_url redirect via BroadcastChannel.
            })
            .catch(() => {
              /* transient network error — keep polling */
            });
        }, 2000);

        // Hard 10-minute timeout: resolve pending so the operator is not stuck forever.
        timeoutHandle = setTimeout(
          () => {
            settle('pending');
          },
          10 * 60 * 1000
        );
      };

      void (async () => {
        try {
          const controller = await mp.bricks().create('wallet', containerId, {
            initialization: { preferenceId, redirectMode: 'blank' },
            callbacks: {
              onReady: () => {
                /* Brick rendered */
              },
              onSubmit: () => {
                // Buyer clicked Pay — new tab opened.
                // Start listening for the BroadcastChannel callback first (fast path),
                // then start polling as a fallback in case the tab cannot broadcast.
                listenForCallback();
                startPolling();
              },
              onError: (error: { type: string; message: string }) => {
                if (error.type === 'critical') {
                  cleanup();
                  reject(new Error(`MercadoPago Wallet error: ${error.message}`));
                }
              },
            },
          } as WalletBrickSettings);

          this.activeController = controller;
        } catch (err) {
          cleanup();
          reject(
            err instanceof Error ? err : new Error('MercadoPago Wallet Brick failed to create')
          );
        }
      })();
    });
  }

  destroy(): void {
    this.activeController?.unmount();
    this.activeController = null;
  }
}
