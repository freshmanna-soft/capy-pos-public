import { InjectionToken, Provider, inject } from '@angular/core';
import { IPaymentAgent } from '../domain/payment-agent.interface';
import { PaymentAgent } from './payment.agent';
import { PAYMENT_REPOSITORY } from '../../../core/infrastructure/factories/repository.factory';
import { AuditLogService } from '../../../core/infrastructure/audit';

/**
 * Injection token for PaymentAgent
 * Allows dependency injection of the payment agent interface
 */
export const PAYMENT_AGENT = new InjectionToken<IPaymentAgent>('PAYMENT_AGENT');

/**
 * Factory function to create PaymentAgent instance
 */
export function paymentAgentFactory(): IPaymentAgent {
  const paymentRepository = inject(PAYMENT_REPOSITORY);
  const auditLogService = inject(AuditLogService);
  return new PaymentAgent(paymentRepository, auditLogService);
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
  useFactory: paymentAgentFactory
};

// Made with Bob