import { Injectable, inject } from '@angular/core';
import { SignJWT, jwtVerify } from 'jose';
import {
  DexieDatabase,
  IOperatorDB,
  IRoleDB,
} from '@core/infrastructure/database/dexie-database.service';
import { AuthSessionDto, TenantMembershipDto } from '@core/application/auth/dtos/auth-session.dto';
import { Role } from '@core/domain/auth';

/**
 * Token storage.
 *
 * sessionStorage, so a session survives a refresh within a tab and is gone when
 * the tab closes — the right lifetime for a till that several people use in a
 * day.
 *
 * Production hardening note (Story 5 concern):
 *   - Replace with an httpOnly cookie + CSRF-token pattern when deploying behind
 *     a real backend (Cognito/API Gateway). Acceptable for an offline-first kiosk
 *     where the XSS surface is minimal; NOT acceptable for a public web SPA.
 */
const TOKEN_STORAGE_KEY = 'capy_pos_access_token';

export function storeToken(token: string): void {
  try {
    sessionStorage.setItem(TOKEN_STORAGE_KEY, token);
  } catch {
    // sessionStorage unavailable (e.g. private mode with storage blocked) — continue
  }
}

export function readToken(): string | null {
  try {
    return sessionStorage.getItem(TOKEN_STORAGE_KEY);
  } catch {
    return null;
  }
}

export function clearToken(): void {
  try {
    sessionStorage.removeItem(TOKEN_STORAGE_KEY);
  } catch {
    // ignore
  }
}

/** 8-hour session TTL */
const SESSION_TTL_SECONDS = 8 * 60 * 60;

/** HMAC-SHA256 secret — derived from a fixed key for local-only use.
 *  Story 5: replace with a securely generated secret stored in environment config. */
export function getJwtSecret(): Uint8Array {
  const secret = 'capy-pos-local-jwt-secret-change-in-production';
  return new TextEncoder().encode(secret);
}

/**
 * SessionIssuer
 *
 * The single place a signed session is minted, and the reason the till can offer
 * three ways in without three definitions of what being signed in means.
 *
 * Extracted from `LocalCredentialAuthAdapter` when the passkey and PIN paths
 * landed. Each of those verifies a person differently — a password comparison, an
 * assertion signature, a PIN hash — and then all three arrive here. Every session
 * therefore carries identical claims, resolved from identical live database state,
 * so no guard, directive or audit row can tell which gesture produced it. Had the
 * passkey adapter grown its own `buildSession`, the first change to role
 * resolution would have applied to one of them.
 *
 * Everything is read from `roles`/`userTenants` at issue time rather than copied
 * from a previous token, which is what makes a role change reach a signed-in
 * operator on their next refresh (AC4, #44).
 */
@Injectable({ providedIn: 'root' })
export class SessionIssuer {
  private readonly db = inject(DexieDatabase);

  /**
   * Build, sign and persist a session for an operator from CURRENT database state.
   *
   * The caller has already established *that* this is the operator; this is only
   * concerned with what they are allowed to do.
   */
  async issueFor(operator: IOperatorDB): Promise<AuthSessionDto> {
    const roleRecord = await this.db.roles.get(operator.roleId);
    const roleName = roleRecord?.name ?? operator.roleId;

    // Permissions for the home role. Falls back to the persisted JSON for custom
    // roles unknown to the domain (see resolvePermissions).
    const permissions: string[] = resolvePermissions(roleName, roleRecord?.permissions);

    // Multi-tenant membership list from the userTenants join table (each carries
    // its role's permissions + level so the client reconstructs data-driven roles).
    const memberships = await this.resolveMemberships(operator.id, operator.tenantId, roleName);

    const now = Math.floor(Date.now() / 1000);
    const exp = now + SESSION_TTL_SECONDS;

    const accessToken = await new SignJWT({
      sub: operator.id,
      tenantId: operator.tenantId,
      roles: [roleName],
      permissions,
      memberships,
    })
      .setProtectedHeader({ alg: 'HS256' })
      .setIssuedAt(now)
      .setExpirationTime(exp)
      .sign(getJwtSecret());

    const session: AuthSessionDto = {
      operatorId: operator.id,
      tenantId: operator.tenantId,
      roles: [roleName],
      permissions,
      memberships,
      accessToken,
      expiresAt: new Date(exp * 1000).toISOString(),
    };

    storeToken(accessToken);
    return session;
  }

  /**
   * Rehydrate a session from the stored token, or null when there isn't a valid one.
   *
   * A token that fails verification is cleared rather than merely rejected: it is
   * expired or tampered with either way, and leaving it in storage would have every
   * subsequent boot repeat the same failed verification.
   */
  async readActive(): Promise<AuthSessionDto | null> {
    const token = readToken();
    if (!token) {
      return null;
    }

    try {
      const { payload } = await jwtVerify(token, getJwtSecret());

      const tenantId = payload['tenantId'] as string;
      const roles = payload['roles'] as string[];

      // Read memberships claim; back-compat fallback for old tokens that lack it.
      const rawMemberships = payload['memberships'] as TenantMembershipDto[] | undefined;
      const memberships: TenantMembershipDto[] = rawMemberships?.length
        ? rawMemberships
        : [{ tenantId, role: roles[0] ?? '' }].filter((m) => m.role !== '');

      return {
        operatorId: payload['sub'] as string,
        tenantId,
        roles,
        permissions: payload['permissions'] as string[],
        memberships,
        accessToken: token,
        expiresAt: new Date((payload['exp'] as number) * 1000).toISOString(),
      };
    } catch {
      clearToken();
      return null;
    }
  }

  /**
   * Build the memberships array from the userTenants join table.
   *
   * Resilient mapping (repo convention): a row whose roleId resolves to a role
   * name the domain does not recognise is skipped with a console.warn rather than
   * throwing, so one bad membership row cannot break login.
   *
   * Fallback: when no rows exist (unseeded DB, back-compat) or all rows were
   * skipped, returns a single home-tenant membership.
   */
  private async resolveMemberships(
    userId: string,
    homeTenantId: string,
    homeRoleName: string
  ): Promise<TenantMembershipDto[]> {
    const membershipRows = await this.db.userTenants.where('userId').equals(userId).toArray();

    const homeFallback = (): TenantMembershipDto[] => {
      const role = resolveRole(homeRoleName);
      return [
        role ? toMembershipDto(homeTenantId, role) : { tenantId: homeTenantId, role: homeRoleName },
      ];
    };

    if (membershipRows.length === 0) {
      return homeFallback();
    }

    const resolved = await Promise.all(
      membershipRows.map(async (row) => {
        const roleRecord = await this.db.roles.get(row.roleId);
        const name = roleRecord?.name ?? row.roleId;
        const role = resolveRole(name, roleRecord);
        if (!role) {
          console.warn(
            `[SessionIssuer] Skipping membership row for tenant '${row.tenantId}': ` +
              `role '${name}' is unknown and has no stored record.`
          );
          return null;
        }
        return toMembershipDto(row.tenantId, role);
      })
    );

    const valid = resolved.filter((m): m is TenantMembershipDto => m !== null);

    // Fallback: if all rows were skipped, return the home membership.
    return valid.length > 0 ? valid : homeFallback();
  }
}

/**
 * Resolve the permission claim for a role.
 *
 * Prefers the canonical domain permission set (permission.constants.ts via the
 * Role value object) so the JWT claim never drifts from the authorization rules.
 * For a role name the domain doesn't recognise (a future custom role), falls back
 * to the permissions persisted on the role record, if any.
 */
export function resolvePermissions(roleName: string, storedJson?: string): string[] {
  try {
    return [...Role.fromName(roleName).permissions];
  } catch {
    if (storedJson) {
      try {
        return JSON.parse(storedJson) as string[];
      } catch {
        return [];
      }
    }
    return [];
  }
}

/**
 * Resolve a domain Role from a stored role record. Built-in names resolve to
 * canonical permissions + level; custom roles are rebuilt from the record's
 * persisted permissions JSON + level (unknown permission strings are dropped by
 * Role.fromRecord). Returns null only for an unknown role with no record.
 */
export function resolveRole(name: string, roleRecord?: IRoleDB): Role | null {
  try {
    return Role.fromName(name); // built-in
  } catch {
    if (!roleRecord) return null;
    let permissions: string[];
    try {
      permissions = JSON.parse(roleRecord.permissions) as string[];
    } catch {
      permissions = [];
    }
    return Role.fromRecord({ name, permissions, level: roleRecord.level ?? 1 });
  }
}

/** Serialise a resolved Role into the tenant-membership claim (data-driven). */
export function toMembershipDto(tenantId: string, role: Role): TenantMembershipDto {
  return { tenantId, role: role.name, permissions: [...role.permissions], level: role.level };
}
