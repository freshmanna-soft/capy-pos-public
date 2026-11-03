import { Injectable, inject } from '@angular/core';
import { CurrentUserService } from '@core/application/auth/current-user.service';
import type {
  MercadoPagoPointPort,
  PointChargeRequest,
  PointChargeResult,
  PointOrderStatus,
} from '@core/application/ports/mercadopago-point.port';
import { environment } from '../../../../environments/environment';

const POLL_INTERVAL_MS = 2_000;
/** The server creates orders with a 5-minute TTL; poll a little past it. */
const CHARGE_DEADLINE_MS = 6 * 60_000;
/**
 * After a cancel MP answers 202 and the machine acts on it only when the clerk taps
 * back on it (or it syncs). Wait this long for that, then stop: the clerk is not
 * held on the cancelling screen, and the charge settles as an unconfirmed cancel.
 */
const CANCEL_WINDOW_MS = 60_000;
const REQUEST_TIMEOUT_MS = 10_000;

/** The subset of the server's order summary the adapter reads. */
interface OrderSummary {
  id: string;
  status: string;
  paymentId: string;
}

interface Attempt {
  readonly request: PointChargeRequest;
  readonly onStatus?: (status: PointOrderStatus) => void;
  readonly promise: Promise<PointChargeResult>;
  readonly resolve: (result: PointChargeResult) => void;
  orderId: string;
  paymentId: string;
  deadline: number;
  settled: boolean;
  cancelRequested: boolean;
  timer: ReturnType<typeof setTimeout> | null;
  /** Settles when the create call has finished (success or failure). */
  created: Promise<void>;
}

/**
 * Charges the cart total on a linked Mercado Pago Point card machine through
 * the pos-api (`/api/mercadopago/point/orders`), authenticated with the staff JWT
 * from `CurrentUserService`.
 *
 * Safety rules, all deliberate:
 *  - Only an order status of `processed` is ever `approved`.
 *  - A failed poll (network, 5xx, bad JSON) is ignored; it never settles the
 *    charge. When no final status arrives before the deadline the charge
 *    settles `cancelled` with `cancellationConfirmed: false` — or, when the
 *    deadline was a cancel window that ran out, `needs-confirmation`.
 *  - `cancel()` on an order already `at_terminal` is asynchronous at MP: the
 *    adapter keeps polling and resolves `approved` if the buyer paid anyway.
 */
@Injectable()
export class MercadoPagoPointAdapter implements MercadoPagoPointPort {
  private readonly currentUser = inject(CurrentUserService);
  private attempt: Attempt | null = null;

  charge(
    request: PointChargeRequest,
    onStatus?: (status: PointOrderStatus) => void
  ): Promise<PointChargeResult> {
    // A new charge supersedes any leftover one.
    this.destroy();

    let resolve!: (result: PointChargeResult) => void;
    const promise = new Promise<PointChargeResult>((r) => (resolve = r));
    const attempt: Attempt = {
      request,
      onStatus,
      promise,
      resolve,
      orderId: '',
      paymentId: '',
      deadline: Date.now() + CHARGE_DEADLINE_MS,
      settled: false,
      cancelRequested: false,
      timer: null,
      created: Promise.resolve(),
    };
    this.attempt = attempt;
    attempt.created = this.createOrder(attempt);
    return promise;
  }

  async cancel(): Promise<PointChargeResult> {
    const attempt = this.attempt;
    if (!attempt) {
      return {
        status: 'cancelled',
        orderId: '',
        paymentId: '',
        amount: 0,
        timestamp: new Date(),
        cancellationConfirmed: true,
      };
    }
    attempt.cancelRequested = true;
    await attempt.created;
    if (attempt.settled) return attempt.promise;

    this.clearTimer(attempt);
    attempt.deadline = Math.min(attempt.deadline, Date.now() + CANCEL_WINDOW_MS);

    const summary = await this.sendCancel(attempt);
    if (attempt.settled) return attempt.promise;
    if (summary === null) {
      // Could not reach the gateway: stop, and have the clerk check the device.
      this.settle(attempt, 'cancelled', false);
      return attempt.promise;
    }
    this.applyStatus(attempt, summary);
    if (!attempt.settled) this.schedulePoll(attempt);
    return attempt.promise;
  }

  destroy(): void {
    const attempt = this.attempt;
    if (!attempt || attempt.settled) return;
    this.clearTimer(attempt);
    const hadOrder = attempt.orderId !== '';
    this.settle(attempt, 'cancelled', false);
    // Best effort: do not leave the device charging after the till moved on.
    if (hadOrder) void this.sendCancel(attempt);
  }

  // ── internals ───────────────────────────────────────────────────────────

  private async createOrder(attempt: Attempt): Promise<void> {
    const { amount, externalReference, terminalId } = attempt.request;
    const summary = await this.call(attempt, 'POST', '', { amount, externalReference, terminalId });
    if (attempt.settled) return;
    if (summary === null || summary.id === '') {
      this.settle(attempt, 'rejected', undefined);
      return;
    }
    attempt.orderId = summary.id;
    this.applyStatus(attempt, summary);
    if (!attempt.settled && !attempt.cancelRequested) this.schedulePoll(attempt);
  }

  private schedulePoll(attempt: Attempt): void {
    if (attempt.settled) return;
    this.clearTimer(attempt);
    attempt.timer = setTimeout(() => void this.poll(attempt), POLL_INTERVAL_MS);
  }

  private async poll(attempt: Attempt): Promise<void> {
    attempt.timer = null;
    if (attempt.settled) return;
    if (Date.now() >= attempt.deadline) {
      // A cancel the machine never acted on leaves the outcome unknown: the buyer
      // may or may not have paid. Hand the decision to the clerk rather than guess.
      if (attempt.cancelRequested) this.settle(attempt, 'needs-confirmation');
      else this.settle(attempt, 'cancelled', false);
      void this.sendCancel(attempt);
      return;
    }
    const summary = await this.call(attempt, 'GET', `/${attempt.orderId}`);
    if (attempt.settled) return;
    // A failed poll says nothing about the charge — never finalize on it.
    if (summary !== null) this.applyStatus(attempt, summary);
    if (!attempt.settled) this.schedulePoll(attempt);
  }

  private applyStatus(attempt: Attempt, summary: OrderSummary): void {
    if (summary.paymentId) attempt.paymentId = summary.paymentId;
    switch (summary.status) {
      case 'processed':
        this.settle(attempt, 'approved');
        return;
      case 'expired':
        // An expired order can no longer be paid: after a cancel request that is
        // as good as a confirmed cancel.
        if (attempt.cancelRequested) this.settle(attempt, 'cancelled', true);
        else this.settle(attempt, 'rejected');
        return;
      case 'failed':
      case 'refunded':
        this.settle(attempt, 'rejected');
        return;
      case 'canceled':
        this.settle(attempt, 'cancelled', true);
        return;
      case 'action_required':
        this.settle(attempt, 'needs-confirmation');
        return;
      case 'created':
      case 'at_terminal':
        attempt.onStatus?.(summary.status);
        return;
      default:
        return;
    }
  }

  private settle(
    attempt: Attempt,
    status: PointChargeResult['status'],
    cancellationConfirmed?: boolean
  ): void {
    if (attempt.settled) return;
    attempt.settled = true;
    this.clearTimer(attempt);
    if (this.attempt === attempt) this.attempt = null;
    attempt.resolve({
      status,
      orderId: attempt.orderId,
      paymentId: attempt.paymentId,
      amount: attempt.request.amount,
      timestamp: new Date(),
      ...(cancellationConfirmed === undefined ? {} : { cancellationConfirmed }),
    });
  }

  private clearTimer(attempt: Attempt): void {
    if (attempt.timer !== null) {
      clearTimeout(attempt.timer);
      attempt.timer = null;
    }
  }

  private sendCancel(attempt: Attempt): Promise<OrderSummary | null> {
    return this.call(attempt, 'POST', `/${attempt.orderId}/cancel`);
  }

  /** One authenticated call to the pos-api; `null` on any failure. */
  private async call(
    attempt: Attempt,
    method: 'GET' | 'POST',
    path: string,
    body?: Record<string, unknown>
  ): Promise<OrderSummary | null> {
    // Read per call so a session refreshed mid-charge is picked up.
    const accessToken = this.currentUser.session()?.accessToken;
    if (!accessToken) return null;
    try {
      const response = await fetch(`${environment.apiUrl}/mercadopago/point/orders${path}`, {
        method,
        headers: {
          Authorization: `Bearer ${accessToken}`,
          ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
        },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
      if (!response.ok) return null;
      const json = (await response.json()) as Partial<OrderSummary> | null;
      if (typeof json !== 'object' || json === null) return null;
      return {
        id: typeof json.id === 'string' ? json.id : '',
        status: typeof json.status === 'string' ? json.status : '',
        paymentId: typeof json.paymentId === 'string' ? json.paymentId : '',
      };
    } catch {
      return null;
    }
  }
}
