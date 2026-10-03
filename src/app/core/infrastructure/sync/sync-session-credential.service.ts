import { Injectable, computed, effect, inject, signal } from '@angular/core';
import { CurrentUserService } from '@core/application/auth/current-user.service';
import { SyncService } from './sync.service';

/**
 * SyncSessionCredentialService
 *
 * Keeps the sync worker's `Authorization` credential in step with whoever is signed
 * in at the till (#224).
 *
 * ## Why this exists
 *
 * #224 chose IBM `pos-api` as the single sync backend, which authorizes with the
 * operator's own session JWT (`infra/pos-api/src/session-auth.ts` verifies HS256
 * over the secret `SessionIssuer` signs with) rather than #206's shared service
 * token. That service token was empty in every checked-in environment — a shared
 * secret compiled into a browser bundle is readable by every visitor — so keeping it
 * would have meant a sync worker that never sends a credential and a backend that
 * 401s every products and transactions call.
 *
 * The session lives on the main thread and the worker is a separate context, so the
 * token has to be pushed across rather than read. `UPDATE_CONFIG` is the existing
 * channel for that, and the moments worth pushing on are exactly the moments the
 * session signal changes: sign-in, sign-out, and the re-issue
 * `CurrentUserService.refresh()` performs after a role change (AC4, #44).
 *
 * ## What it deliberately does not do
 *
 * It does not decide whether to sync. A blank token means "nobody is signed in", and
 * `sync.worker.ts` is where that becomes "skip the authorized calls" — the worker
 * owns its own scheduling and the credential is just one input to it.
 *
 * ## Which credential wins
 *
 * Two parties want the worker's one `Authorization` slot: the staff session above,
 * and a *capability* session — the anonymous customer's shop token, which
 * `ShopSessionService` holds while `/shop` is open. This service is the single
 * place that decides between them (`workerCredential`): an active capability
 * session wins, otherwise the staff token, otherwise none. Before this, both wrote
 * to the worker directly, so a till with a leftover staff session overwrote the
 * shop token on `/shop` whenever the staff session expired or refreshed, and the
 * shop's pulls went out with `''` or a token the customer should never carry.
 *
 * It also does not narrow what the token can do. The claim set is whatever the till
 * minted, and the ceiling is `session-auth.ts`'s own: the signing secret is shared
 * with a public bundle, so this bounds reachability, not identity. Closing that gap
 * needs a server-side issuer (#140/#200), which is where that note lives too.
 */
export const WorkerCredentialKind = {
  /** Nothing to present; the worker skips its authorized calls. */
  NONE: 'none',
  /** The signed-in operator's session JWT. */
  STAFF: 'staff',
  /** A narrow customer capability token (the anonymous shop session). */
  CAPABILITY: 'capability',
} as const;
export type WorkerCredentialKind = (typeof WorkerCredentialKind)[keyof typeof WorkerCredentialKind];

export interface WorkerCredential {
  readonly kind: WorkerCredentialKind;
  /** `''` exactly when `kind` is `none`. */
  readonly token: string;
}

@Injectable({ providedIn: 'root' })
export class SyncSessionCredentialService {
  private readonly currentUser = inject(CurrentUserService);
  private readonly sync = inject(SyncService);

  /**
   * The credential the worker should be presenting right now — the signed-in
   * operator's JWT, or `''` when there is no session.
   *
   * `''` and not `undefined`: the worker reads "no credential" off a blank string
   * and omits the header entirely, which is a cleaner denial to debug than
   * `Bearer undefined`.
   */
  private readonly staffToken = computed<string>(
    () => this.currentUser.session()?.accessToken ?? ''
  );

  /** The capability token holding the worker's slot, or null when none is active. */
  private readonly capabilityToken = signal<string | null>(null);

  /** The arbitration itself — see "Which credential wins" above. */
  readonly workerCredential = computed<WorkerCredential>(() => {
    const capability = this.capabilityToken();
    if (capability) return { kind: WorkerCredentialKind.CAPABILITY, token: capability };
    const staff = this.staffToken();
    return staff
      ? { kind: WorkerCredentialKind.STAFF, token: staff }
      : { kind: WorkerCredentialKind.NONE, token: '' };
  });

  readonly token = computed<string>(() => this.workerCredential().token);

  /**
   * Whether the worker is presenting a staff session. Writes back to pos-api (the
   * product outbox) need one: a capability token is read-only by design, so a push
   * under it would only collect a 403 and burn a retry.
   */
  readonly carriesStaffCredential = computed(
    () => this.workerCredential().kind === WorkerCredentialKind.STAFF
  );

  /**
   * The value the worker already has. Seeded at construction because `app.config.ts`
   * passes `token()` straight into `SyncService.start()`, so the boot value is
   * already in the worker's config and re-posting it would be a redundant message on
   * every reload.
   */
  private lastPushed: string = this.token();

  constructor() {
    effect(() => this.pushIfChanged(this.token()));
  }

  /**
   * Give the worker's credential slot to a capability session until
   * `releaseCapability()`. Pushed synchronously rather than left to the effect so
   * the worker already carries it when the caller's next message (a push, a pull)
   * reaches it — effects only run at the next change-detection pass.
   */
  holdCapability(token: string): void {
    this.capabilityToken.set(token);
    this.pushIfChanged(this.token());
  }

  /** Hand the slot back: the worker carries the staff token again, or `''`. */
  releaseCapability(): void {
    this.capabilityToken.set(null);
    this.pushIfChanged(this.token());
  }

  private pushIfChanged(token: string): void {
    if (token === this.lastPushed) return;
    this.lastPushed = token;
    this.sync.updateConfig({ sessionToken: token });
  }
}
