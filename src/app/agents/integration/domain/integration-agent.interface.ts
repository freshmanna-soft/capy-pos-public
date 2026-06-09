import { Observable } from 'rxjs';
import { IBaseAgent } from '@app/agents/base/base-agent.interface';

/**
 * Integration Agent Interface
 * Handles external system integrations and API communications
 */
export interface IIntegrationAgent extends IBaseAgent {
  syncData(request: SyncDataRequest): Promise<SyncDataResponse>;
  sendWebhook(request: WebhookRequest): Promise<WebhookResponse>;
  getIntegrationStatus(integrationId: string): Promise<IntegrationStatus>;
  integrationEvents$: Observable<IntegrationEvent>;
}

export interface SyncDataRequest {
  integrationId: string;
  dataType: 'products' | 'customers' | 'transactions';
  direction: 'import' | 'export';
}

export interface SyncDataResponse {
  success: boolean;
  recordsProcessed: number;
  errors?: string[];
}

export interface WebhookRequest {
  url: string;
  event: string;
  payload: unknown;
}

export interface WebhookResponse {
  success: boolean;
  statusCode?: number;
  error?: string;
}

export interface IntegrationStatus {
  integrationId: string;
  connected: boolean;
  lastSync?: Date;
  errors?: string[];
}

export interface IntegrationEvent {
  type: 'sync_started' | 'sync_completed' | 'webhook_sent' | 'connection_error';
  timestamp: Date;
  integrationId: string;
  data?: unknown;
}

// Made with Bob
