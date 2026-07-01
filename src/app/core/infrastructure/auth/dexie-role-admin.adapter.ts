import { Injectable, inject } from '@angular/core';
import { DexieDatabase, IRoleDB } from '@core/infrastructure/database/dexie-database.service';
import { RoleAdminPort } from '@core/application/auth/ports/role-admin.port';
import { CreateRoleInput, RoleSummaryDto } from '@core/application/auth/dtos/role-summary.dto';
import { Permission, isPermission } from '@core/domain/auth/permission.constants';
import { BUILT_IN_ROLE_NAMES } from '@core/domain/auth/role.value-object';

/**
 * DexieRoleAdminAdapter
 *
 * Local implementation of {@link RoleAdminPort} over the `roles` table. Built-in
 * roles (operator/manager/admin) are protected: they cannot be edited or deleted
 * here, and their canonical permissions remain the domain source of truth. Custom
 * roles persist their permission set as JSON — the same shape Role.fromRecord and
 * the login adapter read, so a custom role is honoured everywhere.
 */
@Injectable()
export class DexieRoleAdminAdapter implements RoleAdminPort {
  private readonly db = inject(DexieDatabase);

  private isBuiltIn(role: Pick<IRoleDB, 'name'>): boolean {
    return (BUILT_IN_ROLE_NAMES as string[]).includes(role.name);
  }

  private toDto(role: IRoleDB): RoleSummaryDto {
    let raw: unknown;
    try {
      raw = JSON.parse(role.permissions);
    } catch {
      raw = [];
    }
    const permissions = (Array.isArray(raw) ? raw : []).filter(isPermission);
    return {
      id: role.id,
      name: role.name,
      permissions,
      level: role.level ?? 1,
      isBuiltIn: this.isBuiltIn(role),
    };
  }

  async listRoles(): Promise<RoleSummaryDto[]> {
    const roles = await this.db.roles.toArray();
    return roles
      .map((r) => this.toDto(r))
      .sort((a, b) => a.level - b.level || a.name.localeCompare(b.name));
  }

  async createRole(input: CreateRoleInput): Promise<string> {
    const name = input.name.trim();
    if (!name) throw new Error('Role name is required');
    if ((BUILT_IN_ROLE_NAMES as string[]).includes(name)) {
      throw new Error(`'${name}' is a built-in role name and cannot be reused`);
    }
    const clash = await this.db.roles.where('name').equals(name).first();
    if (clash) throw new Error(`A role named '${name}' already exists`);

    const permissions = input.permissions.filter(isPermission);
    const now = new Date();
    const id = `role-${crypto.randomUUID()}`;
    const row: IRoleDB = {
      id,
      name,
      permissions: JSON.stringify(permissions),
      level: input.level ?? 1,
      createdAt: now,
      updatedAt: now,
    };
    await this.db.roles.add(row);
    return id;
  }

  async updateRolePermissions(roleId: string, permissions: Permission[]): Promise<void> {
    const role = await this.db.roles.get(roleId);
    if (!role) throw new Error(`Role '${roleId}' not found`);
    if (this.isBuiltIn(role)) {
      throw new Error(`Built-in role '${role.name}' has fixed permissions and cannot be edited`);
    }
    await this.db.roles.update(roleId, {
      permissions: JSON.stringify(permissions.filter(isPermission)),
      updatedAt: new Date(),
    });
  }

  async deleteRole(roleId: string): Promise<void> {
    const role = await this.db.roles.get(roleId);
    if (!role) throw new Error(`Role '${roleId}' not found`);
    if (this.isBuiltIn(role)) {
      throw new Error(`Built-in role '${role.name}' cannot be deleted`);
    }
    const inUse = await this.db.userTenants.where('roleId').equals(roleId).count();
    if (inUse > 0) {
      throw new Error(
        `Role '${role.name}' is assigned to ${inUse} membership(s); reassign them before deleting`
      );
    }
    await this.db.roles.delete(roleId);
  }
}
