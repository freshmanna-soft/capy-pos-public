import { Component, input, output, signal, ChangeDetectionStrategy } from '@angular/core';

import { Product } from '@core/domain/entities/product.entity';

/**
 * ProductGridComponent (Organism)
 *
 * Displays search results in a grid/list view with:
 * - Grid/list view toggle
 * - Product cards with name, price, stock, category badge
 * - Low stock visual indicator (orange)
 * - Out of stock visual indicator (red, dimmed)
 * - Click to select product (emits productSelected)
 * - Responsive layout (3 columns → 2 → 1)
 *
 * Uses Angular signal-based state with input() pattern.
 * Sprint 1 Story: S1-2 Search Results Display
 * Agents consulted: QA Tester (test scenarios), UX Lead (design specs)
 */
@Component({
  selector: 'app-product-grid',
  standalone: true,
  imports: [],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <!-- Loading State -->
    @if (isLoading()) {
      <div data-testid="loading-results" class="loading-container">
        <div class="loading-spinner"></div>
        <p>Loading products...</p>
      </div>
    }

    <!-- Empty State -->
    @if (!isLoading() && products().length === 0) {
      <div data-testid="empty-results" class="empty-state">
        <span class="empty-icon">🔍</span>
        <p>No products found</p>
        <p class="empty-hint">Try adjusting your search or category filter</p>
      </div>
    }

    <!-- Results with View Toggle -->
    @if (!isLoading() && products().length > 0) {
      <!-- View Toggle -->
      <div class="view-toggle" data-testid="view-toggle">
        <button
          data-testid="view-grid"
          class="toggle-btn"
          [class.active]="viewMode() === 'grid'"
          (click)="setViewMode('grid')"
          aria-label="Grid view"
        >
          ⊞
        </button>
        <button
          data-testid="view-list"
          class="toggle-btn"
          [class.active]="viewMode() === 'list'"
          (click)="setViewMode('list')"
          aria-label="List view"
        >
          ☰
        </button>
        <span class="results-count">{{ products().length }} results</span>
      </div>

      <!-- Product Container -->
      <div
        data-testid="product-container"
        class="product-container"
        [class.grid-view]="viewMode() === 'grid'"
        [class.list-view]="viewMode() === 'list'"
      >
        @for (product of products(); track product.id) {
          <div
            data-testid="product-card"
            class="product-card"
            [class.out-of-stock]="product.stock === 0"
            [class.low-stock]="product.isLowStock() && product.stock > 0"
            [class.clickable]="product.stock > 0"
            (click)="onProductClick(product)"
            (keydown.enter)="onProductClick(product)"
            role="button"
            tabindex="0"
            [attr.aria-disabled]="product.stock === 0"
            [attr.aria-label]="product.name + ' - $' + product.price.toFixed(2)"
          >
            <!-- Emoji/Image -->
            @if (product.emoji) {
              <span data-testid="product-emoji" class="product-emoji">{{ product.emoji }}</span>
            }

            <!-- Product Info -->
            <div class="product-details">
              <span data-testid="product-name" class="product-name">{{ product.name }}</span>
              <span data-testid="product-price" class="product-price"
                >\${{ product.price.toFixed(2) }}</span
              >
            </div>

            <!-- Meta Row -->
            <div class="product-meta">
              <span data-testid="product-category" class="category-badge">{{
                product.category
              }}</span>
              <span data-testid="product-stock" class="stock-level">
                {{ product.stock }} in stock
              </span>
            </div>

            <!-- Stock Badges -->
            @if (product.isLowStock() && product.stock > 0) {
              <span data-testid="low-stock-badge" class="badge badge-warning">Low Stock</span>
            }
            @if (product.stock === 0) {
              <span data-testid="out-of-stock-badge" class="badge badge-danger">Out of Stock</span>
            }
          </div>
        }
      </div>
    }
  `,
  styles: [
    `
      :host {
        display: flex;
        flex-direction: column;
        height: 100%;
        gap: 0.75rem;
      }

      .view-toggle {
        display: flex;
        align-items: center;
        gap: 0.5rem;
        padding: 0.5rem 0;
      }

      .toggle-btn {
        padding: 0.375rem 0.625rem;
        border: 1px solid #d1d5db;
        border-radius: 6px;
        background: white;
        cursor: pointer;
        font-size: 1rem;
        transition: all 0.2s;
      }

      .toggle-btn:hover {
        border-color: #667eea;
      }

      .toggle-btn.active {
        background: #667eea;
        color: white;
        border-color: #667eea;
      }

      .results-count {
        margin-left: auto;
        font-size: 0.8125rem;
        color: #6b7280;
      }

      /* Grid View */
      .product-container.grid-view {
        display: grid;
        grid-template-columns: repeat(3, 1fr);
        gap: 1rem;
        overflow-y: auto;
        flex: 1;
      }

      @media (max-width: 1024px) {
        .product-container.grid-view {
          grid-template-columns: repeat(2, 1fr);
        }
      }

      @media (max-width: 640px) {
        .product-container.grid-view {
          grid-template-columns: 1fr;
        }
      }

      /* List View */
      .product-container.list-view {
        display: flex;
        flex-direction: column;
        gap: 0.5rem;
        overflow-y: auto;
        flex: 1;
      }

      .product-container.list-view .product-card {
        flex-direction: row;
        align-items: center;
        padding: 0.75rem 1rem;
      }

      .product-container.list-view .product-emoji {
        font-size: 1.5rem;
        margin-right: 1rem;
      }

      .product-container.list-view .product-details {
        flex: 1;
        flex-direction: row;
        justify-content: space-between;
        align-items: center;
      }

      /* Product Card */
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

      /* Empty State */
      .empty-state {
        display: flex;
        flex-direction: column;
        align-items: center;
        justify-content: center;
        padding: 3rem;
        text-align: center;
        color: #6b7280;
      }

      .empty-icon {
        font-size: 3rem;
        margin-bottom: 1rem;
      }

      .empty-hint {
        font-size: 0.8125rem;
        color: #9ca3af;
        margin-top: 0.5rem;
      }

      /* Loading State */
      .loading-container {
        display: flex;
        flex-direction: column;
        align-items: center;
        justify-content: center;
        padding: 3rem;
        color: #6b7280;
      }

      .loading-spinner {
        width: 2rem;
        height: 2rem;
        border: 3px solid #e5e7eb;
        border-top-color: #667eea;
        border-radius: 50%;
        animation: spin 0.8s linear infinite;
        margin-bottom: 1rem;
      }

      @keyframes spin {
        to {
          transform: rotate(360deg);
        }
      }

      /* Scrollbar */
      .product-container::-webkit-scrollbar {
        width: 6px;
      }

      .product-container::-webkit-scrollbar-track {
        background: #f9fafb;
      }

      .product-container::-webkit-scrollbar-thumb {
        background: #d1d5db;
        border-radius: 3px;
      }
    `,
  ],
})
export class ProductGridComponent {
  // Signal inputs — bind from the host (e.g. POS terminal) via [products]/[isLoading].
  readonly products = input<Product[]>([]);
  readonly isLoading = input<boolean>(false);

  // Internal view state (toggled by the grid's own controls).
  readonly viewMode = signal<'grid' | 'list'>('grid');

  // Signal-based output
  readonly productSelected = output<Product>();

  /**
   * Set view mode (grid or list)
   */
  setViewMode(mode: 'grid' | 'list'): void {
    this.viewMode.set(mode);
  }

  /**
   * Handle product card click
   * Only emits for in-stock products
   */
  onProductClick(product: Product): void {
    if (product.stock === 0) {
      return;
    }
    this.productSelected.emit(product);
  }
}
