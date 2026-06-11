import { Injectable, inject, Signal } from '@angular/core';
import {
  ManageCustomersUseCase,
  CustomerSummaryDTO,
  CreateCustomerRequest,
  UpdateCustomerRequest,
} from '@core/application/use-cases/manage-customers.use-case';
import { Customer } from '@core/domain/entities/customer.entity';

/**
 * CustomerFacade - Single point of access for Customer Management operations.
 *
 * Orchestrates ManageCustomersUseCase behind a simplified API
 * for the CustomersComponent.
 *
 * Does NOT contain business logic — delegates to use-cases.
 */
@Injectable({ providedIn: 'root' })
export class CustomerFacade {
  private readonly customersUseCase = inject(ManageCustomersUseCase);

  // ─── State (read-only signals) ────────────────────────────────────────

  /** All customers */
  readonly customers: Signal<CustomerSummaryDTO[]> = this.customersUseCase.customers;

  /** Loading state */
  readonly loading: Signal<boolean> = this.customersUseCase.loading;

  /** Error state */
  readonly error: Signal<string | null> = this.customersUseCase.error;

  // ─── Customer CRUD Operations ─────────────────────────────────────────

  /** Load all customers */
  async loadCustomers(): Promise<void> {
    await this.customersUseCase.loadCustomers();
  }

  /** Create a new customer */
  async createCustomer(request: CreateCustomerRequest): Promise<CustomerSummaryDTO | null> {
    return await this.customersUseCase.createCustomer(request);
  }

  /** Update an existing customer */
  async updateCustomer(request: UpdateCustomerRequest): Promise<CustomerSummaryDTO | null> {
    return await this.customersUseCase.updateCustomer(request);
  }

  /** Delete a customer by ID */
  async deleteCustomer(id: string): Promise<boolean> {
    return await this.customersUseCase.deleteCustomer(id);
  }

  /** Search customers by query */
  async searchCustomers(query: string): Promise<void> {
    await this.customersUseCase.searchCustomers(query);
  }

  /** Get a customer by ID */
  async getCustomerById(id: string): Promise<Customer | null> {
    return await this.customersUseCase.getCustomerById(id);
  }
}
