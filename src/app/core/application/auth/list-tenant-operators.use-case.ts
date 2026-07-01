import { Injectable, inject } from '@angular/core';
import { OPERATOR_ADMIN_PORT } from './ports/operator-admin.port';
import { OperatorSummaryDto } from './dtos/operator-summary.dto';
import { CurrentUserService } from './current-user.service';
import { AngularAuthorizationService } from './angular-authorization.service';
import { Permission } from '@core/domain/auth/permission.constants';

/**
 * ListTenantOperatorsUseCase (Application layer)
 *
 * Returns the operators of the **active** tenant for the admin user-management
 * screen. Enforces the authorization boundary at the application layer:
 * `MANAGE_OPERATORS` is asserted before any data is read, so the check cannot
 * be bypassed by calling the use-case directly (the `*appHasPermission`
 * directive only hides UI — it is not a security control).
 *
 * Reads the active tenant from {@link CurrentUserService} so the result always
 * reflects the tenant the operator is currently working in (and switches with
 * it). Returns an empty list when no tenant is active.
 */
@Injectable({ providedIn: 'root' })
export class ListTenantOperatorsUseCase {
  private readonly port = inject(OPERATOR_ADMIN_PORT);
  private readonly currentUser = inject(CurrentUserService);
  private readonly authz = inject(AngularAuthorizationService);

  /**
   * @throws AuthorizationError when the current user lacks `MANAGE_OPERATORS`.
   */
  async execute(): Promise<OperatorSummaryDto[]> {
    this.authz.assert(Permission.MANAGE_OPERATORS);

    const tenantId = this.currentUser.activeTenantId();
    if (!tenantId) {
      return [];
    }

    return this.port.listOperatorsForTenant(tenantId);
  }
}
