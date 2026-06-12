import {
  Component,
  ChangeDetectionStrategy,
  inject,
  output,
  ViewChild,
  ElementRef,
  effect,
  Injector,
  afterNextRender,
} from '@angular/core';

import { Product } from '@core/domain/entities/product.entity';
import { CartService } from '@core/application/services/cart.service';
import { CartTotalsComponent } from '@features/pos-terminal/components/cart-totals/cart-totals.component';

/**
 * Shopping Cart Component
 *
 * Presentation component for the shopping cart.
 * Delegates all cart logic to CartService.
 *
 * Features:
 * - Display cart items with quantities
 * - Show calculated totals (subtotal, tax, total)
 * - Quantity controls (increase/decrease)
 * - Remove items
 * - Clear cart
 * - Checkout functionality
 *
 * Refactored to use CartService for state management,
 * reducing component complexity from 598 to ~250 lines.
 *
 * @example
 * ```html
 * <app-shopping-cart />
 * ```
 */
@Component({
  selector: 'app-shopping-cart',
  standalone: true,
  imports: [CartTotalsComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div
      class="flex flex-col h-full bg-white rounded-lg shadow-md overflow-hidden"
      data-testid="shopping-cart"
    >
      <!-- Cart Header -->
      <div
        class="flex justify-between items-center px-4 py-3 border-b border-gray-200 bg-gradient-to-r from-indigo-500 to-purple-600 text-white"
      >
        <h2 class="text-lg font-bold md:text-xl">Shopping Cart</h2>
        <span
          class="flex items-center justify-center min-w-[2rem] h-8 px-2 bg-white/20 rounded-full text-sm font-semibold backdrop-blur-sm"
          data-testid="cart-count"
          [attr.aria-label]="'Cart has ' + cartService.totalItems() + ' items'"
        >
          {{ cartService.totalItems() }}
        </span>
      </div>

      <!-- Empty Cart Message -->
      @if (cartService.isEmpty()) {
        <div
          class="flex flex-col items-center justify-center flex-1 px-4 py-8 text-center text-gray-500"
          data-testid="empty-cart"
        >
          <svg
            class="w-12 h-12 mb-3 text-gray-300"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path
              stroke-linecap="round"
              stroke-linejoin="round"
              stroke-width="2"
              d="M3 3h2l.4 2M7 13h10l4-8H5.4M7 13L5.4 5M7 13l-2.293 2.293c-.63.63-.184 1.707.707 1.707H17m0 0a2 2 0 100 4 2 2 0 000-4zm-8 2a2 2 0 11-4 0 2 2 0 014 0z"
            />
          </svg>
          <p class="text-base font-semibold text-gray-700">Your cart is empty</p>
          <p class="text-sm mt-1">Search for products to add them to your cart</p>
        </div>
      }

      <!-- Cart Items -->
      @if (!cartService.isEmpty()) {
        <div
          #cartItemsContainer
          class="flex-1 min-h-0 overflow-y-auto p-3 space-y-2 scroll-smooth"
          data-testid="cart-items"
          (scroll)="onCartScroll($event)"
        >
          @for (item of cartService.items(); track item.product.id) {
            <div
              class="flex flex-col gap-2 p-3 border rounded-lg transition-all"
              [class.bg-gray-50]="item.product.stock > 0"
              [class.border-gray-200]="item.product.stock > 0"
              [class.bg-gray-100]="item.product.stock === 0"
              [class.border-red-200]="item.product.stock === 0"
              [class.opacity-60]="item.product.stock === 0"
              [attr.data-testid]="'cart-item-' + item.product.id"
              [attr.aria-disabled]="item.product.stock === 0"
            >
              <!-- Item info row -->
              <div class="flex items-start justify-between gap-2">
                <div class="flex-1 min-w-0">
                  <div class="flex items-center gap-2">
                    <h3
                      class="text-sm font-semibold truncate"
                      [class.text-gray-900]="item.product.stock > 0"
                      [class.text-gray-400]="item.product.stock === 0"
                      [class.line-through]="item.product.stock === 0"
                    >
                      {{ item.product.name }}
                    </h3>
                    @if (item.product.stock === 0) {
                      <span
                        class="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-bold uppercase tracking-wide bg-red-100 text-red-700 border border-red-200 whitespace-nowrap"
                      >
                        Out of Stock
                      </span>
                    }
                  </div>
                  <p
                    class="text-xs"
                    [class.text-gray-500]="item.product.stock > 0"
                    [class.text-gray-400]="item.product.stock === 0"
                  >
                    SKU: {{ item.product.sku }}
                  </p>
                  <p
                    class="text-sm font-semibold mt-0.5"
                    [class.text-indigo-600]="item.product.stock > 0"
                    [class.text-gray-400]="item.product.stock === 0"
                  >
                    {{ '$' + item.product.price.toFixed(2) }}
                  </p>
                </div>
                <!-- Remove button -->
                <button
                  class="flex items-center justify-center w-11 h-11 rounded-lg border border-gray-200 bg-white text-red-500 active:bg-red-500 active:text-white transition-colors"
                  [attr.data-testid]="'remove-item-' + item.product.id"
                  (click)="cartService.removeItem(item.product.id)"
                  aria-label="Remove item from cart"
                >
                  <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path
                      stroke-linecap="round"
                      stroke-linejoin="round"
                      stroke-width="2"
                      d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"
                    />
                  </svg>
                </button>
              </div>

              <!-- Quantity controls + subtotal row -->
              <div class="flex items-center justify-between">
                <div class="flex items-center gap-1">
                  <button
                    class="flex items-center justify-center w-11 h-11 bg-white border border-gray-300 rounded-lg active:bg-indigo-500 active:border-indigo-500 active:text-white disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                    [attr.data-testid]="'decrease-quantity-' + item.product.id"
                    (click)="cartService.decreaseQuantity(item.product.id)"
                    [disabled]="item.quantity <= 1 || item.product.stock === 0"
                    aria-label="Decrease quantity"
                  >
                    <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path
                        stroke-linecap="round"
                        stroke-linejoin="round"
                        stroke-width="2"
                        d="M20 12H4"
                      />
                    </svg>
                  </button>

                  <input
                    type="number"
                    class="w-12 h-11 text-center border border-gray-300 rounded-lg text-sm font-semibold focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 disabled:bg-gray-100 disabled:text-gray-400 disabled:cursor-not-allowed"
                    [attr.data-testid]="'quantity-input-' + item.product.id"
                    [value]="item.quantity"
                    (change)="updateQuantity(item.product.id, $event)"
                    min="1"
                    [max]="item.product.stock"
                    [disabled]="item.product.stock === 0"
                    aria-label="Item quantity"
                  />

                  <button
                    class="flex items-center justify-center w-11 h-11 bg-white border border-gray-300 rounded-lg active:bg-indigo-500 active:border-indigo-500 active:text-white disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                    [attr.data-testid]="'increase-quantity-' + item.product.id"
                    (click)="cartService.increaseQuantity(item.product.id)"
                    [disabled]="item.quantity >= item.product.stock || item.product.stock === 0"
                    aria-label="Increase quantity"
                  >
                    <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path
                        stroke-linecap="round"
                        stroke-linejoin="round"
                        stroke-width="2"
                        d="M12 4v16m8-8H4"
                      />
                    </svg>
                  </button>
                </div>

                <div class="text-right">
                  <span class="text-xs text-gray-500">Subtotal</span>
                  <p
                    class="text-sm font-bold"
                    [class.text-gray-900]="item.product.stock > 0"
                    [class.text-gray-400]="item.product.stock === 0"
                    [attr.data-testid]="'subtotal-' + item.product.id"
                  >
                    {{ '$' + (item.product.price * item.quantity).toFixed(2) }}
                  </p>
                </div>
              </div>

              <!-- Out of stock warning message -->
              @if (item.product.stock === 0) {
                <p class="text-xs text-red-600 font-medium flex items-center gap-1 mt-0.5">
                  <svg class="w-3.5 h-3.5 flex-shrink-0" fill="currentColor" viewBox="0 0 20 20">
                    <path
                      fill-rule="evenodd"
                      d="M8.257 3.099c.765-1.36 2.722-1.36 3.486 0l5.58 9.92c.75 1.334-.213 2.98-1.742 2.98H4.42c-1.53 0-2.493-1.646-1.743-2.98l5.58-9.92zM11 13a1 1 0 11-2 0 1 1 0 012 0zm-1-8a1 1 0 00-1 1v3a1 1 0 002 0V6a1 1 0 00-1-1z"
                      clip-rule="evenodd"
                    />
                  </svg>
                  This item is no longer available. Please remove it.
                </p>
              }
            </div>
          }
        </div>

        <!-- Cart Totals (delegated to CartTotalsComponent) -->
        <app-cart-totals data-testid="cart-summary" />

        <!-- Action Buttons -->
        <div class="flex gap-3 p-3 border-t border-gray-200" data-testid="cart-actions">
          <button
            class="flex-1 py-3 px-4 text-sm font-semibold bg-white border border-gray-300 rounded-lg text-gray-700 active:bg-gray-100 transition-colors min-h-[44px]"
            data-testid="clear-cart-btn"
            (click)="clearCart()"
            aria-label="Clear cart"
          >
            Clear Cart
          </button>

          <button
            class="flex-1 py-3 px-4 text-sm font-semibold bg-gradient-to-r from-indigo-500 to-purple-600 text-white rounded-lg active:opacity-90 transition-all min-h-[44px]"
            data-testid="checkout-btn"
            (click)="handleCheckout()"
            aria-label="Proceed to checkout"
          >
            Checkout
          </button>
        </div>
      }
    </div>
  `,
  styles: [
    `
      :host {
        display: block;
        height: 100%;
      }

      /* Hide number input spinners for cleaner look */
      input[type='number']::-webkit-inner-spin-button,
      input[type='number']::-webkit-outer-spin-button {
        -webkit-appearance: none;
        margin: 0;
      }
      input[type='number'] {
        -moz-appearance: textfield;
      }
    `,
  ],
})
export class ShoppingCartComponent {
  public cartService = inject(CartService);
  private readonly injector = inject(Injector);

  /** Reference to the scrollable cart items container */
  @ViewChild('cartItemsContainer') private readonly cartItemsRef!: ElementRef<HTMLElement>;

  /** Emitted when user clicks checkout with items in cart */
  readonly checkoutRequested = output<void>();

  /** Whether auto-scroll is enabled (disabled when user manually scrolls) */
  private autoScrollEnabled = true;

  /** Track known product IDs to detect truly new items */
  private readonly knownProductIds = new Set<string>();

  /** Previous total quantity to detect additions (including repeated items) */
  private previousTotalQuantity = 0;

  constructor() {
    // React to cart items changes (covers both direct CartService calls and addProduct method)
    effect(() => {
      const items = this.cartService.items();
      const currentTotalQuantity = items.reduce((sum, item) => sum + item.quantity, 0);

      if (currentTotalQuantity > this.previousTotalQuantity && items.length > 0) {
        // Items were added or quantity increased — schedule scroll after DOM renders
        this.scrollToBottomAfterRender();
      }

      this.previousTotalQuantity = currentTotalQuantity;
    });
  }

  /**
   * Schedules a scroll-to-bottom after the next render cycle.
   * Uses afterNextRender to ensure the DOM has been updated with new items.
   */
  private scrollToBottomAfterRender(): void {
    afterNextRender(
      () => {
        if (this.cartItemsRef) {
          const el = this.cartItemsRef.nativeElement;
          el.scrollTo({ top: el.scrollHeight, behavior: 'smooth' });
        }
      },
      { injector: this.injector }
    );
  }

  /**
   * Handle user scroll on cart items container.
   * If user scrolls away from bottom, disable auto-scroll.
   * If user scrolls back to bottom, re-enable auto-scroll.
   */
  onCartScroll(event: Event): void {
    const el = event.target as HTMLElement;
    const threshold = 50; // px from bottom to consider "at bottom"
    const isAtBottom = el.scrollHeight - el.scrollTop - el.clientHeight < threshold;
    this.autoScrollEnabled = isAtBottom;
  }

  /**
   * Public method to add a product to the cart.
   * Called from parent component (POS Terminal).
   * The effect() on cartService.items() handles auto-scrolling reactively.
   */
  addProduct(product: Product): void {
    this.knownProductIds.add(product.id);
    this.cartService.addProduct(product);
  }

  /**
   * Updates quantity from input field
   */
  updateQuantity(productId: string, event: Event): void {
    const input = event.target as HTMLInputElement;
    const newQuantity = Number.parseInt(input.value, 10);

    if (Number.isNaN(newQuantity) || newQuantity < 1) {
      input.value = '1';
      return;
    }

    const item = this.cartService.getItem(productId);
    if (item) {
      const quantity = Math.min(newQuantity, item.product.stock);
      input.value = quantity.toString();
      this.cartService.updateQuantity(productId, quantity);
    }
  }

  /**
   * Clears all items from the cart
   */
  clearCart(): void {
    if (confirm('Are you sure you want to clear the cart?')) {
      this.cartService.clearCart();
    }
  }

  /**
   * Handles checkout process - emits event to parent
   */
  handleCheckout(): void {
    if (this.cartService.isEmpty()) {
      return;
    }
    this.checkoutRequested.emit();
  }
}

// Made with Bob
