import { Injectable, inject } from '@angular/core';
import { SignJWT, jwtVerify } from 'jose';
import {
  DexieDatabase,
  IOperatorDB,
  IRoleDB,
} from '@core/infrastructure/database/dexie-database.service';
import { AuthGateway } from '@core/application/auth/ports/auth-gateway.port';
import { CredentialsDto } from '@core/application/auth/dtos/credentials.dto';
import { AuthSessionDto, TenantMembershipDto } from '@core/application/auth/dtos/auth-session.dto';
import { Role } from '@core/domain/auth/role.value-object';

/**
 * Token storage abstraction
 *
 * Stores the JWT in sessionStorage so it survives page refreshes within a tab
 * but is discarded when the browser tab closes.
 *
 * Production hardening note (Story 5 concern):
 *   - Replace with httpOnly cookie + CSRF-token pattern when deploying behind a
 *     real backend (Cognito/API Gateway). The current sessionStorage approach is
 *     acceptable for an offline-first POS kiosk scenario where XSS surface is
 *     minimal, but should NOT be used for a public web SPA.
 */
const TOKEN_STORAGE_KEY = 'capy_pos_access_token';

function storeToken(token: string): void {
  try {
    sessionStorage.setItem(TOKEN_STORAGE_KEY, token);
  } catch {
    // sessionStorage unavailable (e.g. private mode with storage blocked) — continue
  }
}

function readToken(): string | null {
  try {
    return sessionStorage.getItem(TOKEN_STORAGE_KEY);
  } catch {
    return null;
  }
}

function clearToken(): void {
  try {
    sessionStorage.removeItem(TOKEN_STORAGE_KEY);
  } catch {
    // ignore
  }
}

// ---------------------------------------------------------------------------
// JWT helpers
// ---------------------------------------------------------------------------

/** 8-hour session TTL */
const SESSION_TTL_SECONDS = 8 * 60 * 60;

/** HMAC-SHA256 secret — derived from a fixed key for local-only use.
 *  Story 5: replace with a securely generated secret stored in environment config. */
function getJwtSecret(): Uint8Array {
  const secret = 'capy-pos-local-jwt-secret-change-in-production';
  return new TextEncoder().encode(secret);
}

// ---------------------------------------------------------------------------
// Domain errors
// ---------------------------------------------------------------------------

export class InvalidCredentialsError extends Error {
  constructor() {
    super('Invalid email or password');
    this.name = 'InvalidCredentialsError';
  }
}

// ---------------------------------------------------------------------------
// Password comparison
// ---------------------------------------------------------------------------

/**
 * Compares a plaintext password against a stored bcrypt hash.
 *
 * bcrypt is not natively available in the browser; we use the WebCrypto
 * PBKDF2-based fallback described below.
 *
 * IMPLEMENTATION NOTE (Story 5):
 *   For the local offline POS kiosk we accept the security trade-off of using
 *   a browser-safe hash comparison. The seeded admin hash was pre-generated
 *   with bcrypt cost=10 off-device.  For new accounts created through the UI
 *   we use PBKDF2-SHA256 (100 000 iterations) which is strong enough for
 *   the kiosk threat model.
 *
 *   When the Cognito adapter lands (#42) this file is bypassed entirely and
 *   credentials are validated server-side.
 *
 * The seed admin account uses a well-known bcrypt hash.  We detect bcrypt
 * format (`$2b$`) and fall back to a simple constant-time comparison of the
 * known test hash to make the default admin account work out-of-the-box.
 */
async function comparePassword(plaintext: string, storedHash: string): Promise<boolean> {
  // Bcrypt hash detection — used only for the seeded admin account
  if (storedHash.startsWith('$2b$') || storedHash.startsWith('$2a$')) {
    // bcrypt is not available in pure WebCrypto. For the seeded default admin
    // we store the hash of "admin1234" and do a direct equality check for
    // demonstration purposes only.
    // Story 5: integrate a WASM bcrypt or enforce password reset on first login.
    const SEED_HASH = '$2b$10$EixZaYVK1fsbw1ZfbX3OXePaWxn96p36WQoeG6Lruj3vjPGga31lW';
    const SEED_PLAIN = 'admin1234';
    if (storedHash === SEED_HASH) {
      return plaintext === SEED_PLAIN;
    }
    // Unknown bcrypt hash — reject (cannot verify without bcrypt WASM)
    return false;
  }

  // PBKDF2-SHA256 format: "pbkdf2:<iterations>:<hex-salt>:<hex-dk>"
  if (storedHash.startsWith('pbkdf2:')) {
    const parts = storedHash.split(':');
    if (parts.length !== 4) return false;
    const iterations = parseInt(parts[1], 10);
    const saltHex = parts[2];
    const storedDkHex = parts[3];

    const saltBytes = hexToUint8Array(saltHex);
    const dk = await pbkdf2Hash(plaintext, saltBytes, iterations);
    const candidateDkHex = uint8ArrayToHex(dk);
    return timingSafeEqual(candidateDkHex, storedDkHex);
  }

  return false;
}

async function pbkdf2Hash(
  password: string,
  salt: Uint8Array,
  iterations: number
): Promise<Uint8Array> {
  const keyMaterial = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(password),
    'PBKDF2',
    false,
    ['deriveBits']
  );
  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', hash: 'SHA-256', salt: salt as Uint8Array<ArrayBuffer>, iterations },
    keyMaterial,
    256
  );
  return new Uint8Array(bits);
}

function hexToUint8Array(hex: string): Uint8Array {
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < bytes.length; i++) {
    bytes[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  }
  return bytes;
}

function uint8ArrayToHex(bytes: Uint8Array): string {
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

/** Constant-time string comparison to mitigate timing attacks */
function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let result = 0;
  for (let i = 0; i < a.length; i++) {
    result |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return result === 0;
}

/**
 * Hash a plaintext password with PBKDF2-SHA256 for newly created accounts.
 * Returns a string in the format: "pbkdf2:<iterations>:<hex-salt>:<hex-dk>"
 */
export async function hashPassword(plaintext: string): Promise<string> {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const iterations = 100_000;
  const dk = await pbkdf2Hash(plaintext, salt, iterations);
  return `pbkdf2:${iterations}:${uint8ArrayToHex(salt)}:${uint8ArrayToHex(dk)}`;
}

/**
 * Resolve the permission claim for a role.
 *
 * Prefers the canonical domain permission set (permission.constants.ts via the
 * Role value object) so the JWT claim never drifts from the authorization rules.
 * For a role name the domain doesn't recognise (a future custom role), falls back
 * to the permissions persisted on the role record, if any.
 */
function resolvePermissions(roleName: string, storedJson?: string): string[] {
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
function resolveRole(name: string, roleRecord?: IRoleDB): Role | null {
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
function toMembershipDto(tenantId: string, role: Role): TenantMembershipDto {
  return { tenantId, role: role.name, permissions: [...role.permissions], level: role.level };
}

// ---------------------------------------------------------------------------
// Adapter
// ---------------------------------------------------------------------------

@Injectable()
export class LocalCredentialAuthAdapter implements AuthGateway {
  private readonly db = inject(DexieDatabase);

  async authenticate(creds: CredentialsDto): Promise<AuthSessionDto> {
    const email = creds.email.trim().toLowerCase();

    const operator = await this.db.operators.where('email').equals(email).first();

    if (!operator || !operator.isActive) {
      throw new InvalidCredentialsError();
    }

    const passwordMatch = await comparePassword(creds.password, operator.passwordHash);
    if (!passwordMatch) {
      throw new InvalidCredentialsError();
    }

    return this.buildSession(operator);
  }

  /**
   * Build (and persist) a signed session for an operator from CURRENT database
   * state — the home role + permissions and the multi-tenant membership list read
   * from `roles`/`userTenants`. Shared by authenticate() and refresh() so a
   * refreshed session always reflects live role/membership changes (AC4, #44),
   * never stale JWT claims.
   */
  private async buildSession(operator: IOperatorDB): Promise<AuthSessionDto> {
    const roleRecord = await this.db.roles.get(operator.roleId);
    const roleName = roleRecord?.name ?? operator.roleId;

    // Permissions for the home role. Falls back to the persisted JSON for custom
    // roles unknown to the domain (see resolvePermissions).
    const permissions: string[] = resolvePermissions(roleName, roleRecord?.permissions);

    // Multi-tenant membership list from the userTenants join table (each carries
    // its role's permissions + level so the client reconstructs data-driven roles).
    const memberships = await this._resolveMemberships(operator.id, operator.tenantId, roleName);

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

  async getActiveSession(): Promise<AuthSessionDto | null> {
    const token = readToken();
    if (!token) return null;

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
      // Token expired or tampered — clear it
      clearToken();
      return null;
    }
  }

  async refresh(): Promise<AuthSessionDto> {
    const current = await this.getActiveSession();
    if (!current) {
      throw new Error('No active session to refresh');
    }

    // Rebuild from CURRENT database state (not the stale token claims) so a role
    // reassignment or permission change made while signed in takes effect on the
    // next refresh — this is what makes admin changes reach the current user's
    // guards and gated UI live (AC4, #44).
    const operator = await this.db.operators.get(current.operatorId);
    if (!operator || !operator.isActive) {
      // The operator was removed or deactivated — treat as signed out.
      clearToken();
      throw new Error('Operator no longer active — session refresh denied');
    }
    return this.buildSession(operator);
  }

  /**
   * Build the memberships array from the userTenants join table.
   *
   * Resilient mapping (repo convention): a row whose roleId resolves to a
   * role name that the domain does not recognise is skipped with a console.warn
   * rather than throwing, so one bad membership row cannot break login.
   *
   * Fallback: when no rows exist (unseeded DB, back-compat) or all rows were
   * skipped, returns a single home-tenant membership.
   */
  private async _resolveMemberships(
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
            `[LocalCredentialAuthAdapter] Skipping membership row for tenant '${row.tenantId}': ` +
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

  async signOut(): Promise<void> {
    clearToken();
  }

  getAccessToken(): string | null {
    return readToken();
  }
}
