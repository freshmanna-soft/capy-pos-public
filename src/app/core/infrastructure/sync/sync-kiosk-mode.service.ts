import { Injectable, inject } from '@angular/core';
import { Router, NavigationEnd } from '@angular/router';
import { filter } from 'rxjs/operators';
import { SyncService } from './sync.service';

/**
 * SyncKioskModeService
 *
 * Keeps the sync worker's `kioskMode` flag in step with the current route.
 *
 * ## Why this exists
 *
 * When a customer shops anonymously on a kiosk terminal or their own phone, the
 * sync worker has no operator session JWT.  Attempting to push stock decrements
 * therefore always hits `refuseUnauthorizedPush`, which emits a `console.warn`
 * by default.  That warn is technically correct but alarming: the absence of a
 * session is *expected* in kiosk/shop context — stock will flush on the next
 * authorised staff login.
 *
 * Routing to `/kiosk/*` or `/shop*` sets `kioskMode: true` on the worker so the
 * log is downgraded to `console.info`.  Leaving those routes resets the flag to
 * `false` so the warn returns for the regular POS terminal.
 *
 * ## Pattern
 *
 * Mirrors `SyncSessionCredentialService`: watch a reactive signal / stream that
 * changes at the right moment and push a partial `UPDATE_CONFIG` to the worker.
 */
@Injectable({ providedIn: 'root' })
export class SyncKioskModeService {
  private readonly router = inject(Router);
  private readonly sync = inject(SyncService);

  /** Routes that are considered kiosk/shop context. */
  private static readonly KIOSK_PREFIXES = ['/kiosk', '/shop'];

  private lastPushed: boolean | undefined = undefined;

  /** Initial mode for SyncService.start(), before a worker exists to receive updates. */
  get initialKioskMode(): boolean {
    return this.lastPushed ?? false;
  }

  constructor() {
    // A direct load of /shop or /kiosk can happen after the router has already
    // emitted its initial NavigationEnd. Seed from the current URL so the
    // worker cannot start with kioskMode=false and make one staff-only pull.
    this.pushModeForUrl(this.router.url);

    this.router.events
      .pipe(filter((e): e is NavigationEnd => e instanceof NavigationEnd))
      .subscribe((e) => this.pushModeForUrl(e.urlAfterRedirects));
  }

  private pushModeForUrl(url: string): void {
    const kioskMode = SyncKioskModeService.KIOSK_PREFIXES.some((prefix) => url.startsWith(prefix));

    if (kioskMode === this.lastPushed) return;

    this.lastPushed = kioskMode;
    this.sync.updateConfig({ kioskMode });
  }
}
