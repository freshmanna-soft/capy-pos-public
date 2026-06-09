import { Injectable, computed, signal, inject, Signal } from '@angular/core';
import { CartService } from '@core/application/services/cart.service';

/**
 * Cart Totals DTO
 * Represents the calculated totals for the shopping cart
 */
export interface CartTotalsDto {
  subtotal: number;
  taxRate: number;
  taxAmount: number;
  discountAmount: number;
  discountLabel: string;
  total: number;
  itemCount: number;
  isEmpty: boolean;
}

/**
 * Discount configuration for the cart
 */
export interface CartDiscount {
  type: 'percentage' | 'fixed';
  value: number;
  label: string;
}

/**
 * Calculate Cart Totals Use Case
 *
 * Application layer use case responsible for orchestrating
 * cart total calculations including subtotal, tax, discounts, and final total.
 *
 * Follows Clean Architecture: Application layer orchestrates domain logic.
 * Uses Angular Signals for reactive computed values.
 *
 * @example
 * ```typescript
 * const useCase = inject(CalculateCartTotalsUseCase);
 * const totals = useCase.totals();
 * console.log(totals.total); // Final amount due
 * ```
 */
@Injectable({
  providedIn: 'root',
})
export class CalculateCartTotalsUseCase {
  private readonly cartService = inject(CartService);
  private readonly _discount = signal<CartDiscount | null>(null);

  /** Current applied discount */
  readonly discount: Signal<CartDiscount | null> = this._discount.asReadonly();

  /** Computed discount amount based on subtotal and discount config */
  readonly discountAmount: Signal<number> = computed(() => {
    const discount = this._discount();
    if (!discount) return 0;

    const subtotal = this.cartService.subtotal();
    if (subtotal === 0) return 0;

    switch (discount.type) {
      case 'percentage':
        return Math.round(subtotal * (discount.value / 100) * 100) / 100;
      case 'fixed':
        return Math.min(discount.value, subtotal);
      default:
        return 0;
    }
  });

  /** Computed total after discount and tax */
  readonly totalWithDiscount: Signal<number> = computed(() => {
    const subtotal = this.cartService.subtotal();
    const discount = this.discountAmount();
    const taxableAmount = subtotal - discount;
    const tax = Math.round(taxableAmount * this.cartService.taxRate() * 100) / 100;
    return Math.round((taxableAmount + tax) * 100) / 100;
  });

  /** Tax amount considering discounts */
  readonly taxAmount: Signal<number> = computed(() => {
    const subtotal = this.cartService.subtotal();
    const discount = this.discountAmount();
    const taxableAmount = subtotal - discount;
    return Math.round(taxableAmount * this.cartService.taxRate() * 100) / 100;
  });

  /** Complete cart totals DTO */
  readonly totals: Signal<CartTotalsDto> = computed(() => ({
    subtotal: this.cartService.subtotal(),
    taxRate: this.cartService.taxRate(),
    taxAmount: this.taxAmount(),
    discountAmount: this.discountAmount(),
    discountLabel: this._discount()?.label ?? '',
    total: this.totalWithDiscount(),
    itemCount: this.cartService.totalItems(),
    isEmpty: this.cartService.isEmpty(),
  }));

  /**
   * Applies a discount to the cart
   * @throws Error if discount value is negative or percentage exceeds 100
   */
  applyDiscount(discount: CartDiscount): void {
    if (discount.value < 0) {
      throw new Error('Discount value cannot be negative');
    }
    if (discount.type === 'percentage' && discount.value > 100) {
      throw new Error('Percentage discount cannot exceed 100%');
    }
    this._discount.set(discount);
  }

  /**
   * Removes any applied discount
   */
  removeDiscount(): void {
    this._discount.set(null);
  }
}
