/**
 * TenantMembershipDto
 *
 * A single tenant + role pairing carried in the JWT and session DTO.
 * Mirrors the userTenants join-table row at the application boundary.
 */
export interface TenantMembershipDto {
  readonly tenantId: string;
  readonly role: string; // role NAME (built-in operator|manager|admin, or a custom role name)
  /** The role's permissions in this tenant. Enables data-driven/custom roles;
   *  omitted for legacy sessions, where built-in defaults are resolved by name. */
  readonly permissions?: readonly string[];
  /** The role's hierarchy level. Omitted for legacy sessions (built-ins resolve by name). */
  readonly level?: number;
}

/**
 * AuthSessionDto
 *
 * Read model returned after a successful authentication.
 * Contains all claims needed by the presentation layer for rendering
 * and by route guards for permission checks.
 */
export interface AuthSessionDto {
  readonly operatorId: string;
  readonly tenantId: string;
  /** Role names (e.g. ['admin']) */
  readonly roles: readonly string[];
  /** Expanded permission strings (e.g. ['sale:process', ...]) */
  readonly permissions: readonly string[];
  /** Signed JWT — treat as opaque in the presentation layer */
  readonly accessToken: string;
  /** ISO-8601 expiry timestamp */
  readonly expiresAt: string;
  /** All tenants this operator belongs to, with the role held in each. */
  readonly memberships?: readonly TenantMembershipDto[];
}
