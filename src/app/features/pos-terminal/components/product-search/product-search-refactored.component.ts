import { Component, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { from, Observable } from 'rxjs';
import { BaseSearchComponent } from '../../../../shared/ui/molecules/base-search/base-search.component';
import { ProductService } from '../../../../core/application/services/product.service';
import { Product } from '../../../../core/domain/entities/product.entity';

/**
 * ProductSearchComponent (Extends BaseSearchComponent)
 * 
 * Specialized search component for products
 * Inherits all search functionality from BaseSearchComponent
 * Only implements product-specific behavior
 * 
 * TDD: Implements Cucumber scenarios from product-search.feature
 * 
 * @example
 * ```html
 * <app-product-search 
 *   (itemSelected)="onProductSelected($event)">
 * </app-product-search>
 * ```
 */
@Component({
  selector: 'app-product-search',
  standalone: true,
  imports: [CommonModule],
  template: `
    <div class="product-search-container">
      <!-- Search Input -->
      <div class="search-input-wrapper">
        <input
          #searchInput
          data-testid="product-search"
          type="search"
          [value]="searchQuery()"
          (input)="onSearchInput($event)"
          (keydown)="onKeyDown($event)"
          placeholder="Search products..."
          class="search-input"
          [attr.role]="getAriaAttributes().role"
          [attr.aria-autocomplete]="getAriaAttributes()['aria-autocomplete']"
          [attr.aria-expanded]="getAriaAttributes()['aria-expanded']"
          [attr.aria-controls]="getAriaAttributes()['aria-controls']"
          [attr.aria-activedescendant]="getAriaAttributes()['aria-activedescendant']"
        />
        
        <button 
          data-testid="search-button"
          class="search-button"
          (click)="triggerSearch()"
          [disabled]="isLoading()"
        >
          <span *ngIf="!isLoading()">🔍</span>
          <span *ngIf="isLoading()" class="spinner">⏳</span>
        </button>
      </div>

      <!-- Loading Indicator -->
      <div 
        *ngIf="isLoading()" 
        data-testid="search-loading"
        class="loading-indicator"
      >
        Searching...
      </div>

      <!-- Error Message -->
      <div 
        *ngIf="error()" 
        data-testid="search-error"
        class="error-message"
        role="alert"
      >
        {{ error() }}
      </div>

      <!-- Search Results -->
      <div 
        *ngIf="searchResults().length > 0 && !isLoading()"
        id="search-results"
        class="search-results"
        role="listbox"
        [attr.aria-label]="getResultCountAnnouncement()"
      >
        <div
          *ngFor="let product of searchResults(); let i = index"
          [id]="'result-' + i"
          data-testid="product-result"
          class="product-result"
          [class.highlighted]="isHighlighted(i)"
          [class.out-of-stock]="product.stock === 0"
          (click)="selectItem(product)"
          (mouseenter)="highlightedIndex.set(i)"
          role="option"
          [attr.aria-selected]="isHighlighted(i)"
          [attr.aria-disabled]="product.stock === 0"
        >
          <div class="product-info">
            <span class="product-name">{{ product.name }}</span>
            <span class="product-price">\${{ product.price.toFixed(2) }}</span>
          </div>
          <div class="product-meta">
            <span class="product-sku">{{ product.sku }}</span>
            <span 
              data-testid="stock-status"
              class="stock-status"
              [class.in-stock]="product.stock > 0"
              [class.out-of-stock]="product.stock === 0"
            >
              {{ product.stock > 0 ? 'In Stock' : 'Out of Stock' }}
            </span>
          </div>
        </div>
      </div>

      <!-- No Results -->
      <div 
        *ngIf="searchQuery().length >= 2 && searchResults().length === 0 && !isLoading() && !error()"
        data-testid="no-results"
        class="no-results"
        role="status"
      >
        No products found
      </div>
    </div>
  `,
  styles: [`
    .product-search-container {
      @apply relative w-full;
    }

    .search-input-wrapper {
      @apply relative flex items-center gap-2;
    }

    .search-input {
      @apply w-full px-4 py-2 pr-12 border border-gray-300 rounded-lg
             focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent
             transition-all duration-200;
    }

    .search-button {
      @apply absolute right-2 px-3 py-1 bg-blue-500 text-white rounded-md
             hover:bg-blue-600 disabled:bg-gray-300 disabled:cursor-not-allowed
             transition-colors duration-200;
    }

    .spinner {
      @apply inline-block animate-spin;
    }

    .loading-indicator {
      @apply mt-2 text-sm text-gray-600 animate-pulse;
    }

    .error-message {
      @apply mt-2 p-3 bg-red-50 border border-red-200 rounded-lg
             text-sm text-red-600;
    }

    .search-results {
      @apply absolute z-50 w-full mt-2 bg-white border border-gray-200 rounded-lg
             shadow-lg max-h-96 overflow-y-auto;
    }

    .product-result {
      @apply p-3 border-b border-gray-100 cursor-pointer
             hover:bg-blue-50 transition-colors duration-150;
    }

    .product-result.highlighted {
      @apply bg-blue-50;
    }

    .product-result.out-of-stock {
      @apply opacity-50 cursor-not-allowed;
    }

    .product-result:last-child {
      @apply border-b-0;
    }

    .product-info {
      @apply flex justify-between items-center mb-1;
    }

    .product-name {
      @apply font-medium text-gray-900;
    }

    .product-price {
      @apply text-blue-600 font-semibold;
    }

    .product-meta {
      @apply flex justify-between items-center text-sm;
    }

    .product-sku {
      @apply text-gray-500;
    }

    .stock-status {
      @apply px-2 py-0.5 rounded-full text-xs font-medium;
    }

    .stock-status.in-stock {
      @apply bg-green-100 text-green-800;
    }

    .stock-status.out-of-stock {
      @apply bg-red-100 text-red-800;
    }

    .no-results {
      @apply mt-2 p-4 text-center text-gray-500 text-sm;
    }
  `]
})
export class ProductSearchComponent extends BaseSearchComponent<Product> {
  private productService = inject(ProductService);

  // ============================================
  // REQUIRED IMPLEMENTATIONS
  // ============================================

  /**
   * Perform product search
   * Converts Promise to Observable
   */
  protected override performSearch(query: string): Observable<Product[]> {
    return from(this.productService.searchProducts(query));
  }

  /**
   * Get display text for product
   */
  protected override getItemDisplayText(product: Product): string {
    return product.name;
  }

  /**
   * Get unique identifier for product
   */
  protected override getItemId(product: Product): string {
    return product.id;
  }

  // ============================================
  // OPTIONAL CUSTOMIZATIONS
  // ============================================

  /**
   * Disable out-of-stock products
   */
  protected override isItemDisabled(product: Product): boolean {
    return product.stock === 0;
  }

  /**
   * Custom error message for products
   */
  protected override formatError(error: any): string {
    if (error.message?.includes('network')) {
      return 'Network error. Please check your connection.';
    }
    return 'Unable to search products. Please try again.';
  }

  /**
   * Log search start (for analytics)
   */
  protected override onSearchStart(query: string): void {
    console.log('[ProductSearch] Starting search for:', query);
  }

  /**
   * Log search completion (for analytics)
   */
  protected override onSearchComplete(results: Product[]): void {
    console.log('[ProductSearch] Found', results.length, 'products');
  }

  /**
   * Filter out inactive products
   */
  protected override filterResults(results: Product[]): Product[] {
    return results.filter(product => product.isActive);
  }
}

// Made with Bob
