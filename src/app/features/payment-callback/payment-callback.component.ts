import { Component, OnInit, inject, signal } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';

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
 * After broadcasting:
 *  1. `window.close()` is attempted — works when the tab was opened via
 *     `window.open()` (the Wallet Brick's `redirectMode: 'blank'`).
 *  2. If the tab is still open 300 ms later (browser blocked close), the
 *     Router navigates back to `/` so the buyer is not stranded on a blank
 *     "you can close this tab" page with no way out.
 */
@Component({
  standalone: true,
  template: `
    <div
      style="font-family:sans-serif;padding:2rem;max-width:480px;margin:0 auto;text-align:center"
    >
      @if (status() === 'approved') {
        <p style="font-size:2rem">✅</p>
        <p style="font-weight:600">Payment approved!</p>
        <p style="color:#555;margin-top:.5rem">Returning to the store…</p>
      } @else if (status() === 'failure') {
        <p style="font-size:2rem">❌</p>
        <p style="font-weight:600">Payment cancelled or failed.</p>
        <p style="color:#555;margin-top:.5rem">Returning to the store…</p>
      } @else {
        <p style="font-size:2rem">⏳</p>
        <p style="font-weight:600">Payment pending.</p>
        <p style="color:#555;margin-top:.5rem">Returning to the store…</p>
      }

      <!-- Fallback: shown only when window.close() was blocked and the
           Router navigate fires instead — gives the buyer an explicit tap target. -->
      @if (showFallbackLink()) {
        <a
          style="display:inline-block;margin-top:1.5rem;padding:.75rem 1.5rem;background:#f59e0b;color:#1c1917;border-radius:.75rem;font-weight:600;text-decoration:none"
          href="/"
          >← Back to store</a
        >
      }
    </div>
  `,
})
export class PaymentCallbackComponent implements OnInit {
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);

  readonly status = signal<string>('unknown');
  readonly showFallbackLink = signal(false);

  ngOnInit(): void {
    const params = this.route.snapshot.queryParams as Record<string, string>;
    const paymentId = params['payment_id'] ?? params['collection_id'] ?? '';
    const rawStatus = params['status'] ?? params['collection_status'] ?? 'unknown';
    const preferenceId = params['preference_id'] ?? '';

    this.status.set(rawStatus);

    try {
      const channel = new BroadcastChannel('mp-payment-result');
      channel.postMessage({ paymentId, status: rawStatus, preferenceId });
      channel.close();
    } catch {
      // BroadcastChannel unavailable — original tab's polling will cover it.
    }

    // Attempt to close this tab (works only when opened via window.open()).
    window.close();

    // If close was blocked the tab is still alive. Navigate back to the store
    // after a short delay so the buyer is not stranded here.
    setTimeout(() => {
      this.showFallbackLink.set(true);
      void this.router.navigate(['/']);
    }, 300);
  }
}
