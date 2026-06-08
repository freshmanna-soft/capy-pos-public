import { Component, Input, Output, EventEmitter } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ProductCardComponent } from '../../molecules/product-card/product-card.component';
import { InputComponent } from '../../atoms/input/input.component';
import { Product } from '../../../../core/domain/entities/product.entity';

/**
 * Product Grid Component (Organism)
 * Combines multiple ProductCard molecules with search and filtering
 * Main component for POS terminal product selection
 */
@Component({
  selector: 'app-product-grid',
  standalone: true,
  imports: [CommonModule, ProductCardComponent, InputComponent],
  template: `
    <div class="product-grid-container">
      <!-- Search and Filters -->
      <div class="grid-header">
        <app-input
          type="search"
          placeholder="Search products..."
          prefix="🔍"
          (valueChange)="onSearchChange($event)"
        />
        
        <div class="filter-buttons">
          <button
            *ngFor="let category of categories"
            [class]="getCategoryButtonClass(category)"
            (click)="onCategorySelect(category)"
          >
            {{ category }}
          </button>
        </div>
        
        <!-- Add New Product Button -->
        <button class="add-product-button" (click)="onAddNewProduct()">Add New Product</button>
      </div>
      
      <!-- Product Grid -->
      <div *ngIf="filteredProducts.length > 0" class="products-grid">
        <app-product-card
          *ngFor="let product of filteredProducts; trackBy: trackByProductId"
          [product]="product"
          [showAddToCart]="showAddToCart"
          [showQuickView]="showQuickView"
          [showStockBadge]="showStockBadge"
          (addToCart)="onAddToCart($event)"
          (quickView)="onQuickView($event)"
          (cardClick)="onProductClick($event)"
        />
      </div>
      
      <!-- Empty State -->
      <div *ngIf="filteredProducts.length === 0" class="empty-state">
        <div class="empty-icon">📦</div>
        <h3 class="empty-title">No products found</h3>
        <p class="empty-message">
          {{ searchQuery ? 'Try adjusting your search' : 'No products available' }}
        </p>
      </div>
      
      <!-- Loading State -->
      <div *ngIf="loading" class="loading-state">
        <div class="spinner"></div>
        <p>Loading products...</p>
      </div>
    </div>
  `,
  styles: [`
    .product-grid-container {
      @apply flex flex-col gap-6 h-full;
    }
    
    .grid-header {
      @apply flex flex-col gap-4;
    }
    
    .filter-buttons {
      @apply flex flex-wrap gap-2;
    }
    
    .filter-button {
      @apply px-4 py-2 rounded-lg border border-gray-300 
             text-sm font-medium transition-all duration-200
             hover:bg-gray-50;
    }
    
    .filter-button-active {
      @apply bg-blue-600 text-white border-blue-600 hover:bg-blue-700;
    }
    
    .products-grid {
      @apply grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 
             gap-4 overflow-y-auto;
    }
    
    .empty-state {
      @apply flex flex-col items-center justify-center 
             py-12 text-center;
    }
    
    .empty-icon {
      @apply text-6xl mb-4;
    }
    
    .empty-title {
      @apply text-xl font-semibold text-gray-900 mb-2;
    }
    
    .empty-message {
      @apply text-gray-600;
    }
    
    .loading-state {
      @apply flex flex-col items-center justify-center py-12;
    }
    
    .spinner {
      @apply w-12 h-12 border-4 border-blue-600 border-t-transparent 
             rounded-full animate-spin mb-4;
    }
  `]
})
export class ProductGridComponent {
  @Input() products: Product[] = [];
  @Input() loading = false;
  @Input() showAddToCart = true;
  @Input() showQuickView = false;
  @Input() showStockBadge = true;
  
  @Output() addToCart = new EventEmitter<Product>();
  @Output() quickView = new EventEmitter<Product>();
  @Output() productClick = new EventEmitter<Product>();
  @Output() searchChange = new EventEmitter<string>();
  @Output() categoryChange = new EventEmitter<string>();

  searchQuery = '';
  selectedCategory = 'All';
  
  get categories(): string[] {
    const cats = new Set(this.products.map(p => p.category));
    return ['All', ...Array.from(cats).sort()];
  }
  
  get filteredProducts(): Product[] {
    let filtered = this.products;
    
    // Filter by category
    if (this.selectedCategory !== 'All') {
      filtered = filtered.filter(p => p.category === this.selectedCategory);
    }
    
    // Filter by search query
    if (this.searchQuery) {
      const query = this.searchQuery.toLowerCase();
      filtered = filtered.filter(p =>
        p.name.toLowerCase().includes(query) ||
        p.sku.toLowerCase().includes(query) ||
        p.category.toLowerCase().includes(query) ||
        p.description?.toLowerCase().includes(query)
      );
    }
    
    // Filter active products only
    filtered = filtered.filter(p => p.isActive);
    
    return filtered;
  }

  onSearchChange(query: string): void {
    this.searchQuery = query;
    this.searchChange.emit(query);
  }

  onCategorySelect(category: string): void {
    this.selectedCategory = category;
    this.categoryChange.emit(category);
  }

  getCategoryButtonClass(category: string): string {
    const baseClass = 'filter-button';
    return category === this.selectedCategory
      ? `${baseClass} filter-button-active`
      : baseClass;
  }

  onAddToCart(product: Product): void {
    this.addToCart.emit(product);
  }

  onQuickView(product: Product): void {
    this.quickView.emit(product);
  }

  onProductClick(product: Product): void {
    this.productClick.emit(product);
  }

  onAddNewProduct(): void {
    // Add logic for adding a new product
  }

  trackByProductId(index: number, product: Product): string {
    return product.id;
  }
}

// Made with Bob