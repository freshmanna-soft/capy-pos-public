import { Provider } from '@angular/core';
import { AUTH_GATEWAY } from '@core/application/auth/ports/auth-gateway.port';
import { OPERATOR_ADMIN_PORT } from '@core/application/auth/ports/operator-admin.port';
import { ROLE_ADMIN_PORT } from '@core/application/auth/ports/role-admin.port';
import { LocalCredentialAuthAdapter } from './local-credential-auth.adapter';
import { DexieOperatorAdminAdapter } from './dexie-operator-admin.adapter';
import { DexieRoleAdminAdapter } from './dexie-role-admin.adapter';

/**
 * AUTH_PROVIDERS
 *
 * Binds the auth ports to their local Dexie-backed adapters:
 *   - AuthGateway        → LocalCredentialAuthAdapter (login/session)
 *   - OperatorAdminPort  → DexieOperatorAdminAdapter (admin user management)
 *   - RoleAdminPort      → DexieRoleAdminAdapter (data-driven role authoring)
 *
 * Swap this array in app.config.ts when the Cognito/admin-API adapters land
 * (Story #42/#43).
 */
export const AUTH_PROVIDERS: Provider[] = [
  LocalCredentialAuthAdapter,
  {
    provide: AUTH_GATEWAY,
    useExisting: LocalCredentialAuthAdapter,
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
