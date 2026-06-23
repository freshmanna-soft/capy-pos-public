import { Injectable, inject, signal, computed } from '@angular/core';
import { AUTH_GATEWAY } from './ports/auth-gateway.port';
import { AuthSessionDto } from './dtos/auth-session.dto';
import { Permission } from '@core/domain/auth/permission.constants';

/**
 * CurrentUserService (Application layer)
 *
 * Signal-based read model for the currently authenticated operator.
 * Hydrated on app boot via APP_INITIALIZER (see app.config.ts).
 * Consumed by route guards, directives, and components that need
 * to know who is logged in and what they are allowed to do.
 *
 * Thread-safety note: all mutations happen on the Angular scheduler
 * so signal updates are always synchronous with respect to change detection.
 */
@Injectable({ providedIn: 'root' })
export class CurrentUserService {
  private readonly gateway = inject(AUTH_GATEWAY);

  // ── writable backing signals (private) ─────────────────────────────────

  private readonly _session = signal<AuthSessionDto | null>(null);

  // ── public read-only projections ────────────────────────────────────────

  /** The full session object, or null when not authenticated. */
  readonly session = this._session.asReadonly();

  /** True when a valid session is loaded. */
  readonly isAuthenticated = computed(() => this._session() !== null);

  /** Operator id string, or null when not authenticated. */
  readonly operatorId = computed(() => this._session()?.operatorId ?? null);

  /** List of role names held by the current operator. */
  readonly roles = computed(() => this._session()?.roles ?? []);

  /** List of permission strings held by the current operator. */
  readonly permissions = computed(() => this._session()?.permissions ?? []);

  // ── hydration ───────────────────────────────────────────────────────────

  /**
   * Attempt to rehydrate a session from storage.
   * Called from APP_INITIALIZER — safe to call multiple times (idempotent).
   */
  async hydrate(): Promise<void> {
    const session = await this.gateway.getActiveSession();
    this._session.set(session);
  }

  /**
   * Update the in-memory session after a fresh authentication.
   * Called by LoginComponent after gateway.authenticate() succeeds.
   */
  setSession(session: AuthSessionDto): void {
    this._session.set(session);
  }

  // ── permission helpers ──────────────────────────────────────────────────

  /**
   * Synchronous permission check against the current session.
   * Returns false when not authenticated.
   */
  hasPermission(permission: Permission): boolean {
    return this._session()?.permissions.includes(permission) ?? false;
  }

  /**
   * Synchronous role check against the current session.
   * Returns false when not authenticated.
   */
  hasRole(role: string): boolean {
    return this._session()?.roles.includes(role) ?? false;
  }

  // ── logout ──────────────────────────────────────────────────────────────

  /**
   * Sign out: call the gateway, then clear the in-memory session so
   * guards and reactive consumers react immediately.
   */
  async logout(): Promise<void> {
    await this.gateway.signOut();
    this._session.set(null);
  }
}
