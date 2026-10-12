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

  protected onInitialize(): Promise<void> {
    console.log('Initializing IntegrationAgent');
    return Promise.resolve();
  }

  protected onStart(): Promise<void> {
    console.log('Starting IntegrationAgent');
    return Promise.resolve();
  }

  protected onStop(): Promise<void> {
    console.log('Stopping IntegrationAgent');
    this.integrationEventsSubject.complete();
    return Promise.resolve();
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
            (message.payload as { integrationId: string }).integrationId
          ),
        };
      default:
        throw new Error(`Unknown message type: ${message.type}`);
    }
  }

  syncData(_request: SyncDataRequest): Promise<SyncDataResponse> {
    return Promise.resolve({ success: true, recordsProcessed: 0 });
  }

  sendWebhook(_request: WebhookRequest): Promise<WebhookResponse> {
    return Promise.resolve({ success: true, statusCode: 200 });
  }

  getIntegrationStatus(integrationId: string): Promise<IntegrationStatus> {
    return Promise.resolve({ integrationId, connected: true });
  }
}

// Made with Bob
