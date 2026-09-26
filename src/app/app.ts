import { Component, ChangeDetectionStrategy, inject, computed } from '@angular/core';
import { RouterOutlet, Router, NavigationEnd } from '@angular/router';
import { toSignal } from '@angular/core/rxjs-interop';
import { filter, map, startWith } from 'rxjs';
import { NavigationComponent } from '@shared/ui/organisms/navigation/navigation.component';
import { ToastContainerComponent } from '@shared/ui/toast/toast-container.component';
import { SessionExpiryWarningComponent } from '@shared/ui/session-expiry/session-expiry-warning.component';
import { CurrentUserService } from '@core/application/auth/current-user.service';

/** Routes that render full-screen without the staff nav shell. */
const SHELL_LESS_PREFIXES = ['/kiosk', '/shop', '/login'];

function isShellLess(url: string): boolean {
  return SHELL_LESS_PREFIXES.some(
    (p) => url === p || url.startsWith(p + '/') || url.startsWith(p + '?')
  );
}

@Component({
  selector: 'app-root',
  imports: [
    RouterOutlet,
    NavigationComponent,
    ToastContainerComponent,
    SessionExpiryWarningComponent,
  ],
  templateUrl: './app.html',
  styleUrl: './app.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class App {
  private readonly router = inject(Router);
  private readonly currentUser = inject(CurrentUserService);

  /** The current URL as a signal — updates on every NavigationEnd. */
  private readonly currentUrl = toSignal(
    this.router.events.pipe(
      filter((e): e is NavigationEnd => e instanceof NavigationEnd),
      map((e) => e.urlAfterRedirects),
      startWith(this.router.url)
    ),
    { initialValue: this.router.url }
  );

  /**
   * True when the staff nav shell should be shown:
   * - route is NOT a full-screen customer/public route (/kiosk, /shop, /login)
   * - AND the operator is authenticated
   */
  readonly showShell = computed(
    () => !isShellLess(this.currentUrl()) && this.currentUser.isAuthenticated()
  );
}
