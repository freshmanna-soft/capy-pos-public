import { Injectable, inject } from '@angular/core';
import {
  DexieDatabase,
  IUserTenantDB,
  userTenantId,
} from '@core/infrastructure/database/dexie-database.service';
import { OperatorAdminPort } from '@core/application/auth/ports/operator-admin.port';
import { OperatorSummaryDto } from '@core/application/auth/dtos/operator-summary.dto';

/**
 * DexieOperatorAdminAdapter
 *
 * Local (offline-first) implementation of {@link OperatorAdminPort} backed by
 * the Dexie/IndexedDB tables. The authoritative role-per-tenant is the
 * `userTenants` join table — never the legacy `operators.roleId` column.
 *
 * Data-driven: listings tolerate custom roles (the role name is read from the
 * `roles` record, not validated against the fixed domain roles), so a role an
 * admin authored shows up correctly.
 */
@Injectable()
export class DexieOperatorAdminAdapter implements OperatorAdminPort {
  private readonly db = inject(DexieDatabase);

  async listOperatorsForTenant(tenantId: string): Promise<OperatorSummaryDto[]> {
    // Tenant isolation is structural: we only read membership rows for the
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

        // Role name comes from the stored role record (built-in OR custom). Fall
        // back to the raw roleId if the role record is missing — never skip the
        // operator over it (they still hold a valid membership).
        const roleRecord = await this.db.roles.get(membership.roleId);
        const roleName = roleRecord?.name ?? membership.roleId;

        return {
          id: operator.id,
          email: operator.email,
          displayName: operator.displayName,
          roleId: membership.roleId,
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

  async assignRole(userId: string, tenantId: string, roleId: string): Promise<void> {
    const [operator, role] = await Promise.all([
      this.db.operators.get(userId),
      this.db.roles.get(roleId),
    ]);
    if (!operator) throw new Error(`Operator '${userId}' not found`);
    if (!role) throw new Error(`Role '${roleId}' not found`);

    const id = userTenantId(userId, tenantId);
    const existing = await this.db.userTenants.get(id);
    const now = new Date();
    const row: IUserTenantDB = {
      id,
      userId,
      tenantId,
      roleId,
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
    };
    // put = upsert: one role per (user, tenant); reassigning overwrites the row.
    await this.db.userTenants.put(row);
  }

  async revokeMembership(userId: string, tenantId: string): Promise<void> {
    // delete is idempotent — deleting a missing key is a no-op.
    await this.db.userTenants.delete(userTenantId(userId, tenantId));
  }
}
