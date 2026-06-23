import { Provider } from '@angular/core';
import { AUTH_GATEWAY } from '@core/application/auth/ports/auth-gateway.port';
import { LocalCredentialAuthAdapter } from './local-credential-auth.adapter';

/**
 * AUTH_PROVIDERS
 *
 * Binds the AuthGateway token to the local Dexie-backed credential adapter.
 * Swap this array in app.config.ts when the Cognito adapter lands (Story #42/#43).
 */
export const AUTH_PROVIDERS: Provider[] = [
  LocalCredentialAuthAdapter,
  {
    provide: AUTH_GATEWAY,
    useExisting: LocalCredentialAuthAdapter,
  },
];
