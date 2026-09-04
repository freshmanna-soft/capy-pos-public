import {
  Component,
  ChangeDetectionStrategy,
  inject,
  signal,
  computed,
  effect,
  OnDestroy,
} from '@angular/core';
import { Router } from '@angular/router';
import { CurrentUserService } from '@core/application/auth/current-user.service';

/**
 * SessionExpiryWarningComponent
 *
 * Mounted once at the application root, same pattern as `app-toast-container`.
 * Shows a countdown dialog for the last `CurrentUserService.EXPIRY_WARNING_LEAD_MS`
 * before a session's token expires — "Stay signed in" calls `refresh()`, which
 * re-arms both of `CurrentUserService`'s timers against a new, later expiry and
 * clears `expiryWarningActive()` immediately; "Sign out now" logs out manually
 * rather than waiting for the hard expiry to do it. Doing nothing lets the
 * existing expiry timer fire on its own — `SessionExpiryNavigatorService`
 * already redirects to `/login?reason=expired` when that happens, so this
 * component owns none of that path itself.
 *
 * The countdown ticks off `sessionExpiresAt()` (an exact wall-clock instant)
 * via its own one-second interval, not a value `CurrentUserService` decrements
 * for it — the same "the instant is already known, there is nothing to poll
 * for" reasoning that timer itself already follows, just rendered for a human
 * once a second instead of fired once at the one moment that matters.
 */
@Component({
  selector: 'app-session-expiry-warning',
  standalone: true,
  imports: [],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (currentUser.expiryWarningActive()) {
      <div
        class="fixed inset-0 z-[110] flex items-center justify-center bg-black/40 p-4"
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="session-expiry-title"
        data-testid="session-expiry-warning"
      >
        <div class="bg-white rounded-2xl shadow-xl max-w-sm w-full p-6 text-center">
          <h2 id="session-expiry-title" class="text-lg font-bold text-gray-900 m-0">
            Your session is about to expire
          </h2>
          <p
            class="mt-2 text-sm text-gray-600"
            aria-live="polite"
            data-testid="session-expiry-countdown"
          >
            Signing out in {{ secondsRemaining() }}s
          </p>
          <div class="mt-5 flex flex-col gap-2">
            <button
              type="button"
              class="w-full py-2.5 rounded-lg bg-blue-600 text-white font-semibold text-sm cursor-pointer border-none"
              (click)="staySignedIn()"
              [disabled]="busy()"
              data-testid="session-expiry-continue"
            >
              Stay signed in
            </button>
            <button
              type="button"
              class="w-full py-2.5 rounded-lg bg-transparent text-gray-500 font-semibold text-sm cursor-pointer border-none"
              (click)="signOutNow()"
              [disabled]="busy()"
              data-testid="session-expiry-sign-out"
            >
              Sign out now
            </button>
          </div>
        </div>
      </div>
    }
  `,
})
export class SessionExpiryWarningComponent implements OnDestroy {
  protected readonly currentUser = inject(CurrentUserService);
  private readonly router = inject(Router);

  protected readonly busy = signal(false);

  /** Ticks once a second only while the warning is showing — no interval running the rest of the time. */
  private readonly nowTick = signal(Date.now());
  private tickTimer: ReturnType<typeof setInterval> | null = null;

  protected readonly secondsRemaining = computed(() => {
    const expiresAt = this.currentUser.sessionExpiresAt();
    if (!expiresAt) return 0;
    const remainingMs = new Date(expiresAt).getTime() - this.nowTick();
    return Math.max(0, Math.ceil(remainingMs / 1000));
  });

  constructor() {
    effect(() => {
      if (this.currentUser.expiryWarningActive()) {
        this.startTicking();
      } else {
        this.stopTicking();
      }
    });
  }

  ngOnDestroy(): void {
    this.stopTicking();
  }

  protected async staySignedIn(): Promise<void> {
    this.busy.set(true);
    try {
      await this.currentUser.refresh();
    } catch {
      // A failed refresh leaves the warning showing (still authenticated, still
      // counting down) — the hard-expiry timer underneath is the real backstop,
      // not this dialog, so there is nothing else to do here.
    } finally {
      this.busy.set(false);
    }
  }

  protected async signOutNow(): Promise<void> {
    this.busy.set(true);
    try {
      await this.currentUser.logout('manual');
      await this.router.navigate(['/login']);
    } finally {
      this.busy.set(false);
    }
  }

  private startTicking(): void {
    if (this.tickTimer !== null) return;
    this.nowTick.set(Date.now());
    this.tickTimer = setInterval(() => this.nowTick.set(Date.now()), 1000);
  }

  private stopTicking(): void {
    if (this.tickTimer !== null) {
      clearInterval(this.tickTimer);
      this.tickTimer = null;
    }
  }
}
