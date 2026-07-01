import { Injectable, inject, signal, computed } from '@angular/core';
import { AUTH_GATEWAY } from './ports/auth-gateway.port';
import { AuthSessionDto } from './dtos/auth-session.dto';
import { Permission, isPermission } from '@core/domain/auth/permission.constants';
import { TenantMembershipSet, TenantIsolationError } from '@core/domain/auth/tenant-membership-set';
import { TenantId } from '@core/domain/auth/tenant-id.value-object';
import { Role } from '@core/domain/auth/role.value-object';

export { TenantIsolationError };

/**
 * CurrentUserService (Application layer)
 *
 * Signal-based read model for the currently authenticated operator.
 * Hydrated on app boot via APP_INITIALIZER (see app.config.ts).
 * Consumed by route guards, directives, and components that need
 * to know who is logged in and what they are allowed to do.
 *
 * Single source of truth for active-tenant state: the _activeTenantId signal
 * is owned here so that RBAC consumers (AngularAuthorizationService,
 * has-permission.directive) automatically react to tenant switches via the
 * roles() and permissions() computed signals.
 *
 * Thread-safety note: all mutations happen on the Angular scheduler
 * so signal updates are always synchronous with respect to change detection.
 */
@Injectable({ providedIn: 'root' })
export class CurrentUserService {
  private readonly gateway = inject(AUTH_GATEWAY);

  // ── writable backing signals (private) ─────────────────────────────────

  private readonly _session = signal<AuthSessionDto | null>(null);
  private readonly _activeTenantId = signal<string | null>(null);

  // ── public read-only projections ────────────────────────────────────────

  /** The full session object, or null when not authenticated. */
  readonly session = this._session.asReadonly();

  /** The active tenant id, or null when no tenant is selected. */
  readonly activeTenantId = this._activeTenantId.asReadonly();

  /** True when a valid session is loaded. */
  readonly isAuthenticated = computed(() => this._session() !== null);

  /** Operator id string, or null when not authenticated. */
  readonly operatorId = computed(() => this._session()?.operatorId ?? null);

  /**
   * The full set of tenant memberships for the current session.
   * Parsed from the session's `memberships` claim into a domain TenantMembershipSet.
   * Returns an empty set when not authenticated.
   */
  readonly memberships = computed<TenantMembershipSet>(() => {
    const s = this._session();
    if (!s) return new TenantMembershipSet([]);
    try {
      return TenantMembershipSet.fromJSON(s.memberships ?? []);
    } catch {
      return new TenantMembershipSet([]);
    }
  });

  /** All tenant ids the current operator is a member of. */
  readonly availableTenantIds = computed<string[]>(() =>
    this.memberships()
      .tenantIds()
      .map((t) => t.value)
  );

  /** The domain Role for the active tenant, or null when no active tenant or no membership. */
  private readonly activeRole = computed<Role | null>(() => {
    const id = this._activeTenantId();
    if (!id) return null;
    try {
      return this.memberships().roleFor(new TenantId(id));
    } catch {
      return null;
    }
  });

  /**
   * List of role names held by the current operator.
   * Active-tenant aware: when an active tenant is selected the role for that
   * tenant is returned. Falls back to the session claim when no active
   * membership is available (preserves back-compat for fixtures without memberships).
   */
  readonly roles = computed(() => {
    const role = this.activeRole();
    return role ? [role.name] : (this._session()?.roles ?? []);
  });

  /**
   * List of permission strings held by the current operator.
   * Active-tenant aware: permissions are derived from the active tenant's role.
   * Falls back to the session claim when no active membership is available.
   */
  readonly permissions = computed(() => {
    const role = this.activeRole();
    return role ? [...role.permissions] : (this._session()?.permissions ?? []);
  });

  /**
   * The principal's resolved domain Role(s) for the active tenant — the input to
   * AuthorizationService. Data-driven: a custom role's permissions/level come from
   * the role it actually holds, not a name lookup. Falls back to reconstructing
   * roles from the session claims when there is no active membership (fixtures /
   * pre-membership sessions), so authorization stays correct either way.
   */
  readonly principalRoles = computed<Role[]>(() => {
    const active = this.activeRole();
    if (active) return [active];

    const s = this._session();
    if (!s) return [];
    const sessionPermissions = (s.permissions ?? []).filter(isPermission);
    return (s.roles ?? []).map((name) => {
      try {
        return Role.fromName(name); // built-in → canonical permissions + level
      } catch {
        // Custom role with no membership context: trust the session's permission
        // claim, lowest level (hierarchy checks fall back to permission checks).
        return Role.fromRecord({ name, permissions: sessionPermissions, level: 1 });
      }
    });
  });

  // ── hydration ───────────────────────────────────────────────────────────

  /**
   * Attempt to rehydrate a session from storage.
   * Called from APP_INITIALIZER — safe to call multiple times (idempotent).
   */
  async hydrate(): Promise<void> {
    const session = await this.gateway.getActiveSession();
    this._session.set(session);
    this._activeTenantId.set(session?.tenantId ?? null);
  }

  /**
   * Update the in-memory session after a fresh authentication.
   * Called by LoginComponent after gateway.authenticate() succeeds.
   * Sets the active tenant to the session's home tenant.
   */
  setSession(session: AuthSessionDto): void {
    this._session.set(session);
    this._activeTenantId.set(session.tenantId);
  }

  /**
   * Re-issue the session from current persisted state (roles/memberships) without
   * re-login, then re-apply it so guards, the `*appHasPermission` directive and
   * every RBAC computed signal recompute. Call this after an admin action that
   * changes the CURRENT operator's own access (AC4, #44). Preserves the tenant the
   * user is actively working in when they still hold a membership there.
   */
  async refresh(): Promise<void> {
    const previousActive = this._activeTenantId();
    const session = await this.gateway.refresh();
    this._session.set(session);
    const stillMember =
      !!previousActive && (session.memberships ?? []).some((m) => m.tenantId === previousActive);
    this._activeTenantId.set(stillMember ? previousActive : session.tenantId);
  }

  // ── tenant switching ─────────────────────────────────────────────────────

  /**
   * Switch the active tenant. Enforces isolation: throws TenantIsolationError
   * when the current user has no membership in the target tenant. On success,
   * roles()/permissions() recompute to the role held in the new tenant.
   */
  switchTenant(tenantId: string): void {
    const target = new TenantId(tenantId);
    this.memberships().assertMemberOf(target); // throws TenantIsolationError for non-members
    this._activeTenantId.set(target.value);
  }

  // ── permission helpers ──────────────────────────────────────────────────

  /**
   * Synchronous permission check against the current session.
   * Active-tenant aware — reads the computed permissions() signal.
   * Returns false when not authenticated.
   */
  hasPermission(permission: Permission): boolean {
    return this.permissions().includes(permission);
  }

  /**
   * Synchronous role check against the current session.
   * Active-tenant aware — reads the computed roles() signal.
   * Returns false when not authenticated.
   */
  hasRole(role: string): boolean {
    return this.roles().includes(role);
  }

  // ── logout ──────────────────────────────────────────────────────────────

  /**
   * Sign out: call the gateway, then clear the in-memory session so
   * guards and reactive consumers react immediately.
   */
  async logout(): Promise<void> {
    await this.gateway.signOut();
    this._session.set(null);
    this._activeTenantId.set(null);
  }
}
