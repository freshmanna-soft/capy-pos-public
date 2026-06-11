import { Injectable, inject, signal, computed } from '@angular/core';
import { ICustomerRepository } from '@core/domain/interfaces/customer.repository.interface';
import { CUSTOMER_REPOSITORY } from '@core/infrastructure/factories/repository.factory';
import { Customer, CustomerStatus } from '@core/domain/entities/customer.entity';
import { generateUUID } from '@core/domain/utils/uuid';
import { EntityNotFoundException, DuplicateEntityException } from '@core/domain/exceptions';

/**
 * DTO for creating a new customer
 */
export interface CreateCustomerRequest {
  name: string;
  email: string;
  phone: string;
  address?: string;
  city?: string;
  state?: string;
  zipCode?: string;
  country?: string;
  notes?: string;
}

/**
 * DTO for updating an existing customer
 */
export interface UpdateCustomerRequest {
  id: string;
  name?: string;
  email?: string;
  phone?: string;
  address?: string;
  city?: string;
  state?: string;
  zipCode?: string;
  country?: string;
  notes?: string;
}

/**
 * Customer summary DTO for the customer list
 */
export interface CustomerSummaryDTO {
  id: string;
  name: string;
  email: string;
  phone: string;
  status: CustomerStatus;
  loyaltyPoints: number;
  tier: string;
  totalPurchases: number;
  createdAt: Date;
}

/**
 * Manage Customers Use Case
 *
 * Application layer use case responsible for full CRUD operations
 * on customer profiles. Provides reactive state via signals.
 *
 * Operations:
 * - loadCustomers: Fetch all active customers from repository
 * - createCustomer: Add a new customer
 * - updateCustomer: Modify an existing customer
 * - deleteCustomer: Remove a customer
 * - searchCustomers: Search by name, email, or phone
 *
 * @example
 * ```typescript
 * const useCase = inject(ManageCustomersUseCase);
 * await useCase.loadCustomers();
 * const customers = useCase.customers();
 * ```
 */
@Injectable({
  providedIn: 'root',
})
export class ManageCustomersUseCase {
  private readonly customerRepository: ICustomerRepository =
    inject<ICustomerRepository>(CUSTOMER_REPOSITORY);

  /** Loading state signal */
  private readonly _loading = signal<boolean>(false);

  /** Error state signal */
  private readonly _error = signal<string | null>(null);

  /** Customers state signal */
  private readonly _customers = signal<CustomerSummaryDTO[]>([]);

  /** Selected customer signal */
  private readonly _selectedCustomer = signal<CustomerSummaryDTO | null>(null);

  /** Public readonly signals */
  readonly loading = computed(() => this._loading());
  readonly error = computed(() => this._error());
  readonly customers = computed(() => this._customers());
  readonly selectedCustomer = computed(() => this._selectedCustomer());

  /**
   * Loads all customers from the repository
   */
  async loadCustomers(): Promise<CustomerSummaryDTO[]> {
    this._loading.set(true);
    this._error.set(null);

    try {
      const customers = await this.customerRepository.findAll();
      const summaries = customers.map((c) => this.mapToSummary(c));
      this._customers.set(summaries);

      this._loading.set(false);
      return summaries;
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : 'Failed to load customers';
      this._error.set(message);
      this._loading.set(false);
      return [];
    }
  }

  /**
   * Creates a new customer
   */
  async createCustomer(request: CreateCustomerRequest): Promise<CustomerSummaryDTO | null> {
    this._loading.set(true);
    this._error.set(null);

    try {
      // Validate email uniqueness
      const existingByEmail = await this.customerRepository.findByEmail(request.email);
      if (existingByEmail) {
        throw new DuplicateEntityException('Customer', 'email', request.email);
      }

      const id = generateUUID();
      const customer = new Customer({
        id,
        name: request.name,
        email: request.email,
        phone: request.phone,
        status: CustomerStatus.ACTIVE,
        loyaltyPoints: 0,
        address: request.address,
        city: request.city,
        state: request.state,
        zipCode: request.zipCode,
        country: request.country ?? 'US',
        notes: request.notes,
      });

      const created = await this.customerRepository.create(customer);
      const summary = this.mapToSummary(created);

      this._customers.update((current) => [...current, summary]);

      this._loading.set(false);
      return summary;
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : 'Failed to create customer';
      this._error.set(message);
      this._loading.set(false);
      return null;
    }
  }

  /**
   * Updates an existing customer
   */
  async updateCustomer(request: UpdateCustomerRequest): Promise<CustomerSummaryDTO | null> {
    this._loading.set(true);
    this._error.set(null);

    try {
      const existing = await this.customerRepository.findById(request.id);
      if (!existing) {
        throw new EntityNotFoundException('Customer', request.id);
      }

      // Check email uniqueness if email is being changed
      if (request.email && request.email !== existing.email) {
        const existingByEmail = await this.customerRepository.findByEmail(request.email);
        if (existingByEmail) {
          throw new DuplicateEntityException('Customer', 'email', request.email);
        }
      }

      // Apply updates using field mapping to reduce complexity
      this.applyUpdates(existing, request);

      existing.updatedAt = new Date();

      const updated = await this.customerRepository.update(request.id, existing);
      const summary = this.mapToSummary(updated);

      this._customers.update((current) => current.map((c) => (c.id === summary.id ? summary : c)));

      this._loading.set(false);
      return summary;
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : 'Failed to update customer';
      this._error.set(message);
      this._loading.set(false);
      return null;
    }
  }

  /**
   * Deletes a customer
   */
  async deleteCustomer(customerId: string): Promise<boolean> {
    this._loading.set(true);
    this._error.set(null);

    try {
      await this.customerRepository.delete(customerId);
      this._customers.update((current) => current.filter((c) => c.id !== customerId));

      // Clear selected if it was the deleted one
      if (this._selectedCustomer()?.id === customerId) {
        this._selectedCustomer.set(null);
      }

      this._loading.set(false);
      return true;
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : 'Failed to delete customer';
      this._error.set(message);
      this._loading.set(false);
      return false;
    }
  }

  /**
   * Searches customers by name, email, or phone
   */
  async searchCustomers(query: string): Promise<CustomerSummaryDTO[]> {
    this._loading.set(true);
    this._error.set(null);

    try {
      if (!query.trim()) {
        return this.loadCustomers();
      }

      const customers = await this.customerRepository.search(query);
      const summaries = customers.map((c) => this.mapToSummary(c));
      this._customers.set(summaries);

      this._loading.set(false);
      return summaries;
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : 'Failed to search customers';
      this._error.set(message);
      this._loading.set(false);
      return [];
    }
  }

  /**
   * Gets full customer details by ID (includes address, notes, etc.)
   */
  async getCustomerById(customerId: string): Promise<Customer | null> {
    try {
      return await this.customerRepository.findById(customerId);
    } catch {
      return null;
    }
  }

  /**
   * Selects a customer for detail view
   */
  selectCustomer(customer: CustomerSummaryDTO | null): void {
    this._selectedCustomer.set(customer);
  }

  /**
   * Applies partial updates from the request to the existing customer entity
   */
  private applyUpdates(existing: Customer, request: UpdateCustomerRequest): void {
    const updatableFields: (keyof UpdateCustomerRequest)[] = [
      'name',
      'email',
      'phone',
      'address',
      'city',
      'state',
      'zipCode',
      'country',
      'notes',
    ];
    for (const field of updatableFields) {
      if (request[field] !== undefined) {
        (existing as unknown as Record<string, unknown>)[field] = request[field];
      }
    }
  }

  /**
   * Maps a Customer entity to a CustomerSummaryDTO
   */
  private mapToSummary(customer: Customer): CustomerSummaryDTO {
    return {
      id: customer.id,
      name: customer.name,
      email: customer.email,
      phone: customer.phone,
      status: customer.status,
      loyaltyPoints: customer.loyaltyPoints,
      tier: customer.tier,
      totalPurchases: 0,
      createdAt: customer.createdAt,
    };
  }
}
