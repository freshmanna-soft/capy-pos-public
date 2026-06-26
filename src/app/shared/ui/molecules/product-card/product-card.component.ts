import { ChangeDetectionStrategy, Component, input, output } from '@angular/core';

import { Product } from '@core/domain/entities/product.entity';

/**
 * ProductCardComponent (Molecule)
 *
 * A single, selectable product tile used by the {@link ProductGridComponent}
 * organism. Owns the visual contract of a POS product card:
 * - Emoji, name and price
 * - Category badge and stock level
 * - Low-stock (orange) / out-of-stock (red, dimmed) visual indicators
 * - Click / Enter to select — only emits for in-stock products
 *
 * Renders in either `'grid'` (vertical tile) or `'list'` (compact row) layout
 * via the {@link view} input; the parent organism owns the container layout
 * and forwards its current view mode.
 *
 * The host element uses `display: contents` so this card participates directly
 * in the parent grid/flex container as if its markup were inline — keeping the
 * organism's grid/list layout intact after extraction.
 */
@Component({
  selector: 'app-product-card',
  standalone: true,
  imports: [],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div
      data-testid="product-card"
      class="product-card"
      [class.list-view]="view() === 'list'"
      [class.out-of-stock]="product().stock === 0"
      [class.low-stock]="product().isLowStock() && product().stock > 0"
      [class.clickable]="product().stock > 0"
      (click)="select()"
      (keydown.enter)="select()"
      role="button"
      tabindex="0"
      [attr.aria-disabled]="product().stock === 0"
      [attr.aria-label]="product().name + ' - $' + product().price.toFixed(2)"
    >
      <!-- Emoji/Image -->
      @if (product().emoji) {
        <span data-testid="product-emoji" class="product-emoji">{{ product().emoji }}</span>
      }

      <!-- Product Info -->
      <div class="product-details">
        <span data-testid="product-name" class="product-name">{{ product().name }}</span>
        <span data-testid="product-price" class="product-price"
          >\${{ product().price.toFixed(2) }}</span
        >
      </div>

      <!-- Meta Row -->
      <div class="product-meta">
        <span data-testid="product-category" class="category-badge">{{ product().category }}</span>
        <span data-testid="product-stock" class="stock-level">
          {{ product().stock }} in stock
        </span>
      </div>

      <!-- Stock Badges -->
      @if (product().isLowStock() && product().stock > 0) {
        <span data-testid="low-stock-badge" class="badge badge-warning">Low Stock</span>
      }
      @if (product().stock === 0) {
        <span data-testid="out-of-stock-badge" class="badge badge-danger">Out of Stock</span>
      }
    </div>
  `,
  styles: [
    `
      /* Card participates directly in the parent grid/list container. */
      :host {
        display: contents;
      }

      .product-card {
        display: flex;
        flex-direction: column;
        gap: 0.5rem;
        padding: 1rem;
        border: 1px solid #e5e7eb;
        border-radius: 12px;
        background: white;
        transition: all 0.2s ease;
        position: relative;
      }

      .product-card.clickable {
        cursor: pointer;
      }

      .product-card.clickable:hover {
        border-color: #667eea;
        box-shadow: 0 4px 12px rgba(102, 126, 234, 0.15);
        transform: translateY(-2px);
      }

      .product-card.out-of-stock {
        opacity: 0.5;
        cursor: not-allowed;
      }

      .product-card.low-stock {
        border-color: #f59e0b;
      }

      /* List layout: the parent switches its container to a column of rows. */
      .product-card.list-view {
        flex-direction: row;
        align-items: center;
        padding: 0.75rem 1rem;
      }

      .product-card.list-view .product-emoji {
        font-size: 1.5rem;
        margin-right: 1rem;
      }

      .product-card.list-view .product-details {
        flex: 1;
        flex-direction: row;
        justify-content: space-between;
        align-items: center;
      }

      .product-emoji {
        font-size: 2rem;
        text-align: center;
      }

      .product-details {
        display: flex;
        flex-direction: column;
        gap: 0.25rem;
      }

      .product-name {
        font-weight: 600;
        color: #1f2937;
        font-size: 0.9375rem;
      }

      .product-price {
        font-weight: 700;
        color: #667eea;
        font-size: 1.125rem;
      }

      .product-meta {
        display: flex;
        justify-content: space-between;
        align-items: center;
      }

      .category-badge {
        padding: 0.125rem 0.5rem;
        background: #f3f4f6;
        border-radius: 9999px;
        font-size: 0.6875rem;
        font-weight: 500;
        color: #6b7280;
        text-transform: uppercase;
        letter-spacing: 0.025em;
      }

      .stock-level {
        font-size: 0.75rem;
        color: #6b7280;
      }

      .badge {
        position: absolute;
        top: 0.5rem;
        right: 0.5rem;
        padding: 0.125rem 0.5rem;
        border-radius: 9999px;
        font-size: 0.625rem;
        font-weight: 700;
        text-transform: uppercase;
      }

      .badge-warning {
        background: #fef3c7;
        color: #d97706;
      }

      .badge-danger {
        background: #fee2e2;
        color: #dc2626;
      }
    `,
  ],
})
export class ProductCardComponent {
  /** The product this card renders. */
  readonly product = input.required<Product>();

  /** Layout mode, forwarded from the parent organism's view toggle. */
  readonly view = input<'grid' | 'list'>('grid');

  /** Emitted when an in-stock product is selected (click / Enter). */
  readonly selected = output<Product>();

  /**
   * Select this product. Out-of-stock products are not selectable, mirroring
   * the cashier workflow where unavailable items cannot be added to a sale.
   */
  select(): void {
    const product = this.product();
    if (product.stock === 0) {
      return;
    }
    this.selected.emit(product);
  }
}
