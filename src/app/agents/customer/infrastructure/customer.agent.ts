import { Injectable } from '@angular/core';
import { Subject, Observable } from 'rxjs';
import { BaseAgent } from '@app/agents/base/base-agent';
import { IAgentMessage, IAgentResponse } from '@app/agents/base/base-agent.interface';
import {
  ICustomerAgent,
  CreateCustomerRequest,
  CreateCustomerResponse,
  UpdateCustomerRequest,
  UpdateCustomerResponse,
  CustomerEvent,
} from '@app/agents/customer/domain/customer-agent.interface';
import { Customer } from '@core/domain/entities/customer.entity';

@Injectable({
  providedIn: 'root',
})
export class CustomerAgent extends BaseAgent implements ICustomerAgent {
  private readonly customerEventsSubject = new Subject<CustomerEvent>();
  public readonly customerEvents$: Observable<CustomerEvent> =
    this.customerEventsSubject.asObservable();

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

  protected async handleMessage(message: IAgentMessage): Promise<IAgentResponse> {
    switch (message.type) {
      case 'CREATE_CUSTOMER':
        return {
          success: true,
          data: await this.createCustomer(message.payload as CreateCustomerRequest),
        };
      case 'UPDATE_CUSTOMER':
        return {
          success: true,
          data: await this.updateCustomer(message.payload as UpdateCustomerRequest),
        };
      case 'GET_CUSTOMER':
        return {
          success: true,
          data: await this.getCustomer((message.payload as { customerId: string }).customerId),
        };
      case 'SEARCH_CUSTOMERS':
        return {
          success: true,
          data: await this.searchCustomers((message.payload as { query: string }).query),
        };
      case 'GET_LOYALTY_POINTS':
        return {
          success: true,
          data: await this.getLoyaltyPoints((message.payload as { customerId: string }).customerId),
        };
      default:
        throw new Error(`Unknown message type: ${message.type}`);
    }
  }

  async createCustomer(_request: CreateCustomerRequest): Promise<CreateCustomerResponse> {
    // Mock implementation
    return { success: true };
  }

  async updateCustomer(_request: UpdateCustomerRequest): Promise<UpdateCustomerResponse> {
    return { success: true };
  }

  async getCustomer(_customerId: string): Promise<Customer> {
    throw new Error('Not implemented');
  }

  async searchCustomers(_query: string): Promise<Customer[]> {
    return [];
  }

  async getLoyaltyPoints(_customerId: string): Promise<number> {
    return 0;
  }
}

// Made with Bob
