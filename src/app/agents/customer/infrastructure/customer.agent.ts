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

  protected onInitialize(): Promise<void> {
    console.log('Initializing CustomerAgent');
    return Promise.resolve();
  }

  protected onStart(): Promise<void> {
    console.log('Starting CustomerAgent');
    return Promise.resolve();
  }

  protected onStop(): Promise<void> {
    console.log('Stopping CustomerAgent');
    this.customerEventsSubject.complete();
    return Promise.resolve();
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

  createCustomer(_request: CreateCustomerRequest): Promise<CreateCustomerResponse> {
    // Mock implementation
    return Promise.resolve({ success: true });
  }

  updateCustomer(_request: UpdateCustomerRequest): Promise<UpdateCustomerResponse> {
    return Promise.resolve({ success: true });
  }

  getCustomer(_customerId: string): Promise<Customer> {
    return Promise.reject(new Error('Not implemented'));
  }

  searchCustomers(_query: string): Promise<Customer[]> {
    return Promise.resolve([]);
  }

  getLoyaltyPoints(_customerId: string): Promise<number> {
    return Promise.resolve(0);
  }
}

// Made with Bob
