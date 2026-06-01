import { Component, Output, EventEmitter, signal, OnDestroy, Directive } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Subject, debounceTime, distinctUntilChanged, switchMap, catchError, of, Subscription } from 'rxjs';

/**
 * BaseSearchComponent (Abstract Molecule)
 * 
 * Template Method Pattern for search functionality
 * Provides common search behavior that can be extended for different entity types
 * 
 * Features:
 * - Debounced search (configurable)
 * - Keyboard navigation
 * - Loading and error states
 * - Accessibility (ARIA attributes)
 * - Reactive state with signals
 * 
 * @example
 * ```typescript
 * export class ProductSearchComponent extends BaseSearchComponent<Product> {
 *   protected override performSearch(query: string): Observable<Product[]> {
 *     return from(this.productService.searchProducts(query));
 *   }
 * 
 *   protected override isItemDisabled(item: Product): boolean {
 *     return item.stock === 0;
 *   }
 * }
 * ```
 */
@Directive()
export abstract class BaseSearchComponent<T> implements OnDestroy {
  // Signals for reactive state
  searchQuery = signal<string>('');
  searchResults = signal<T[]>([]);
  isLoading = signal<boolean>(false);
  error = signal<string | null>(null);
  highlightedIndex = signal<number>(-1);

  // Configuration
  protected debounceTime = 300;
  protected minSearchLength = 2;
  protected maxResults = 50;

  // Output events
  @Output() itemSelected = new EventEmitter<T>();

  // Search subject for debouncing
  private searchSubject = new Subject<string>();
  private subscription?: Subscription;

  constructor() {
    this.setupSearch();
  }

  ngOnDestroy(): void {
    this.subscription?.unsubscribe();
  }

  /**
   * Setup debounced search pipeline
   * Template method that uses hook methods
   */
  private setupSearch(): void {
    this.subscription = this.searchSubject.pipe(
      debounceTime(this.debounceTime),
      distinctUntilChanged(),
      switchMap(query => {
        if (query.length < this.minSearchLength) {
          return of([]);
        }

        this.isLoading.set(true);
        this.error.set(null);
        this.onSearchStart(query);

        return this.performSearch(query).pipe(
          catchError(err => {
            const errorMessage = this.formatError(err);
            this.error.set(errorMessage);
            this.onSearchError(err);
            return of([]);
          })
        );
      })
    ).subscribe(results => {
      const filteredResults = this.filterResults(results as T[]);
      const limitedResults = filteredResults.slice(0, this.maxResults);
      
      this.searchResults.set(limitedResults);
      this.isLoading.set(false);
      this.highlightedIndex.set(-1);
      this.onSearchComplete(limitedResults);
    });
  }

  /**
   * Handle search input changes
   */
  onSearchInput(event: Event): void {
    const input = event.target as HTMLInputElement;
    const query = input.value;
    
    this.searchQuery.set(query);
    
    if (query.length === 0) {
      this.clearSearch();
      return;
    }

    if (query.length < this.minSearchLength) {
      return;
    }

    this.searchSubject.next(query);
  }

  /**
   * Trigger search manually
   */
  triggerSearch(): void {
    const query = this.searchQuery();
    if (query.length >= this.minSearchLength) {
      this.searchSubject.next(query);
    }
  }

  /**
   * Handle keyboard navigation
   */
  onKeyDown(event: KeyboardEvent): void {
    const results = this.searchResults();
    
    switch (event.key) {
      case 'ArrowDown':
        event.preventDefault();
        if (results.length > 0) {
          const newIndex = Math.min(this.highlightedIndex() + 1, results.length - 1);
          this.highlightedIndex.set(newIndex);
          this.onNavigate(newIndex, results[newIndex]);
        }
        break;

      case 'ArrowUp':
        event.preventDefault();
        if (results.length > 0) {
          const newIndex = Math.max(this.highlightedIndex() - 1, 0);
          this.highlightedIndex.set(newIndex);
          this.onNavigate(newIndex, results[newIndex]);
        }
        break;

      case 'Enter':
        event.preventDefault();
        const index = this.highlightedIndex();
        if (index >= 0 && index < results.length) {
          this.selectItem(results[index]);
        }
        break;

      case 'Escape':
        event.preventDefault();
        this.clearSearch();
        break;

      default:
        this.onOtherKey(event);
        break;
    }
  }

  /**
   * Select an item
   */
  selectItem(item: T): void {
    if (this.isItemDisabled(item)) {
      return;
    }

    if (this.beforeItemSelect(item)) {
      this.itemSelected.emit(item);
      this.afterItemSelect(item);
      
      if (this.shouldClearAfterSelect()) {
        this.clearSearch();
      }
    }
  }

  /**
   * Clear search state
   */
  clearSearch(): void {
    this.searchQuery.set('');
    this.searchResults.set([]);
    this.error.set(null);
    this.highlightedIndex.set(-1);
    this.onSearchClear();
  }

  // ============================================
  // HOOK METHODS - Override in subclasses
  // ============================================

  /**
   * Perform the actual search
   * MUST be implemented by subclasses
   */
  protected abstract performSearch(query: string): any;

  /**
   * Get display text for an item
   * MUST be implemented by subclasses
   */
  protected abstract getItemDisplayText(item: T): string;

  /**
   * Get unique identifier for an item
   * MUST be implemented by subclasses
   */
  protected abstract getItemId(item: T): string;

  /**
   * Check if item should be disabled
   * Override to customize
   */
  protected isItemDisabled(item: T): boolean {
    return false;
  }

  /**
   * Filter results before display
   * Override to add custom filtering
   */
  protected filterResults(results: T[]): T[] {
    return results;
  }

  /**
   * Format error message
   * Override to customize error messages
   */
  protected formatError(error: any): string {
    return error.message || 'Search failed. Please try again.';
  }

  /**
   * Called before item selection
   * Return false to prevent selection
   */
  protected beforeItemSelect(item: T): boolean {
    return true;
  }

  /**
   * Called after item selection
   * Override to add custom behavior
   */
  protected afterItemSelect(item: T): void {
    // Override in subclass
  }

  /**
   * Should clear search after selection
   * Override to customize
   */
  protected shouldClearAfterSelect(): boolean {
    return true;
  }

  /**
   * Called when search starts
   * Override to add custom behavior
   */
  protected onSearchStart(query: string): void {
    // Override in subclass
  }

  /**
   * Called when search completes
   * Override to add custom behavior
   */
  protected onSearchComplete(results: T[]): void {
    // Override in subclass
  }

  /**
   * Called when search error occurs
   * Override to add custom behavior
   */
  protected onSearchError(error: any): void {
    // Override in subclass
  }

  /**
   * Called when search is cleared
   * Override to add custom behavior
   */
  protected onSearchClear(): void {
    // Override in subclass
  }

  /**
   * Called during keyboard navigation
   * Override to add custom behavior
   */
  protected onNavigate(index: number, item: T): void {
    // Override in subclass
  }

  /**
   * Called for other keyboard events
   * Override to handle custom keys
   */
  protected onOtherKey(event: KeyboardEvent): void {
    // Override in subclass
  }

  // ============================================
  // UTILITY METHODS
  // ============================================

  /**
   * Check if item is highlighted
   */
  isHighlighted(index: number): boolean {
    return this.highlightedIndex() === index;
  }

  /**
   * Get ARIA attributes for search input
   */
  getAriaAttributes() {
    return {
      role: 'combobox',
      'aria-autocomplete': 'list',
      'aria-expanded': this.searchResults().length > 0,
      'aria-controls': 'search-results',
      'aria-activedescendant': this.highlightedIndex() >= 0 
        ? `result-${this.highlightedIndex()}` 
        : null
    };
  }

  /**
   * Get result count for screen readers
   */
  getResultCountAnnouncement(): string {
    const count = this.searchResults().length;
    if (count === 0 && this.searchQuery().length >= this.minSearchLength) {
      return 'No results found';
    }
    return count === 1 ? '1 result found' : `${count} results found`;
  }
}

// Made with Bob
