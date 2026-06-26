import { Component, input, output, signal, ChangeDetectionStrategy } from '@angular/core';

import { Product } from '@core/domain/entities/product.entity';
import { ProductCardComponent } from '@shared/ui/molecules/product-card/product-card.component';

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
 * Owns the container layout and view toggle; each tile is rendered by the
 * {@link ProductCardComponent} molecule, which owns the card's own markup,
 * styling and selection guard.
 *
 * Uses Angular signal-based state with input() pattern.
 * Sprint 1 Story: S1-2 Search Results Display
 * Agents consulted: QA Tester (test scenarios), UX Lead (design specs)
 */
@Component({
  selector: 'app-product-grid',
  standalone: true,
  imports: [ProductCardComponent],
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
          <app-product-card
            [product]="product"
            [view]="viewMode()"
            (selected)="onProductSelected($event)"
          />
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
   * Forward a product-card selection to the host. The molecule already guards
   * out-of-stock items, so the grid simply re-emits the choice.
   */
  onProductSelected(product: Product): void {
    this.productSelected.emit(product);
  }
}
