import { Injectable } from '@angular/core';
import { loadMercadoPago } from '@mercadopago/sdk-js';
import {
  MP_PAYMENT_RESULT_CHANNEL,
  MercadoPagoReturnOutcome,
  type MercadoPagoPort,
  type MercadoPagoPaymentResult,
  type MercadoPagoReturnMessage,
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
  /** UUID we set as external_reference on the MP preference — the poll and cancel key. */
  externalReference?: string;
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

/** What `POST {preferenceApiUrl}/:externalReference/cancel` answers. */
interface BackendCancelResponse {
  status?: 'cancelled' | 'approved';
  paymentId?: string;
}

/**
 * One in-flight payment attempt (one Brick mount). Kept on the adapter rather
 * than closed over inside `createWalletBrick` so `cancelPayment()` and
 * `destroy()` can reach its timers, channel and pending promise — before this
 * existed, `destroy()` only unmounted the Brick and a poll that answered
 * `approved` after the overlay closed still finalized a ghost sale.
 */
interface PaymentAttempt {
  readonly kind: 'wallet' | 'card';
  readonly amount: number;
  /** Wallet: the preference request; `null` once it failed. Card: always `null`. */
  preference: Promise<BackendWalletResponse | null>;
  preferenceId: string;
  externalReference: string;
  /** Card: the charge POST once the buyer submitted, so a cancel can wait for its verdict. */
  charge: Promise<BackendPaymentResponse | null> | null;
  /**
   * Set the moment a cancel / destroy starts. From then on only the
   * cancellation settles the attempt — a late poll, broadcast, card verdict or
   * Brick error is ignored, and a Brick that finishes mounting is unmounted.
   */
  abandoned: boolean;
  settled: boolean;
  cancellation: Promise<MercadoPagoPaymentResult> | null;
  stopWatching: () => void;
  finish: (result: MercadoPagoPaymentResult) => void;
  fail: (error: Error) => void;
}

/** How long the till waits on the MP tab before giving up and cancelling. */
const WALLET_WAIT_TIMEOUT_MS = 10 * 60 * 1000;
const WALLET_POLL_INTERVAL_MS = 2000;

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
 *     creates a MercadoPago Preference and returns `{ id, externalReference }`.
 *  2. The Wallet Brick is mounted with the preference id. The buyer pays
 *     from their MercadoPago account in a new tab.
 *  3. The return tab's broadcast, or the status poll, settles the attempt.
 *
 *  **Cancelling** (`cancelPayment` / `destroy`): stops watching, unmounts, and
 *  for a wallet attempt asks the backend to cancel pending payments and expire
 *  the preference, so the link MP opened can no longer take money.
 */
@Injectable()
export class MercadoPagoAdapter implements MercadoPagoPort {
  private sdkLoaded = false;
  private activeController: BrickController | null = null;
  private attempt: PaymentAttempt | null = null;

  isEnabled(): boolean {
    return environment.mercadopago.enabled;
  }

  async loadSdk(): Promise<void> {
    if (this.sdkLoaded) return;
    await loadMercadoPago();
    this.sdkLoaded = true;
  }

  createAndRender(amount: number, containerId: string): Promise<MercadoPagoPaymentResult> {
    this.abandonCurrentAttempt();
    const { publicKey, preferenceApiUrl } = environment.mercadopago;

    return new Promise<MercadoPagoPaymentResult>((resolve, reject) => {
      const attempt = this.beginAttempt('card', amount, resolve, reject);

      void (async () => {
        try {
          await this.loadSdk();
          if (attempt.abandoned) return;
          const mp = new window.MercadoPago(publicKey, { advancedFraudPrevention: true });
          const controller = await mp.bricks().create('cardPayment', containerId, {
            initialization: { amount },
            callbacks: {
              onReady: () => {
                // Brick finished rendering — nothing extra to do.
              },

              onSubmit: async (formData: CardData): Promise<void> => {
                const charge = this.chargeCard(preferenceApiUrl, formData, amount);
                attempt.charge = charge.catch(() => null);
                try {
                  const result = await charge;
                  // A cancel that started meanwhile owns the verdict (it awaits
                  // `attempt.charge` and finalizes an approval itself).
                  if (attempt.abandoned) return;
                  attempt.finish({
                    status: result.status,
                    paymentId: result.id,
                    preferenceId: result.id,
                    amount,
                    timestamp: new Date(),
                  });
                } catch (err) {
                  if (attempt.abandoned) return;
                  attempt.fail(
                    err instanceof Error ? err : new Error('MercadoPago payment failed')
                  );
                }
              },

              onError: (error: { type: string; message: string }): void => {
                // Non-critical errors are surfaced by the brick itself;
                // critical ones must reject the flow.
                if (error.type === 'critical' && !attempt.abandoned) {
                  attempt.fail(new Error(`MercadoPago critical error: ${error.message}`));
                }
              },
            },
          });

          this.adoptController(attempt, controller);
        } catch (err) {
          if (attempt.abandoned) return;
          attempt.fail(
            err instanceof Error ? err : new Error('MercadoPago brick failed to create')
          );
        }
      })();
    });
  }

  /**
   * **Wallet Brick mode.**
   *
   * Flow:
   * 1. POSTs `{ mode:'wallet', amount }` to the backend → receives
   *    `{ id, externalReference }`.
   * 2. Mounts the Wallet Brick with the preference id. The buyer sees the Pay button.
   * 3. When the buyer clicks Pay (`onSubmit`), the Brick opens MP's checkout in a
   *    new tab. We listen on the return channel and poll
   *    `GET /api/mercadopago/preference/:externalReference` every 2 s.
   * 4. `approved` (poll or broadcast) resolves the attempt. A broadcast saying
   *    the buyer came back without paying — or 10 minutes with no verdict —
   *    cancels it at the gateway instead of leaving a payable link behind.
   */
  createWalletBrick(
    amount: number,
    containerId: string,
    onPollingStarted?: () => void,
    onCancelling?: () => void
  ): Promise<MercadoPagoPaymentResult> {
    this.abandonCurrentAttempt();
    const { publicKey, preferenceApiUrl } = environment.mercadopago;

    return new Promise<MercadoPagoPaymentResult>((resolve, reject) => {
      const attempt = this.beginAttempt('wallet', amount, resolve, reject);
      const preference = this.loadSdk().then(() =>
        this.requestPreference(preferenceApiUrl, amount)
      );
      attempt.preference = preference.catch(() => null);

      let pollInterval: ReturnType<typeof setInterval> | null = null;
      let timeoutHandle: ReturnType<typeof setTimeout> | null = null;
      let broadcastChannel: BroadcastChannel | null = null;

      attempt.stopWatching = (): void => {
        if (pollInterval !== null) clearInterval(pollInterval);
        if (timeoutHandle !== null) clearTimeout(timeoutHandle);
        pollInterval = null;
        timeoutHandle = null;
        broadcastChannel?.close();
        broadcastChannel = null;
      };

      const approve = (paymentId?: string): void => {
        attempt.finish(this.resultFor(attempt, 'approved', paymentId));
      };

      /** The adapter itself decided to give up — tell the UI, then cancel. */
      const cancelFromHere = (): void => {
        if (attempt.abandoned) return;
        onCancelling?.();
        void this.cancelPayment();
      };

      /**
       * Listen on the return channel. PaymentCallbackComponent posts the moment
       * MP sends the buyer's tab back to a back_url — including MP's own
       * "Return to site" link, which is how a buyer cancels inside MP.
       */
      const listenForCallback = (): void => {
        try {
          broadcastChannel = new BroadcastChannel(MP_PAYMENT_RESULT_CHANNEL);
          broadcastChannel.onmessage = (event: MessageEvent<Partial<MercadoPagoReturnMessage>>) => {
            const message = event.data ?? {};
            // Another checkout in this browser (a second shop tab) shares the
            // channel; only our own preference's return may settle us. Older
            // return pages sent no reference, so absence is accepted.
            if (
              message.externalReference &&
              message.externalReference !== attempt.externalReference
            ) {
              return;
            }
            const approved =
              message.outcome === MercadoPagoReturnOutcome.APPROVED ||
              (message.outcome === undefined && message.status === 'approved');
            if (approved) approve(message.paymentId || undefined);
            else cancelFromHere();
          };
        } catch {
          // BroadcastChannel not available (e.g. unit-test environment) — polling covers it.
        }
      };

      /**
       * Poll `GET /api/mercadopago/preference/:id` every 2 s — the fallback
       * when the return tab cannot broadcast (popup closed by hand, another
       * device). Polling only ever promotes to `approved`: within one MP
       * checkout session the buyer can fail a method and retry another, so a
       * `rejected` poll is not the buyer's final word.
       */
      const startPolling = (): void => {
        onPollingStarted?.();
        const pollUrl = `${preferenceApiUrl}/${encodeURIComponent(attempt.externalReference)}`;
        pollInterval = setInterval(() => {
          void fetch(pollUrl)
            .then((r) => r.json() as Promise<{ status: string }>)
            .then(({ status }) => {
              if (status === 'approved' && !attempt.abandoned) approve();
            })
            .catch(() => {
              /* transient network error — keep polling */
            });
        }, WALLET_POLL_INTERVAL_MS);

        // Nobody is coming back: cancel rather than resolve `pending`, which
        // used to finalize a sale that was never paid for.
        timeoutHandle = setTimeout(cancelFromHere, WALLET_WAIT_TIMEOUT_MS);
      };

      void (async () => {
        let pref: BackendWalletResponse;
        try {
          pref = await preference;
        } catch (err) {
          if (!attempt.abandoned) {
            attempt.fail(err instanceof Error ? err : new Error('MercadoPago preference failed'));
          }
          return;
        }
        if (attempt.abandoned) return; // cancelled while the preference was being created

        attempt.preferenceId = pref.id;
        // The backend searches by external_reference, not preference_id (MP's
        // search API rejects that param), and the cancel route is keyed on it.
        attempt.externalReference = pref.externalReference ?? pref.id;

        try {
          const mp = new window.MercadoPago(publicKey, { advancedFraudPrevention: true });
          const controller = await mp.bricks().create('wallet', containerId, {
            initialization: { preferenceId: pref.id, redirectMode: 'blank' },
            callbacks: {
              onReady: () => {
                /* Brick rendered */
              },
              onSubmit: () => {
                if (attempt.abandoned) return;
                // Buyer clicked Pay — new tab opened. Listen first (fast path),
                // then poll as a fallback in case the tab cannot broadcast.
                listenForCallback();
                startPolling();
              },
              onError: (error: { type: string; message: string }) => {
                if (error.type === 'critical' && !attempt.abandoned) {
                  attempt.fail(new Error(`MercadoPago Wallet error: ${error.message}`));
                }
              },
            },
          } as WalletBrickSettings);

          this.adoptController(attempt, controller);
        } catch (err) {
          if (attempt.abandoned) return;
          attempt.fail(
            err instanceof Error ? err : new Error('MercadoPago Wallet Brick failed to create')
          );
        }
      })();
    });
  }

  cancelPayment(): Promise<MercadoPagoPaymentResult> {
    const attempt = this.attempt;
    if (attempt === null) {
      return Promise.resolve({
        status: 'cancelled',
        paymentId: '',
        preferenceId: '',
        amount: 0,
        timestamp: new Date(),
        cancellationConfirmed: true,
      });
    }
    attempt.cancellation ??= this.runCancellation(attempt);
    return attempt.cancellation;
  }

  destroy(): void {
    // Settles the pending attempt and, for a wallet preference, kills it at the
    // gateway — closing the overlay must not leave a link the customer can
    // still pay with no sale behind it.
    if (this.attempt !== null) void this.cancelPayment();
    this.activeController?.unmount();
    this.activeController = null;
  }

  // ── internals ─────────────────────────────────────────────────────────────

  private beginAttempt(
    kind: PaymentAttempt['kind'],
    amount: number,
    resolve: (result: MercadoPagoPaymentResult) => void,
    reject: (error: Error) => void
  ): PaymentAttempt {
    const attempt: PaymentAttempt = {
      kind,
      amount,
      preference: Promise.resolve(null),
      preferenceId: '',
      externalReference: '',
      charge: null,
      abandoned: false,
      settled: false,
      cancellation: null,
      stopWatching: () => undefined,
      finish: (result) => {
        if (!this.endAttempt(attempt)) return;
        resolve(result);
      },
      fail: (error) => {
        if (!this.endAttempt(attempt)) return;
        reject(error);
      },
    };
    this.attempt = attempt;
    return attempt;
  }

  /** Marks the attempt settled exactly once; false when it already was. */
  private endAttempt(attempt: PaymentAttempt): boolean {
    if (attempt.settled) return false;
    attempt.settled = true;
    attempt.stopWatching();
    if (this.attempt === attempt) this.attempt = null;
    return true;
  }

  /** A new mount supersedes whatever was in flight. */
  private abandonCurrentAttempt(): void {
    if (this.attempt !== null) void this.cancelPayment();
  }

  /** Keep a freshly mounted Brick, unless its attempt was cancelled mid-mount. */
  private adoptController(attempt: PaymentAttempt, controller: BrickController): void {
    if (attempt.abandoned) {
      controller.unmount();
      return;
    }
    this.activeController = controller;
  }

  private async runCancellation(attempt: PaymentAttempt): Promise<MercadoPagoPaymentResult> {
    attempt.abandoned = true;
    attempt.stopWatching();
    this.activeController?.unmount();
    this.activeController = null;

    const result =
      attempt.kind === 'card'
        ? await this.cancelCardAttempt(attempt)
        : await this.cancelWalletAttempt(attempt);
    attempt.finish(result);
    return result;
  }

  /**
   * A card attempt has nothing at the gateway until the buyer submits. If a
   * charge is already in flight it cannot be recalled from here, so wait for
   * it: an approval means the customer paid and the sale must go through.
   */
  private async cancelCardAttempt(attempt: PaymentAttempt): Promise<MercadoPagoPaymentResult> {
    const charge = attempt.charge === null ? null : await attempt.charge;
    if (charge?.status === 'approved') {
      return {
        status: 'approved',
        paymentId: charge.id,
        preferenceId: charge.id,
        amount: attempt.amount,
        timestamp: new Date(),
      };
    }
    return { ...this.resultFor(attempt, 'cancelled'), cancellationConfirmed: true };
  }

  private async cancelWalletAttempt(attempt: PaymentAttempt): Promise<MercadoPagoPaymentResult> {
    const pref = await attempt.preference;
    if (pref === null) {
      // No preference was ever created — nothing exists at the gateway to cancel.
      return { ...this.resultFor(attempt, 'cancelled'), cancellationConfirmed: true };
    }
    attempt.preferenceId = pref.id;
    attempt.externalReference = pref.externalReference ?? pref.id;

    const { preferenceApiUrl } = environment.mercadopago;
    try {
      const response = await fetch(
        `${preferenceApiUrl}/${encodeURIComponent(attempt.externalReference)}/cancel`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ preferenceId: pref.id }),
        }
      );
      const body = response.ok ? ((await response.json()) as BackendCancelResponse) : {};
      if (body.status === 'approved') {
        return this.resultFor(attempt, 'approved', body.paymentId);
      }
      return {
        ...this.resultFor(attempt, 'cancelled'),
        cancellationConfirmed: body.status === 'cancelled',
      };
    } catch {
      return { ...this.resultFor(attempt, 'cancelled'), cancellationConfirmed: false };
    }
  }

  private resultFor(
    attempt: PaymentAttempt,
    status: MercadoPagoPaymentResult['status'],
    paymentId?: string
  ): MercadoPagoPaymentResult {
    return {
      status,
      paymentId: paymentId ?? attempt.preferenceId,
      preferenceId: attempt.preferenceId,
      amount: attempt.amount,
      timestamp: new Date(),
    };
  }

  private async requestPreference(
    preferenceApiUrl: string,
    amount: number
  ): Promise<BackendWalletResponse> {
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

    return (await prefResponse.json()) as BackendWalletResponse;
  }

  private async chargeCard(
    preferenceApiUrl: string,
    formData: CardData,
    amount: number
  ): Promise<BackendPaymentResponse> {
    const response = await fetch(preferenceApiUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ formData, amount }),
    });
    if (!response.ok) {
      throw new Error(`Payment request failed: ${response.status}`);
    }
    return (await response.json()) as BackendPaymentResponse;
  }
}
