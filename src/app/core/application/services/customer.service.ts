import { Injectable, inject } from '@angular/core';
import { ICustomerRepository } from '@core/domain/interfaces/customer.repository.interface';
import { CUSTOMER_REPOSITORY } from '@core/infrastructure/factories/repository.factory';
import { Customer, CustomerStatus, CustomerTier } from '@core/domain/entities/customer.entity';
import { BaseApplicationService } from '@core/application/services/base-application.service';
import { ICustomerService } from '@core/application/services/customer.service.interface';

/**
 * Customer Application Service
 * Implements ICustomerService interface
 * Extends BaseApplicationService with customer-specific operations
 * Orchestrates customer-related use cases
 * Uses repository through dependency injection
 *
 * @example
 * ```typescript
 * constructor(private customerService: CustomerService) {}
 *
 * async loadCustomers() {
 *   const customers = await this.customerService.getAll();
 * }
 * ```
 */
@Injectable({
  providedIn: 'root',
})
export class CustomerService
  extends BaseApplicationService<Customer, ICustomerRepository>
  implements ICustomerService
{
  constructor() {
    const customerRepository = inject<ICustomerRepository>(CUSTOMER_REPOSITORY);

    super(customerRepository);
  }

  /**
   * Get customers by status
   */
  async getCustomersByStatus(status: CustomerStatus): Promise<Customer[]> {
    return this.repository.findByStatus(status);
  }

  /**
   * Get customers by tier
   */
  async getCustomersByTier(tier: CustomerTier): Promise<Customer[]> {
    return this.repository.findByTier(tier);
  }

  /**
   * Get customer by email
   */
  async getCustomerByEmail(email: string): Promise<Customer | null> {
    return this.repository.findByEmail(email);
  }

  /**
   * Get customer by phone
   */
  async getCustomerByPhone(phone: string): Promise<Customer | null> {
    return this.repository.findByPhone(phone);
  }

  /**
   * Search customers
   */
  async searchCustomers(query: string, limit?: number): Promise<Customer[]> {
    return this.repository.search(query, limit);
  }

  /**
   * Get VIP customers
   */
  async getVIPCustomers(): Promise<Customer[]> {
    return this.repository.findVIPCustomers();
  }

  /**
   * Get customers with minimum loyalty points
   */
  async getCustomersByMinPoints(minPoints: number): Promise<Customer[]> {
    return this.repository.findByMinLoyaltyPoints(minPoints);
  }

  /**
   * Get top customers by loyalty points
   */
  async getTopCustomers(limit?: number): Promise<Customer[]> {
    return this.repository.getTopCustomers(limit);
  }

  /**
   * Update customer loyalty points
   */
  async updateLoyaltyPoints(customerId: string, points: number): Promise<Customer> {
    return this.repository.updateLoyaltyPoints(customerId, points);
  }

  /**
   * Add loyalty points to customer
   */
  async addLoyaltyPoints(customerId: string, points: number): Promise<Customer> {
    if (points <= 0) {
      throw new Error('Points must be positive');
    }
    return this.repository.updateLoyaltyPoints(customerId, points);
  }

  /**
   * Redeem loyalty points from customer
   */
  async redeemLoyaltyPoints(customerId: string, points: number): Promise<Customer> {
    if (points <= 0) {
      throw new Error('Points must be positive');
    }
    return this.repository.updateLoyaltyPoints(customerId, -points);
  }

  /**
   * Update customer status
   */
  async updateCustomerStatus(customerId: string, status: CustomerStatus): Promise<Customer> {
    return this.repository.updateStatus(customerId, status);
  }

  /**
   * Activate customer
   */
  async activateCustomer(customerId: string): Promise<Customer> {
    return this.updateCustomerStatus(customerId, CustomerStatus.ACTIVE);
  }

  /**
   * Deactivate customer
   */
  async deactivateCustomer(customerId: string): Promise<Customer> {
    return this.updateCustomerStatus(customerId, CustomerStatus.INACTIVE);
  }

  /**
   * Block customer
   */
  async blockCustomer(customerId: string): Promise<Customer> {
    return this.updateCustomerStatus(customerId, CustomerStatus.BLOCKED);
  }

  /**
   * Promote customer to VIP
   */
  async promoteToVIP(customerId: string): Promise<Customer> {
    return this.updateCustomerStatus(customerId, CustomerStatus.VIP);
  }

  /**
   * Validate customer before operations
   * Override from base service
   */
  protected override validateEntity(customer: Customer): void {
    if (!customer.name || customer.name.trim() === '') {
      throw new Error('Customer name is required');
    }
    if (!customer.email || customer.email.trim() === '') {
      throw new Error('Customer email is required');
    }
    if (!customer.phone || customer.phone.trim() === '') {
      throw new Error('Customer phone is required');
    }
  }
}

// Made with Bob
