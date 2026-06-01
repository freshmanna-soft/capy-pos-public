import { Component, Output, EventEmitter, signal, inject, ChangeDetectionStrategy } from '@angular/core';
import { CommonModule } from '@angular/common';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { Subject, debounceTime, distinctUntilChanged, switchMap, catchError, of, from } from 'rxjs';
import { ProductService } from '../../../../core/application/services/product.service';
import { Product } from '../../../../core/domain/entities/product.entity';

/**
 * ProductSearchComponent (Molecule)
 * 
 * Micro-frontend component for product search with:
 * - Debounced search (300ms)
 * - Keyboard navigation (ArrowUp, ArrowDown, Enter, Escape)
 * - Accessibility (ARIA attributes)
 * - Loading and error states
 * - Reuses InputComponent (Atom)
 * 
 * TDD: Implements Cucumber scenarios from product-search.feature
 */
@Component({
  selector: 'app-product-search',
  standalone: true,
  imports: [CommonModule],
  template: `
    <div class="product-search-container">
      <!-- Search Input - Reusing InputComponent -->
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
          role="combobox"
          [attr.aria-autocomplete]="'list'"
          [attr.aria-expanded]="searchResults().length > 0"
          [attr.aria-controls]="'search-results'"
          [attr.aria-activedescendant]="highlightedIndex() >= 0 ? 'result-' + highlightedIndex() : null"
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
      >
        <div
          *ngFor="let product of searchResults(); let i = index"
          [id]="'result-' + i"
          data-testid="product-result"
          class="product-result"
          [class.highlighted]="highlightedIndex() === i"
          [class.out-of-stock]="product.stock === 0"
          (click)="selectProduct(product)"
          (mouseenter)="highlightedIndex.set(i)"
          role="option"
          [attr.aria-selected]="highlightedIndex() === i"
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
    :host {
      display: flex;
      flex-direction: column;
      height: 100%;
    }

    .product-search-container {
      display: flex;
      flex-direction: column;
      height: 100%;
      padding: 1.5rem;
      background: white;
      border-radius: 8px;
      box-shadow: 0 2px 8px rgba(0, 0, 0, 0.1);
    }

    .search-input-wrapper {
      @apply relative flex items-center gap-2 mb-4;
    }

    .search-input {
      @apply w-full px-4 py-3 pr-12 border border-gray-300 rounded-lg
             focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent
             transition-all duration-200 text-base;
    }

    .search-button {
      @apply absolute right-2 px-3 py-2 bg-blue-500 text-white rounded-md
             hover:bg-blue-600 disabled:bg-gray-300 disabled:cursor-not-allowed
             transition-colors duration-200;
    }

    .spinner {
      @apply inline-block animate-spin;
    }

    .loading-indicator {
      @apply p-4 text-center text-gray-600 animate-pulse;
    }

    .error-message {
      @apply p-3 bg-red-50 border border-red-200 rounded-lg
             text-sm text-red-600 mb-4;
    }

    .search-results {
      flex: 1;
      overflow-y: auto;
      border: 1px solid #e5e7eb;
      border-radius: 8px;
      background: white;
    }

    .product-result {
      @apply p-4 border-b border-gray-100 cursor-pointer
             hover:bg-blue-50 transition-colors duration-150;
    }

    .product-result.highlighted {
      @apply bg-blue-100;
    }

    .product-result.out-of-stock {
      @apply opacity-50 cursor-not-allowed hover:bg-transparent;
    }

    .product-result:last-child {
      @apply border-b-0;
    }

    .product-info {
      @apply flex justify-between items-center mb-2;
    }

    .product-name {
      @apply font-semibold text-gray-900 text-base;
    }

    .product-price {
      @apply text-blue-600 font-bold text-lg;
    }

    .product-meta {
      @apply flex justify-between items-center text-sm;
    }

    .product-sku {
      @apply text-gray-500 font-mono;
    }

    .stock-status {
      @apply px-2 py-1 rounded-full text-xs font-semibold;
    }

    .stock-status.in-stock {
      @apply bg-green-100 text-green-800;
    }

    .stock-status.out-of-stock {
      @apply bg-red-100 text-red-800;
    }

    .no-results {
      @apply p-8 text-center text-gray-500;
    }

    /* Scrollbar Styling */
    .search-results::-webkit-scrollbar {
      width: 8px;
    }

    .search-results::-webkit-scrollbar-track {
      background: #f3f4f6;
    }

    .search-results::-webkit-scrollbar-thumb {
      background: #d1d5db;
      border-radius: 4px;
    }

    .search-results::-webkit-scrollbar-thumb:hover {
      background: #9ca3af;
    }
  `]
})
export class ProductSearchComponent {
  private productService = inject(ProductService);
  
  // Signals for reactive state
  searchQuery = signal<string>('');
  searchResults = signal<Product[]>([]);
  isLoading = signal<boolean>(false);
  error = signal<string | null>(null);
  highlightedIndex = signal<number>(-1);
  selectedCategory = signal<string | null>(null);

  // Output events
  @Output() productSelected = new EventEmitter<Product>();

  // Search subject for debouncing
  private searchSubject = new Subject<string>();

  constructor() {
    // Setup debounced search with automatic cleanup
    this.searchSubject.pipe(
      debounceTime(300),
      distinctUntilChanged(),
      switchMap(query => {
        if (query.length < 2) {
          return of([]);
        }

        this.isLoading.set(true);
        this.error.set(null);

        // Convert Promise to Observable
        return from(this.productService.searchProducts(query)).pipe(
          catchError(err => {
            this.error.set(err.message || 'Unable to search products');
            return of([]);
          })
        );
      }),
      takeUntilDestroyed() // Automatically unsubscribe when component is destroyed
    ).subscribe(results => {
      this.searchResults.set(results);
      this.isLoading.set(false);
      this.highlightedIndex.set(-1);
    });
  }

  /**
   * Handle search input changes
   * Implements debounced search with minimum 2 characters
   */
  onSearchInput(event: Event): void {
    const input = event.target as HTMLInputElement;
    const query = input.value;
    
    this.searchQuery.set(query);
    
    if (query.length === 0) {
      this.searchResults.set([]);
      this.error.set(null);
      return;
    }

    if (query.length < 2) {
      return; // Don't search with less than 2 characters
    }

    this.searchSubject.next(query);
  }

  /**
   * Trigger search manually (for search button)
   */
  triggerSearch(): void {
    const query = this.searchQuery();
    if (query.length >= 2) {
      this.searchSubject.next(query);
    }
  }

  /**
   * Handle keyboard navigation
   * ArrowDown: Move highlight down
   * ArrowUp: Move highlight up
   * Enter: Select highlighted product
   * Escape: Clear search
   */
  onKeyDown(event: KeyboardEvent): void {
    const results = this.searchResults();
    
    switch (event.key) {
      case 'ArrowDown':
        event.preventDefault();
        if (results.length > 0) {
          const newIndex = Math.min(this.highlightedIndex() + 1, results.length - 1);
          this.highlightedIndex.set(newIndex);
        }
        break;

      case 'ArrowUp':
        event.preventDefault();
        if (results.length > 0) {
          const newIndex = Math.max(this.highlightedIndex() - 1, 0);
          this.highlightedIndex.set(newIndex);
        }
        break;

      case 'Enter':
        event.preventDefault();
        const index = this.highlightedIndex();
        if (index >= 0 && index < results.length) {
          this.selectProduct(results[index]);
        }
        break;

      case 'Escape':
        event.preventDefault();
        this.clearSearch();
        break;
    }
  }

  /**
   * Select a product and emit event
   * Clears search after selection
   */
  selectProduct(product: Product): void {
    if (product.stock === 0) {
      return; // Don't select out of stock products
    }

    this.productSelected.emit(product);
    this.clearSearch();
  }

  /**
   * Clear search state
   */
  clearSearch(): void {
    this.searchQuery.set('');
    this.searchResults.set([]);
    this.error.set(null);
    this.highlightedIndex.set(-1);
  }

  /**
   * Select category filter
   */
  onCategorySelect(category: string | null): void {
    this.selectedCategory.set(category);
    const query = this.searchQuery();
    if (query.length >= 2) {
      this.searchSubject.next(query);
    }
  }
}

// Made with Bob
