import { Customer, CustomerStatus, CustomerTier } from '../../domain/entities/customer.entity';
import { IBaseApplicationService } from './base-application.service.interface';

/**
 * Customer Service Interface
 * Extends IBaseApplicationService with customer-specific operations
 * Defines contract for customer-related operations
 * Follows Interface Segregation Principle (SOLID)
 */
export interface ICustomerService extends IBaseApplicationService<Customer> {

  // Customer-specific operations
  getCustomersByStatus(status: CustomerStatus): Promise<Customer[]>;
  getCustomersByTier(tier: CustomerTier): Promise<Customer[]>;
  getCustomerByEmail(email: string): Promise<Customer | null>;
  getCustomerByPhone(phone: string): Promise<Customer | null>;
  searchCustomers(query: string, limit?: number): Promise<Customer[]>;
  getVIPCustomers(): Promise<Customer[]>;
  getCustomersByMinPoints(minPoints: number): Promise<Customer[]>;
  getTopCustomers(limit?: number): Promise<Customer[]>;
  
  // Loyalty operations
  updateLoyaltyPoints(customerId: string, points: number): Promise<Customer>;
  addLoyaltyPoints(customerId: string, points: number): Promise<Customer>;
  redeemLoyaltyPoints(customerId: string, points: number): Promise<Customer>;
  
  // Status operations
  updateCustomerStatus(customerId: string, status: CustomerStatus): Promise<Customer>;
  activateCustomer(customerId: string): Promise<Customer>;
  deactivateCustomer(customerId: string): Promise<Customer>;
  blockCustomer(customerId: string): Promise<Customer>;
  promoteToVIP(customerId: string): Promise<Customer>;
}

// Made with Bob