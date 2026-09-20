import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  OnInit,
  computed,
  inject,
  signal,
} from '@angular/core';
import { CurrencyPipe } from '@angular/common';
import { Router } from '@angular/router';
import { CartChangedDuringCheckoutError, PosFacade } from '@core/application/facades/pos.facade';
import {
  PAYPAL_CHECKOUT,
  PayPalCheckoutCallbacks,
} from '@core/application/ports/paypal-checkout.port';
import {
  SELF_CHECKOUT_GATEWAY,
  SelfCheckoutGatewayError,
  SelfCheckoutState,
  SelfCheckoutStatus,
} from '@core/application/ports/self-checkout-gateway.port';
import { ReceiptData } from '@core/application/dtos/receipt.dto';
import {
  SelfCheckoutAttemptStore,
  StoredSelfCheckoutAttempt,
  StoredSelfCheckoutDraft,
} from '@core/infrastructure/payments/self-checkout-attempt.store';
import { ReceiptComponent } from '@features/pos-terminal/components/receipt/receipt.component';
import { environment } from '../../../environments/environment';
import { LANE_ROUTE } from './self-checkout-routes';

const STATUS_POLL_DELAYS_MS = [350, 700, 1_400] as const;
const MANUAL_REVIEW_STATES = new Set<SelfCheckoutState>([
  SelfCheckoutState.MANUAL_REVIEW_CREATE_UNKNOWN,
  SelfCheckoutState.MANUAL_REVIEW_AWAITING_APPROVAL,
  SelfCheckoutState.MANUAL_REVIEW_AUTHORIZE_UNKNOWN,
  SelfCheckoutState.MANUAL_REVIEW_AUTHORIZED,
  SelfCheckoutState.MANUAL_REVIEW_CAPTURE_UNKNOWN,
  SelfCheckoutState.MANUAL_REVIEW_CAPTURED,
]);
const ACTIVE_CAPTURE_STATES = new Set<SelfCheckoutState>([
  SelfCheckoutState.AUTHORIZE_REQUESTED,
  SelfCheckoutState.RECONCILE_AUTHORIZE_UNKNOWN,
  SelfCheckoutState.AUTHORIZED,
  SelfCheckoutState.RESERVING,
  SelfCheckoutState.RESERVED,
  SelfCheckoutState.NEVER_CAPTURE_VOID_REQUESTED,
  SelfCheckoutState.RECONCILE_VOID_UNKNOWN,
  SelfCheckoutState.CAPTURE_REQUESTED,
  SelfCheckoutState.RECONCILE_CAPTURE_UNKNOWN,
  SelfCheckoutState.CONFIRMED_NON_CAPTURABLE,
  SelfCheckoutState.CAPTURED_PENDING_COMMIT,
  SelfCheckoutState.COMMITTING,
  SelfCheckoutState.RECONCILE_CAPTURED,
]);
const REPLACEABLE_STATES = new Set<SelfCheckoutState>([
  SelfCheckoutState.AWAITING_APPROVAL,
  SelfCheckoutState.VOIDED,
  SelfCheckoutState.EXPIRED,
]);

type PaymentView =
  | 'loading'
  | 'ready'
  | 'processing'
  | 'cancelled'
  | 'unavailable'
  | 'failed'
  | 'changed'
  | 'manual-review'
  | 'completed';

@Component({
  selector: 'app-self-checkout-pay',
  standalone: true,
  imports: [CurrencyPipe, ReceiptComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './self-checkout-pay.component.html',
})
export class SelfCheckoutPayComponent implements OnInit {
  private readonly pos = inject(PosFacade);
  private readonly gateway = inject(SELF_CHECKOUT_GATEWAY);
  private readonly paypal = inject(PAYPAL_CHECKOUT);
  private readonly attempts = inject(SelfCheckoutAttemptStore);
  private readonly router = inject(Router);

  private readonly _view = signal<PaymentView>('loading');
  private readonly _attempt = signal<StoredSelfCheckoutAttempt | null>(null);
  private readonly _message = signal('Preparing your secure PayPal checkout…');
  private readonly _receipt = signal<ReceiptData | null>(null);
  private completionPromise: Promise<void> | null = null;
  private paypalCallbacks: PayPalCheckoutCallbacks | null = null;
  private paypalReady = false;
  private destroyed = false;

  protected readonly view = this._view.asReadonly();
  protected readonly message = this._message.asReadonly();
  protected readonly receipt = this._receipt.asReadonly();
  protected readonly quote = computed(() => this._attempt()?.quote ?? null);
  protected readonly total = computed(() => {
    const quote = this.quote();
    return quote === null ? 0 : quote.totalMinorUnits / 100;
  });
  protected readonly currency = computed(() => this.quote()?.currency ?? 'USD');
  protected readonly canDiscardLocalAttempt = computed(
    () => environment.name.startsWith('development') && this._view() === 'manual-review'
  );

  constructor() {
    inject(DestroyRef).onDestroy(() => {
      this.destroyed = true;
      this.paypal.destroy();
    });
  }

  async ngOnInit(): Promise<void> {
    await this.prepare();
  }

  protected pay(): void {
    const attempt = this.currentUnchangedAttempt();
    if (attempt === null) return;
    this._view.set('processing');
    this._message.set('Opening PayPal…');
    void this.paypal.start(attempt.paypalOrderId).catch(() => {
      if (this.destroyed) return;
      this._view.set('failed');
      this._message.set('PayPal could not open. Your basket is still here.');
    });
  }

  protected retry(): void {
    void this.prepare();
  }

  protected returnToBasket(): void {
    if (this._view() === 'loading' || this._view() === 'processing') return;
    void this.router.navigate([LANE_ROUTE]);
  }

  protected discardLocalAttempt(): void {
    if (!this.canDiscardLocalAttempt()) return;
    this.paypal.destroy();
    this.attempts.clear();
    this._attempt.set(null);
    void this.router.navigate([LANE_ROUTE]);
  }

  protected newBasket(): void {
    this.attempts.clear();
    void this.router.navigate([LANE_ROUTE]);
  }

  private async prepare(): Promise<void> {
    if (this.destroyed) return;
    this._view.set('loading');
    this._message.set('Preparing your secure PayPal checkout…');

    try {
      const recovery = this.attempts.read();
      const recoveredAttempt = recovery !== null && 'checkoutId' in recovery ? recovery : null;
      if (recoveredAttempt !== null) {
        const shouldContinue = await this.recover(recoveredAttempt);
        if (!shouldContinue) return;
      }

      if (this.destroyed || !(await this.initializePayPal())) return;
      if (recoveredAttempt !== null) {
        await this.offerPayment(recoveredAttempt);
        return;
      }

      const draft = recovery ?? this.snapshotDraft();
      if (draft === null) {
        this._view.set('changed');
        this._message.set('Your basket is empty. Add an item before paying.');
        return;
      }
      this.attempts.write(draft);

      let created;
      try {
        created = await this.gateway.create(draft.items, draft.idempotencyKey);
      } catch (error) {
        if (isAmbiguousGatewayError(error)) {
          this._view.set('failed');
          this._message.set(
            'We could not confirm whether checkout started. Retry this same attempt; do not scan a second payment.'
          );
          return;
        }
        throw error;
      }
      const attempt: StoredSelfCheckoutAttempt = { ...draft, ...created };
      this.attempts.write(attempt);
      this._attempt.set(attempt);
      await this.offerPayment(attempt);
    } catch (error) {
      this.fail(error);
    }
  }

  private async initializePayPal(): Promise<boolean> {
    if (this.paypalCallbacks === null) {
      this.paypalCallbacks = {
        onApprove: () => this.completeOnce(),
        onCancel: () => this.onCancel(),
        onError: (code, recoverable) => this.onPayPalError(code, recoverable),
      };
    }
    if (!this.paypalReady) {
      this.paypalReady = await this.paypal.initialize(this.paypalCallbacks);
    }
    if (this.paypalReady) return true;
    this._view.set('unavailable');
    this._message.set('PayPal is not available on this device right now.');
    return false;
  }

  private snapshotDraft(): StoredSelfCheckoutDraft | null {
    const items = this.pos.cartItems().map((item) => ({
      productId: item.product.id,
      quantity: item.quantity,
    }));
    if (items.length === 0) return null;
    return {
      cartRevision: this.pos.cartRevision(),
      items,
      idempotencyKey: crypto.randomUUID(),
    };
  }

  private async recover(attempt: StoredSelfCheckoutAttempt): Promise<boolean> {
    let status: SelfCheckoutStatus;
    try {
      status = await this.gateway.status(attempt.checkoutId, attempt.checkoutToken);
    } catch (error) {
      if (isExpiredLocalAttempt(error)) return this.restartExpiredLocalAttempt();
      this._attempt.set(attempt);
      throw error;
    }

    const cartMatches = this.cartMatchesAttempt(attempt);
    if (!cartMatches && MANUAL_REVIEW_STATES.has(status.state)) {
      this.paypal.destroy();
      this._attempt.set(null);
      this._view.set('manual-review');
      this._message.set(
        'An earlier payment needs a member of staff. The items shown in your basket are not part of a new checkout. Do not try to pay a second time.'
      );
      return false;
    }

    this._attempt.set(attempt);
    if (await this.applyStatus(status, attempt)) return false;
    if (!cartMatches) {
      await this.replaceChangedAttempt(status.state);
      return false;
    }
    if (status.state === SelfCheckoutState.AWAITING_APPROVAL) {
      try {
        const completed = await this.gateway.complete(attempt.checkoutId, attempt.checkoutToken);
        if (await this.applyStatus(completed, attempt)) return false;
        return completed.state === SelfCheckoutState.AWAITING_APPROVAL;
      } catch (error) {
        if (!isAmbiguousGatewayError(error)) throw error;
      }
    }
    await this.recoverUntilSettled(attempt);
    return false;
  }

  private async restartExpiredLocalAttempt(): Promise<false> {
    this.paypal.destroy();
    this.attempts.clear();
    this._attempt.set(null);
    const draft = this.snapshotDraft();
    if (draft === null) {
      this._view.set('changed');
      this._message.set('Your earlier local checkout expired. Add an item before paying.');
      return false;
    }
    this.attempts.write(draft);
    await this.prepare();
    return false;
  }

  private async replaceChangedAttempt(state: SelfCheckoutState): Promise<void> {
    if (!REPLACEABLE_STATES.has(state)) {
      this.paypal.destroy();
      this._attempt.set(null);
      this._view.set('manual-review');
      this._message.set(
        'An earlier payment may still be processing. The items shown in your basket are not part of a new checkout. Do not try to pay a second time.'
      );
      return;
    }

    this.attempts.clear();
    this._attempt.set(null);
    if (state === SelfCheckoutState.AWAITING_APPROVAL) {
      this._view.set('changed');
      this._message.set(
        'Your basket changed. Return to your basket, then continue again to create a new checkout.'
      );
      return;
    }

    await this.prepare();
  }

  private async offerPayment(attempt: StoredSelfCheckoutAttempt): Promise<void> {
    if (this.currentUnchangedAttempt() === null) return;
    const resumed = await this.paypal.resumeIfReturned(attempt.paypalOrderId);
    if (resumed) {
      this._view.set('processing');
      this._message.set('Confirming your returned PayPal payment…');
      await this.recoverUntilSettled(attempt);
      return;
    }
    this._view.set('ready');
    this._message.set('Review the server-confirmed total, then continue to PayPal.');
  }

  private completeOnce(): Promise<void> {
    if (this.completionPromise !== null) return this.completionPromise;
    this.completionPromise = this.complete().finally(() => {
      this.completionPromise = null;
    });
    return this.completionPromise;
  }

  private async complete(): Promise<void> {
    const attempt = this.currentUnchangedAttempt();
    if (attempt === null) return;
    this._view.set('processing');
    this._message.set('Confirming payment with the checkout server…');
    try {
      const status = await this.gateway.complete(attempt.checkoutId, attempt.checkoutToken);
      if (!(await this.applyStatus(status, attempt))) {
        await this.recoverUntilSettled(attempt);
      }
    } catch (error) {
      if (isAmbiguousGatewayError(error)) {
        await this.recoverUntilSettled(attempt);
        return;
      }
      this.fail(error);
    }
  }

  private async recoverUntilSettled(attempt: StoredSelfCheckoutAttempt): Promise<void> {
    for (const delay of STATUS_POLL_DELAYS_MS) {
      if (this.destroyed) return;
      try {
        const status = await this.gateway.status(attempt.checkoutId, attempt.checkoutToken);
        if (await this.applyStatus(status, attempt)) return;
      } catch (error) {
        if (!isAmbiguousGatewayError(error)) {
          this.fail(error);
          return;
        }
      }
      await wait(delay);
    }
    if (!this.destroyed) {
      this._view.set('failed');
      this._message.set(
        'Payment status is still being confirmed. Retry to check this checkout; do not pay again.'
      );
    }
  }

  private async applyStatus(
    status: SelfCheckoutStatus,
    attempt: StoredSelfCheckoutAttempt
  ): Promise<boolean> {
    if (this.destroyed) return true;
    if (status.state === SelfCheckoutState.COMPLETED && status.receipt !== null) {
      try {
        const receipt = this.pos.finalizeServerCheckout(status.receipt, attempt.cartRevision);
        this.finishCompletedAttempt(receipt, 'Payment complete.');
      } catch (error) {
        if (!(error instanceof CartChangedDuringCheckoutError)) throw error;
        const receipt = this.pos.serverCheckoutReceiptData(status.receipt);
        this.finishCompletedAttempt(
          receipt,
          'Payment completed, but this basket changed. Keep this receipt and ask a member of staff for help.'
        );
      }
      return true;
    }

    if (MANUAL_REVIEW_STATES.has(status.state)) {
      this.paypal.destroy();
      this._view.set('manual-review');
      this._message.set('This payment needs a member of staff. Do not try to pay a second time.');
      return true;
    }

    if (status.state === SelfCheckoutState.VOIDED || status.state === SelfCheckoutState.EXPIRED) {
      if (!this.cartMatchesAttempt(attempt) && this.pos.cartItems().length > 0) return false;
      this.attempts.clear();
      this._attempt.set(null);
      this._view.set('failed');
      this._message.set('This checkout ended without a completed sale. Your basket is still here.');
      return true;
    }

    if (ACTIVE_CAPTURE_STATES.has(status.state)) {
      this._view.set('processing');
      this._message.set('Payment is still being confirmed. Please wait…');
      return false;
    }

    if (status.state === SelfCheckoutState.AWAITING_APPROVAL) return false;

    this._view.set('failed');
    this._message.set('Checkout is not ready yet. Retry to check this same payment.');
    return true;
  }

  private finishCompletedAttempt(receipt: ReceiptData, message: string): void {
    this.attempts.clear();
    this.paypal.destroy();
    this._receipt.set(receipt);
    this._view.set('completed');
    this._message.set(message);
  }

  private cartMatchesAttempt(attempt: StoredSelfCheckoutAttempt): boolean {
    if (this.pos.cartRevision() !== attempt.cartRevision) return false;
    const currentItems = this.pos.cartItems().map((item) => ({
      productId: item.product.id,
      quantity: item.quantity,
    }));
    return itemSnapshotsMatch(currentItems, attempt.items);
  }

  private currentUnchangedAttempt(): StoredSelfCheckoutAttempt | null {
    const attempt = this._attempt();
    if (attempt === null) return null;
    if (!this.cartMatchesAttempt(attempt)) {
      this._view.set('changed');
      this._message.set(
        'Your basket changed after checkout started. Return to your basket and review it before paying.'
      );
      return null;
    }
    return attempt;
  }

  private onCancel(): void {
    if (this.destroyed) return;
    this._view.set('cancelled');
    this._message.set('PayPal was cancelled. Nothing was removed from your basket.');
  }

  private onPayPalError(code: string, recoverable: boolean): void {
    if (this.destroyed) return;
    this._view.set('failed');
    this._message.set(
      recoverable
        ? 'PayPal could not finish. Retry this same checkout.'
        : `PayPal stopped this checkout (${code}). Your basket is still here.`
    );
  }

  private fail(error: unknown): void {
    if (this.destroyed) return;
    const gatewayError = error instanceof SelfCheckoutGatewayError ? error : null;
    this._view.set('failed');
    this._message.set(
      gatewayError?.code === 'out-of-stock'
        ? 'One or more items are no longer available. Return to your basket for help.'
        : 'Checkout could not continue. Your basket is still here.'
    );
  }
}

function isAmbiguousGatewayError(error: unknown): boolean {
  return error instanceof SelfCheckoutGatewayError && error.ambiguous;
}

function isExpiredLocalAttempt(error: unknown): boolean {
  return (
    environment.name.startsWith('development') &&
    error instanceof SelfCheckoutGatewayError &&
    error.code === 'not-found' &&
    error.status === 404 &&
    !error.ambiguous
  );
}

function itemSnapshotsMatch(
  left: readonly { readonly productId: string; readonly quantity: number }[],
  right: readonly { readonly productId: string; readonly quantity: number }[]
): boolean {
  if (left.length !== right.length) return false;
  const byProductId = (a: { productId: string }, b: { productId: string }): number =>
    a.productId.localeCompare(b.productId);
  const orderedLeft = [...left].sort(byProductId);
  const orderedRight = [...right].sort(byProductId);
  return orderedLeft.every(
    (item, index) =>
      item.productId === orderedRight[index]?.productId &&
      item.quantity === orderedRight[index]?.quantity
  );
}

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
