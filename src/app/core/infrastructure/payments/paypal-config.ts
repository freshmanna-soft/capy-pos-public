import { InjectionToken } from '@angular/core';
import { environment } from '../../../../environments/environment';

declare const PAYPAL_LOCAL_CLIENT_ID: string | undefined;

export interface PayPalBrowserConfig {
  readonly enabled: boolean;
  readonly clientId: string;
  readonly environment: 'sandbox' | 'production';
}

/** Public browser configuration only. A PayPal client secret must never be added here. */
export const PAYPAL_BROWSER_CONFIG = new InjectionToken<PayPalBrowserConfig>(
  'PAYPAL_BROWSER_CONFIG',
  {
    providedIn: 'root',
    factory: () => {
      const localClientId =
        typeof PAYPAL_LOCAL_CLIENT_ID === 'string' ? PAYPAL_LOCAL_CLIENT_ID.trim() : '';
      return localClientId.length > 0
        ? { enabled: true, clientId: localClientId, environment: 'sandbox' }
        : (environment.paypal as PayPalBrowserConfig);
    },
  }
);
