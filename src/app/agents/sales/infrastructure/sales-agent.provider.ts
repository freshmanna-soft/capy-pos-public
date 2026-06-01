/**
 * Sales Agent Provider Configuration
 * Sets up dependency injection for SalesAgent
 */

import { Provider, InjectionToken } from '@angular/core';
import { SalesAgent } from './sales.agent';
import { ISalesAgent } from '../domain/sales-agent.interface';

/**
 * Injection token for ISalesAgent
 */
export const SALES_AGENT = new InjectionToken<ISalesAgent>('ISalesAgent');

/**
 * Sales Agent Providers
 * Configures Angular DI for SalesAgent
 */
export const SALES_AGENT_PROVIDERS: Provider[] = [
  {
    provide: SALES_AGENT,
    useClass: SalesAgent,
  },
  {
    provide: 'ISalesAgent',
    useExisting: SALES_AGENT,
  },
];

// Made with Bob