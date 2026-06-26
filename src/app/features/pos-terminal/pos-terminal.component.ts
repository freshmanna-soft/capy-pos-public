import { Component, ViewChild, OnInit, inject, signal } from '@angular/core';

import { ProductSearchComponent } from '@features/pos-terminal/components/product-search/product-search.component';
import { ShoppingCartComponent } from '@features/pos-terminal/components/shopping-cart/shopping-cart.component';
import {
  CheckoutComponent,
  PaymentResult,
} from '@features/pos-terminal/components/checkout/checkout.component';
import { ReceiptComponent } from '@features/pos-terminal/components/receipt/receipt.component';
import { Product } from '@core/domain/entities/product.entity';
import { PosFacade } from '@core/application/facades';
import { ReceiptData } from '@core/application/use-cases/generate-receipt.use-case';
import { ToastService } from '@shared/ui/toast/toast.service';

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
  protected readonly posFacade = inject(PosFacade);
  private readonly toast = inject(ToastService);

  @ViewChild(ProductSearchComponent) productSearch!: ProductSearchComponent;

  /** Controls visibility of the checkout overlay */
  readonly showCheckout = signal(false);

  /** Controls visibility of the receipt overlay */
  readonly showReceipt = signal(false);

  /** Controls visibility of the mobile cart bottom sheet */
  readonly mobileCartOpen = signal(false);

  /** Last completed payment result */
  readonly lastPayment = signal<PaymentResult | null>(null);

  /** Receipt data for display after payment */
  readonly receiptData = signal<ReceiptData | null>(null);

  ngOnInit(): void {
    // Initialize database with seed data if empty. The product search loads the
    // active catalog itself, so this only needs to ensure the data exists.
    this.posFacade
      .initializeDatabase()
      .then(() => {
        console.log('Database initialized with seed data');
      })
      .catch((error: unknown) => {
        console.error('Failed to initialize database:', error);
      });
  }

  /**
   * Handles product selection from search.
   * Delegates stock validation to PosFacade and surfaces the outcome to the
   * cashier via a toast — previously a rejected scan failed silently to the
   * console, making it easy to under-scan without noticing. The cart is
   * signal-driven, so no ViewChild/setTimeout deferral is needed.
   */
  handleProductSelected(product: Product): void {
    const result = this.posFacade.tryAddToCart(product);

    if (!result.added) {
      const message =
        result.reason === 'out-of-stock'
          ? `${product.name} is out of stock`
          : `Only ${product.stock} of ${product.name} available`;
      this.toast.warning(message);
      return;
    }

    this.toast.success(`${product.name} added to cart`);
  }

  /**
   * Starts a new transaction. Guards against accidental data loss: when the
   * cart already has items, the cashier must confirm before it is discarded
   * (mirrors the in-cart "Clear Cart" confirmation).
   */
  startNewTransaction(): void {
    if (
      this.posFacade.isCartEmpty() ||
      confirm('Start a new transaction? This will clear the current cart.')
    ) {
      this.posFacade.clearCart();
    }
  }

  /**
   * Handles the header "Add Product" action by focusing the product search so
   * the cashier can immediately type/scan an item.
   */
  handleAddProduct(): void {
    this.productSearch?.focusSearch();
  }

  /**
   * Opens the checkout overlay
   */
  openCheckout(): void {
    if (!this.posFacade.isCartEmpty()) {
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
   * Delegates checkout orchestration to PosFacade.
   */
  handlePaymentComplete(result: PaymentResult): void {
    this.posFacade
      .checkout(result)
      .then((receipt) => {
        this.receiptData.set(receipt);
        this.lastPayment.set(result);
        this.showCheckout.set(false);
        this.showReceipt.set(true);

        // Refresh product search to show updated stock numbers
        if (this.productSearch) {
          this.productSearch.refreshProducts();
        }

        console.log('Payment completed:', result);
      })
      .catch((error: unknown) => {
        console.error('[POS] Checkout failed:', error);
        // Recover the UI: close the stuck "Processing…" dialog and tell the
        // cashier. The cart is preserved so they can retry.
        this.showCheckout.set(false);
        this.toast.error('Checkout failed. Your cart was kept — please try again.');
      });
  }

  /**
   * Handles print receipt action from receipt component
   */
  handlePrintReceipt(): void {
    globalThis.print();
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

  /**
   * Toggles the mobile cart bottom sheet
   */
  toggleMobileCart(): void {
    this.mobileCartOpen.update((v) => !v);
  }

  /**
   * Closes the mobile cart bottom sheet
   */
  closeMobileCart(): void {
    this.mobileCartOpen.set(false);
  }
}
