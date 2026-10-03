import { Component, OnInit, inject, signal } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import {
  MP_PAYMENT_RESULT_CHANNEL,
  MercadoPagoReturnOutcome,
  type MercadoPagoReturnMessage,
} from '@core/application/ports/mercadopago.port';

/**
 * PaymentCallbackComponent
 *
 * Mounted at /payment/success, /payment/failure, /payment/pending —
 * the back_urls MercadoPago sends the buyer's tab to after checkout, and also
 * where MP's own "Return to site" link lands a buyer who gives up.
 *
 * Reads the query params MP appends (payment_id, status, external_reference,
 * …) and broadcasts them so the original checkout tab can settle at once
 * instead of waiting for the slow Payments Search API to index anything.
 *
 * Anything but an approved payment is reported as `abandoned`: a buyer who
 * returns via "Return to site" arrives with `status=null` and no payment id,
 * and a pending ticket is not something a till can wait on. The checkout tab
 * answers that by cancelling the attempt at the gateway, so this page only
 * has to say so and let the buyer close it.
 *
 * After broadcasting, `window.close()` is attempted (works when the Wallet
 * Brick opened this tab with `redirectMode: 'blank'`). For an approved
 * payment, if the tab is still open 300 ms later the Router navigates back to
 * `/` so the buyer is not stranded. A cancelled return stays put: the cart and
 * the "Payment cancelled" screen live in the other tab, and a fresh store here
 * would only be a second, empty one.
 */
@Component({
  standalone: true,
  template: `
    <div
      style="font-family:sans-serif;padding:2rem;max-width:480px;margin:0 auto;text-align:center"
      role="status"
      aria-live="polite"
    >
      @if (outcome() === 'approved') {
        <p style="font-size:2rem" aria-hidden="true">✅</p>
        <p style="font-weight:600" data-testid="payment-callback-approved">Payment approved!</p>
        <p style="color:#555;margin-top:.5rem">Returning to the store…</p>
      } @else {
        <p style="font-size:2rem" aria-hidden="true">↩️</p>
        <p style="font-weight:600" data-testid="payment-callback-cancelled">Payment cancelled</p>
        <p style="color:#555;margin-top:.5rem">
          You weren't charged. You can close this tab — your cart is still waiting in the store.
        </p>
      }

      <!-- Fallback: shown when window.close() was blocked — gives the buyer
           an explicit tap target. -->
      @if (showFallbackLink()) {
        <a
          style="display:inline-block;margin-top:1.5rem;padding:.75rem 1.5rem;background:#f59e0b;color:#1c1917;border-radius:.75rem;font-weight:600;text-decoration:none"
          href="/"
          data-testid="payment-callback-back"
          >← Back to store</a
        >
      }
    </div>
  `,
})
export class PaymentCallbackComponent implements OnInit {
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);

  readonly outcome = signal<MercadoPagoReturnOutcome>(MercadoPagoReturnOutcome.ABANDONED);
  readonly showFallbackLink = signal(false);

  ngOnInit(): void {
    const params = this.route.snapshot.queryParams as Record<string, string | undefined>;
    const paymentId = params['payment_id'] ?? params['collection_id'] ?? '';
    const status = params['status'] ?? params['collection_status'] ?? 'null';
    const outcome =
      status === 'approved'
        ? MercadoPagoReturnOutcome.APPROVED
        : MercadoPagoReturnOutcome.ABANDONED;
    this.outcome.set(outcome);

    const message: MercadoPagoReturnMessage = {
      outcome,
      status,
      // MP sends the literal string "null" when there is no payment.
      paymentId: paymentId === 'null' ? '' : paymentId,
      preferenceId: params['preference_id'] ?? '',
      externalReference: params['external_reference'] ?? '',
    };

    try {
      const channel = new BroadcastChannel(MP_PAYMENT_RESULT_CHANNEL);
      channel.postMessage(message);
      channel.close();
    } catch {
      // BroadcastChannel unavailable — original tab's polling (approved) or
      // its own Cancel button (abandoned) covers it.
    }

    // Attempt to close this tab (works only when opened via window.open()).
    window.close();

    // Still alive 300 ms later: close was blocked.
    setTimeout(() => {
      this.showFallbackLink.set(true);
      if (outcome === MercadoPagoReturnOutcome.APPROVED) {
        void this.router.navigate(['/']);
      }
    }, 300);
  }
}
