import { Component, ChangeDetectionStrategy, inject, signal } from '@angular/core';

import { PosFacade } from '@core/application/facades/pos.facade';
import { CustomerTier } from '@core/domain/entities/customer.entity';
import { ToastService } from '@shared/ui/toast/toast.service';

/**
 * Customer Loyalty Component
 *
 * The till-side control for attaching a shopper's loyalty card to the sale in
 * progress, so checkout can award them points (#177).
 *
 * `PosFacade` already knew how to resolve a code, hold the attached customer and
 * award on checkout, but nothing in the UI called any of it — the loyalty
 * programme was reachable only from a unit test. This is that missing surface.
 *
 * Deliberately thin: it owns the field the cashier types into and nothing else.
 * Who is attached lives in `PosFacade.attachedCustomer`, so a detach made
 * elsewhere — a completed sale, a cleared cart — shows up here without this
 * component being told.
 *
 * @example
 * ```html
 * <app-customer-loyalty />
 * ```
 */
@Component({
  selector: 'app-customer-loyalty',
  standalone: true,
  imports: [],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div
      class="flex flex-wrap items-center gap-2 px-3 py-2 bg-white border border-gray-200 rounded-lg"
      data-testid="customer-loyalty"
    >
      @if (attached(); as customer) {
        <div
          class="flex flex-wrap items-center gap-2 flex-1 min-w-0"
          data-testid="loyalty-attached"
        >
          <span aria-hidden="true">🎫</span>
          <span
            class="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-sm min-w-0"
            aria-live="polite"
          >
            <span class="font-semibold text-gray-900 truncate">{{ customer.name }}</span>
            <span
              class="px-2 py-0.5 rounded-full text-xs font-semibold bg-indigo-50 text-indigo-700"
              data-testid="loyalty-tier"
            >
              {{ tierLabel(customer.tier) }}
            </span>
            <span class="text-gray-600" data-testid="loyalty-balance">
              {{ formatPoints(customer.loyaltyPoints) }} points
            </span>
          </span>
        </div>
        <button
          type="button"
          class="px-3 py-2 text-sm font-semibold bg-white border border-gray-300 rounded-lg text-gray-700 active:bg-gray-100 transition-colors min-h-[44px]"
          data-testid="loyalty-detach-btn"
          (click)="detach()"
          [attr.aria-label]="'Remove ' + customer.name + ' from this sale'"
        >
          Remove
        </button>
      } @else {
        <label class="text-sm font-medium text-gray-700" for="loyalty-code">
          <span aria-hidden="true">🎫</span> Loyalty
        </label>
        <input
          id="loyalty-code"
          type="text"
          class="flex-1 min-w-[10rem] px-3 py-2 text-sm border border-gray-300 rounded-lg min-h-[44px] focus:outline-none focus:ring-2 focus:ring-indigo-500"
          data-testid="loyalty-code-input"
          placeholder="Scan or enter loyalty code"
          aria-label="Loyalty card code"
          autocomplete="off"
          [value]="code()"
          [disabled]="looking()"
          (input)="code.set($any($event.target).value)"
          (keydown.enter)="attach()"
        />
        <button
          type="button"
          class="px-4 py-2 text-sm font-semibold bg-gradient-to-r from-indigo-500 to-purple-600 text-white rounded-lg active:opacity-90 transition-all min-h-[44px] disabled:opacity-50"
          data-testid="loyalty-attach-btn"
          [disabled]="looking() || !code().trim()"
          (click)="attach()"
        >
          {{ looking() ? 'Looking…' : 'Attach' }}
        </button>
      }
    </div>
  `,
})
export class CustomerLoyaltyComponent {
  private readonly posFacade = inject(PosFacade);
  private readonly toast = inject(ToastService);

  /** Who the sale currently belongs to — owned by the facade, not by this component. */
  readonly attached = this.posFacade.attachedCustomer;

  /** The code being typed or scanned. */
  readonly code = signal('');

  /** Whether a lookup is in flight, so a held scanner cannot queue duplicates. */
  readonly looking = signal(false);

  /**
   * Resolves the entered code and attaches whoever holds that card.
   *
   * An unrecognised code keeps the field: it is far more often a mistyped digit
   * worth correcting than a card worth rescanning.
   */
  async attach(): Promise<void> {
    if (this.looking()) {
      return;
    }
    const code = this.code().trim();
    if (!code) {
      return;
    }

    this.looking.set(true);
    try {
      // Normalising the spelling is the repository's job; this passes the code
      // through as typed, minus the whitespace a scanner tends to add.
      const customer = await this.posFacade.attachCustomerByLoyaltyCode(code);
      if (!customer) {
        this.toast.warning(`No loyalty card matches ${code}`);
        return;
      }
      this.code.set('');
      this.toast.success(`${customer.name} will earn points on this sale`);
    } catch (error) {
      // A backstop: the facade already swallows a failed lookup and returns null.
      // Reaching here means something unexpected, and the cashier still needs the
      // field back rather than a stuck spinner.
      console.error('[POS] Loyalty attach failed:', error);
      this.toast.error('Could not look up that loyalty card. Please try again.');
    } finally {
      this.looking.set(false);
    }
  }

  /** Drops the card, returning the sale to anonymous. */
  detach(): void {
    this.posFacade.detachCustomer();
    this.toast.info('Loyalty card removed — this sale is anonymous');
  }

  /** `SILVER` reads as `Silver` on a customer-facing screen. */
  tierLabel(tier: CustomerTier): string {
    return tier.charAt(0) + tier.slice(1).toLowerCase();
  }

  /** Thousands-separated, because a four-figure balance is common and hard to scan. */
  formatPoints(points: number): string {
    return points.toLocaleString('en-US');
  }
}
