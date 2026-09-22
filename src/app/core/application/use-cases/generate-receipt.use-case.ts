import { Injectable, inject } from '@angular/core';
import { CartService } from '@core/application/services/cart.service';
import { CartItem } from '@core/application/services/cart.service.interface';
import { PaymentResult } from '@features/pos-terminal/components/checkout/checkout.component';
import { KioskSettingsService } from '@core/application/services/kiosk-settings.service';

/**
 * Receipt data structure for display
 */
export interface ReceiptData {
  payment: PaymentResult;
  items: CartItem[];
  subtotal: number;
  tax: number;
  taxRate: number;
  total: number;
  /** Display name of the store that processed the transaction. */
  storeName: string;
  /** Store address, shown on the receipt footer. */
  storeAddress: string;
}

/**
 * Generate Receipt Use Case
 *
 * Captures cart state and payment result to produce a ReceiptData object.
 * Must be called BEFORE clearing the cart, as it reads current cart items.
 *
 * Domain Rules:
 * - Receipt must include all items at time of payment
 * - Totals must match the cart calculations
 * - Tax rate is captured at time of transaction
 *
 * @example
 * ```typescript
 * const receipt = this.generateReceipt.execute(paymentResult);
 * ```
 */
@Injectable({
  providedIn: 'root',
})
export class GenerateReceiptUseCase {
  private readonly cartService = inject(CartService);
  private readonly kioskSettings = inject(KioskSettingsService);

  /**
   * Generates receipt data from current cart state and payment result.
   *
   * @param payment - The completed payment result
   * @returns ReceiptData with all transaction details
   */
  execute(payment: PaymentResult): ReceiptData {
    return {
      payment,
      items: [...this.cartService.items()],
      subtotal: this.cartService.subtotal(),
      tax: this.cartService.tax(),
      taxRate: this.cartService.taxRate(),
      total: this.cartService.total(),
      storeName: this.kioskSettings.storeName() || 'Capy-POS',
      storeAddress: this.kioskSettings.storeAddress(),
    };
  }

  /**
   * Generates receipt data from explicit values (for reconstruction from persisted data).
   *
   * @param payment - The payment result
   * @param items - Cart items snapshot
   * @param subtotal - Calculated subtotal
   * @param tax - Calculated tax
   * @param taxRate - Tax rate at time of transaction
   * @param total - Calculated total
   * @returns ReceiptData with all transaction details
   */
  fromSnapshot(
    payment: PaymentResult,
    items: CartItem[],
    subtotal: number,
    tax: number,
    taxRate: number,
    total: number,
    storeName = '',
    storeAddress = ''
  ): ReceiptData {
    return { payment, items, subtotal, tax, taxRate, total, storeName, storeAddress };
  }
}
