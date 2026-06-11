import { Component, ViewChild, OnInit, inject, signal } from '@angular/core';

import { ProductSearchComponent } from '@features/pos-terminal/components/product-search/product-search.component';
import { ShoppingCartComponent } from '@features/pos-terminal/components/shopping-cart/shopping-cart.component';
import {
  CheckoutComponent,
  PaymentResult,
} from '@features/pos-terminal/components/checkout/checkout.component';
import { ReceiptComponent } from '@features/pos-terminal/components/receipt/receipt.component';
import { Product } from '@core/domain/entities/product.entity';
import { DexieDatabase } from '@core/infrastructure/database/dexie-database.service';
import { CartService } from '@core/application/services/cart.service';
import {
  GenerateReceiptUseCase,
  ReceiptData,
} from '@core/application/use-cases/generate-receipt.use-case';
import { AdjustStockOnSaleUseCase } from '@core/application/use-cases/adjust-stock-on-sale.use-case';

/**
 * POS Terminal Page Component
 *
 * Main page for the Point of Sale terminal.
 * Integrates product search and shopping cart functionality.
 *
 * Features:
 * - Product search with real-time results
 * - Shopping cart management
 * - Responsive layout (search on left, cart on right)
 * - Product selection and cart integration
 *
 * Layout:
 * - Desktop: Two-column layout (60/40 split)
 * - Mobile: Stacked layout with tabs
 */
@Component({
  selector: 'app-pos-terminal',
  standalone: true,
  imports: [ProductSearchComponent, ShoppingCartComponent, CheckoutComponent, ReceiptComponent],
  templateUrl: './pos-terminal.component.html',
  styleUrl: './pos-terminal.component.scss',
})
export class PosTerminalComponent implements OnInit {
  private db = inject(DexieDatabase);
  private cartService = inject(CartService);
  private generateReceipt = inject(GenerateReceiptUseCase);
  private adjustStock = inject(AdjustStockOnSaleUseCase);

  @ViewChild(ShoppingCartComponent) shoppingCart!: ShoppingCartComponent;
  @ViewChild(ProductSearchComponent) productSearch!: ProductSearchComponent;

  /** Controls visibility of the checkout overlay */
  readonly showCheckout = signal(false);

  /** Controls visibility of the receipt overlay */
  readonly showReceipt = signal(false);

  /** Last completed payment result */
  readonly lastPayment = signal<PaymentResult | null>(null);

  /** Receipt data for display after payment */
  readonly receiptData = signal<ReceiptData | null>(null);

  async ngOnInit() {
    // Initialize database with seed data if empty
    try {
      await this.db.initializeWithSeedData();
      console.log('Database initialized with seed data');
    } catch (error) {
      console.error('Failed to initialize database:', error);
    }
  }

  /**
   * Handles product selection from search.
   * Validates stock availability before adding to cart.
   *
   * Rules:
   * - Out-of-stock products (stock === 0) are rejected
   * - Products cannot exceed available stock in cart
   */
  handleProductSelected(product: Product): void {
    // Use setTimeout to ensure ViewChild is initialized
    setTimeout(() => {
      if (!this.shoppingCart) {
        console.error('Shopping cart not initialized');
        return;
      }

      // Prevent adding out-of-stock products
      if (product.isOutOfStock()) {
        console.warn('Cannot add out-of-stock product:', product.name);
        return;
      }

      // Check if adding would exceed available stock
      const currentQuantity = this.shoppingCart.cartService.getQuantity(product.id);
      if (currentQuantity >= product.stock) {
        console.warn(
          'Cannot exceed available stock for:',
          product.name,
          `(${currentQuantity}/${product.stock})`,
        );
        return;
      }

      // Add product to cart
      this.shoppingCart.addProduct(product);

      // Show feedback
      console.log('Product added to cart:', product.name);
    }, 0);
  }

  /**
   * Starts a new transaction
   */
  startNewTransaction(): void {
    if (!this.shoppingCart) {
      console.error('Shopping cart not initialized');
      return;
    }

    // Clear the cart
    this.shoppingCart.clearCart();
  }

  /**
   * Handles adding a product to the cart
   */
  handleAddProduct(): void {
    // This would typically trigger the product selection flow
    console.log('Add Product button clicked');
  }

  /**
   * Opens the checkout overlay
   */
  openCheckout(): void {
    if (!this.cartService.isEmpty()) {
      this.showCheckout.set(true);
    }
  }

  /**
   * Closes the checkout overlay
   */
  closeCheckout(): void {
    this.showCheckout.set(false);
  }

  /**
   * Handles successful payment completion.
   * Generates receipt and adjusts stock BEFORE clearing cart to capture item snapshot.
   * Stock adjustment is fire-and-forget — sale completes even if adjustment fails.
   */
  handlePaymentComplete(result: PaymentResult): void {
    // Capture cart items BEFORE clearing for stock adjustment
    const cartItems = this.cartService.items();
    const stockAdjustmentItems = cartItems.map((item) => ({
      productId: item.product.id,
      quantity: item.quantity,
    }));

    // Generate receipt from current cart state BEFORE clearing
    const receipt = this.generateReceipt.execute(result);
    this.receiptData.set(receipt);

    // Adjust stock levels and refresh product list on success
    this.adjustStock
      .execute(stockAdjustmentItems)
      .then((adjustmentResult) => {
        if (!adjustmentResult.success) {
          console.error(
            '[POS] Stock adjustment partially failed. Manual reconciliation needed:',
            adjustmentResult.failedAdjustments,
          );
        } else {
          console.log(
            '[POS] Stock adjusted successfully for',
            adjustmentResult.adjustedProducts.length,
            'products',
          );
        }
        // Refresh product search to show updated stock numbers
        if (this.productSearch) {
          this.productSearch.refreshProducts();
        }
      })
      .catch((error) => {
        console.error('[POS] Stock adjustment failed entirely:', error);
      });

    this.lastPayment.set(result);
    this.showCheckout.set(false);
    this.showReceipt.set(true);
    this.cartService.clearCart();
    console.log('Payment completed:', result);
  }

  /**
   * Handles print receipt action from receipt component
   */
  handlePrintReceipt(): void {
    window.print();
  }

  /**
   * Handles new transaction action from receipt component.
   * Dismisses receipt and resets state for next transaction.
   */
  handleNewTransactionFromReceipt(): void {
    this.showReceipt.set(false);
    this.receiptData.set(null);
    this.lastPayment.set(null);
  }
}
