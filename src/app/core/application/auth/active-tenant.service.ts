import { Injectable, inject, computed } from '@angular/core';
import { CurrentUserService } from './current-user.service';

/**
 * ActiveTenantService (Application layer)
 *
 * Signal-based public API for the currently active tenant context.
 * Delegates entirely to CurrentUserService (the single source of truth for
 * session + active-tenant state) to avoid circular dependencies — this service
 * already injects CurrentUserService, and RBAC consumers read CurrentUserService
 * directly for roles/permissions.
 *
 * What this service exposes:
 *  - `tenantId` — the active tenant id (null when not authenticated)
 *  - `hasActiveTenant` — convenience boolean derived from tenantId
 *  - `availableTenantIds` — all tenant ids the current user may switch to
 *  - `setActiveTenant(id)` — switch the active tenant; enforces membership
 *    isolation via CurrentUserService.switchTenant (throws TenantIsolationError
 *    when the user has no membership in the target tenant)
 *
 * Repository-level data-at-rest filtering (WI-3) — i.e. every query being
 * scoped to the active tenantId — remains a separate follow-up work item and
 * is explicitly out of scope for this service.
 */
@Injectable({ providedIn: 'root' })
export class ActiveTenantService {
  private readonly currentUser = inject(CurrentUserService);

  /** The active tenant id, or null when not authenticated. */
  readonly tenantId = computed(() => this.currentUser.activeTenantId());

  /** True when a tenant context is active (i.e. the user is authenticated). */
  readonly hasActiveTenant = computed(() => this.tenantId() !== null);

  /** All tenant ids the current operator is a member of. */
  readonly availableTenantIds = computed(() => this.currentUser.availableTenantIds());

  /**
   * Switch the active tenant context.
   * Delegates to CurrentUserService.switchTenant — throws TenantIsolationError
   * when the current user has no membership in the target tenant.
   */
  setActiveTenant(tenantId: string): void {
    this.currentUser.switchTenant(tenantId);
  }
}
