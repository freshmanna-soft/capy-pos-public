import { Injectable } from '@angular/core';
import { Subject, Observable } from 'rxjs';
import { BaseAgent } from '../../base/base-agent';
import {
  IIntegrationAgent,
  SyncDataRequest,
  SyncDataResponse,
  WebhookRequest,
  WebhookResponse,
  IntegrationStatus,
  IntegrationEvent
} from '../domain/integration-agent.interface';

@Injectable({
  providedIn: 'root'
})
export class IntegrationAgent extends BaseAgent implements IIntegrationAgent {
  private integrationEventsSubject = new Subject<IntegrationEvent>();
  public integrationEvents$: Observable<IntegrationEvent> = this.integrationEventsSubject.asObservable();

  constructor() {
    super('integration-agent', 'IntegrationAgent', 'Handles external system integrations');
  }

  protected async onInitialize(): Promise<void> {
    console.log('Initializing IntegrationAgent');
  }

  protected async onStart(): Promise<void> {
    console.log('Starting IntegrationAgent');
  }

  protected async onStop(): Promise<void> {
    console.log('Stopping IntegrationAgent');
    this.integrationEventsSubject.complete();
  }

  protected async handleMessage(message: any): Promise<any> {
    switch (message.type) {
      case 'SYNC_DATA':
        return await this.syncData(message.payload);
      case 'SEND_WEBHOOK':
        return await this.sendWebhook(message.payload);
      case 'GET_INTEGRATION_STATUS':
        return await this.getIntegrationStatus(message.payload.integrationId);
      default:
        throw new Error(`Unknown message type: ${message.type}`);
    }
  }

  async syncData(request: SyncDataRequest): Promise<SyncDataResponse> {
    return { success: true, recordsProcessed: 0 };
  }

  async sendWebhook(request: WebhookRequest): Promise<WebhookResponse> {
    return { success: true, statusCode: 200 };
  }

  async getIntegrationStatus(integrationId: string): Promise<IntegrationStatus> {
    return { integrationId, connected: true };
  }
}

// Made with Bob