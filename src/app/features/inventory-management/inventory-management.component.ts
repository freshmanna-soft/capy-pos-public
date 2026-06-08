import { Component, ChangeDetectionStrategy, signal, computed } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';

interface InventoryProduct {
  id: string;
  name: string;
  sku: string;
  category: string;
  price: number;
  stock: number;
  icon: string;
}

type StockStatus = 'healthy' | 'warning' | 'critical';

/**
 * Inventory Management Component
 * 
 * Generated with guidance from Capy-POS workflow agents:
 * - Orchestrator: Sprint 2 planning & user stories
 * - QA Tester: E2E test scenarios
 * - Code Reviewer: Quality patterns
 * 
 * Features:
 * - Product table with stock levels
 * - Search/filter by name or SKU
 * - Color-coded stock status badges
 * - Stock adjustment (+/-) buttons
 * - Low stock alert banner
 */
@Component({
  selector: 'app-inventory-management',
  standalone: true,
  imports: [CommonModule, FormsModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="page-container" data-testid="inventory-page">
      <!-- Header -->
      <div class="page-header">
        <div class="header-left">
          <h1 class="page-title">📦 Inventory Management</h1>
          <p class="page-subtitle">{{ filteredProducts().length }} of {{ products().length }} products</p>
        </div>
        <div class="header-actions">
          <button class="btn-add" data-testid="btn-add-product">
            ➕ Add Product
          </button>
        </div>
      </div>

      <!-- Low Stock Alert -->
      @if (lowStockCount() > 0) {
        <div class="alert-banner" data-testid="low-stock-alert">
          <span class="alert-icon">⚠️</span>
          <span class="alert-text">
            <strong>{{ lowStockCount() }} product{{ lowStockCount() > 1 ? 's' : '' }}</strong> 
            {{ lowStockCount() > 1 ? 'have' : 'has' }} low stock (below 5 units)
          </span>
          <button class="alert-action" (click)="filterLowStock()">View All</button>
        </div>
      }

      <!-- Search & Filters -->
      <div class="filters-bar">
        <div class="search-group">
          <input 
            type="text"
            class="search-input"
            placeholder="Search by name or SKU..."
            [ngModel]="searchQuery()"
            (ngModelChange)="searchQuery.set($event)"
            data-testid="inventory-search" />
        </div>
        <div class="filter-group">
          <select 
            class="filter-select"
            [ngModel]="categoryFilter()"
            (ngModelChange)="categoryFilter.set($event)"
            data-testid="category-filter">
            <option value="">All Categories</option>
            @for (cat of categories(); track cat) {
              <option [value]="cat">{{ cat }}</option>
            }
          </select>
          <select 
            class="filter-select"
            [ngModel]="stockFilter()"
            (ngModelChange)="stockFilter.set($event)"
            data-testid="stock-filter">
            <option value="">All Stock Levels</option>
            <option value="critical">Critical (&lt; 5)</option>
            <option value="warning">Warning (5-20)</option>
            <option value="healthy">Healthy (&gt; 20)</option>
          </select>
        </div>
      </div>

      <!-- Products Table -->
      <div class="table-container">
        <table class="inventory-table" data-testid="inventory-table">
          <thead>
            <tr>
              <th class="col-product">Product</th>
              <th class="col-sku">SKU</th>
              <th class="col-category">Category</th>
              <th class="col-price">Price</th>
              <th class="col-stock">Stock Level</th>
              <th class="col-status">Status</th>
              <th class="col-actions">Actions</th>
            </tr>
          </thead>
          <tbody>
            @for (product of filteredProducts(); track product.id) {
              <tr class="product-row" [attr.data-testid]="'product-row-' + product.id">
                <td class="col-product">
                  <div class="product-cell">
                    <span class="product-icon">{{ product.icon }}</span>
                    <span class="product-name">{{ product.name }}</span>
                  </div>
                </td>
                <td class="col-sku">
                  <code class="sku-code">{{ product.sku }}</code>
                </td>
                <td class="col-category">
                  <span class="category-badge">{{ product.category }}</span>
                </td>
                <td class="col-price">{{ product.price | currency }}</td>
                <td class="col-stock">
                  <div class="stock-display">
                    <span class="stock-number">{{ product.stock }}</span>
                    <span class="stock-unit">units</span>
                  </div>
                </td>
                <td class="col-status">
                  <span 
                    class="status-badge"
                    [class]="'status-badge status-' + getStockStatus(product.stock)"
                    [attr.data-testid]="'status-' + product.id">
                    {{ getStockLabel(product.stock) }}
                  </span>
                </td>
                <td class="col-actions">
                  <div class="action-buttons">
                    <button 
                      class="btn-adjust btn-decrease"
                      (click)="adjustStock(product.id, -1)"
                      [disabled]="product.stock <= 0"
                      [attr.data-testid]="'btn-decrease-' + product.id"
                      aria-label="Decrease stock">
                      −
                    </button>
                    <button 
                      class="btn-adjust btn-increase"
                      (click)="adjustStock(product.id, 1)"
                      [attr.data-testid]="'btn-increase-' + product.id"
                      aria-label="Increase stock">
                      +
                    </button>
                  </div>
                </td>
              </tr>
            } @empty {
              <tr>
                <td colspan="7" class="empty-state">
                  <div class="empty-content">
                    <span class="empty-icon">🔍</span>
                    <p>No products found matching your criteria</p>
                  </div>
                </td>
              </tr>
            }
          </tbody>
        </table>
      </div>

      <!-- Summary Footer -->
      <div class="summary-footer" data-testid="inventory-summary">
        <div class="summary-stat">
          <span class="stat-value">{{ totalStock() }}</span>
          <span class="stat-label">Total Units</span>
        </div>
        <div class="summary-stat">
          <span class="stat-value stat-healthy">{{ healthyCount() }}</span>
          <span class="stat-label">Healthy</span>
        </div>
        <div class="summary-stat">
          <span class="stat-value stat-warning">{{ warningCount() }}</span>
          <span class="stat-label">Warning</span>
        </div>
        <div class="summary-stat">
          <span class="stat-value stat-critical">{{ lowStockCount() }}</span>
          <span class="stat-label">Critical</span>
        </div>
      </div>
    </div>
  `,
  styles: [`
    .page-container {
      padding: 1.5rem 2rem;
      max-width: 1400px;
      margin: 0 auto;
      height: 100%;
      display: flex;
      flex-direction: column;
    }

    .page-header {
      display: flex;
      justify-content: space-between;
      align-items: flex-start;
      margin-bottom: 1.5rem;
    }

    .page-title {
      font-size: 1.75rem;
      font-weight: 700;
      color: #111827;
      margin: 0;
    }

    .page-subtitle {
      color: #6b7280;
      margin: 0.25rem 0 0;
      font-size: 0.875rem;
    }

    .btn-add {
      padding: 0.625rem 1.25rem;
      background: #2563eb;
      color: white;
      border: none;
      border-radius: 8px;
      font-size: 0.875rem;
      font-weight: 600;
      cursor: pointer;
      transition: background 0.15s;
    }

    .btn-add:hover {
      background: #1d4ed8;
    }

    /* Alert Banner */
    .alert-banner {
      display: flex;
      align-items: center;
      gap: 0.75rem;
      padding: 0.875rem 1.25rem;
      background: #fef3c7;
      border: 1px solid #f59e0b;
      border-radius: 8px;
      margin-bottom: 1.25rem;
    }

    .alert-icon {
      font-size: 1.25rem;
    }

    .alert-text {
      flex: 1;
      font-size: 0.875rem;
      color: #92400e;
    }

    .alert-action {
      padding: 0.375rem 0.75rem;
      background: #f59e0b;
      color: white;
      border: none;
      border-radius: 6px;
      font-size: 0.8125rem;
      font-weight: 600;
      cursor: pointer;
    }

    .alert-action:hover {
      background: #d97706;
    }

    /* Filters */
    .filters-bar {
      display: flex;
      justify-content: space-between;
      align-items: center;
      gap: 1rem;
      margin-bottom: 1.25rem;
    }

    .search-group {
      flex: 1;
      max-width: 400px;
    }

    .search-input {
      width: 100%;
      padding: 0.625rem 1rem;
      border: 2px solid #e5e7eb;
      border-radius: 8px;
      font-size: 0.875rem;
      outline: none;
      transition: border-color 0.15s;
      box-sizing: border-box;
    }

    .search-input:focus {
      border-color: #2563eb;
    }

    .filter-group {
      display: flex;
      gap: 0.75rem;
    }

    .filter-select {
      padding: 0.625rem 0.75rem;
      border: 2px solid #e5e7eb;
      border-radius: 8px;
      font-size: 0.8125rem;
      background: white;
      cursor: pointer;
      outline: none;
    }

    .filter-select:focus {
      border-color: #2563eb;
    }

    /* Table */
    .table-container {
      flex: 1;
      overflow: auto;
      background: white;
      border-radius: 12px;
      border: 1px solid #e5e7eb;
    }

    .inventory-table {
      width: 100%;
      border-collapse: collapse;
      font-size: 0.875rem;
    }

    .inventory-table thead {
      position: sticky;
      top: 0;
      background: #f9fafb;
      z-index: 1;
    }

    .inventory-table th {
      padding: 0.875rem 1rem;
      text-align: left;
      font-weight: 600;
      color: #374151;
      border-bottom: 2px solid #e5e7eb;
      white-space: nowrap;
    }

    .inventory-table td {
      padding: 0.75rem 1rem;
      border-bottom: 1px solid #f3f4f6;
      color: #374151;
    }

    .product-row:hover {
      background: #f9fafb;
    }

    .product-cell {
      display: flex;
      align-items: center;
      gap: 0.625rem;
    }

    .product-icon {
      font-size: 1.5rem;
    }

    .product-name {
      font-weight: 500;
    }

    .sku-code {
      font-family: 'JetBrains Mono', monospace;
      font-size: 0.8125rem;
      background: #f3f4f6;
      padding: 0.125rem 0.5rem;
      border-radius: 4px;
      color: #6b7280;
    }

    .category-badge {
      font-size: 0.8125rem;
      color: #6b7280;
    }

    .stock-display {
      display: flex;
      align-items: baseline;
      gap: 0.25rem;
    }

    .stock-number {
      font-weight: 700;
      font-size: 1rem;
    }

    .stock-unit {
      font-size: 0.75rem;
      color: #9ca3af;
    }

    /* Status Badges */
    .status-badge {
      display: inline-block;
      padding: 0.25rem 0.625rem;
      border-radius: 9999px;
      font-size: 0.75rem;
      font-weight: 600;
      text-transform: uppercase;
      letter-spacing: 0.025em;
    }

    .status-healthy {
      background: #dcfce7;
      color: #166534;
    }

    .status-warning {
      background: #fef9c3;
      color: #854d0e;
    }

    .status-critical {
      background: #fee2e2;
      color: #991b1b;
    }

    /* Action Buttons */
    .action-buttons {
      display: flex;
      gap: 0.375rem;
    }

    .btn-adjust {
      width: 32px;
      height: 32px;
      border: 2px solid #e5e7eb;
      border-radius: 6px;
      background: white;
      font-size: 1.125rem;
      font-weight: 700;
      cursor: pointer;
      display: flex;
      align-items: center;
      justify-content: center;
      transition: all 0.15s;
    }

    .btn-increase:hover {
      background: #dcfce7;
      border-color: #16a34a;
      color: #16a34a;
    }

    .btn-decrease:hover:not(:disabled) {
      background: #fee2e2;
      border-color: #dc2626;
      color: #dc2626;
    }

    .btn-adjust:disabled {
      opacity: 0.3;
      cursor: not-allowed;
    }

    /* Empty State */
    .empty-state {
      text-align: center;
      padding: 3rem !important;
    }

    .empty-content {
      display: flex;
      flex-direction: column;
      align-items: center;
      gap: 0.5rem;
      color: #9ca3af;
    }

    .empty-icon {
      font-size: 2rem;
    }

    .empty-content p {
      margin: 0;
    }

    /* Summary Footer */
    .summary-footer {
      display: flex;
      gap: 2rem;
      padding: 1.25rem 1.5rem;
      margin-top: 1.25rem;
      background: white;
      border-radius: 12px;
      border: 1px solid #e5e7eb;
    }

    .summary-stat {
      display: flex;
      flex-direction: column;
      align-items: center;
      gap: 0.25rem;
    }

    .stat-value {
      font-size: 1.5rem;
      font-weight: 700;
      color: #111827;
    }

    .stat-label {
      font-size: 0.75rem;
      color: #6b7280;
      text-transform: uppercase;
      letter-spacing: 0.05em;
    }

    .stat-healthy { color: #16a34a; }
    .stat-warning { color: #d97706; }
    .stat-critical { color: #dc2626; }

    /* Responsive */
    @media (max-width: 768px) {
      .page-container { padding: 1rem; }
      .filters-bar { flex-direction: column; align-items: stretch; }
      .search-group { max-width: none; }
      .filter-group { flex-wrap: wrap; }
      .summary-footer { flex-wrap: wrap; gap: 1rem; }
    }
  `]
})
export class InventoryManagementComponent {
  // State signals
  readonly products = signal<InventoryProduct[]>([
    { id: '1', name: 'Coffee', sku: 'SKU-001', category: 'Beverages', price: 4.50, stock: 50, icon: '☕' },
    { id: '2', name: 'Sandwich', sku: 'SKU-002', category: 'Food', price: 8.99, stock: 3, icon: '🥪' },
    { id: '3', name: 'Salad', sku: 'SKU-003', category: 'Food', price: 7.50, stock: 25, icon: '🥗' },
    { id: '4', name: 'Pizza', sku: 'SKU-004', category: 'Food', price: 12.99, stock: 8, icon: '🍕' },
    { id: '5', name: 'Burger', sku: 'SKU-005', category: 'Food', price: 10.50, stock: 35, icon: '🍔' },
    { id: '6', name: 'Sushi', sku: 'SKU-006', category: 'Food', price: 15.99, stock: 2, icon: '🍣' },
    { id: '7', name: 'Pasta', sku: 'SKU-007', category: 'Food', price: 11.50, stock: 28, icon: '🍝' },
    { id: '8', name: 'Taco', sku: 'SKU-008', category: 'Food', price: 6.99, stock: 12, icon: '🌮' },
    { id: '9', name: 'Tea', sku: 'SKU-009', category: 'Beverages', price: 3.50, stock: 60, icon: '🍵' },
    { id: '10', name: 'Juice', sku: 'SKU-010', category: 'Beverages', price: 4.99, stock: 4, icon: '🧃' },
    { id: '11', name: 'Donut', sku: 'SKU-011', category: 'Desserts', price: 2.99, stock: 18, icon: '🍩' },
    { id: '12', name: 'Ice Cream', sku: 'SKU-012', category: 'Desserts', price: 5.50, stock: 30, icon: '🍦' },
  ]);

  readonly searchQuery = signal('');
  readonly categoryFilter = signal('');
  readonly stockFilter = signal<'' | StockStatus>('');

  // Computed values
  readonly categories = computed(() => {
    const cats = new Set(this.products().map(p => p.category));
    return Array.from(cats).sort();
  });

  readonly filteredProducts = computed(() => {
    let result = this.products();
    const query = this.searchQuery().toLowerCase().trim();
    const category = this.categoryFilter();
    const stockStatus = this.stockFilter();

    if (query) {
      result = result.filter(p =>
        p.name.toLowerCase().includes(query) ||
        p.sku.toLowerCase().includes(query)
      );
    }

    if (category) {
      result = result.filter(p => p.category === category);
    }

    if (stockStatus) {
      result = result.filter(p => this.getStockStatus(p.stock) === stockStatus);
    }

    return result;
  });

  readonly lowStockCount = computed(() =>
    this.products().filter(p => p.stock < 5).length
  );

  readonly warningCount = computed(() =>
    this.products().filter(p => p.stock >= 5 && p.stock <= 20).length
  );

  readonly healthyCount = computed(() =>
    this.products().filter(p => p.stock > 20).length
  );

  readonly totalStock = computed(() =>
    this.products().reduce((sum, p) => sum + p.stock, 0)
  );

  // Methods
  getStockStatus(stock: number): StockStatus {
    if (stock < 5) return 'critical';
    if (stock <= 20) return 'warning';
    return 'healthy';
  }

  getStockLabel(stock: number): string {
    if (stock < 5) return 'Critical';
    if (stock <= 20) return 'Warning';
    return 'Healthy';
  }

  adjustStock(productId: string, delta: number): void {
    this.products.update(products =>
      products.map(p =>
        p.id === productId
          ? { ...p, stock: Math.max(0, p.stock + delta) }
          : p
      )
    );
  }

  filterLowStock(): void {
    this.stockFilter.set('critical');
    this.categoryFilter.set('');
    this.searchQuery.set('');
  }
}
