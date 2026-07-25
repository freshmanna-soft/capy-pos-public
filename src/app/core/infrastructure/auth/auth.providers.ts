import { Provider } from '@angular/core';
import { environment } from '../../../../environments/environment';
import { AUTH_GATEWAY } from '@core/application/auth/ports/auth-gateway.port';
import { OPERATOR_ADMIN_PORT } from '@core/application/auth/ports/operator-admin.port';
import { ROLE_ADMIN_PORT } from '@core/application/auth/ports/role-admin.port';
import { LocalCredentialAuthAdapter } from './local-credential-auth.adapter';
import { CognitoAuthAdapter } from './cognito-auth.adapter';
import { DexieOperatorAdminAdapter } from './dexie-operator-admin.adapter';
import { DexieRoleAdminAdapter } from './dexie-role-admin.adapter';

/**
 * The AuthGateway swap seam (Story #140).
 *
 * The gateway is chosen from config at composition time: flip
 * `environment.cognito.enabled` to route logins through Cognito instead of the
 * local credential adapter. Both adapters are registered so the choice is a
 * single flag — no code change — but only the selected one is ever instantiated
 * (`useExisting` resolves lazily).
 */
const useCognitoGateway = environment.cognito?.enabled === true;

/**
 * AUTH_PROVIDERS
 *
 * Binds the auth ports to their adapters:
 *   - AuthGateway        → Cognito (when enabled) or LocalCredentialAuthAdapter
 *   - OperatorAdminPort  → DexieOperatorAdminAdapter (admin user management)
 *   - RoleAdminPort      → DexieRoleAdminAdapter (data-driven role authoring)
 *
 * OperatorAdmin/RoleAdmin remain Dexie-backed until their Cognito/admin-API
 * counterparts land (Story #42/#43 follow-ups).
 */
export const AUTH_PROVIDERS: Provider[] = [
  LocalCredentialAuthAdapter,
  CognitoAuthAdapter,
  {
    provide: AUTH_GATEWAY,
    useExisting: useCognitoGateway ? CognitoAuthAdapter : LocalCredentialAuthAdapter,
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
