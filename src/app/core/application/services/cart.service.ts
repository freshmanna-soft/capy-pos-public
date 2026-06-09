import { Injectable, computed, signal } from '@angular/core';
import { Product } from '@core/domain/entities/product.entity';
import { CartItem } from '@core/application/services/cart.service.interface';

/**
 * Service responsible for managing shopping cart state and operations.
 * Uses Angular signals for reactive state management.
 *
 * @example
 * ```typescript
 * constructor(private cartService: CartService) {}
 *
 * addToCart(product: Product) {
 *   this.cartService.addProduct(product);
 * }
 * ```
 */
@Injectable({
  providedIn: 'root',
})
export class CartService {
  // State signals
  private readonly _items = signal<CartItem[]>([]);
  private readonly _taxRate = signal<number>(0.085); // 8.5% default tax rate

  // Public read-only signals
  readonly items = this._items.asReadonly();
  readonly taxRate = this._taxRate.asReadonly();

  // Computed values
  readonly totalItems = computed(() => {
    return this._items().reduce((sum, item) => sum + item.quantity, 0);
  });

  readonly subtotal = computed(() => {
    return this._items().reduce((sum, item) => {
      return sum + item.product.price * item.quantity;
    }, 0);
  });

  readonly tax = computed(() => {
    return this.subtotal() * this._taxRate();
  });

  readonly total = computed(() => {
    return this.subtotal() + this.tax();
  });

  readonly isEmpty = computed(() => {
    return this._items().length === 0;
  });

  /**
   * Adds a product to the cart. If the product already exists, increases quantity by 1.
   *
   * @param product - The product to add to the cart
   * @throws Error if product is null or undefined
   */
  addProduct(product: Product): void {
    if (!product) {
      throw new Error('Cannot add null or undefined product to cart');
    }

    const currentItems = this._items();
    const existingItemIndex = currentItems.findIndex((item) => item.product.id === product.id);

    if (existingItemIndex >= 0) {
      // Product exists, increase quantity
      const updatedItems = [...currentItems];
      updatedItems[existingItemIndex] = {
        ...updatedItems[existingItemIndex],
        quantity: updatedItems[existingItemIndex].quantity + 1,
      };
      this._items.set(updatedItems);
    } else {
      // New product, add to cart
      this._items.set([...currentItems, { product, quantity: 1 }]);
    }
  }

  /**
   * Increases the quantity of a product in the cart by 1.
   *
   * @param productId - The ID of the product to increase quantity for
   * @throws Error if product is not found in cart
   */
  increaseQuantity(productId: string): void {
    const currentItems = this._items();
    const itemIndex = currentItems.findIndex((item) => item.product.id === productId);

    if (itemIndex === -1) {
      throw new Error(`Product with ID ${productId} not found in cart`);
    }

    const updatedItems = [...currentItems];
    updatedItems[itemIndex] = {
      ...updatedItems[itemIndex],
      quantity: updatedItems[itemIndex].quantity + 1,
    };
    this._items.set(updatedItems);
  }

  /**
   * Decreases the quantity of a product in the cart by 1.
   * If quantity reaches 0, removes the item from cart.
   *
   * @param productId - The ID of the product to decrease quantity for
   * @throws Error if product is not found in cart
   */
  decreaseQuantity(productId: string): void {
    const currentItems = this._items();
    const itemIndex = currentItems.findIndex((item) => item.product.id === productId);

    if (itemIndex === -1) {
      throw new Error(`Product with ID ${productId} not found in cart`);
    }

    const currentQuantity = currentItems[itemIndex].quantity;

    if (currentQuantity <= 1) {
      // Remove item if quantity would be 0
      this.removeItem(productId);
    } else {
      // Decrease quantity
      const updatedItems = [...currentItems];
      updatedItems[itemIndex] = {
        ...updatedItems[itemIndex],
        quantity: currentQuantity - 1,
      };
      this._items.set(updatedItems);
    }
  }

  /**
   * Updates the quantity of a product in the cart to a specific value.
   * If quantity is 0 or negative, removes the item from cart.
   *
   * @param productId - The ID of the product to update
   * @param quantity - The new quantity (must be >= 0)
   * @throws Error if product is not found in cart or quantity is negative
   */
  updateQuantity(productId: string, quantity: number): void {
    if (quantity < 0) {
      throw new Error('Quantity cannot be negative');
    }

    if (quantity === 0) {
      this.removeItem(productId);
      return;
    }

    const currentItems = this._items();
    const itemIndex = currentItems.findIndex((item) => item.product.id === productId);

    if (itemIndex === -1) {
      throw new Error(`Product with ID ${productId} not found in cart`);
    }

    const updatedItems = [...currentItems];
    updatedItems[itemIndex] = {
      ...updatedItems[itemIndex],
      quantity,
    };
    this._items.set(updatedItems);
  }

  /**
   * Removes a product from the cart completely.
   *
   * @param productId - The ID of the product to remove
   */
  removeItem(productId: string): void {
    const currentItems = this._items();
    const filteredItems = currentItems.filter((item) => item.product.id !== productId);
    this._items.set(filteredItems);
  }

  /**
   * Removes all items from the cart.
   */
  clearCart(): void {
    this._items.set([]);
  }

  /**
   * Updates the tax rate for cart calculations.
   *
   * @param rate - The new tax rate (e.g., 0.085 for 8.5%)
   * @throws Error if rate is negative or greater than 1
   */
  setTaxRate(rate: number): void {
    if (rate < 0 || rate > 1) {
      throw new Error('Tax rate must be between 0 and 1');
    }
    this._taxRate.set(rate);
  }

  /**
   * Gets a specific cart item by product ID.
   *
   * @param productId - The ID of the product to find
   * @returns The cart item or undefined if not found
   */
  getItem(productId: string): CartItem | undefined {
    return this._items().find((item) => item.product.id === productId);
  }

  /**
   * Checks if a product is in the cart.
   *
   * @param productId - The ID of the product to check
   * @returns true if product is in cart, false otherwise
   */
  hasProduct(productId: string): boolean {
    return this._items().some((item) => item.product.id === productId);
  }

  /**
   * Gets the quantity of a specific product in the cart.
   *
   * @param productId - The ID of the product
   * @returns The quantity or 0 if product is not in cart
   */
  getQuantity(productId: string): number {
    const item = this.getItem(productId);
    return item ? item.quantity : 0;
  }
}

// Made with Bob
