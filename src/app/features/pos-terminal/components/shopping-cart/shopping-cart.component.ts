import { Component, computed, ChangeDetectionStrategy, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Product } from '../../../../core/domain/entities/product.entity';
import { CartService } from '../../../../core/application/services/cart.service';
import { CartTotalsComponent } from '../cart-totals/cart-totals.component';

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
  imports: [CommonModule, CartTotalsComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="shopping-cart" data-testid="shopping-cart">
      <!-- Cart Header -->
      <div class="cart-header">
        <h2 class="cart-title">Shopping Cart</h2>
        <span 
          class="cart-count" 
          data-testid="cart-count"
          [attr.aria-label]="'Cart has ' + cartService.totalItems() + ' items'">
          {{ cartService.totalItems() }}
        </span>
      </div>

      <!-- Empty Cart Message -->
      @if (cartService.isEmpty()) {
        <div class="empty-cart" data-testid="empty-cart">
          <svg class="empty-icon" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" 
              d="M3 3h2l.4 2M7 13h10l4-8H5.4M7 13L5.4 5M7 13l-2.293 2.293c-.63.63-.184 1.707.707 1.707H17m0 0a2 2 0 100 4 2 2 0 000-4zm-8 2a2 2 0 11-4 0 2 2 0 014 0z" />
          </svg>
          <p class="empty-message">Your cart is empty</p>
          <p class="empty-hint">Search for products to add them to your cart</p>
        </div>
      }

      <!-- Cart Items -->
      @if (!cartService.isEmpty()) {
        <div class="cart-items" data-testid="cart-items">
          @for (item of cartService.items(); track item.product.id) {
            <div class="cart-item" [attr.data-testid]="'cart-item-' + item.product.id">
              <div class="item-info">
                <h3 class="item-name">{{ item.product.name }}</h3>
                <p class="item-sku">SKU: {{ item.product.sku }}</p>
                <p class="item-price">{{ '$' + item.product.price.toFixed(2) }}</p>
              </div>

              <div class="item-actions">
                <div class="quantity-controls">
                  <button
                    class="quantity-btn"
                    [attr.data-testid]="'decrease-quantity-' + item.product.id"
                    (click)="cartService.decreaseQuantity(item.product.id)"
                    [disabled]="item.quantity <= 1"
                    aria-label="Decrease quantity">
                    <svg fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M20 12H4" />
                    </svg>
                  </button>

                  <input
                    type="number"
                    class="quantity-input"
                    [attr.data-testid]="'quantity-input-' + item.product.id"
                    [value]="item.quantity"
                    (change)="updateQuantity(item.product.id, $event)"
                    min="1"
                    [max]="item.product.stock"
                    aria-label="Item quantity" />

                  <button
                    class="quantity-btn"
                    [attr.data-testid]="'increase-quantity-' + item.product.id"
                    (click)="cartService.increaseQuantity(item.product.id)"
                    [disabled]="item.quantity >= item.product.stock"
                    aria-label="Increase quantity">
                    <svg fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 4v16m8-8H4" />
                    </svg>
                  </button>
                </div>

                <div class="item-subtotal">
                  <span class="subtotal-label">Subtotal:</span>
                  <span class="subtotal-amount" [attr.data-testid]="'subtotal-' + item.product.id">
                    {{ '$' + (item.product.price * item.quantity).toFixed(2) }}
                  </span>
                </div>

                <button
                  class="remove-btn"
                  [attr.data-testid]="'remove-item-' + item.product.id"
                  (click)="cartService.removeItem(item.product.id)"
                  aria-label="Remove item from cart">
                  <svg fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" 
                      d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                  </svg>
                </button>
              </div>
            </div>
          }
        </div>

        <!-- Cart Totals (delegated to CartTotalsComponent) -->
        <app-cart-totals data-testid="cart-summary" />

        <!-- Action Buttons -->
        <div class="cart-actions" data-testid="cart-actions">
          <button
            class="clear-btn"
            data-testid="clear-cart-btn"
            (click)="clearCart()"
            aria-label="Clear cart">
            Clear Cart
          </button>

          <button
            class="checkout-btn"
            data-testid="checkout-btn"
            (click)="handleCheckout()"
            aria-label="Proceed to checkout">
            Checkout
          </button>
        </div>
      }
    </div>
  `,
  styles: [`
    .shopping-cart {
      display: flex;
      flex-direction: column;
      height: 100%;
      background: white;
      border-radius: 8px;
      box-shadow: 0 2px 8px rgba(0, 0, 0, 0.1);
      overflow: hidden;
    }

    .cart-header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      padding: 1.5rem;
      border-bottom: 1px solid #e5e7eb;
      background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
      color: white;
    }

    .cart-title {
      font-size: 1.5rem;
      font-weight: 700;
      margin: 0;
    }

    .cart-count {
      display: flex;
      align-items: center;
      justify-content: center;
      min-width: 2rem;
      height: 2rem;
      padding: 0 0.5rem;
      background: rgba(255, 255, 255, 0.2);
      border-radius: 9999px;
      font-size: 0.875rem;
      font-weight: 600;
      backdrop-filter: blur(10px);
    }

    .empty-cart {
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      flex: 1;
      padding: 3rem 1.5rem;
      text-align: center;
      color: #6b7280;
    }

    .empty-icon {
      width: 4rem;
      height: 4rem;
      margin-bottom: 1rem;
      color: #d1d5db;
    }

    .empty-message {
      font-size: 1.125rem;
      font-weight: 600;
      margin: 0 0 0.5rem 0;
      color: #374151;
    }

    .empty-hint {
      font-size: 0.875rem;
      margin: 0;
    }

    .cart-items {
      flex: 1;
      overflow-y: auto;
      padding: 1rem;
    }

    .cart-item {
      display: flex;
      gap: 1rem;
      padding: 1rem;
      margin-bottom: 0.75rem;
      background: #f9fafb;
      border: 1px solid #e5e7eb;
      border-radius: 8px;
      transition: all 0.2s;
    }

    .cart-item:hover {
      border-color: #667eea;
      box-shadow: 0 2px 8px rgba(102, 126, 234, 0.1);
    }

    .item-info {
      flex: 1;
    }

    .item-name {
      font-size: 1rem;
      font-weight: 600;
      margin: 0 0 0.25rem 0;
      color: #111827;
    }

    .item-sku {
      font-size: 0.75rem;
      margin: 0 0 0.5rem 0;
      color: #6b7280;
    }

    .item-price {
      font-size: 0.875rem;
      font-weight: 600;
      margin: 0;
      color: #667eea;
    }

    .item-actions {
      display: flex;
      flex-direction: column;
      gap: 0.5rem;
      align-items: flex-end;
    }

    .quantity-controls {
      display: flex;
      align-items: center;
      gap: 0.5rem;
    }

    .quantity-btn {
      display: flex;
      align-items: center;
      justify-content: center;
      width: 2rem;
      height: 2rem;
      padding: 0;
      background: white;
      border: 1px solid #d1d5db;
      border-radius: 4px;
      cursor: pointer;
      transition: all 0.2s;
    }

    .quantity-btn:hover:not(:disabled) {
      background: #667eea;
      border-color: #667eea;
      color: white;
    }

    .quantity-btn:disabled {
      opacity: 0.5;
      cursor: not-allowed;
    }

    .quantity-btn svg {
      width: 1rem;
      height: 1rem;
    }

    .quantity-input {
      width: 3rem;
      height: 2rem;
      padding: 0.25rem;
      text-align: center;
      border: 1px solid #d1d5db;
      border-radius: 4px;
      font-size: 0.875rem;
      font-weight: 600;
    }

    .quantity-input:focus {
      outline: none;
      border-color: #667eea;
      box-shadow: 0 0 0 3px rgba(102, 126, 234, 0.1);
    }

    .item-subtotal {
      display: flex;
      gap: 0.5rem;
      font-size: 0.875rem;
    }

    .subtotal-label {
      color: #6b7280;
    }

    .subtotal-amount {
      font-weight: 600;
      color: #111827;
    }

    .remove-btn {
      display: flex;
      align-items: center;
      justify-content: center;
      width: 2rem;
      height: 2rem;
      padding: 0;
      background: white;
      border: 1px solid #d1d5db;
      border-radius: 4px;
      color: #ef4444;
      cursor: pointer;
      transition: all 0.2s;
    }

    .remove-btn:hover {
      background: #ef4444;
      border-color: #ef4444;
      color: white;
    }

    .remove-btn svg {
      width: 1.25rem;
      height: 1.25rem;
    }

    .cart-actions {
      display: flex;
      gap: 0.75rem;
      margin-top: 1rem;
    }

    .clear-btn,
    .checkout-btn {
      flex: 1;
      padding: 0.75rem 1.5rem;
      font-size: 0.875rem;
      font-weight: 600;
      border: none;
      border-radius: 6px;
      cursor: pointer;
      transition: all 0.2s;
    }

    .clear-btn {
      background: white;
      border: 1px solid #d1d5db;
      color: #374151;
    }

    .clear-btn:hover {
      background: #f3f4f6;
      border-color: #9ca3af;
    }

    .checkout-btn {
      background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
      color: white;
    }

    .checkout-btn:hover {
      transform: translateY(-1px);
      box-shadow: 0 4px 12px rgba(102, 126, 234, 0.4);
    }

    /* Scrollbar Styling */
    .cart-items::-webkit-scrollbar {
      width: 8px;
    }

    .cart-items::-webkit-scrollbar-track {
      background: #f3f4f6;
    }

    .cart-items::-webkit-scrollbar-thumb {
      background: #d1d5db;
      border-radius: 4px;
    }

    .cart-items::-webkit-scrollbar-thumb:hover {
      background: #9ca3af;
    }
  `]
})
export class ShoppingCartComponent {
  public cartService = inject(CartService);

  /**
   * Public method to add a product to the cart.
   * Called from parent component (POS Terminal).
   */
  addProduct(product: Product): void {
    this.cartService.addProduct(product);
  }

  /**
   * Updates quantity from input field
   */
  updateQuantity(productId: string, event: Event): void {
    const input = event.target as HTMLInputElement;
    const newQuantity = parseInt(input.value, 10);

    if (isNaN(newQuantity) || newQuantity < 1) {
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
   * Handles checkout process
   */
  handleCheckout(): void {
    if (this.cartService.isEmpty()) {
      alert('Cart is empty');
      return;
    }

    // TODO: Implement checkout logic with SalesAgent
    console.log('Checkout:', {
      items: this.cartService.items(),
      subtotal: this.cartService.subtotal(),
      tax: this.cartService.tax(),
      total: this.cartService.total()
    });

    alert(`Checkout total: $${this.cartService.total().toFixed(2)}\n\nCheckout functionality will be implemented with SalesAgent integration.`);
  }
}

// Made with Bob
