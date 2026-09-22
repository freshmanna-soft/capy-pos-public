import { Provider } from '@angular/core';
import { MERCADOPAGO_PAYMENT_PORT } from '@core/application/ports/mercadopago.port';
import { MercadoPagoAdapter } from '@core/infrastructure/payment/mercadopago.adapter';
import { environment } from '../../../../environments/environment';

/**
 * Provider for the MercadoPago payment port.
 *
 * When the feature flag is disabled a no-op stub is registered so the
 * injection token resolves everywhere without throwing — the checkout
 * component checks `isEnabled()` before showing the button.
 */
export const MERCADOPAGO_PROVIDER: Provider = environment.mercadopago.enabled
  ? { provide: MERCADOPAGO_PAYMENT_PORT, useClass: MercadoPagoAdapter }
  : {
      provide: MERCADOPAGO_PAYMENT_PORT,
      useValue: {
        isEnabled: () => false,
        loadSdk: () => Promise.resolve(),
        createAndRender: () => Promise.reject(new Error('MercadoPago is disabled')),
        destroy: () => undefined,
      },
    };
