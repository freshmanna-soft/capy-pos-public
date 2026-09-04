import { Injectable, inject } from '@angular/core';
import { OperatorAdminPort } from '@core/application/auth/ports/operator-admin.port';
import { OperatorSummaryDto } from '@core/application/auth/dtos/operator-summary.dto';
import { RoleSummaryDto } from '@core/application/auth/dtos/role-summary.dto';
import { AUTH_GATEWAY } from '@core/application/auth/ports/auth-gateway.port';
import { DEFAULT_TENANT_ID } from '@core/infrastructure/database/dexie-database.service';
import { APPID_CONFIG } from './appid-auth.adapter';

/**
 * AppIdOperatorAdminAdapter
 *
 * {@link OperatorAdminPort} backed by IBM App ID's Management API, reached
 * through `infra/appid-token-relay`'s admin-only `/appid/admin/*` routes —
 * never App ID's Management API directly, which needs an IBM Cloud IAM
 * credential this browser bundle must never hold (the same reasoning
 * `AppIdAuthAdapter`'s class doc already gives for the token endpoint's client
 * secret, one credential tier further up).
 *
 * Bound in place of {@link DexieOperatorAdminAdapter} whenever
 * `environment.appId.enabled` is true (`auth.providers.ts`), because once App
 * ID is production's `AuthGateway`, the Dexie operator table has no
 * relationship to who can actually sign in — see Phase 3d in the plan file for
 * the full finding.
 *
 * Every call attaches the current session's own App ID access token
 * (`AUTH_GATEWAY.getAccessToken()`) as `Bearer` — the relay's `admin-auth.ts`
 * verifies it and requires `MANAGE_OPERATORS` before it ever reaches the
 * Management API. This adapter invents no credential of its own.
 *
 * This pilot is single-tenant (`DEFAULT_TENANT_ID`, same as
 * `AppIdAuthAdapter.sessionFromToken()`), so `tenantId` on every returned
 * summary is that fixed constant, never a per-store id App ID has no concept
 * of.
 */
@Injectable()
export class AppIdOperatorAdminAdapter implements OperatorAdminPort {
  private readonly config = inject(APPID_CONFIG);
  private readonly gateway = inject(AUTH_GATEWAY);

  readonly supportsCreate = true;

  private get staffUrl(): string {
    return `${this.adminBaseUrl}/staff`;
  }

  private get rolesUrl(): string {
    return `${this.adminBaseUrl}/roles`;
  }

  /** `relayUrl` is `.../appid/token`; the admin routes live alongside it at `.../appid/admin/*`. */
  private get adminBaseUrl(): string {
    return this.config.relayUrl.replace(/\/appid\/token$/, '/appid/admin');
  }

  async listOperatorsForTenant(): Promise<OperatorSummaryDto[]> {
    const users = (await this.request<StaffUserWire[]>('GET', this.staffUrl)) ?? [];
    return users.map(toOperatorSummary);
  }

  async listAssignableRoles(): Promise<RoleSummaryDto[]> {
    const roles = (await this.request<StaffRoleWire[]>('GET', this.rolesUrl)) ?? [];
    return roles.map(toRoleSummary);
  }

  async createOperator(email: string, roleId: string): Promise<OperatorSummaryDto> {
    const user = await this.request<StaffUserWire>('POST', this.staffUrl, { email, roleId });
    if (!user) {
      throw new Error('App ID did not return the new staff account.');
    }
    return toOperatorSummary(user);
  }

  async assignRole(userId: string, _tenantId: string, roleId: string): Promise<void> {
    await this.request('PUT', `${this.staffUrl}/${encodeURIComponent(userId)}/role`, { roleId });
  }

  async revokeMembership(userId: string): Promise<void> {
    await this.request('DELETE', `${this.staffUrl}/${encodeURIComponent(userId)}/role`);
  }

  private async request<T>(method: string, url: string, body?: unknown): Promise<T | undefined> {
    const token = this.gateway.getAccessToken();
    let response: Response;
    try {
      response = await fetch(url, {
        method,
        headers: {
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
          ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
        },
        body: body !== undefined ? JSON.stringify(body) : undefined,
      });
    } catch (err) {
      throw new Error(`Staff-management request failed: ${(err as Error).message}`, { cause: err });
    }

    if (!response.ok) {
      const problem = await response.json().catch(() => ({}) as { error?: string });
      throw new Error(
        (problem as { error?: string }).error ??
          `Staff-management request returned ${response.status}.`
      );
    }
    if (response.status === 204) {
      return undefined;
    }
    return (await response.json()) as T;
  }
}

interface StaffRoleWire {
  readonly id: string;
  readonly name: string;
}

interface StaffUserWire {
  readonly id: string;
  readonly email: string;
  readonly displayName: string;
  readonly roles: readonly StaffRoleWire[];
}

function toRoleSummary(role: StaffRoleWire): RoleSummaryDto {
  return {
    id: role.id,
    name: role.name,
    // App ID's own scope→permission mapping (AppIdAuthAdapter.resolveRoles(),
    // pos-api's session-auth.ts) resolves permissions from the *token's* scope
    // at sign-in time, not from anything this list carries — there is nothing
    // meaningful to report here, and this DTO field exists for Dexie's custom
    // roles, which App ID has no equivalent of.
    permissions: [],
    level: 0,
    isBuiltIn: true,
  };
}

function toOperatorSummary(user: StaffUserWire): OperatorSummaryDto {
  const primaryRole = user.roles[0];
  return {
    id: user.id,
    email: user.email,
    displayName: user.displayName,
    roleId: primaryRole?.id ?? '',
    roleName: primaryRole?.name ?? '',
    // "Active" here means "holds at least one Capy-POS role" — see the class
    // doc's revoke note. Not App ID's own account-level `active` SCIM flag,
    // a different, coarser concept this page has never exposed.
    isActive: user.roles.length > 0,
    tenantId: DEFAULT_TENANT_ID,
  };
}
