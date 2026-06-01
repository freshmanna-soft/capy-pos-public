import { Signal } from '@angular/core';
import { Product } from '../../domain/entities/product.entity';

/**
 * Interface representing an item in the shopping cart
 */
export interface CartItem {
  product: Product;
  quantity: number;
}

/**
 * Interface for cart service operations.
 * Defines the contract for managing shopping cart state and operations.
 */
export interface ICartService {
  // State signals (read-only)
  readonly items: Signal<readonly CartItem[]>;
  readonly taxRate: Signal<number>;

  // Computed values
  readonly totalItems: Signal<number>;
  readonly subtotal: Signal<number>;
  readonly tax: Signal<number>;
  readonly total: Signal<number>;
  readonly isEmpty: Signal<boolean>;

  // Operations
  /**
   * Adds a product to the cart. If the product already exists, increases quantity by 1.
   * 
   * @param product - The product to add to the cart
   * @throws Error if product is null or undefined
   */
  addProduct(product: Product): void;

  /**
   * Increases the quantity of a product in the cart by 1.
   * 
   * @param productId - The ID of the product to increase quantity for
   * @throws Error if product is not found in cart
   */
  increaseQuantity(productId: string): void;

  /**
   * Decreases the quantity of a product in the cart by 1.
   * If quantity reaches 0, removes the item from cart.
   * 
   * @param productId - The ID of the product to decrease quantity for
   * @throws Error if product is not found in cart
   */
  decreaseQuantity(productId: string): void;

  /**
   * Updates the quantity of a product in the cart to a specific value.
   * If quantity is 0 or negative, removes the item from cart.
   * 
   * @param productId - The ID of the product to update
   * @param quantity - The new quantity (must be >= 0)
   * @throws Error if product is not found in cart or quantity is negative
   */
  updateQuantity(productId: string, quantity: number): void;

  /**
   * Removes a product from the cart completely.
   * 
   * @param productId - The ID of the product to remove
   */
  removeItem(productId: string): void;

  /**
   * Removes all items from the cart.
   */
  clearCart(): void;

  /**
   * Updates the tax rate for cart calculations.
   * 
   * @param rate - The new tax rate (e.g., 0.085 for 8.5%)
   * @throws Error if rate is negative or greater than 1
   */
  setTaxRate(rate: number): void;

  /**
   * Gets a specific cart item by product ID.
   * 
   * @param productId - The ID of the product to find
   * @returns The cart item or undefined if not found
   */
  getItem(productId: string): CartItem | undefined;

  /**
   * Checks if a product is in the cart.
   * 
   * @param productId - The ID of the product to check
   * @returns true if product is in cart, false otherwise
   */
  hasProduct(productId: string): boolean;

  /**
   * Gets the quantity of a specific product in the cart.
   * 
   * @param productId - The ID of the product
   * @returns The quantity or 0 if product is not in cart
   */
  getQuantity(productId: string): number;
}

// Made with Bob
