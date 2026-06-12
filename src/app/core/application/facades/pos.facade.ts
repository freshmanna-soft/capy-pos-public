import { Injectable, inject } from '@angular/core';
import { CartService } from '@core/application/services/cart.service';
import {
  GenerateReceiptUseCase,
  ReceiptData,
} from '@core/application/use-cases/generate-receipt.use-case';
import {
  AdjustStockOnSaleUseCase,
  StockAdjustmentResult,
} from '@core/application/use-cases/adjust-stock-on-sale.use-case';
import { DexieDatabase } from '@core/infrastructure/database/dexie-database.service';
import { Product } from '@core/domain/entities/product.entity';
import { PaymentResult } from '@features/pos-terminal/components/checkout/checkout.component';

/**
 * PosFacade - Single point of access for POS Terminal operations.
 *
 * Orchestrates CartService, GenerateReceiptUseCase, AdjustStockOnSaleUseCase,
 * and DexieDatabase behind a simplified API for the PosTerminalComponent.
 *
 * Responsibilities:
 * - Cart state exposure (signals)
 * - Cart operations (add, remove, clear)
 * - Stock validation on add
 * - Checkout orchestration (receipt + stock adjustment + cart clear)
 * - Database initialization
 *
 * Does NOT contain business logic — delegates to use-cases and services.
 */
@Injectable({ providedIn: 'root' })
export class PosFacade {
  private readonly cartService = inject(CartService);
  private readonly generateReceipt = inject(GenerateReceiptUseCase);
  private readonly adjustStock = inject(AdjustStockOnSaleUseCase);
  private readonly db = inject(DexieDatabase);

  // ─── Cart State (read-only signals) ───────────────────────────────────

  /** Current cart items */
  readonly cartItems = this.cartService.items;

  /** Total number of items in cart */
  readonly totalItems = this.cartService.totalItems;

  /** Cart subtotal before tax */
  readonly subtotal = this.cartService.subtotal;

  /** Tax amount */
  readonly tax = this.cartService.tax;

  /** Cart total including tax */
  readonly total = this.cartService.total;

  /** Whether the cart is empty */
  readonly isCartEmpty = this.cartService.isEmpty;

  // ─── Cart Operations ──────────────────────────────────────────────────

  /**
   * Adds a product to the cart with stock validation.
   * @returns true if product was added, false if rejected (out of stock or exceeds available)
   */
  addToCart(product: Product): boolean {
    if (product.isOutOfStock()) {
      return false;
    }

    const currentQuantity = this.cartService.getQuantity(product.id);
    if (currentQuantity >= product.stock) {
      return false;
    }

    this.cartService.addProduct(product);
    return true;
  }

  /** Increase quantity of a product in cart */
  increaseQuantity(productId: string): void {
    this.cartService.increaseQuantity(productId);
  }

  /** Decrease quantity of a product in cart */
  decreaseQuantity(productId: string): void {
    this.cartService.decreaseQuantity(productId);
  }

  /** Remove a product from cart entirely */
  removeFromCart(productId: string): void {
    this.cartService.removeItem(productId);
  }

  /** Clear all items from cart */
  clearCart(): void {
    this.cartService.clearCart();
  }

  /** Get current quantity of a product in cart */
  getQuantity(productId: string): number {
    return this.cartService.getQuantity(productId);
  }

  // ─── Checkout Operations ──────────────────────────────────────────────

  /**
   * Completes a checkout: generates receipt, adjusts stock, clears cart.
   * Stock adjustment is best-effort — checkout completes even if it fails.
   *
   * @param paymentResult - The payment result from the checkout component
   * @returns The generated receipt data
   */
  async checkout(paymentResult: PaymentResult): Promise<ReceiptData> {
    // Capture cart items BEFORE clearing for stock adjustment
    const cartItems = this.cartService.items();
    const stockAdjustmentItems = cartItems.map(
      (item: { product: { id: string }; quantity: number }) => ({
        productId: item.product.id,
        quantity: item.quantity,
      })
    );

    // Generate receipt from current cart state BEFORE clearing
    const receipt = this.generateReceipt.execute(paymentResult);

    // Adjust stock levels (fire-and-forget, best-effort)
    try {
      const result: StockAdjustmentResult = await this.adjustStock.execute(stockAdjustmentItems);
      if (!result.success) {
        console.error('[PosFacade] Stock adjustment partially failed:', result.failedAdjustments);
      }
    } catch (error) {
      console.error('[PosFacade] Stock adjustment failed entirely:', error);
    }

    // Clear cart after checkout
    this.cartService.clearCart();

    return receipt;
  }

  // ─── Database Operations ──────────────────────────────────────────────

  /** Initialize database with seed data if empty */
  async initializeDatabase(): Promise<void> {
    await this.db.initializeWithSeedData();
  }
}
