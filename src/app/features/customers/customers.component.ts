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
  templateUrl: './customers.component.html',
  styleUrl: './customers.component.scss',
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

  async openEditForm(customer: CustomerSummaryDTO): Promise<void> {
    this.formMode.set('edit');
    this.editingCustomerId.set(customer.id);

    // Fetch full customer details to populate all fields (address, notes, etc.)
    const fullCustomer = await this.customersUseCase.getCustomerById(customer.id);

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
