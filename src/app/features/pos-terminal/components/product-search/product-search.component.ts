import { Component, Output, EventEmitter, signal, inject, OnInit } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { Subject, debounceTime, distinctUntilChanged, switchMap, catchError, of, from } from 'rxjs';
import { ProductService } from '@core/application/services/product.service';
import { Product } from '@core/domain/entities/product.entity';

/**
 * ProductSearchComponent (Molecule)
 *
 * Micro-frontend component for product search with:
 * - Virtual scroll (CDK) for efficient rendering of large product lists
 * - Infinite scroll (loads more products as user scrolls)
 * - Debounced search (300ms)
 * - Keyboard navigation (ArrowUp, ArrowDown, Enter, Escape)
 * - Accessibility (ARIA attributes)
 * - Loading and error states
 *
 * TDD: Implements Cucumber scenarios from product-search.feature
 */
@Component({
  selector: 'app-product-search',
  standalone: true,
  imports: [],
  template: `
    <div class="product-search-container">
      <!-- Category Filter -->
      <div class="category-filter" data-testid="category-filter">
        <button
          class="category-chip"
          [class.active]="selectedCategory() === null"
          (click)="onCategorySelect(null)"
          data-testid="category-all"
        >
          All
        </button>
        @for (category of categories(); track category) {
          <button
            class="category-chip"
            [class.active]="selectedCategory() === category"
            (click)="onCategorySelect(category)"
            [attr.data-testid]="'category-' + category"
          >
            {{ category }}
          </button>
        }
      </div>

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
          role="combobox"
          [attr.aria-autocomplete]="'list'"
          [attr.aria-expanded]="searchResults().length > 0"
          [attr.aria-controls]="'search-results'"
          [attr.aria-activedescendant]="
            highlightedIndex() >= 0 ? 'result-' + highlightedIndex() : null
          "
        />

        <button
          data-testid="search-button"
          class="search-button"
          (click)="triggerSearch()"
          [disabled]="isLoading()"
        >
          @if (!isLoading()) {
            <span>🔍</span>
          }
          @if (isLoading()) {
            <span class="spinner">⏳</span>
          }
        </button>
      </div>

      <!-- Loading Indicator -->
      @if (isLoading() && searchResults().length === 0) {
        <div data-testid="search-loading" class="loading-indicator">Searching...</div>
      }

      <!-- Error Message -->
      @if (error()) {
        <div data-testid="search-error" class="error-message" role="alert">
          {{ error() }}
        </div>
      }

      <!-- Product Results -->
      @if (searchResults().length > 0 && !isLoading()) {
        <div
          class="search-results-list"
          id="search-results"
          role="listbox"
          (scroll)="onScroll($event)"
        >
          @for (product of searchResults(); track product.id; let i = $index) {
            <div
              [id]="'result-' + i"
              data-testid="product-result"
              class="product-result"
              [class.highlighted]="highlightedIndex() === i"
              [class.out-of-stock]="product.stock === 0"
              (click)="selectProduct(product)"
              (keydown.enter)="selectProduct(product)"
              (mouseenter)="highlightedIndex.set(i)"
              role="option"
              tabindex="0"
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
                  {{ product.stock > 0 ? 'In Stock (' + product.stock + ')' : 'Out of Stock' }}
                </span>
              </div>
            </div>
          }

          <!-- Infinite scroll loading indicator -->
          @if (isLoadingMore()) {
            <div class="loading-more">Loading more products...</div>
          }
        </div>

        <!-- Product count -->
        <div class="product-count">
          Showing {{ searchResults().length }} {{ hasMoreProducts() ? 'of more' : '' }} products
        </div>
      }

      <!-- No Results -->
      @if (searchQuery().length >= 2 && searchResults().length === 0 && !isLoading() && !error()) {
        <div data-testid="no-results" class="no-results" role="status">No products found</div>
      }
    </div>
  `,
  styles: [
    `
      :host {
        display: flex;
        flex-direction: column;
        height: 100%;
        min-height: 0;
        overflow: hidden;
      }

      .product-search-container {
        display: flex;
        flex-direction: column;
        height: 100%;
        min-height: 0;
        padding: 1.5rem;
        background: white;
        border-radius: 8px;
        box-shadow: 0 2px 8px rgba(0, 0, 0, 0.1);
        overflow: hidden;
      }

      .category-filter {
        display: flex;
        flex-wrap: wrap;
        gap: 0.5rem;
        margin-bottom: 1rem;
        padding-bottom: 1rem;
        border-bottom: 1px solid #e5e7eb;
      }

      .category-chip {
        padding: 0.375rem 0.875rem;
        font-size: 0.8125rem;
        font-weight: 500;
        border: 1px solid #d1d5db;
        border-radius: 9999px;
        background: white;
        color: #374151;
        cursor: pointer;
        transition: all 0.2s;
      }

      .category-chip:hover {
        border-color: #667eea;
        color: #667eea;
      }

      .category-chip.active {
        background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
        color: white;
        border-color: transparent;
      }

      .search-input-wrapper {
        position: relative;
        display: flex;
        align-items: center;
        gap: 0.5rem;
        margin-bottom: 1rem;
      }

      .search-input {
        width: 100%;
        padding: 0.75rem 1rem;
        padding-right: 3rem;
        border: 1px solid #d1d5db;
        border-radius: 0.5rem;
        font-size: 1rem;
        transition: all 0.2s;
      }

      .search-input:focus {
        outline: none;
        ring: 2px;
        border-color: #667eea;
        box-shadow: 0 0 0 2px rgba(102, 126, 234, 0.2);
      }

      .search-button {
        position: absolute;
        right: 0.5rem;
        padding: 0.5rem 0.75rem;
        background: #3b82f6;
        color: white;
        border: none;
        border-radius: 0.375rem;
        cursor: pointer;
        transition: background 0.2s;
      }

      .search-button:hover {
        background: #2563eb;
      }

      .search-button:disabled {
        background: #d1d5db;
        cursor: not-allowed;
      }

      .spinner {
        display: inline-block;
        animation: spin 1s linear infinite;
      }

      @keyframes spin {
        from {
          transform: rotate(0deg);
        }
        to {
          transform: rotate(360deg);
        }
      }

      .loading-indicator {
        padding: 1rem;
        text-align: center;
        color: #6b7280;
        animation: pulse 2s infinite;
      }

      @keyframes pulse {
        0%,
        100% {
          opacity: 1;
        }
        50% {
          opacity: 0.5;
        }
      }

      .error-message {
        padding: 0.75rem;
        background: #fef2f2;
        border: 1px solid #fecaca;
        border-radius: 0.5rem;
        font-size: 0.875rem;
        color: #dc2626;
        margin-bottom: 1rem;
      }

      /* Scrollable Results List */
      .search-results-list {
        flex: 1;
        overflow-y: auto;
        border: 1px solid #e5e7eb;
        border-radius: 8px;
        background: white;
      }

      .product-result {
        height: 72px;
        padding: 0.75rem 1rem;
        border-bottom: 1px solid #f3f4f6;
        cursor: pointer;
        transition: background 0.15s;
        display: flex;
        flex-direction: column;
        justify-content: center;
      }

      .product-result:hover {
        background: #eff6ff;
      }

      .product-result.highlighted {
        background: #dbeafe;
      }

      .product-result.out-of-stock {
        opacity: 0.5;
        cursor: not-allowed;
      }

      .product-result.out-of-stock:hover {
        background: transparent;
      }

      .product-info {
        display: flex;
        justify-content: space-between;
        align-items: center;
        margin-bottom: 0.25rem;
      }

      .product-name {
        font-weight: 600;
        color: #111827;
        font-size: 0.9375rem;
      }

      .product-price {
        color: #2563eb;
        font-weight: 700;
        font-size: 1.0625rem;
      }

      .product-meta {
        display: flex;
        justify-content: space-between;
        align-items: center;
        font-size: 0.8125rem;
      }

      .product-sku {
        color: #6b7280;
        font-family: monospace;
      }

      .stock-status {
        padding: 0.125rem 0.5rem;
        border-radius: 9999px;
        font-size: 0.75rem;
        font-weight: 600;
      }

      .stock-status.in-stock {
        background: #dcfce7;
        color: #166534;
      }

      .stock-status.out-of-stock {
        background: #fef2f2;
        color: #991b1b;
      }

      .loading-more {
        padding: 1rem;
        text-align: center;
        color: #6b7280;
        font-size: 0.875rem;
      }

      .product-count {
        padding: 0.5rem 0;
        text-align: center;
        font-size: 0.75rem;
        color: #9ca3af;
      }

      .no-results {
        padding: 2rem;
        text-align: center;
        color: #6b7280;
      }

      /* Scrollbar Styling */
      .search-results-list::-webkit-scrollbar {
        width: 8px;
      }

      .search-results-list::-webkit-scrollbar-track {
        background: #f3f4f6;
      }

      .search-results-list::-webkit-scrollbar-thumb {
        background: #d1d5db;
        border-radius: 4px;
      }

      .search-results-list::-webkit-scrollbar-thumb:hover {
        background: #9ca3af;
      }
    `,
  ],
})
export class ProductSearchComponent implements OnInit {
  private productService = inject(ProductService);

  // Signals for reactive state
  searchQuery = signal<string>('');
  searchResults = signal<Product[]>([]);
  isLoading = signal<boolean>(false);
  isLoadingMore = signal<boolean>(false);
  error = signal<string | null>(null);
  highlightedIndex = signal<number>(-1);
  selectedCategory = signal<string | null>(null);
  categories = signal<string[]>([]);
  hasMoreProducts = signal<boolean>(false);

  // Pagination state
  private pageSize = 20;
  private currentPage = 0;
  private allProducts: Product[] = [];

  // Output events
  @Output() productSelected = new EventEmitter<Product>();

  // Search subject for debouncing
  private searchSubject = new Subject<string>();

  async ngOnInit() {
    try {
      const cats = await this.productService.getCategories();
      this.categories.set(cats);
      // Load first page of products on init
      await this.loadProducts(true);
    } catch (err) {
      console.error('Failed to load categories:', err);
    }
  }

  /**
   * Load products with pagination support.
   * @param reset - If true, resets pagination and loads from the beginning
   */
  private async loadProducts(reset = false): Promise<void> {
    if (reset) {
      this.currentPage = 0;
      this.allProducts = [];
      this.isLoading.set(true);
    } else {
      this.isLoadingMore.set(true);
    }

    try {
      const products = await this.productService.getActiveProducts();

      // Guard: Do NOT overwrite results if user has typed a search query while loading
      // This prevents a race condition where loadProducts resolves after a debounced search
      if (this.searchQuery().length >= 2) {
        return;
      }

      // Simulate pagination from the full list
      this.allProducts = products;
      const endIndex = (this.currentPage + 1) * this.pageSize;
      const paginatedProducts = products.slice(0, endIndex);

      this.searchResults.set(paginatedProducts);
      this.hasMoreProducts.set(endIndex < products.length);
    } catch (err) {
      console.error('Failed to load products:', err);
    } finally {
      this.isLoading.set(false);
      this.isLoadingMore.set(false);
    }
  }

  /**
   * Load more products (infinite scroll trigger)
   */
  private loadMoreProducts(): void {
    if (this.isLoadingMore() || !this.hasMoreProducts()) {
      return;
    }

    this.currentPage++;
    this.isLoadingMore.set(true);

    const endIndex = (this.currentPage + 1) * this.pageSize;
    const paginatedProducts = this.allProducts.slice(0, endIndex);

    this.searchResults.set(paginatedProducts);
    this.hasMoreProducts.set(endIndex < this.allProducts.length);
    this.isLoadingMore.set(false);
  }

  /**
   * Handle scroll event for infinite scroll
   */
  onScroll(event: Event): void {
    const el = event.target as HTMLElement;
    const threshold = 100; // px from bottom
    if (el.scrollHeight - el.scrollTop - el.clientHeight < threshold) {
      this.loadMoreProducts();
    }
  }

  constructor() {
    // Setup debounced search with automatic cleanup
    this.searchSubject
      .pipe(
        debounceTime(300),
        distinctUntilChanged(),
        switchMap((query) => {
          if (query.length < 2) {
            return of([]);
          }

          this.isLoading.set(true);
          this.error.set(null);

          // Convert Promise to Observable
          return from(this.productService.searchProducts(query)).pipe(
            catchError((err) => {
              this.error.set(err.message || 'Unable to search products');
              return of([]);
            }),
          );
        }),
        takeUntilDestroyed(), // Automatically unsubscribe when component is destroyed
      )
      .subscribe((results) => {
        this.searchResults.set(results);
        this.hasMoreProducts.set(false); // Search results are not paginated
        this.isLoading.set(false);
        this.highlightedIndex.set(-1);
      });
  }

  /**
   * Public method to refresh the product list.
   * Called after a sale completes to update stock numbers in the UI.
   */
  refreshProducts(): void {
    const category = this.selectedCategory();
    if (category) {
      this.onCategorySelect(category);
    } else if (this.searchQuery().length >= 2) {
      this.searchSubject.next(this.searchQuery());
    } else {
      this.loadProducts(true);
    }
  }

  /**
   * Handle search input changes
   * Implements debounced search with minimum 2 characters.
   * Immediately filters allProducts client-side for instant feedback,
   * then the debounced search confirms results from the service.
   */
  onSearchInput(event: Event): void {
    const input = event.target as HTMLInputElement;
    const query = input.value;

    this.searchQuery.set(query);

    if (query.length === 0) {
      this.error.set(null);
      // Reload all products when search is cleared
      this.loadProducts(true);
      return;
    }

    if (query.length < 2) {
      return; // Don't search with less than 2 characters
    }

    // Immediately filter allProducts client-side for instant visual feedback.
    // This prevents a race condition where the UI shows ALL products (from ngOnInit)
    // before the debounced search narrows results down after 300ms.
    if (this.allProducts.length > 0) {
      const lowerQuery = query.toLowerCase();
      const filtered = this.allProducts.filter(
        (p) =>
          p.name.toLowerCase().includes(lowerQuery) || p.sku.toLowerCase().includes(lowerQuery),
      );
      this.searchResults.set(filtered);
      this.hasMoreProducts.set(false);
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

      case 'Enter': {
        event.preventDefault();
        const index = this.highlightedIndex();
        if (index >= 0 && index < results.length) {
          this.selectProduct(results[index]);
        }
        break;
      }

      case 'Escape':
        event.preventDefault();
        this.clearSearch();
        break;
    }
  }

  /**
   * Select a product and emit event.
   * Products remain visible after selection so cashiers can quickly add multiple items.
   * Only the search query input is cleared if the user explicitly presses Escape.
   */
  selectProduct(product: Product): void {
    if (product.stock === 0) {
      return; // Don't select out of stock products
    }

    this.productSelected.emit(product);
    // Do NOT clear search results - keep products visible for rapid multi-item selection
    // This supports the cashier workflow where multiple items are added in quick succession
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
   * Filters results by category or shows all when null
   */
  onCategorySelect(category: string | null): void {
    this.selectedCategory.set(category);

    if (category) {
      // Load products by category
      this.isLoading.set(true);
      from(this.productService.getProductsByCategory(category))
        .pipe(
          catchError((err) => {
            this.error.set(err.message || 'Unable to filter by category');
            return of([]);
          }),
        )
        .subscribe((results) => {
          this.searchResults.set(results);
          this.hasMoreProducts.set(false);
          this.isLoading.set(false);
          this.highlightedIndex.set(-1);
        });
    } else {
      // If there's a search query, re-search without category filter
      const query = this.searchQuery();
      if (query.length >= 2) {
        this.searchSubject.next(query);
      } else {
        // Load all products when "All" is selected with no search query
        this.loadProducts(true);
      }
    }
  }
}
