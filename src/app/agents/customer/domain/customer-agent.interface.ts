import { Observable } from 'rxjs';
import { IBaseAgent } from '../../base/base-agent.interface';
import { Customer } from '../../../core/domain/entities/customer.entity';

/**
 * Customer Agent Interface
 * Handles customer management, loyalty programs, and customer insights
 */
export interface ICustomerAgent extends IBaseAgent {
  createCustomer(request: CreateCustomerRequest): Promise<CreateCustomerResponse>;
  updateCustomer(request: UpdateCustomerRequest): Promise<UpdateCustomerResponse>;
  getCustomer(customerId: string): Promise<Customer>;
  searchCustomers(query: string): Promise<Customer[]>;
  getLoyaltyPoints(customerId: string): Promise<number>;
  customerEvents$: Observable<CustomerEvent>;
}

export interface CreateCustomerRequest {
  name: string;
  email: string;
  phone?: string;
}

export interface CreateCustomerResponse {
  success: boolean;
  customer?: Customer;
  error?: string;
}

export interface UpdateCustomerRequest {
  customerId: string;
  updates: Partial<Customer>;
}

export interface UpdateCustomerResponse {
  success: boolean;
  customer?: Customer;
  error?: string;
}

export interface CustomerEvent {
  type: 'customer_created' | 'customer_updated' | 'loyalty_earned';
  timestamp: Date;
  customerId: string;
  data?: any;
}

// Made with Bob