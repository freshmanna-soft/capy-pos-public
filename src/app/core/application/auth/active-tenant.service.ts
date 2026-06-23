import { Injectable, inject, computed } from '@angular/core';
import { CurrentUserService } from './current-user.service';

/**
 * ActiveTenantService (Application layer)
 *
 * Signal-based read model for the currently active tenant.
 * Derives its state from CurrentUserService so there is a single
 * source of truth for session data.
 *
 * Multi-tenant data isolation (Story #43) is explicitly out of scope here —
 * this service only exposes the tenantId claim for use by services that
 * need it (e.g. audit logging, future API calls).
 */
@Injectable({ providedIn: 'root' })
export class ActiveTenantService {
  private readonly currentUser = inject(CurrentUserService);

  /** The active tenant id, or null when not authenticated. */
  readonly tenantId = computed(() => this.currentUser.session()?.tenantId ?? null);

  /** True when a tenant context is active (i.e. the user is authenticated). */
  readonly hasActiveTenant = computed(() => this.tenantId() !== null);
}
