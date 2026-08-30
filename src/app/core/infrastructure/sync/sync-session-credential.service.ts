import { Injectable, computed, effect, inject } from '@angular/core';
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
 * It also does not narrow what the token can do. The claim set is whatever the till
 * minted, and the ceiling is `session-auth.ts`'s own: the signing secret is shared
 * with a public bundle, so this bounds reachability, not identity. Closing that gap
 * needs a server-side issuer (#140/#200), which is where that note lives too.
 */
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
  readonly token = computed<string>(() => this.currentUser.session()?.accessToken ?? '');

  /**
   * The value the worker already has. Seeded at construction because `app.config.ts`
   * passes `token()` straight into `SyncService.start()`, so the boot value is
   * already in the worker's config and re-posting it would be a redundant message on
   * every reload.
   */
  private lastPushed: string = this.token();

  constructor() {
    effect(() => {
      const token = this.token();
      if (token === this.lastPushed) {
        return;
      }

      this.lastPushed = token;
      this.sync.updateConfig({ sessionToken: token });
    });
  }
}
