import { Injectable } from '@angular/core';
import { Subject, Observable } from 'rxjs';
import { BaseAgent } from '@app/agents/base/base-agent';
import { IAgentMessage, IAgentResponse } from '@app/agents/base/base-agent.interface';
import {
  IIntegrationAgent,
  SyncDataRequest,
  SyncDataResponse,
  WebhookRequest,
  WebhookResponse,
  IntegrationStatus,
  IntegrationEvent,
} from '@app/agents/integration/domain/integration-agent.interface';

@Injectable({
  providedIn: 'root',
})
export class IntegrationAgent extends BaseAgent implements IIntegrationAgent {
  private readonly integrationEventsSubject = new Subject<IntegrationEvent>();
  public readonly integrationEvents$: Observable<IntegrationEvent> =
    this.integrationEventsSubject.asObservable();

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

  protected async handleMessage(message: IAgentMessage): Promise<IAgentResponse> {
    switch (message.type) {
      case 'SYNC_DATA':
        return { success: true, data: await this.syncData(message.payload as SyncDataRequest) };
      case 'SEND_WEBHOOK':
        return { success: true, data: await this.sendWebhook(message.payload as WebhookRequest) };
      case 'GET_INTEGRATION_STATUS':
        return {
          success: true,
          data: await this.getIntegrationStatus(
            (message.payload as { integrationId: string }).integrationId,
          ),
        };
      default:
        throw new Error(`Unknown message type: ${message.type}`);
    }
  }

  async syncData(_request: SyncDataRequest): Promise<SyncDataResponse> {
    return { success: true, recordsProcessed: 0 };
  }

  async sendWebhook(_request: WebhookRequest): Promise<WebhookResponse> {
    return { success: true, statusCode: 200 };
  }

  async getIntegrationStatus(integrationId: string): Promise<IntegrationStatus> {
    return { integrationId, connected: true };
  }
}

// Made with Bob
