import { InjectionToken, Provider, inject } from '@angular/core';
import { IPaymentAgent } from '@app/agents/payment/domain/payment-agent.interface';
import { PaymentAgent } from '@app/agents/payment/infrastructure/payment.agent';

/**
 * Injection token for PaymentAgent
 * Allows dependency injection of the payment agent interface
 */
export const PAYMENT_AGENT = new InjectionToken<IPaymentAgent>('PAYMENT_AGENT');

/**
 * Factory function to create PaymentAgent instance
 */
export function paymentAgentFactory(): IPaymentAgent {
  return inject(PaymentAgent);
}

/**
 * PaymentAgent Provider
 * Use this in app.config.ts or module providers
 *
 * @example
 * ```typescript
 * export const appConfig: ApplicationConfig = {
 *   providers: [
 *     PAYMENT_AGENT_PROVIDER
 *   ]
 * };
 * ```
 */
export const PAYMENT_AGENT_PROVIDER: Provider = {
  provide: PAYMENT_AGENT,
  useFactory: paymentAgentFactory,
};

// Made with Bob
