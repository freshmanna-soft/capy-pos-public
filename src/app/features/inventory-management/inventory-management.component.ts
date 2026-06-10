import {
  Component,
  ChangeDetectionStrategy,
  signal,
  computed,
  inject,
  OnInit,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import {
  ManageInventoryUseCase,
  ProductSummaryDTO,
  CreateProductRequest,
  UpdateProductRequest,
} from '@core/application/use-cases/manage-inventory.use-case';

type StockStatus = 'healthy' | 'warning' | 'critical';
type FormMode = 'closed' | 'create' | 'edit';

/**
 * Product form data interface for create/edit operations
 */
interface ProductFormData {
  name: string;
  sku: string;
  category: string;
  price: number;
  cost: number;
  stock: number;
  description: string;
  emoji: string;
  barcode: string;
  lowStockThreshold: number;
  reorderQuantity: number;
}

/**
 * Inventory Management Component
 *
 * Full CRUD interface for managing product inventory with
 * persistent storage via IndexedDB (Dexie).
 *
 * Features:
 * - Product table with stock levels
 * - Search/filter by name, SKU, category, stock status
 * - Create new products with form validation
 * - Edit existing products inline
 * - Delete products with confirmation
 * - Stock adjustment (+/-) buttons
 * - Low stock alert banner
 * - Persistent storage via ManageInventoryUseCase
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
          <p class="page-subtitle">
            {{ filteredProducts().length }} of {{ inventoryUseCase.products().length }} products
          </p>
        </div>
        <div class="header-actions">
          <button class="btn-add" (click)="openCreateForm()" data-testid="btn-add-product">
            ➕ Add Product
          </button>
        </div>
      </div>

      <!-- Error Banner -->
      @if (inventoryUseCase.error()) {
        <div class="error-banner" data-testid="error-banner">
          <span class="error-icon">❌</span>
          <span class="error-text">{{ inventoryUseCase.error() }}</span>
          <button class="error-dismiss" (click)="dismissError()">Dismiss</button>
        </div>
      }

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

      <!-- Product Form (Create/Edit) -->
      @if (formMode() !== 'closed') {
        <div class="form-overlay" data-testid="product-form">
          <div class="form-container">
            <div class="form-header">
              <h2>{{ formMode() === 'create' ? 'Add New Product' : 'Edit Product' }}</h2>
              <button class="btn-close" (click)="closeForm()" data-testid="btn-close-form">
                ✕
              </button>
            </div>
            <div class="form-body">
              <div class="form-row">
                <div class="form-field">
                  <label for="name">Product Name *</label>
                  <input
                    id="name"
                    type="text"
                    [ngModel]="formData().name"
                    (ngModelChange)="updateFormField('name', $event)"
                    placeholder="e.g. Coffee"
                    data-testid="input-name"
                  />
                  @if (formErrors()['name']) {
                    <span class="field-error">{{ formErrors()['name'] }}</span>
                  }
                </div>
                <div class="form-field">
                  <label for="sku">SKU *</label>
                  <input
                    id="sku"
                    type="text"
                    [ngModel]="formData().sku"
                    (ngModelChange)="updateFormField('sku', $event)"
                    placeholder="e.g. SKU-001"
                    data-testid="input-sku"
                  />
                  @if (formErrors()['sku']) {
                    <span class="field-error">{{ formErrors()['sku'] }}</span>
                  }
                </div>
              </div>
              <div class="form-row">
                <div class="form-field">
                  <label for="category">Category *</label>
                  <input
                    id="category"
                    type="text"
                    [ngModel]="formData().category"
                    (ngModelChange)="updateFormField('category', $event)"
                    placeholder="e.g. Beverages"
                    data-testid="input-category"
                    list="category-suggestions"
                  />
                  <datalist id="category-suggestions">
                    @for (cat of inventoryUseCase.categories(); track cat) {
                      <option [value]="cat"></option>
                    }
                  </datalist>
                </div>
                <div class="form-field">
                  <label for="emoji">Icon</label>
                  <input
                    id="emoji"
                    type="text"
                    [ngModel]="formData().emoji"
                    (ngModelChange)="updateFormField('emoji', $event)"
                    placeholder="e.g. ☕"
                    data-testid="input-emoji"
                  />
                </div>
              </div>
              <div class="form-row">
                <div class="form-field">
                  <label for="price">Price ($) *</label>
                  <input
                    id="price"
                    type="number"
                    step="0.01"
                    min="0"
                    [ngModel]="formData().price"
                    (ngModelChange)="updateFormField('price', $event)"
                    data-testid="input-price"
                  />
                  @if (formErrors()['price']) {
                    <span class="field-error">{{ formErrors()['price'] }}</span>
                  }
                </div>
                <div class="form-field">
                  <label for="cost">Cost ($)</label>
                  <input
                    id="cost"
                    type="number"
                    step="0.01"
                    min="0"
                    [ngModel]="formData().cost"
                    (ngModelChange)="updateFormField('cost', $event)"
                    data-testid="input-cost"
                  />
                </div>
                <div class="form-field">
                  <label for="stock">Stock *</label>
                  <input
                    id="stock"
                    type="number"
                    min="0"
                    [ngModel]="formData().stock"
                    (ngModelChange)="updateFormField('stock', $event)"
                    data-testid="input-stock"
                  />
                  @if (formErrors()['stock']) {
                    <span class="field-error">{{ formErrors()['stock'] }}</span>
                  }
                </div>
              </div>
              <div class="form-row">
                <div class="form-field">
                  <label for="barcode">Barcode</label>
                  <input
                    id="barcode"
                    type="text"
                    [ngModel]="formData().barcode"
                    (ngModelChange)="updateFormField('barcode', $event)"
                    placeholder="e.g. 123456789"
                    data-testid="input-barcode"
                  />
                </div>
                <div class="form-field">
                  <label for="lowStockThreshold">Low Stock Threshold</label>
                  <input
                    id="lowStockThreshold"
                    type="number"
                    min="0"
                    [ngModel]="formData().lowStockThreshold"
                    (ngModelChange)="updateFormField('lowStockThreshold', $event)"
                    data-testid="input-threshold"
                  />
                </div>
              </div>
              <div class="form-row">
                <div class="form-field full-width">
                  <label for="description">Description</label>
                  <textarea
                    id="description"
                    rows="2"
                    [ngModel]="formData().description"
                    (ngModelChange)="updateFormField('description', $event)"
                    placeholder="Optional product description"
                    data-testid="input-description"
                  ></textarea>
                </div>
              </div>
            </div>
            <div class="form-footer">
              <button class="btn-cancel" (click)="closeForm()" data-testid="btn-cancel">
                Cancel
              </button>
              <button
                class="btn-save"
                (click)="saveProduct()"
                [disabled]="inventoryUseCase.loading()"
                data-testid="btn-save"
              >
                {{
                  inventoryUseCase.loading()
                    ? 'Saving...'
                    : formMode() === 'create'
                      ? 'Create Product'
                      : 'Save Changes'
                }}
              </button>
            </div>
          </div>
        </div>
      }

      <!-- Delete Confirmation -->
      @if (deleteConfirmId()) {
        <div class="form-overlay" data-testid="delete-confirm">
          <div class="confirm-container">
            <h3>Delete Product?</h3>
            <p>Are you sure you want to delete this product? This action cannot be undone.</p>
            <div class="confirm-actions">
              <button class="btn-cancel" (click)="cancelDelete()" data-testid="btn-cancel-delete">
                Cancel
              </button>
              <button
                class="btn-delete-confirm"
                (click)="confirmDelete()"
                data-testid="btn-confirm-delete"
              >
                Delete
              </button>
            </div>
          </div>
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
            data-testid="inventory-search"
          />
        </div>
        <div class="filter-group">
          <select
            class="filter-select"
            [ngModel]="categoryFilter()"
            (ngModelChange)="categoryFilter.set($event)"
            data-testid="category-filter"
          >
            <option value="">All Categories</option>
            @for (cat of inventoryUseCase.categories(); track cat) {
              <option [value]="cat">{{ cat }}</option>
            }
          </select>
          <select
            class="filter-select"
            [ngModel]="stockFilter()"
            (ngModelChange)="stockFilter.set($event)"
            data-testid="stock-filter"
          >
            <option value="">All Stock Levels</option>
            <option value="critical">Critical (&lt; 5)</option>
            <option value="warning">Warning (5-20)</option>
            <option value="healthy">Healthy (&gt; 20)</option>
          </select>
        </div>
      </div>

      <!-- Loading State -->
      @if (inventoryUseCase.loading() && inventoryUseCase.products().length === 0) {
        <div class="loading-state" data-testid="loading-state">
          <span>Loading inventory...</span>
        </div>
      }

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
                    <span class="product-icon">{{ product.emoji }}</span>
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
                    [attr.data-testid]="'status-' + product.id"
                  >
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
                      aria-label="Decrease stock"
                    >
                      −
                    </button>
                    <button
                      class="btn-adjust btn-increase"
                      (click)="adjustStock(product.id, 1)"
                      [attr.data-testid]="'btn-increase-' + product.id"
                      aria-label="Increase stock"
                    >
                      +
                    </button>
                    <button
                      class="btn-action btn-edit"
                      (click)="openEditForm(product)"
                      [attr.data-testid]="'btn-edit-' + product.id"
                      aria-label="Edit product"
                    >
                      ✏️
                    </button>
                    <button
                      class="btn-action btn-delete"
                      (click)="requestDelete(product.id)"
                      [attr.data-testid]="'btn-delete-' + product.id"
                      aria-label="Delete product"
                    >
                      🗑️
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
  styles: [
    `
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

      /* Error Banner */
      .error-banner {
        display: flex;
        align-items: center;
        gap: 0.75rem;
        padding: 0.875rem 1.25rem;
        background: #fee2e2;
        border: 1px solid #ef4444;
        border-radius: 8px;
        margin-bottom: 1.25rem;
      }

      .error-text {
        flex: 1;
        font-size: 0.875rem;
        color: #991b1b;
      }

      .error-dismiss {
        padding: 0.375rem 0.75rem;
        background: #ef4444;
        color: white;
        border: none;
        border-radius: 6px;
        font-size: 0.8125rem;
        cursor: pointer;
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

      /* Form Overlay */
      .form-overlay {
        position: fixed;
        top: 0;
        left: 0;
        right: 0;
        bottom: 0;
        background: rgba(0, 0, 0, 0.5);
        display: flex;
        align-items: center;
        justify-content: center;
        z-index: 1000;
      }

      .form-container {
        background: white;
        border-radius: 12px;
        width: 90%;
        max-width: 640px;
        max-height: 90vh;
        overflow-y: auto;
        box-shadow: 0 20px 60px rgba(0, 0, 0, 0.3);
      }

      .form-header {
        display: flex;
        justify-content: space-between;
        align-items: center;
        padding: 1.25rem 1.5rem;
        border-bottom: 1px solid #e5e7eb;
      }

      .form-header h2 {
        margin: 0;
        font-size: 1.25rem;
        color: #111827;
      }

      .btn-close {
        background: none;
        border: none;
        font-size: 1.25rem;
        cursor: pointer;
        color: #6b7280;
        padding: 0.25rem;
      }

      .form-body {
        padding: 1.5rem;
      }

      .form-row {
        display: flex;
        gap: 1rem;
        margin-bottom: 1rem;
      }

      .form-field {
        flex: 1;
        display: flex;
        flex-direction: column;
        gap: 0.25rem;
      }

      .form-field.full-width {
        flex: 1 1 100%;
      }

      .form-field label {
        font-size: 0.8125rem;
        font-weight: 600;
        color: #374151;
      }

      .form-field input,
      .form-field textarea {
        padding: 0.5rem 0.75rem;
        border: 2px solid #e5e7eb;
        border-radius: 6px;
        font-size: 0.875rem;
        outline: none;
        transition: border-color 0.15s;
      }

      .form-field input:focus,
      .form-field textarea:focus {
        border-color: #2563eb;
      }

      .field-error {
        font-size: 0.75rem;
        color: #dc2626;
      }

      .form-footer {
        display: flex;
        justify-content: flex-end;
        gap: 0.75rem;
        padding: 1rem 1.5rem;
        border-top: 1px solid #e5e7eb;
      }

      .btn-cancel {
        padding: 0.5rem 1rem;
        background: #f3f4f6;
        color: #374151;
        border: 1px solid #d1d5db;
        border-radius: 6px;
        font-size: 0.875rem;
        cursor: pointer;
      }

      .btn-save {
        padding: 0.5rem 1.25rem;
        background: #2563eb;
        color: white;
        border: none;
        border-radius: 6px;
        font-size: 0.875rem;
        font-weight: 600;
        cursor: pointer;
      }

      .btn-save:hover {
        background: #1d4ed8;
      }
      .btn-save:disabled {
        opacity: 0.5;
        cursor: not-allowed;
      }

      /* Delete Confirmation */
      .confirm-container {
        background: white;
        border-radius: 12px;
        padding: 1.5rem;
        width: 90%;
        max-width: 400px;
        text-align: center;
      }

      .confirm-container h3 {
        margin: 0 0 0.5rem;
        color: #111827;
      }
      .confirm-container p {
        color: #6b7280;
        font-size: 0.875rem;
        margin: 0 0 1.5rem;
      }

      .confirm-actions {
        display: flex;
        justify-content: center;
        gap: 0.75rem;
      }

      .btn-delete-confirm {
        padding: 0.5rem 1.25rem;
        background: #dc2626;
        color: white;
        border: none;
        border-radius: 6px;
        font-size: 0.875rem;
        font-weight: 600;
        cursor: pointer;
      }

      .btn-delete-confirm:hover {
        background: #b91c1c;
      }

      /* Loading State */
      .loading-state {
        text-align: center;
        padding: 2rem;
        color: #6b7280;
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

      .btn-action {
        width: 32px;
        height: 32px;
        border: none;
        border-radius: 6px;
        background: transparent;
        font-size: 0.875rem;
        cursor: pointer;
        display: flex;
        align-items: center;
        justify-content: center;
        transition: background 0.15s;
      }

      .btn-edit:hover {
        background: #dbeafe;
      }
      .btn-delete:hover {
        background: #fee2e2;
      }

      /* Empty State */
      .empty-state {
        text-align: center;
        padding: 3rem;
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

      .stat-healthy {
        color: #16a34a;
      }
      .stat-warning {
        color: #d97706;
      }
      .stat-critical {
        color: #dc2626;
      }

      /* Responsive */
      @media (max-width: 768px) {
        .page-container {
          padding: 1rem;
        }
        .filters-bar {
          flex-direction: column;
          align-items: stretch;
        }
        .search-group {
          max-width: none;
        }
        .filter-group {
          flex-wrap: wrap;
        }
        .summary-footer {
          flex-wrap: wrap;
          gap: 1rem;
        }
        .form-row {
          flex-direction: column;
        }
      }
    `,
  ],
})
export class InventoryManagementComponent implements OnInit {
  readonly inventoryUseCase = inject(ManageInventoryUseCase);

  // Filter signals
  readonly searchQuery = signal('');
  readonly categoryFilter = signal('');
  readonly stockFilter = signal<'' | StockStatus>('');

  // Form state
  readonly formMode = signal<FormMode>('closed');
  readonly editingProductId = signal<string | null>(null);
  readonly formData = signal<ProductFormData>(this.getEmptyFormData());
  readonly formErrors = signal<Record<string, string>>({});

  // Delete confirmation
  readonly deleteConfirmId = signal<string | null>(null);

  // Computed values
  readonly filteredProducts = computed(() => {
    let result = this.inventoryUseCase.products();
    const query = this.searchQuery().toLowerCase().trim();
    const category = this.categoryFilter();
    const stockStatus = this.stockFilter();

    if (query) {
      result = result.filter(
        (p) => p.name.toLowerCase().includes(query) || p.sku.toLowerCase().includes(query),
      );
    }

    if (category) {
      result = result.filter((p) => p.category === category);
    }

    if (stockStatus) {
      result = result.filter((p) => this.getStockStatus(p.stock) === stockStatus);
    }

    return result;
  });

  readonly lowStockCount = computed(
    () => this.inventoryUseCase.products().filter((p) => p.stock < 5).length,
  );

  readonly warningCount = computed(
    () => this.inventoryUseCase.products().filter((p) => p.stock >= 5 && p.stock <= 20).length,
  );

  readonly healthyCount = computed(
    () => this.inventoryUseCase.products().filter((p) => p.stock > 20).length,
  );

  readonly totalStock = computed(() =>
    this.inventoryUseCase.products().reduce((sum, p) => sum + p.stock, 0),
  );

  ngOnInit(): void {
    this.inventoryUseCase.loadProducts();
  }

  // Stock status helpers
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

  // Stock adjustment
  adjustStock(productId: string, delta: number): void {
    this.inventoryUseCase.adjustStock(productId, delta);
  }

  // Filter actions
  filterLowStock(): void {
    this.stockFilter.set('critical');
    this.categoryFilter.set('');
    this.searchQuery.set('');
  }

  dismissError(): void {
    // Clear error by reloading
    this.inventoryUseCase.loadProducts();
  }

  // Form operations
  openCreateForm(): void {
    this.formMode.set('create');
    this.editingProductId.set(null);
    this.formData.set(this.getEmptyFormData());
    this.formErrors.set({});
  }

  openEditForm(product: ProductSummaryDTO): void {
    this.formMode.set('edit');
    this.editingProductId.set(product.id);
    this.formData.set({
      name: product.name,
      sku: product.sku,
      category: product.category,
      price: product.price,
      cost: product.cost,
      stock: product.stock,
      description: product.description,
      emoji: product.emoji,
      barcode: product.barcode,
      lowStockThreshold: product.lowStockThreshold,
      reorderQuantity: 20,
    });
    this.formErrors.set({});
  }

  closeForm(): void {
    this.formMode.set('closed');
    this.editingProductId.set(null);
    this.formData.set(this.getEmptyFormData());
    this.formErrors.set({});
  }

  updateFormField(field: keyof ProductFormData, value: string | number): void {
    this.formData.update((current) => ({ ...current, [field]: value }));
    // Clear error for this field
    this.formErrors.update((current) => {
      const updated = { ...current };
      delete updated[field];
      return updated;
    });
  }

  async saveProduct(): Promise<void> {
    const errors = this.validateForm();
    if (Object.keys(errors).length > 0) {
      this.formErrors.set(errors);
      return;
    }

    const data = this.formData();

    if (this.formMode() === 'create') {
      const request: CreateProductRequest = {
        name: data.name.trim(),
        sku: data.sku.trim(),
        category: data.category.trim(),
        price: Number(data.price),
        cost: Number(data.cost),
        stock: Number(data.stock),
        description: data.description.trim() || undefined,
        emoji: data.emoji.trim() || undefined,
        barcode: data.barcode.trim() || undefined,
        lowStockThreshold: Number(data.lowStockThreshold),
        reorderQuantity: Number(data.reorderQuantity),
      };

      const result = await this.inventoryUseCase.createProduct(request);
      if (result) {
        this.closeForm();
      }
    } else {
      const productId = this.editingProductId();
      if (!productId) return;

      const request: UpdateProductRequest = {
        id: productId,
        name: data.name.trim(),
        sku: data.sku.trim(),
        category: data.category.trim(),
        price: Number(data.price),
        cost: Number(data.cost),
        stock: Number(data.stock),
        description: data.description.trim(),
        emoji: data.emoji.trim(),
        barcode: data.barcode.trim(),
        lowStockThreshold: Number(data.lowStockThreshold),
        reorderQuantity: Number(data.reorderQuantity),
      };

      const result = await this.inventoryUseCase.updateProduct(request);
      if (result) {
        this.closeForm();
      }
    }
  }

  // Delete operations
  requestDelete(productId: string): void {
    this.deleteConfirmId.set(productId);
  }

  cancelDelete(): void {
    this.deleteConfirmId.set(null);
  }

  async confirmDelete(): Promise<void> {
    const id = this.deleteConfirmId();
    if (!id) return;

    await this.inventoryUseCase.deleteProduct(id);
    this.deleteConfirmId.set(null);
  }

  // Form validation
  private validateForm(): Record<string, string> {
    const errors: Record<string, string> = {};
    const data = this.formData();

    if (!data.name.trim()) {
      errors['name'] = 'Product name is required';
    }

    if (!data.sku.trim()) {
      errors['sku'] = 'SKU is required';
    }

    if (!data.category.trim()) {
      errors['category'] = 'Category is required';
    }

    if (Number(data.price) < 0) {
      errors['price'] = 'Price cannot be negative';
    }

    if (Number(data.stock) < 0) {
      errors['stock'] = 'Stock cannot be negative';
    }

    return errors;
  }

  private getEmptyFormData(): ProductFormData {
    return {
      name: '',
      sku: '',
      category: '',
      price: 0,
      cost: 0,
      stock: 0,
      description: '',
      emoji: '',
      barcode: '',
      lowStockThreshold: 10,
      reorderQuantity: 20,
    };
  }
}
