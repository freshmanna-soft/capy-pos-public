import { Component, ChangeDetectionStrategy, inject } from '@angular/core';
import { RouterOutlet, Router, NavigationEnd } from '@angular/router';
import { toSignal } from '@angular/core/rxjs-interop';
import { filter, map, startWith } from 'rxjs';
import { NavigationComponent } from '@shared/ui/organisms/navigation/navigation.component';
import { ToastContainerComponent } from '@shared/ui/toast/toast-container.component';
import { SessionExpiryWarningComponent } from '@shared/ui/session-expiry/session-expiry-warning.component';

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

  /** True on /kiosk and /kiosk/shop — suppresses the staff shell chrome. */
  readonly isKioskRoute = toSignal(
    this.router.events.pipe(
      filter((e): e is NavigationEnd => e instanceof NavigationEnd),
      map((e) => e.urlAfterRedirects.startsWith('/kiosk')),
      startWith(this.router.url.startsWith('/kiosk'))
    ),
    { initialValue: this.router.url.startsWith('/kiosk') }
  );
}
