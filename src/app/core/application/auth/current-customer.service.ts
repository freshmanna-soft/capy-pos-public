import { Injectable, inject, signal, computed } from '@angular/core';
import { CUSTOMER_AUTH_GATEWAY } from './ports/customer-auth-gateway.port';
import { CustomerSessionDto } from './dtos/customer-session.dto';
import { Permission } from '@core/domain/auth';

/**
 * CurrentCustomerService (Application layer)
 *
 * Signal-based read model for the currently authenticated *customer*, the
 * self-checkout counterpart of {@link CurrentUserService} (Epic #261 item 12).
 * A second parallel service rather than a reuse: `CurrentUserService` is a root
 * singleton holding exactly one identity, and self-checkout has to be able to
 * hold a customer session in the same browser tab a staff member is also
 * signed into.
 *
 * Deliberately NOT `providedIn: 'root'`. It is provided together with the
 * `CUSTOMER_AUTH_GATEWAY` binding on the self-checkout lazy route (epic item
 * 13), so a customer identity cannot be resolved — or accidentally consulted
 * for authorization — anywhere else in the app. A route-scoped provider also
 * means the session dies with the route, which is the behaviour a shared
 * in-store device wants.
 *
 * What it deliberately does NOT mirror from `CurrentUserService`:
 * tenant memberships and `switchTenant()`. A customer identity is scoped to
 * the single store it registered against (see {@link CustomerSessionDto}), so
 * there is no membership set to switch between and no RBAC consumer
 * (`AngularAuthorizationService`, `*appHasPermission`) is wired to this
 * service — those stay staff-only.
 */
@Injectable()
export class CurrentCustomerService {
  private readonly gateway = inject(CUSTOMER_AUTH_GATEWAY);

  // ── writable backing signals (private) ─────────────────────────────────

  private readonly _session = signal<CustomerSessionDto | null>(null);
  private readonly _logoutReason = signal<'expired' | 'manual' | null>(null);
  private readonly _sessionExpiresAt = signal<string | null>(null);
  private readonly _expiryWarningActive = signal(false);
  private expiryTimer: ReturnType<typeof setTimeout> | null = null;
  private expiryWarningTimer: ReturnType<typeof setTimeout> | null = null;

  /** How long before the hard expiry the warning fires — see `armExpiryTimer`'s own doc. */
  private static readonly EXPIRY_WARNING_LEAD_MS = 60_000;

  // ── public read-only projections ────────────────────────────────────────

  /** The full customer session object, or null when not authenticated. */
  readonly session = this._session.asReadonly();

  /** True when a valid customer session is loaded. */
  readonly isAuthenticated = computed(() => this._session() !== null);

  /**
   * Why the last logout happened, or null before any logout this session.
   * Read by the self-checkout shell to tell an expiry ("your session timed
   * out") apart from the customer tapping "Done" — both clear the same
   * `_session` signal, so the *reason* has to be its own signal rather than
   * inferred from the true→false transition alone.
   */
  readonly logoutReason = this._logoutReason.asReadonly();

  /**
   * ISO timestamp the current session's token expires at, or null when not
   * authenticated. Lets a countdown tick off wall-clock time rather than a
   * separately-tracked remaining duration, since the exact instant is known.
   */
  readonly sessionExpiresAt = this._sessionExpiresAt.asReadonly();

  /**
   * True for the last `EXPIRY_WARNING_LEAD_MS` before the hard expiry fires.
   * `refresh()` clears it immediately by re-arming both timers against the
   * new, later expiry.
   */
  readonly expiryWarningActive = this._expiryWarningActive.asReadonly();

  /** App ID subject for the signed-in customer, or null when not authenticated. */
  readonly customerId = computed(() => this._session()?.customerId ?? null);

  /** The signed-in customer's email, or null when not authenticated. */
  readonly email = computed(() => this._session()?.email ?? null);

  /** The store this customer identity is scoped to, or null when not authenticated. */
  readonly tenantId = computed(() => this._session()?.tenantId ?? null);

  /** Role names held by the current customer (in practice the single `customer` role). */
  readonly roles = computed<readonly string[]>(() => this._session()?.roles ?? []);

  /** Permission strings carried by the current customer session. */
  readonly permissions = computed<readonly string[]>(() => this._session()?.permissions ?? []);

  // ── hydration ───────────────────────────────────────────────────────────

  /**
   * Attempt to rehydrate a customer session from storage.
   * Called on self-checkout route entry — safe to call multiple times (idempotent).
   */
  async hydrate(): Promise<void> {
    const session = await this.gateway.getActiveSession();
    this._session.set(session);
    this.armExpiryTimer(session?.expiresAt);
  }

  /**
   * Update the in-memory session after a fresh authentication or sign-up.
   * Called by the self-checkout sign-in/sign-up forms after the gateway call
   * succeeds — the same split `LoginComponent` already uses with
   * `CurrentUserService.setSession()`, which keeps this service free of the
   * form's error handling.
   */
  setSession(session: CustomerSessionDto): void {
    this._session.set(session);
    this.armExpiryTimer(session.expiresAt);
  }

  /**
   * Arm a one-shot timer for the moment this session's token expires, plus a
   * second one `EXPIRY_WARNING_LEAD_MS` earlier that flips on the countdown.
   *
   * Two single `setTimeout`s for the exact instants, not a polling interval —
   * `expiresAt` is already known exactly, so there is nothing to poll for. A
   * session already expired by the time this runs (a tab left open on the
   * kiosk long after the token lapsed) logs out immediately rather than
   * waiting out a negative delay forever. A session already inside the
   * warning window shows the warning immediately, the same way.
   */
  private armExpiryTimer(expiresAt: string | undefined): void {
    this.clearExpiryTimer();
    this._sessionExpiresAt.set(expiresAt ?? null);
    if (!expiresAt) {
      return;
    }
    const delayMs = new Date(expiresAt).getTime() - Date.now();
    if (delayMs <= 0) {
      void this.logout('expired');
      return;
    }
    this.expiryTimer = setTimeout(() => void this.logout('expired'), delayMs);

    const warningDelayMs = delayMs - CurrentCustomerService.EXPIRY_WARNING_LEAD_MS;
    if (warningDelayMs <= 0) {
      this._expiryWarningActive.set(true);
    } else {
      this.expiryWarningTimer = setTimeout(
        () => this._expiryWarningActive.set(true),
        warningDelayMs
      );
    }
  }

  private clearExpiryTimer(): void {
    if (this.expiryTimer !== null) {
      clearTimeout(this.expiryTimer);
      this.expiryTimer = null;
    }
    if (this.expiryWarningTimer !== null) {
      clearTimeout(this.expiryWarningTimer);
      this.expiryWarningTimer = null;
    }
    this._expiryWarningActive.set(false);
  }

  /**
   * Re-issue the session from the gateway without re-login, then re-apply it
   * so reactive consumers recompute against the new token and expiry.
   */
  async refresh(): Promise<void> {
    const session = await this.gateway.refresh();
    this._session.set(session);
    this.armExpiryTimer(session.expiresAt);
  }

  // ── permission helpers ──────────────────────────────────────────────────

  /**
   * Synchronous permission check against the current customer session.
   * Returns false when not authenticated.
   */
  hasPermission(permission: Permission): boolean {
    return this.permissions().includes(permission);
  }

  // ── logout ──────────────────────────────────────────────────────────────

  /**
   * Sign out: call the gateway, then clear the in-memory session so the
   * self-checkout shell reacts immediately.
   *
   * @param reason 'expired' when this fires from the token's own expiry timer
   *   or a 401 the server caught first; 'manual' for the customer ending their
   *   own session. Both clear the same session, so this can't be inferred from
   *   that alone.
   */
  async logout(reason: 'expired' | 'manual' = 'manual'): Promise<void> {
    this.clearExpiryTimer();
    await this.gateway.signOut();
    this._session.set(null);
    this._logoutReason.set(reason);
    this._sessionExpiresAt.set(null);
  }
}
