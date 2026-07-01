import { Injectable, inject } from '@angular/core';
import { DexieDatabase } from '@core/infrastructure/database/dexie-database.service';
import { OperatorAdminPort } from '@core/application/auth/ports/operator-admin.port';
import { OperatorSummaryDto } from '@core/application/auth/dtos/operator-summary.dto';
import { Role, RoleName } from '@core/domain/auth/role.value-object';

/**
 * DexieOperatorAdminAdapter
 *
 * Local (offline-first) implementation of {@link OperatorAdminPort} backed by
 * the Dexie/IndexedDB tables. Reads the authoritative role-per-tenant from the
 * `userTenants` join table — never the legacy `operators.roleId` column, which
 * is kept only for v3 back-compat (see IOperatorDB docs).
 *
 * Read-only: this adapter performs no writes, so it cannot collide with the
 * in-flight multi-tenant membership work (#43); if that work re-indexes
 * `userTenants`, only the query below needs revisiting.
 */
@Injectable()
export class DexieOperatorAdminAdapter implements OperatorAdminPort {
  private readonly db = inject(DexieDatabase);

  async listOperatorsForTenant(tenantId: string): Promise<OperatorSummaryDto[]> {
    // Tenant isolation is structural: we only ever read membership rows for the
    // requested tenant, so operators from other tenants can never leak in.
    const memberships = await this.db.userTenants.where('tenantId').equals(tenantId).toArray();

    const summaries = await Promise.all(
      memberships.map(async (membership): Promise<OperatorSummaryDto | null> => {
        const operator = await this.db.operators.get(membership.userId);
        if (!operator) {
          console.warn(
            `[DexieOperatorAdminAdapter] Skipping membership '${membership.id}': ` +
              `operator '${membership.userId}' not found.`
          );
          return null;
        }

        const roleRecord = await this.db.roles.get(membership.roleId);
        const rawRoleName = roleRecord?.name ?? membership.roleId;

        let roleName: RoleName;
        try {
          // Validate against the domain — throws for a role the domain does not know.
          // fromName only resolves built-ins, so the name is a RoleName by construction.
          roleName = Role.fromName(rawRoleName).name as RoleName;
        } catch {
          console.warn(
            `[DexieOperatorAdminAdapter] Skipping operator '${operator.id}' in tenant ` +
              `'${tenantId}': role '${rawRoleName}' is not a known domain Role.`
          );
          return null;
        }

        return {
          id: operator.id,
          email: operator.email,
          displayName: operator.displayName,
          roleName,
          isActive: operator.isActive,
          tenantId,
        } satisfies OperatorSummaryDto;
      })
    );

    return summaries
      .filter((summary): summary is OperatorSummaryDto => summary !== null)
      .sort((a, b) => a.displayName.localeCompare(b.displayName));
  }
}
