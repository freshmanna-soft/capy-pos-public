import { Injectable } from '@angular/core';
import { Subject, Observable } from 'rxjs';
import { BaseAgent } from '../../base/base-agent';
import {
  ICustomerAgent,
  CreateCustomerRequest,
  CreateCustomerResponse,
  UpdateCustomerRequest,
  UpdateCustomerResponse,
  CustomerEvent
} from '../domain/customer-agent.interface';
import { Customer } from '../../../core/domain/entities/customer.entity';

@Injectable({
  providedIn: 'root'
})
export class CustomerAgent extends BaseAgent implements ICustomerAgent {
  private customerEventsSubject = new Subject<CustomerEvent>();
  public customerEvents$: Observable<CustomerEvent> = this.customerEventsSubject.asObservable();

  constructor() {
    super('customer-agent', 'CustomerAgent', 'Handles customer management and loyalty programs');
  }

  protected async onInitialize(): Promise<void> {
    console.log('Initializing CustomerAgent');
  }

  protected async onStart(): Promise<void> {
    console.log('Starting CustomerAgent');
  }

  protected async onStop(): Promise<void> {
    console.log('Stopping CustomerAgent');
    this.customerEventsSubject.complete();
  }

  protected async handleMessage(message: any): Promise<any> {
    switch (message.type) {
      case 'CREATE_CUSTOMER':
        return await this.createCustomer(message.payload);
      case 'UPDATE_CUSTOMER':
        return await this.updateCustomer(message.payload);
      case 'GET_CUSTOMER':
        return await this.getCustomer(message.payload.customerId);
      case 'SEARCH_CUSTOMERS':
        return await this.searchCustomers(message.payload.query);
      case 'GET_LOYALTY_POINTS':
        return await this.getLoyaltyPoints(message.payload.customerId);
      default:
        throw new Error(`Unknown message type: ${message.type}`);
    }
  }

  async createCustomer(request: CreateCustomerRequest): Promise<CreateCustomerResponse> {
    // Mock implementation
    return { success: true };
  }

  async updateCustomer(request: UpdateCustomerRequest): Promise<UpdateCustomerResponse> {
    return { success: true };
  }

  async getCustomer(customerId: string): Promise<Customer> {
    throw new Error('Not implemented');
  }

  async searchCustomers(query: string): Promise<Customer[]> {
    return [];
  }

  async getLoyaltyPoints(customerId: string): Promise<number> {
    return 0;
  }
}

// Made with Bob