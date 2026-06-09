import { IBaseRepository } from '@core/domain/interfaces/base.repository.interface';
import { Customer, CustomerStatus, CustomerTier } from '@core/domain/entities/customer.entity';

/**
 * Customer Repository Interface
 * Extends base repository with customer-specific operations
 */
export interface ICustomerRepository extends IBaseRepository<Customer> {
  /**
   * Find customers by status
   * @param status - Customer status to filter by
   * @returns Promise resolving to array of customers
   */
  findByStatus(status: CustomerStatus): Promise<Customer[]>;

  /**
   * Find customers by tier
   * @param tier - Customer tier to filter by
   * @returns Promise resolving to array of customers
   */
  findByTier(tier: CustomerTier): Promise<Customer[]>;

  /**
   * Find customer by email
   * @param email - Customer email
   * @returns Promise resolving to customer or null
   */
  findByEmail(email: string): Promise<Customer | null>;

  /**
   * Find customer by phone
   * @param phone - Customer phone number
   * @returns Promise resolving to customer or null
   */
  findByPhone(phone: string): Promise<Customer | null>;

  /**
   * Search customers by name, email, or phone
   * @param query - Search query
   * @param limit - Maximum number of results (default: 50)
   * @returns Promise resolving to array of customers
   */
  search(query: string, limit?: number): Promise<Customer[]>;

  /**
   * Find VIP customers
   * @returns Promise resolving to array of VIP customers
   */
  findVIPCustomers(): Promise<Customer[]>;

  /**
   * Find customers with loyalty points above threshold
   * @param minPoints - Minimum loyalty points
   * @returns Promise resolving to array of customers
   */
  findByMinLoyaltyPoints(minPoints: number): Promise<Customer[]>;

  /**
   * Get top customers by loyalty points
   * @param limit - Number of top customers to return (default: 10)
   * @returns Promise resolving to array of top customers
   */
  getTopCustomers(limit?: number): Promise<Customer[]>;

  /**
   * Update customer loyalty points
   * @param customerId - Customer ID
   * @param points - Points to add (positive) or subtract (negative)
   * @returns Promise resolving to updated customer
   */
  updateLoyaltyPoints(customerId: string, points: number): Promise<Customer>;

  /**
   * Update customer status
   * @param customerId - Customer ID
   * @param status - New status
   * @returns Promise resolving to updated customer
   */
  updateStatus(customerId: string, status: CustomerStatus): Promise<Customer>;
}

// Made with Bob
