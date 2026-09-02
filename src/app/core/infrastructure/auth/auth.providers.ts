import { Provider } from '@angular/core';
import { environment } from '../../../../environments/environment';
import { AUTH_GATEWAY } from '@core/application/auth/ports/auth-gateway.port';
import { OPERATOR_ADMIN_PORT } from '@core/application/auth/ports/operator-admin.port';
import { ROLE_ADMIN_PORT } from '@core/application/auth/ports/role-admin.port';
import { QUICK_AUTH_GATEWAY } from '@core/application/auth/ports/quick-auth.port';
import { QUICK_AUTH_ADMIN_PORT } from '@core/application/auth/ports/quick-auth-admin.port';
import { LocalCredentialAuthAdapter } from './local-credential-auth.adapter';
import { CognitoAuthAdapter } from './cognito-auth.adapter';
import { AppIdAuthAdapter } from './appid-auth.adapter';
import { DexieOperatorAdminAdapter } from './dexie-operator-admin.adapter';
import { DexieRoleAdminAdapter } from './dexie-role-admin.adapter';
import { WebAuthnAuthAdapter } from './webauthn/webauthn-auth.adapter';

/**
 * The AuthGateway swap seam (Story #140; IBM App ID added 2026-09-01).
 *
 * The gateway is chosen from config at composition time: flip
 * `environment.appId.enabled` or `environment.cognito.enabled` to route logins
 * through IBM App ID or Cognito instead of the local credential adapter. All
 * three adapters are registered so the choice is a single flag — no code
 * change — but only the selected one is ever instantiated (`useExisting`
 * resolves lazily). App ID takes priority if both happen to be enabled at
 * once, since it's the one actually being stood up for this pilot; that
 * combination isn't a real deployment target, just a defined order rather
 * than an undefined one.
 */
const useAppIdGateway = environment.appId?.enabled === true;
const useCognitoGateway = environment.cognito?.enabled === true;

/**
 * AUTH_PROVIDERS
 *
 * Binds the auth ports to their adapters:
 *   - AuthGateway        → App ID (when enabled), else Cognito (when enabled),
 *                          else LocalCredentialAuthAdapter
 *   - QuickAuthGateway   → WebAuthnAuthAdapter (passkey + PIN sign-in)
 *   - QuickAuthAdminPort → WebAuthnAuthAdapter (enrollment + PIN management)
 *   - OperatorAdminPort  → DexieOperatorAdminAdapter (admin user management)
 *   - RoleAdminPort      → DexieRoleAdminAdapter (data-driven role authoring)
 *
 * Quick sign-in is deliberately NOT switched by the Cognito flag. It is a local
 * capability of this device — the credential lives in this machine's secure enclave
 * — and both of its ports are served by the one adapter, which implements them
 * together because enrolling and asserting share the same ceremony plumbing. When
 * verification moves server-side (see the TODO in that adapter) this binding is
 * where the swap happens.
 *
 * OperatorAdmin/RoleAdmin remain Dexie-backed until their Cognito/admin-API
 * counterparts land (Story #42/#43 follow-ups).
 */
export const AUTH_PROVIDERS: Provider[] = [
  LocalCredentialAuthAdapter,
  CognitoAuthAdapter,
  AppIdAuthAdapter,
  {
    provide: AUTH_GATEWAY,
    useExisting: useAppIdGateway
      ? AppIdAuthAdapter
      : useCognitoGateway
        ? CognitoAuthAdapter
        : LocalCredentialAuthAdapter,
  },
  WebAuthnAuthAdapter,
  {
    provide: QUICK_AUTH_GATEWAY,
    useExisting: WebAuthnAuthAdapter,
  },
  {
    provide: QUICK_AUTH_ADMIN_PORT,
    useExisting: WebAuthnAuthAdapter,
  },
  DexieOperatorAdminAdapter,
  {
    provide: OPERATOR_ADMIN_PORT,
    useExisting: DexieOperatorAdminAdapter,
  },
  DexieRoleAdminAdapter,
  {
    provide: ROLE_ADMIN_PORT,
    useExisting: DexieRoleAdminAdapter,
  },
];
