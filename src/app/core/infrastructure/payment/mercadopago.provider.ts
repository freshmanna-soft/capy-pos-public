import { Provider } from '@angular/core';
import { MERCADOPAGO_PAYMENT_PORT } from '@core/application/ports/mercadopago.port';
import { MercadoPagoAdapter } from '@core/infrastructure/payment/mercadopago.adapter';

/**
 * Provider for the MercadoPago payment port.
 *
 * The real adapter is always registered. Runtime gating is handled by
 * `MercadoPagoAdapter.isEnabled()`, which reads `environment.mercadopago.enabled`.
 * This keeps the adapter unit-testable without requiring the feature flag to be
 * enabled in test environments.
 */
export const MERCADOPAGO_PROVIDER: Provider = {
  provide: MERCADOPAGO_PAYMENT_PORT,
  useClass: MercadoPagoAdapter,
};
