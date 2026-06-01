import { Component, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { from, Observable } from 'rxjs';
import { BaseSearchComponent } from '../../../../shared/ui/molecules/base-search/base-search.component';
import { CustomerService } from '../../../../core/application/services/customer.service';
import { Customer } from '../../../../core/domain/entities/customer.entity';

/**
 * CustomerSearchComponent (Extends BaseSearchComponent)
 * 
 * Specialized search component for customers
 * Demonstrates reusability of BaseSearchComponent
 * 
 * Features inherited from BaseSearchComponent:
 * - Debounced search
 * - Keyboard navigation
 * - Loading/error states
 * - Accessibility
 * 
 * Only implements customer-specific behavior:
 * - Customer search logic
 * - Customer display format
 * - Customer-specific filtering
 * 
 * @example
 * ```html
 * <app-customer-search 
 *   (itemSelected)="onCustomerSelected($event)">
 * </app-customer-search>
 * ```
 */
@Component({
  selector: 'app-customer-search',
  standalone: true,
  imports: [CommonModule],
  template: `
    <div class="customer-search-container">
      <!-- Search Input -->
      <div class="search-input-wrapper">
        <input
          data-testid="customer-search"
          type="search"
          [value]="searchQuery()"
          (input)="onSearchInput($event)"
          (keydown)="onKeyDown($event)"
          placeholder="Search customers by name, email, or phone..."
          class="search-input"
          [attr.role]="getAriaAttributes().role"
          [attr.aria-autocomplete]="getAriaAttributes()['aria-autocomplete']"
          [attr.aria-expanded]="getAriaAttributes()['aria-expanded']"
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

      <!-- Loading -->
      <div *ngIf="isLoading()" data-testid="search-loading" class="loading">
        Searching customers...
      </div>

      <!-- Error -->
      <div *ngIf="error()" data-testid="search-error" class="error" role="alert">
        {{ error() }}
      </div>

      <!-- Results -->
      <div 
        *ngIf="searchResults().length > 0 && !isLoading()"
        class="search-results"
        role="listbox"
      >
        <div
          *ngFor="let customer of searchResults(); let i = index"
          [id]="'result-' + i"
          data-testid="customer-result"
          class="customer-result"
          [class.highlighted]="isHighlighted(i)"
          (click)="selectItem(customer)"
          (mouseenter)="highlightedIndex.set(i)"
          role="option"
          [attr.aria-selected]="isHighlighted(i)"
        >
          <div class="customer-info">
            <span class="customer-name">{{ customer.name }}</span>
            <span class="customer-email">{{ customer.email }}</span>
          </div>
          <div class="customer-meta">
            <span class="customer-phone">{{ customer.phone || 'No phone' }}</span>
            <span class="loyalty-points">{{ customer.loyaltyPoints }} pts</span>
          </div>
        </div>
      </div>

      <!-- No Results -->
      <div 
        *ngIf="searchQuery().length >= 2 && searchResults().length === 0 && !isLoading() && !error()"
        data-testid="no-results"
        class="no-results"
      >
        No customers found
      </div>
    </div>
  `,
  styles: [`
    .customer-search-container {
      @apply relative w-full;
    }

    .search-input-wrapper {
      @apply relative flex items-center gap-2;
    }

    .search-input {
      @apply w-full px-4 py-2 pr-12 border border-gray-300 rounded-lg
             focus:outline-none focus:ring-2 focus:ring-purple-500 focus:border-transparent;
    }

    .search-button {
      @apply absolute right-2 px-3 py-1 bg-purple-500 text-white rounded-md
             hover:bg-purple-600 disabled:bg-gray-300;
    }

    .spinner {
      @apply inline-block animate-spin;
    }

    .loading {
      @apply mt-2 text-sm text-gray-600 animate-pulse;
    }

    .error {
      @apply mt-2 p-3 bg-red-50 border border-red-200 rounded-lg text-sm text-red-600;
    }

    .search-results {
      @apply absolute z-50 w-full mt-2 bg-white border border-gray-200 rounded-lg
             shadow-lg max-h-96 overflow-y-auto;
    }

    .customer-result {
      @apply p-3 border-b border-gray-100 cursor-pointer hover:bg-purple-50;
    }

    .customer-result.highlighted {
      @apply bg-purple-50;
    }

    .customer-info {
      @apply flex justify-between items-center mb-1;
    }

    .customer-name {
      @apply font-medium text-gray-900;
    }

    .customer-email {
      @apply text-purple-600 text-sm;
    }

    .customer-meta {
      @apply flex justify-between items-center text-sm text-gray-500;
    }

    .loyalty-points {
      @apply px-2 py-0.5 bg-yellow-100 text-yellow-800 rounded-full text-xs font-medium;
    }

    .no-results {
      @apply mt-2 p-4 text-center text-gray-500 text-sm;
    }
  `]
})
export class CustomerSearchComponent extends BaseSearchComponent<Customer> {
  private customerService = inject(CustomerService);

  // Override debounce time for customers (faster response)
  protected override debounceTime = 200;

  // ============================================
  // REQUIRED IMPLEMENTATIONS
  // ============================================

  protected override performSearch(query: string): Observable<Customer[]> {
    // Search by name, email, or phone
    return from(this.customerService.searchCustomers(query));
  }

  protected override getItemDisplayText(customer: Customer): string {
    return `${customer.name} (${customer.email})`;
  }

  protected override getItemId(customer: Customer): string {
    return customer.id;
  }

  // ============================================
  // OPTIONAL CUSTOMIZATIONS
  // ============================================

  protected override formatError(error: any): string {
    return 'Unable to search customers. Please try again.';
  }

  /**
   * Sort customers by loyalty points (highest first)
   */
  protected override filterResults(results: Customer[]): Customer[] {
    return results.sort((a, b) => b.loyaltyPoints - a.loyaltyPoints);
  }

  /**
   * Log customer selection for analytics
   */
  protected override afterItemSelect(customer: Customer): void {
    console.log('[CustomerSearch] Selected customer:', customer.name, 'with', customer.loyaltyPoints, 'points');
  }
}

// Made with Bob
