import { InjectionToken, Provider } from '@angular/core';
import { IBaseAgent } from './base-agent.interface';

/**
 * Generic Agent Provider Factory
 * Creates injection tokens and providers for agents to reduce code duplication
 * 
 * @example
 * ```typescript
 * // Create provider for InventoryAgent
 * export const {
 *   token: INVENTORY_AGENT,
 *   provider: INVENTORY_AGENT_PROVIDER
 * } = createAgentProvider('INVENTORY_AGENT', InventoryAgent);
 * ```
 */
export function createAgentProvider<T extends IBaseAgent>(
  tokenName: string,
  agentClass: new () => T
): {
  token: InjectionToken<T>;
  provider: Provider;
} {
  const token = new InjectionToken<T>(tokenName);
  
  const provider: Provider = {
    provide: token,
    useFactory: () => new agentClass()
  };

  return { token, provider };
}

/**
 * Create multiple agent providers at once
 * Useful for creating all agent providers in one call
 * 
 * @example
 * ```typescript
 * export const AGENT_PROVIDERS = createAgentProviders([
 *   { name: 'INVENTORY_AGENT', class: InventoryAgent },
 *   { name: 'SALES_AGENT', class: SalesAgent },
 *   { name: 'PAYMENT_AGENT', class: PaymentAgent }
 * ]);
 * ```
 */
export function createAgentProviders<T extends IBaseAgent>(
  configs: Array<{ name: string; class: new () => T }>
): Array<{ token: InjectionToken<T>; provider: Provider }> {
  return configs.map(config => createAgentProvider(config.name, config.class));
}

// Made with Bob