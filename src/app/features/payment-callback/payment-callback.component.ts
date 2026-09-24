import { Component, OnInit, inject } from '@angular/core';
import { ActivatedRoute } from '@angular/router';

/**
 * PaymentCallbackComponent
 *
 * Mounted at /payment/success, /payment/failure, /payment/pending —
 * the back_urls MercadoPago redirects the buyer's tab to after checkout.
 *
 * Reads the query-params (payment_id, status, preference_id) that
 * MercadoPago appends and broadcasts them over a BroadcastChannel so the
 * original till tab can settle the payment promise immediately instead of
 * waiting for the slow Payments Search API to index the transaction.
 *
 * After broadcasting this component shows a brief "returning…" message.
 * The window closes itself automatically (it was opened as a blank tab by
 * the Wallet Brick `redirectMode: 'blank'`).
 */
@Component({
  standalone: true,
  template: `
    <p style="font-family:sans-serif;padding:2rem">Payment processed — you can close this tab.</p>
  `,
})
export class PaymentCallbackComponent implements OnInit {
  private readonly route = inject(ActivatedRoute);

  ngOnInit(): void {
    const params = this.route.snapshot.queryParams as Record<string, string>;
    const paymentId = params['payment_id'] ?? params['collection_id'] ?? '';
    const status = params['status'] ?? params['collection_status'] ?? 'unknown';
    const preferenceId = params['preference_id'] ?? '';

    const channel = new BroadcastChannel('mp-payment-result');
    channel.postMessage({ paymentId, status, preferenceId });
    channel.close();

    // Attempt to close the tab that MP opened. Works when this tab was opened
    // via window.open(); silently fails in other contexts.
    window.close();
  }
}
