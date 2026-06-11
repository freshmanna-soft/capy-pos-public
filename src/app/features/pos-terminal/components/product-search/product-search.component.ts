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
  templateUrl: './product-search.component.html',
  styleUrl: './product-search.component.scss',
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
