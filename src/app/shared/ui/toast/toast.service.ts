import { Injectable, signal } from '@angular/core';

/** Visual/semantic variant of a toast notification */
export type ToastVariant = 'success' | 'error' | 'warning' | 'info';

/** A single transient notification shown to the user */
export interface Toast {
  readonly id: number;
  readonly message: string;
  readonly variant: ToastVariant;
}

/**
 * ToastService
 *
 * Lightweight, signal-based notification service. Provides the user-facing
 * feedback channel the app previously lacked (actions used to fail silently
 * to the console). Components read `toasts()` reactively via ToastContainer;
 * any service or component can raise one through the helper methods.
 *
 * Toasts auto-dismiss after a per-variant default duration (errors linger
 * longer). The visible stack is capped so rapid bursts (e.g. a barcode
 * scanner firing repeatedly) never flood the screen.
 *
 * @example
 * ```ts
 * private readonly toast = inject(ToastService);
 * this.toast.success('Added to cart');
 * this.toast.error('Checkout failed. Please try again.');
 * ```
 */
@Injectable({ providedIn: 'root' })
export class ToastService {
  /** Maximum number of toasts visible at once (oldest are dropped). */
  private static readonly MAX_VISIBLE = 4;

  /** Default auto-dismiss durations per variant, in milliseconds. */
  private static readonly DEFAULT_DURATION: Record<ToastVariant, number> = {
    success: 2500,
    info: 3000,
    warning: 4000,
    error: 5000,
  };

  private readonly _toasts = signal<Toast[]>([]);

  /** Reactive list of currently visible toasts. */
  readonly toasts = this._toasts.asReadonly();

  private nextId = 0;

  /** Show a success toast. */
  success(message: string, duration?: number): number {
    return this.show(message, 'success', duration);
  }

  /** Show an error toast. */
  error(message: string, duration?: number): number {
    return this.show(message, 'error', duration);
  }

  /** Show a warning toast. */
  warning(message: string, duration?: number): number {
    return this.show(message, 'warning', duration);
  }

  /** Show an info toast. */
  info(message: string, duration?: number): number {
    return this.show(message, 'info', duration);
  }

  /**
   * Show a toast. Returns the toast id (useful for manual dismissal).
   * Pass `duration <= 0` to keep the toast until dismissed manually.
   */
  show(message: string, variant: ToastVariant = 'info', duration?: number): number {
    const id = ++this.nextId;
    const toast: Toast = { id, message, variant };

    this._toasts.update((list) => {
      const next = [...list, toast];
      // Keep only the most recent MAX_VISIBLE toasts.
      return next.slice(-ToastService.MAX_VISIBLE);
    });

    const ttl = duration ?? ToastService.DEFAULT_DURATION[variant];
    if (ttl > 0) {
      setTimeout(() => this.dismiss(id), ttl);
    }

    return id;
  }

  /** Dismiss a specific toast by id. */
  dismiss(id: number): void {
    this._toasts.update((list) => list.filter((t) => t.id !== id));
  }

  /** Dismiss all toasts. */
  clear(): void {
    this._toasts.set([]);
  }
}
