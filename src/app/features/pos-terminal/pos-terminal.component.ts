import { Component, ViewChild, OnInit, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ProductSearchComponent } from './components/product-search/product-search.component';
import { ShoppingCartComponent } from './components/shopping-cart/shopping-cart.component';
import { Product } from '../../core/domain/entities/product.entity';
import { DexieDatabase } from '../../core/infrastructure/database/dexie-database.service';

/**
 * POS Terminal Page Component
 * 
 * Main page for the Point of Sale terminal.
 * Integrates product search and shopping cart functionality.
 * 
 * Features:
 * - Product search with real-time results
 * - Shopping cart management
 * - Responsive layout (search on left, cart on right)
 * - Product selection and cart integration
 * 
 * Layout:
 * - Desktop: Two-column layout (60/40 split)
 * - Mobile: Stacked layout with tabs
 * 
 * @example
 * ```html
 * <app-pos-terminal></app-pos-terminal>
 * ```
 */
@Component({
  selector: 'app-pos-terminal',
  standalone: true,
  imports: [
    CommonModule,
    ProductSearchComponent,
    ShoppingCartComponent
  ],
  template: `
    <div class="pos-terminal" data-testid="pos-terminal">
      <!-- Header -->
      <header class="pos-header">
        <div class="header-content">
          <h1 class="header-title">POS Terminal</h1>
          <div class="header-actions">
            <button 
              class="header-btn"
              data-testid="new-transaction-btn"
              (click)="startNewTransaction()"
              aria-label="Start new transaction">
              <svg fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" 
                  d="M12 4v16m8-8H4" />
              </svg>
              New Transaction
            </button>
          </div>
        </div>
      </header>

      <!-- Main Content -->
      <main class="pos-content">
        <!-- Product Search Section -->
        <section class="search-section" data-testid="search-section">
          <app-product-search
            (productSelected)="handleProductSelected($event)">
          </app-product-search>
        </section>

        <!-- Shopping Cart Section -->
        <aside class="cart-section" data-testid="cart-section">
          <app-shopping-cart></app-shopping-cart>
        </aside>
      </main>
    </div>
  `,
  styles: [`
    .pos-terminal {
      display: flex;
      flex-direction: column;
      height: 100vh;
      background: #f3f4f6;
    }

    .pos-header {
      background: white;
      border-bottom: 1px solid #e5e7eb;
      box-shadow: 0 1px 3px rgba(0, 0, 0, 0.1);
      z-index: 10;
    }

    .header-content {
      display: flex;
      justify-content: space-between;
      align-items: center;
      max-width: 1920px;
      margin: 0 auto;
      padding: 1rem 2rem;
    }

    .header-title {
      font-size: 1.5rem;
      font-weight: 700;
      margin: 0;
      color: #111827;
      background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
      -webkit-background-clip: text;
      -webkit-text-fill-color: transparent;
      background-clip: text;
    }

    .header-actions {
      display: flex;
      gap: 0.75rem;
    }

    .header-btn {
      display: flex;
      align-items: center;
      gap: 0.5rem;
      padding: 0.625rem 1.25rem;
      background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
      color: white;
      border: none;
      border-radius: 6px;
      font-size: 0.875rem;
      font-weight: 600;
      cursor: pointer;
      transition: all 0.2s;
    }

    .header-btn:hover {
      transform: translateY(-1px);
      box-shadow: 0 4px 12px rgba(102, 126, 234, 0.4);
    }

    .header-btn svg {
      width: 1.25rem;
      height: 1.25rem;
    }

    .pos-content {
      display: grid;
      grid-template-columns: 1fr 400px;
      gap: 1.5rem;
      flex: 1;
      max-width: 1920px;
      margin: 0 auto;
      padding: 1.5rem 2rem;
      width: 100%;
      overflow: hidden;
    }

    .search-section {
      display: flex;
      flex-direction: column;
      height: 100%;
      overflow: auto;
    }

    .search-section app-product-search {
      display: flex;
      flex-direction: column;
      height: 100%;
    }

    .cart-section {
      display: flex;
      flex-direction: column;
      height: 100%;
    }

    .cart-section app-shopping-cart {
      display: flex;
      flex-direction: column;
      height: 100%;
    }

    /* Responsive Design */
    @media (max-width: 1280px) {
      .pos-content {
        grid-template-columns: 1fr 350px;
      }
    }

    @media (max-width: 1024px) {
      .pos-content {
        grid-template-columns: 1fr;
        grid-template-rows: 1fr 400px;
      }

      .cart-section {
        border-top: 2px solid #e5e7eb;
      }
    }

    @media (max-width: 768px) {
      .header-content {
        padding: 1rem;
      }

      .header-title {
        font-size: 1.25rem;
      }

      .header-btn {
        padding: 0.5rem 1rem;
        font-size: 0.8125rem;
      }

      .header-btn svg {
        width: 1rem;
        height: 1rem;
      }

      .pos-content {
        padding: 1rem;
        gap: 1rem;
        grid-template-rows: 1fr 350px;
      }
    }

    @media (max-width: 640px) {
      .header-content {
        flex-direction: column;
        gap: 0.75rem;
        align-items: stretch;
      }

      .header-title {
        text-align: center;
      }

      .header-actions {
        justify-content: center;
      }

      .pos-content {
        grid-template-rows: 1fr 300px;
      }
    }
  `]
})
export class PosTerminalComponent implements OnInit {
  private db = inject(DexieDatabase);
  
  @ViewChild(ShoppingCartComponent) shoppingCart!: ShoppingCartComponent;

  async ngOnInit() {
    // Initialize database with seed data if empty
    try {
      await this.db.initializeWithSeedData();
      console.log('Database initialized with seed data');
    } catch (error) {
      console.error('Failed to initialize database:', error);
    }
  }

  /**
   * Handles product selection from search
   */
  handleProductSelected(product: Product): void {
    // Use setTimeout to ensure ViewChild is initialized
    setTimeout(() => {
      if (!this.shoppingCart) {
        console.error('Shopping cart not initialized');
        return;
      }

      // Add product to cart
      this.shoppingCart.addProduct(product);

      // Show feedback
      console.log('Product added to cart:', product.name);
    }, 0);
  }

  /**
   * Starts a new transaction
   */
  startNewTransaction(): void {
    if (!this.shoppingCart) {
      console.error('Shopping cart not initialized');
      return;
    }

    // Clear the cart
    this.shoppingCart.clearCart();

    // Show feedback
    console.log('New transaction started');
  }
}

// Made with Bob
