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
  ManageCustomersUseCase,
  CustomerSummaryDTO,
  CreateCustomerRequest,
  UpdateCustomerRequest,
} from '@core/application/use-cases/manage-customers.use-case';
import { CustomerStatus } from '@core/domain/entities/customer.entity';

type FormMode = 'closed' | 'create' | 'edit';

/**
 * Customer form data interface for create/edit operations
 */
interface CustomerFormData {
  name: string;
  email: string;
  phone: string;
  address: string;
  city: string;
  state: string;
  zipCode: string;
  country: string;
  notes: string;
}

/**
 * Customers Component
 *
 * Full CRUD interface for managing customer profiles with
 * persistent storage via IndexedDB (Dexie).
 *
 * Features:
 * - Customer list with name, email, phone, loyalty points
 * - Search/filter by name, email, or phone
 * - Create new customers with form validation
 * - Edit existing customers
 * - Delete customers with confirmation
 * - Customer detail view
 * - Status badges and loyalty tier display
 * - Persistent storage via ManageCustomersUseCase
 */
@Component({
  selector: 'app-customers',
  standalone: true,
  imports: [CommonModule, FormsModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="page-container" data-testid="customers-page">
      <!-- Header -->
      <div class="page-header">
        <div class="header-left">
          <h1 class="page-title">👥 Customer Management</h1>
          <p class="page-subtitle">
            {{ filteredCustomers().length }} of {{ customersUseCase.customers().length }} customers
          </p>
        </div>
        <div class="header-actions">
          <button class="btn-add" (click)="openCreateForm()" data-testid="btn-add-customer">
            ➕ Add Customer
          </button>
        </div>
      </div>

      <!-- Error Banner -->
      @if (customersUseCase.error()) {
        <div class="error-banner" data-testid="error-banner">
          <span class="error-icon">❌</span>
          <span class="error-text">{{ customersUseCase.error() }}</span>
          <button class="error-dismiss" (click)="dismissError()">Dismiss</button>
        </div>
      }

      <!-- Customer Form (Create/Edit) -->
      @if (formMode() !== 'closed') {
        <div class="form-overlay" data-testid="customer-form">
          <div class="form-container">
            <div class="form-header">
              <h2>{{ formMode() === 'create' ? 'Add New Customer' : 'Edit Customer' }}</h2>
              <button class="btn-close" (click)="closeForm()" data-testid="btn-close-form">
                ✕
              </button>
            </div>
            <div class="form-body">
              <div class="form-row">
                <div class="form-field">
                  <label for="name">Full Name *</label>
                  <input
                    id="name"
                    type="text"
                    [ngModel]="formData().name"
                    (ngModelChange)="updateFormField('name', $event)"
                    placeholder="e.g. John Doe"
                    data-testid="input-name"
                  />
                  @if (formErrors()['name']) {
                    <span class="field-error">{{ formErrors()['name'] }}</span>
                  }
                </div>
                <div class="form-field">
                  <label for="email">Email *</label>
                  <input
                    id="email"
                    type="email"
                    [ngModel]="formData().email"
                    (ngModelChange)="updateFormField('email', $event)"
                    placeholder="e.g. john@example.com"
                    data-testid="input-email"
                  />
                  @if (formErrors()['email']) {
                    <span class="field-error">{{ formErrors()['email'] }}</span>
                  }
                </div>
              </div>
              <div class="form-row">
                <div class="form-field">
                  <label for="phone">Phone *</label>
                  <input
                    id="phone"
                    type="tel"
                    [ngModel]="formData().phone"
                    (ngModelChange)="updateFormField('phone', $event)"
                    placeholder="e.g. (555) 123-4567"
                    data-testid="input-phone"
                  />
                  @if (formErrors()['phone']) {
                    <span class="field-error">{{ formErrors()['phone'] }}</span>
                  }
                </div>
                <div class="form-field">
                  <label for="country">Country</label>
                  <input
                    id="country"
                    type="text"
                    [ngModel]="formData().country"
                    (ngModelChange)="updateFormField('country', $event)"
                    placeholder="e.g. US"
                    data-testid="input-country"
                  />
                </div>
              </div>
              <div class="form-row">
                <div class="form-field">
                  <label for="address">Address</label>
                  <input
                    id="address"
                    type="text"
                    [ngModel]="formData().address"
                    (ngModelChange)="updateFormField('address', $event)"
                    placeholder="e.g. 123 Main St"
                    data-testid="input-address"
                  />
                </div>
                <div class="form-field">
                  <label for="city">City</label>
                  <input
                    id="city"
                    type="text"
                    [ngModel]="formData().city"
                    (ngModelChange)="updateFormField('city', $event)"
                    placeholder="e.g. Springfield"
                    data-testid="input-city"
                  />
                </div>
              </div>
              <div class="form-row">
                <div class="form-field">
                  <label for="state">State</label>
                  <input
                    id="state"
                    type="text"
                    [ngModel]="formData().state"
                    (ngModelChange)="updateFormField('state', $event)"
                    placeholder="e.g. IL"
                    data-testid="input-state"
                  />
                </div>
                <div class="form-field">
                  <label for="zipCode">Zip Code</label>
                  <input
                    id="zipCode"
                    type="text"
                    [ngModel]="formData().zipCode"
                    (ngModelChange)="updateFormField('zipCode', $event)"
                    placeholder="e.g. 62701"
                    data-testid="input-zipcode"
                  />
                </div>
              </div>
              <div class="form-row">
                <div class="form-field full-width">
                  <label for="notes">Notes</label>
                  <textarea
                    id="notes"
                    rows="2"
                    [ngModel]="formData().notes"
                    (ngModelChange)="updateFormField('notes', $event)"
                    placeholder="Optional notes about this customer"
                    data-testid="input-notes"
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
                (click)="saveCustomer()"
                [disabled]="customersUseCase.loading()"
                data-testid="btn-save"
              >
                {{
                  customersUseCase.loading()
                    ? 'Saving...'
                    : formMode() === 'create'
                      ? 'Create Customer'
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
            <h3>Delete Customer?</h3>
            <p>Are you sure you want to delete this customer? This action cannot be undone.</p>
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

      <!-- Search -->
      <div class="filters-bar">
        <div class="search-group">
          <input
            type="text"
            class="search-input"
            placeholder="Search by name, email, or phone..."
            [ngModel]="searchQuery()"
            (ngModelChange)="searchQuery.set($event)"
            data-testid="customer-search"
          />
        </div>
        <div class="filter-group">
          <select
            class="filter-select"
            [ngModel]="statusFilter()"
            (ngModelChange)="statusFilter.set($event)"
            data-testid="status-filter"
          >
            <option value="">All Statuses</option>
            <option value="ACTIVE">Active</option>
            <option value="INACTIVE">Inactive</option>
            <option value="VIP">VIP</option>
            <option value="BLOCKED">Blocked</option>
          </select>
        </div>
      </div>

      <!-- Loading State -->
      @if (customersUseCase.loading() && customersUseCase.customers().length === 0) {
        <div class="loading-state" data-testid="loading-state">
          <span>Loading customers...</span>
        </div>
      }

      <!-- Customers Table -->
      <div class="table-container">
        <table class="customers-table" data-testid="customers-table">
          <thead>
            <tr>
              <th class="col-name">Customer</th>
              <th class="col-email">Email</th>
              <th class="col-phone">Phone</th>
              <th class="col-status">Status</th>
              <th class="col-loyalty">Loyalty Points</th>
              <th class="col-tier">Tier</th>
              <th class="col-actions">Actions</th>
            </tr>
          </thead>
          <tbody>
            @for (customer of filteredCustomers(); track customer.id) {
              <tr class="customer-row" [attr.data-testid]="'customer-row-' + customer.id">
                <td class="col-name">
                  <div class="customer-cell">
                    <span class="customer-avatar">{{ getInitials(customer.name) }}</span>
                    <span class="customer-name">{{ customer.name }}</span>
                  </div>
                </td>
                <td class="col-email">
                  <span class="email-text">{{ customer.email }}</span>
                </td>
                <td class="col-phone">{{ customer.phone }}</td>
                <td class="col-status">
                  <span
                    class="status-badge"
                    [class]="'status-badge status-' + customer.status.toLowerCase()"
                    [attr.data-testid]="'status-' + customer.id"
                  >
                    {{ customer.status }}
                  </span>
                </td>
                <td class="col-loyalty">
                  <span class="loyalty-points">{{ customer.loyaltyPoints }}</span>
                  <span class="loyalty-unit">pts</span>
                </td>
                <td class="col-tier">
                  <span
                    class="tier-badge"
                    [class]="'tier-badge tier-' + customer.tier.toLowerCase()"
                  >
                    {{ customer.tier }}
                  </span>
                </td>
                <td class="col-actions">
                  <div class="action-buttons">
                    <button
                      class="btn-action btn-edit"
                      (click)="openEditForm(customer)"
                      [attr.data-testid]="'btn-edit-' + customer.id"
                      aria-label="Edit customer"
                    >
                      ✏️
                    </button>
                    <button
                      class="btn-action btn-delete"
                      (click)="requestDelete(customer.id)"
                      [attr.data-testid]="'btn-delete-' + customer.id"
                      aria-label="Delete customer"
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
                    <p>No customers found matching your criteria</p>
                  </div>
                </td>
              </tr>
            }
          </tbody>
        </table>
      </div>

      <!-- Summary Footer -->
      <div class="summary-footer" data-testid="customers-summary">
        <div class="summary-stat">
          <span class="stat-value">{{ customersUseCase.customers().length }}</span>
          <span class="stat-label">Total Customers</span>
        </div>
        <div class="summary-stat">
          <span class="stat-value stat-active">{{ activeCount() }}</span>
          <span class="stat-label">Active</span>
        </div>
        <div class="summary-stat">
          <span class="stat-value stat-vip">{{ vipCount() }}</span>
          <span class="stat-label">VIP</span>
        </div>
        <div class="summary-stat">
          <span class="stat-value stat-loyalty">{{ totalLoyaltyPoints() }}</span>
          <span class="stat-label">Total Points</span>
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

      .customers-table {
        width: 100%;
        border-collapse: collapse;
        font-size: 0.875rem;
      }

      .customers-table thead {
        position: sticky;
        top: 0;
        background: #f9fafb;
        z-index: 1;
      }

      .customers-table th {
        padding: 0.875rem 1rem;
        text-align: left;
        font-weight: 600;
        color: #374151;
        border-bottom: 2px solid #e5e7eb;
        white-space: nowrap;
      }

      .customers-table td {
        padding: 0.75rem 1rem;
        border-bottom: 1px solid #f3f4f6;
        color: #374151;
      }

      .customer-row:hover {
        background: #f9fafb;
      }

      .customer-cell {
        display: flex;
        align-items: center;
        gap: 0.625rem;
      }

      .customer-avatar {
        width: 36px;
        height: 36px;
        border-radius: 50%;
        background: #dbeafe;
        color: #2563eb;
        display: flex;
        align-items: center;
        justify-content: center;
        font-size: 0.75rem;
        font-weight: 700;
      }

      .customer-name {
        font-weight: 500;
      }

      .email-text {
        font-size: 0.8125rem;
        color: #6b7280;
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

      .status-active {
        background: #dcfce7;
        color: #166534;
      }
      .status-inactive {
        background: #f3f4f6;
        color: #6b7280;
      }
      .status-vip {
        background: #fef3c7;
        color: #92400e;
      }
      .status-blocked {
        background: #fee2e2;
        color: #991b1b;
      }

      /* Tier Badges */
      .tier-badge {
        display: inline-block;
        padding: 0.25rem 0.5rem;
        border-radius: 6px;
        font-size: 0.75rem;
        font-weight: 600;
      }

      .tier-bronze {
        background: #fef3c7;
        color: #92400e;
      }
      .tier-silver {
        background: #f3f4f6;
        color: #374151;
      }
      .tier-gold {
        background: #fef9c3;
        color: #854d0e;
      }
      .tier-platinum {
        background: #ede9fe;
        color: #5b21b6;
      }

      /* Loyalty Points */
      .loyalty-points {
        font-weight: 700;
        font-size: 1rem;
      }
      .loyalty-unit {
        font-size: 0.75rem;
        color: #9ca3af;
        margin-left: 0.25rem;
      }

      /* Action Buttons */
      .action-buttons {
        display: flex;
        gap: 0.375rem;
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

      .stat-active {
        color: #16a34a;
      }
      .stat-vip {
        color: #d97706;
      }
      .stat-loyalty {
        color: #2563eb;
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
export class CustomersComponent implements OnInit {
  readonly customersUseCase = inject(ManageCustomersUseCase);

  // Filter signals
  readonly searchQuery = signal('');
  readonly statusFilter = signal<string>('');

  // Form state
  readonly formMode = signal<FormMode>('closed');
  readonly editingCustomerId = signal<string | null>(null);
  readonly formData = signal<CustomerFormData>(this.getEmptyFormData());
  readonly formErrors = signal<Record<string, string>>({});

  // Delete confirmation
  readonly deleteConfirmId = signal<string | null>(null);

  // Computed values
  readonly filteredCustomers = computed(() => {
    let result = this.customersUseCase.customers();
    const query = this.searchQuery().toLowerCase().trim();
    const status = this.statusFilter();

    if (query) {
      result = result.filter(
        (c) =>
          c.name.toLowerCase().includes(query) ||
          c.email.toLowerCase().includes(query) ||
          c.phone.toLowerCase().includes(query),
      );
    }

    if (status) {
      result = result.filter((c) => c.status === status);
    }

    return result;
  });

  readonly activeCount = computed(
    () =>
      this.customersUseCase.customers().filter((c) => c.status === CustomerStatus.ACTIVE).length,
  );

  readonly vipCount = computed(
    () => this.customersUseCase.customers().filter((c) => c.status === CustomerStatus.VIP).length,
  );

  readonly totalLoyaltyPoints = computed(() =>
    this.customersUseCase.customers().reduce((sum, c) => sum + c.loyaltyPoints, 0),
  );

  ngOnInit(): void {
    this.customersUseCase.loadCustomers();
  }

  // Helper methods
  getInitials(name: string): string {
    return name
      .split(' ')
      .map((n) => n[0])
      .join('')
      .toUpperCase()
      .slice(0, 2);
  }

  dismissError(): void {
    this.customersUseCase.loadCustomers();
  }

  // Form operations
  openCreateForm(): void {
    this.formMode.set('create');
    this.editingCustomerId.set(null);
    this.formData.set(this.getEmptyFormData());
    this.formErrors.set({});
  }

  openEditForm(customer: CustomerSummaryDTO): void {
    this.formMode.set('edit');
    this.editingCustomerId.set(customer.id);
    this.formData.set({
      name: customer.name,
      email: customer.email,
      phone: customer.phone,
      address: '',
      city: '',
      state: '',
      zipCode: '',
      country: '',
      notes: '',
    });
    this.formErrors.set({});
  }

  closeForm(): void {
    this.formMode.set('closed');
    this.editingCustomerId.set(null);
    this.formData.set(this.getEmptyFormData());
    this.formErrors.set({});
  }

  updateFormField(field: keyof CustomerFormData, value: string): void {
    this.formData.update((current) => ({ ...current, [field]: value }));
    // Clear error for this field
    this.formErrors.update((current) => {
      const updated = { ...current };
      delete updated[field];
      return updated;
    });
  }

  async saveCustomer(): Promise<void> {
    const errors = this.validateForm();
    if (Object.keys(errors).length > 0) {
      this.formErrors.set(errors);
      return;
    }

    const data = this.formData();

    if (this.formMode() === 'create') {
      const request: CreateCustomerRequest = {
        name: data.name.trim(),
        email: data.email.trim(),
        phone: data.phone.trim(),
        address: data.address.trim() || undefined,
        city: data.city.trim() || undefined,
        state: data.state.trim() || undefined,
        zipCode: data.zipCode.trim() || undefined,
        country: data.country.trim() || undefined,
        notes: data.notes.trim() || undefined,
      };

      const result = await this.customersUseCase.createCustomer(request);
      if (result) {
        this.closeForm();
      }
    } else {
      const customerId = this.editingCustomerId();
      if (!customerId) return;

      const request: UpdateCustomerRequest = {
        id: customerId,
        name: data.name.trim(),
        email: data.email.trim(),
        phone: data.phone.trim(),
        address: data.address.trim(),
        city: data.city.trim(),
        state: data.state.trim(),
        zipCode: data.zipCode.trim(),
        country: data.country.trim(),
        notes: data.notes.trim(),
      };

      const result = await this.customersUseCase.updateCustomer(request);
      if (result) {
        this.closeForm();
      }
    }
  }

  // Delete operations
  requestDelete(customerId: string): void {
    this.deleteConfirmId.set(customerId);
  }

  cancelDelete(): void {
    this.deleteConfirmId.set(null);
  }

  async confirmDelete(): Promise<void> {
    const id = this.deleteConfirmId();
    if (!id) return;

    await this.customersUseCase.deleteCustomer(id);
    this.deleteConfirmId.set(null);
  }

  // Form validation
  private validateForm(): Record<string, string> {
    const errors: Record<string, string> = {};
    const data = this.formData();

    if (!data.name.trim()) {
      errors['name'] = 'Customer name is required';
    }

    if (!data.email.trim()) {
      errors['email'] = 'Email is required';
    } else if (!this.isValidEmail(data.email.trim())) {
      errors['email'] = 'Please enter a valid email address';
    }

    if (!data.phone.trim()) {
      errors['phone'] = 'Phone number is required';
    }

    return errors;
  }

  private isValidEmail(email: string): boolean {
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    return emailRegex.test(email);
  }

  private getEmptyFormData(): CustomerFormData {
    return {
      name: '',
      email: '',
      phone: '',
      address: '',
      city: '',
      state: '',
      zipCode: '',
      country: '',
      notes: '',
    };
  }
}
