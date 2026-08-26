import {
  AfterViewInit,
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  OnDestroy,
  ViewChild,
  effect,
  inject,
  signal,
} from '@angular/core';
import { Router } from '@angular/router';
import { ClerkFacade } from '@core/application/facades/clerk.facade';
import { CameraService } from '@core/infrastructure/media/camera.service';
import { CapybaraStageComponent } from '@features/clerk/components/capybara-stage.component';
import { ClerkHudComponent } from '@features/clerk/components/clerk-hud.component';
import { environment } from '../../../environments/environment';

/** Where the "yes, send frames" decision is remembered. */
const CONSENT_KEY = 'capy-clerk-camera-consent';

/**
 * ClerkComponent
 *
 * The full-screen stage: treated camera feed at the back, the capybara canvas
 * over it, the HUD on top. Owns the three things that are genuinely the page's
 * job — the session lifecycle, the keyboard, and the route out — and delegates
 * every decision to `ClerkFacade`.
 *
 * It renders `fixed inset-0` and covers the app's navigation on purpose: this is
 * a mode, not a screen you glance at, and a nav bar under a live camera invites
 * the misclick that ends a scan mid-item. "Back to POS" is the only way out, plus
 * Escape.
 *
 * Every voice command has a key (listed in the footer). Voice is the fast path,
 * not the only path — the mic can be off, unsupported, or in a room too loud to
 * use, and the clerk has to keep working in all three cases.
 */
@Component({
  selector: 'app-clerk',
  standalone: true,
  imports: [CapybaraStageComponent, ClerkHudComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './clerk.component.html',
  styleUrl: './clerk.component.scss',
})
export class ClerkComponent implements AfterViewInit, OnDestroy {
  @ViewChild('feed', { static: true })
  private readonly feedRef!: ElementRef<HTMLVideoElement>;

  protected readonly clerk = inject(ClerkFacade);
  protected readonly camera = inject(CameraService);
  private readonly router = inject(Router);

  /**
   * Whether the operator still has to agree to frames leaving the device.
   *
   * Only asked when `aiVision` is on. On the offline recognizer nothing is
   * transmitted, so there is nothing to consent to and a dialog would be theatre.
   */
  protected readonly needsConsent = signal(
    environment.features.aiVision && readConsent() === false
  );

  /** "Clear the glass" — drop the atmospheric treatment on the main feed. */
  protected readonly clearGlass = signal(false);

  private lastCheckoutToken = 0;

  constructor() {
    // Voice checkout. The facade bumps a counter; navigation is the page's job.
    effect(() => {
      const token = this.clerk.checkoutRequested();
      if (token > this.lastCheckoutToken) {
        this.lastCheckoutToken = token;
        this.goToCheckout();
      }
    });
  }

  ngAfterViewInit(): void {
    this.camera.attach(this.feedRef.nativeElement);
    window.addEventListener('keydown', this.onKeyDown);
    if (!this.needsConsent()) {
      void this.clerk.start();
    }
  }

  ngOnDestroy(): void {
    window.removeEventListener('keydown', this.onKeyDown);
    // Always release the camera and mic on the way out. A till that keeps
    // filming after the cashier has navigated away is a real problem, not a leak.
    this.clerk.stop();
  }

  protected acceptConsent(): void {
    writeConsent();
    this.needsConsent.set(false);
    void this.clerk.start();
  }

  protected exit(): void {
    void this.router.navigate(['/pos']);
  }

  /**
   * Hand off to the terminal's checkout overlay.
   *
   * Checkout lives in `/pos` as an overlay rather than a route, so the clerk asks
   * for it with a query parameter instead of duplicating the payment flow.
   */
  protected goToCheckout(): void {
    void this.router.navigate(['/pos'], { queryParams: { checkout: 1 } });
  }

  protected toggleGlass(): void {
    this.clearGlass.update((clear) => !clear);
  }

  /**
   * Keyboard equivalents for every voice command.
   *
   * Bound on `window` rather than the host so they work regardless of what has
   * focus — a cashier with both hands on stock is not going to tab to a button.
   * Modifier combinations are left alone so browser shortcuts keep working.
   */
  private readonly onKeyDown = (event: KeyboardEvent): void => {
    if (event.metaKey || event.ctrlKey || event.altKey) {
      return;
    }

    switch (event.key.toLowerCase()) {
      case 'escape':
        this.exit();
        return;
      case 'y':
        this.clerk.confirmTop();
        break;
      case 'n':
        this.clerk.reject();
        break;
      case '1':
      case '2':
      case '3':
        this.clerk.chooseCandidate(Number(event.key));
        break;
      case 'u':
        this.clerk.undoLast();
        break;
      case 'm':
        this.clerk.toggleMic();
        break;
      case 'q':
        this.clerk.toggleMute();
        break;
      case 't':
        this.clerk.speakTotal();
        break;
      case 'c':
        void this.clerk.cycleCamera();
        break;
      case 'v':
        void this.clerk.toggleCamera();
        break;
      case 'a':
        this.clerk.toggleAi();
        break;
      case 'r':
        this.clerk.repeatLast();
        break;
      case 'x':
        this.clerk.dismiss();
        break;
      case 'h':
        this.clerk.speakHelp();
        break;
      default:
        return;
    }
    event.preventDefault();
  };
}

function readConsent(): boolean {
  try {
    return localStorage.getItem(CONSENT_KEY) === 'granted';
  } catch {
    // Private mode or blocked storage: ask every time rather than assume yes.
    return false;
  }
}

function writeConsent(): void {
  try {
    localStorage.setItem(CONSENT_KEY, 'granted');
  } catch {
    // Not being able to remember the answer is survivable; asking again is fine.
  }
}
