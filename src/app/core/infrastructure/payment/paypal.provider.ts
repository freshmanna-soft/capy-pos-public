import { Provider } from '@angular/core';
import { PAYPAL_PAYMENT_PORT } from '@core/application/ports/paypal.port';
import { PayPalAdapter } from '@core/infrastructure/payment/paypal.adapter';
import { environment } from '../../../../environments/environment';

/**
 * Provider for the PayPal payment port.
 *
 * When the feature flag is disabled a no-op stub is registered so the
 * injection token resolves everywhere without throwing — the checkout
 * component checks `isEnabled()` before showing the button.
 */
export const PAYPAL_PROVIDER: Provider = environment.paypal.enabled
  ? { provide: PAYPAL_PAYMENT_PORT, useClass: PayPalAdapter }
  : {
      provide: PAYPAL_PAYMENT_PORT,
      useValue: {
        isEnabled: () => false,
        loadSdk: () => Promise.resolve(),
        createAndRender: () => Promise.reject(new Error('PayPal is disabled')),
        destroy: () => undefined,
      },
    };
