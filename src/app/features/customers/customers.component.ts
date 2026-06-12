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
  CustomerSummaryDTO,
  CreateCustomerRequest,
  UpdateCustomerRequest,
} from '@core/application/use-cases/manage-customers.use-case';
import { CustomerStatus } from '@core/domain/entities/customer.entity';
import { CustomerFacade } from '@core/application/facades';

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
  templateUrl: './customers.component.html',
  styleUrl: './customers.component.scss',
})
export class CustomersComponent implements OnInit {
  protected readonly customerFacade = inject(CustomerFacade);

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
    let result = this.customerFacade.customers();
    const query = this.searchQuery().toLowerCase().trim();
    const status = this.statusFilter();

    if (query) {
      result = result.filter(
        (c) =>
          c.name.toLowerCase().includes(query) ||
          c.email.toLowerCase().includes(query) ||
          c.phone.toLowerCase().includes(query)
      );
    }

    if (status) {
      result = result.filter((c) => c.status === status);
    }

    return result;
  });

  readonly activeCount = computed(
    () => this.customerFacade.customers().filter((c) => c.status === CustomerStatus.ACTIVE).length
  );

  readonly vipCount = computed(
    () => this.customerFacade.customers().filter((c) => c.status === CustomerStatus.VIP).length
  );

  readonly totalLoyaltyPoints = computed(() =>
    this.customerFacade.customers().reduce((sum, c) => sum + c.loyaltyPoints, 0)
  );

  ngOnInit(): void {
    this.customerFacade.loadCustomers();
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

  getStatusClasses(status: string): string {
    const base = 'inline-block px-2.5 py-1 rounded-full font-semibold uppercase tracking-wide';
    switch (status.toLowerCase()) {
      case 'active':
        return `${base} bg-green-100 text-green-800`;
      case 'inactive':
        return `${base} bg-gray-100 text-gray-600`;
      case 'vip':
        return `${base} bg-amber-100 text-amber-800`;
      case 'blocked':
        return `${base} bg-red-100 text-red-800`;
      default:
        return `${base} bg-gray-100 text-gray-600`;
    }
  }

  getTierClasses(tier: string): string {
    const base = 'inline-block px-2 py-1 rounded-md text-xs font-semibold';
    switch (tier.toLowerCase()) {
      case 'bronze':
        return `${base} bg-amber-100 text-amber-800`;
      case 'silver':
        return `${base} bg-gray-100 text-gray-700`;
      case 'gold':
        return `${base} bg-yellow-100 text-yellow-800`;
      case 'platinum':
        return `${base} bg-purple-100 text-purple-800`;
      default:
        return `${base} bg-gray-100 text-gray-600`;
    }
  }

  dismissError(): void {
    this.customerFacade.loadCustomers();
  }

  // Form operations
  openCreateForm(): void {
    this.formMode.set('create');
    this.editingCustomerId.set(null);
    this.formData.set(this.getEmptyFormData());
    this.formErrors.set({});
  }

  async openEditForm(customer: CustomerSummaryDTO): Promise<void> {
    this.formMode.set('edit');
    this.editingCustomerId.set(customer.id);

    // Fetch full customer details to populate all fields (address, notes, etc.)
    const fullCustomer = await this.customerFacade.getCustomerById(customer.id);

    this.formData.set({
      name: fullCustomer?.name ?? customer.name,
      email: fullCustomer?.email ?? customer.email,
      phone: fullCustomer?.phone ?? customer.phone,
      address: fullCustomer?.address ?? '',
      city: fullCustomer?.city ?? '',
      state: fullCustomer?.state ?? '',
      zipCode: fullCustomer?.zipCode ?? '',
      country: fullCustomer?.country ?? '',
      notes: fullCustomer?.notes ?? '',
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

      const result = await this.customerFacade.createCustomer(request);
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

      const result = await this.customerFacade.updateCustomer(request);
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

    await this.customerFacade.deleteCustomer(id);
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
