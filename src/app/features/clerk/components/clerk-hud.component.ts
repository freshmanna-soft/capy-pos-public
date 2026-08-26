import {
  AfterViewInit,
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  ViewChild,
  inject,
  output,
} from '@angular/core';
import { CurrencyPipe } from '@angular/common';
import { ClerkFacade, UNDO_WINDOW_MS } from '@core/application/facades/clerk.facade';
import { PosFacade } from '@core/application/facades/pos.facade';
import { CameraService } from '@core/infrastructure/media/camera.service';

/**
 * ClerkHudComponent
 *
 * Everything readable on the clerk stage. Deliberately DOM rather than canvas:
 * this is the layer that has to be focusable, translatable, selectable, and
 * legible to a screen reader. The canvas underneath carries no text at all, so
 * the interface still works with the animation switched off entirely.
 *
 * Three states share the lower half of the screen and never overlap — what she
 * said, what she wants you to choose between, or what went wrong. Fighting for
 * that space is what makes camera UIs unreadable.
 */
@Component({
  selector: 'app-clerk-hud',
  standalone: true,
  imports: [CurrencyPipe],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <!-- Chrome: quiet, kelp on warm dark, so the stage keeps the attention. -->
    <header
      class="pointer-events-auto flex items-center justify-between gap-3 px-4 py-3 md:px-6"
      data-testid="clerk-chrome"
    >
      <button
        type="button"
        (click)="exit.emit()"
        class="flex min-h-[44px] items-center gap-2 rounded-full border border-kelp/30 bg-onsen-deep/70 px-4 text-sm font-medium text-steam backdrop-blur transition-colors hover:border-kelp/60 hover:bg-onsen-deep/90 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-yuzu"
        data-testid="clerk-exit"
      >
        <span aria-hidden="true">←</span>
        Back to POS
      </button>

      <p class="hidden font-data text-[10px] uppercase tracking-[0.22em] text-kelp sm:block">
        Capy Clerk
        <span class="text-kelp/60"
          >· {{ clerk.recognizerKind === 'claude' ? 'live' : 'demo' }}</span
        >
        <!-- Stated up here as well as on the button: a till that has stopped
             guessing looks identical to one that is failing to, and the difference
             matters to whoever is wondering why the apples need typing in. -->
        @if (!clerk.aiEnabled()) {
          <span class="text-tsuba" data-testid="clerk-ai-off-badge">· barcodes only</span>
        }
        <!-- Same reasoning for the voice: silence is a setting here, and it is
             remembered, so it cannot be left to look like a broken speaker. -->
        @if (clerk.muted()) {
          <span class="text-tsuba" data-testid="clerk-muted-badge">· muted</span>
        }
      </p>

      <div
        class="flex min-h-[44px] items-center gap-3 rounded-full border border-kelp/30 bg-onsen-deep/70 px-4 backdrop-blur"
        data-testid="clerk-cart-summary"
      >
        <span aria-hidden="true">🛒</span>
        <span class="font-data text-[10px] uppercase tracking-[0.16em] text-kelp">
          {{ pos.totalItems() }} {{ pos.totalItems() === 1 ? 'item' : 'items' }}
        </span>
        <span class="font-display text-lg font-bold tabular-nums text-steam">
          {{ pos.total() | currency }}
        </span>
      </div>
    </header>

    <!-- Camera column: the preview, and under it the picker. One container so the
         picker follows the preview rather than being positioned with an offset
         that has to be kept equal to the preview's height by hand. -->
    <div
      class="pointer-events-none absolute right-4 top-[68px] flex w-[150px] flex-col gap-2 md:right-6 md:w-[188px]"
    >
      <!-- What she's actually looking at. Unfiltered, because the main feed is
           styled for atmosphere and you cannot aim a camera through it. -->
      <div
        class="relative overflow-hidden rounded-xl border border-kelp/25 bg-onsen-deep/80 shadow-2xl"
        [class.ring-2]="clerk.busy()"
        [class.ring-yuzu]="clerk.busy()"
        data-testid="clerk-preview"
      >
        <video
          #preview
          class="block aspect-[4/3] w-full object-cover"
          muted
          playsinline
          autoplay
          aria-hidden="true"
        ></video>
        <!-- Laid over the video rather than replacing it: the element is bound
             once via a static ViewChild, so an @if here would drop the reference
             and the preview would never come back after one toggle. -->
        @if (!clerk.cameraEnabled()) {
          <div
            class="absolute inset-x-0 top-0 grid aspect-[4/3] place-items-center gap-1 bg-onsen-deep/95 text-center"
            data-testid="clerk-preview-off"
          >
            <span class="text-2xl" aria-hidden="true">🙈</span>
            <p class="px-2 font-data text-[9px] uppercase tracking-[0.18em] text-kelp">
              Camera off
            </p>
          </div>
        }
        <p class="relative px-2 py-1 font-data text-[9px] uppercase tracking-[0.18em] text-kelp">
          {{ clerk.busy() ? 'Reading' : hint() }}
        </p>
      </div>

      <!-- Rendered only when there is genuinely a choice: a single row reading
           "Camera 1" is noise. Scrolls rather than growing, for the rare till with
           more cameras than counter. -->
      <!-- Hidden while the camera is off: picking a row calls getUserMedia, which
           would turn the light back on behind the operator's back. -->
      @if (clerk.hasCameraChoice() && clerk.cameraEnabled()) {
        <div
          class="pointer-events-auto max-h-[168px] overflow-y-auto rounded-xl border border-kelp/25 bg-onsen-deep/85 p-1 backdrop-blur"
          role="radiogroup"
          aria-label="Camera"
          data-testid="clerk-camera-picker"
        >
          @for (camera of clerk.cameras(); track camera.deviceId) {
            <button
              type="button"
              role="radio"
              [attr.aria-checked]="camera.deviceId === clerk.activeCameraId()"
              (click)="clerk.selectCamera(camera.deviceId)"
              class="flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-[11px] font-medium transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-yuzu"
              [class]="
                camera.deviceId === clerk.activeCameraId()
                  ? 'bg-kelp/20 text-steam'
                  : 'text-kelp hover:bg-kelp/10 hover:text-steam'
              "
              data-testid="clerk-camera-option"
            >
              <span
                class="h-1.5 w-1.5 flex-shrink-0 rounded-full"
                [class]="camera.deviceId === clerk.activeCameraId() ? 'bg-yuzu' : 'bg-kelp/40'"
                aria-hidden="true"
              ></span>
              <span class="truncate">{{ camera.label }}</span>
            </button>
          }
        </div>
      }
    </div>

    <div class="mt-auto flex flex-col gap-4 px-4 pb-4 md:px-6 md:pb-6">
      @if (clerk.candidateCards().length > 0) {
        <!-- Numbered because the number IS the command: say "two", or press 2. -->
        <ul
          class="pointer-events-auto flex flex-wrap gap-3"
          aria-label="Which product is it?"
          data-testid="clerk-candidates"
        >
          @for (card of clerk.candidateCards(); track card.productId) {
            <li class="min-w-[168px] flex-1 sm:max-w-[260px]">
              <button
                type="button"
                (click)="clerk.chooseCandidate(card.position)"
                class="flex w-full flex-col gap-1 rounded-2xl border border-steam/15 bg-onsen-water/85 p-3 text-left backdrop-blur transition-transform hover:-translate-y-0.5 hover:border-yuzu/60 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-yuzu"
                [attr.data-testid]="'clerk-candidate-' + card.position"
              >
                <span class="flex items-center gap-2">
                  <span
                    class="grid h-6 w-6 place-items-center rounded-full bg-yuzu font-data text-[11px] font-bold text-onsen-deep"
                    aria-hidden="true"
                    >{{ card.position }}</span
                  >
                  <span class="font-display text-base font-bold leading-tight text-steam">
                    {{ card.emoji ? card.emoji + ' ' : '' }}{{ card.label }}
                  </span>
                </span>
                <span class="flex items-baseline justify-between gap-2">
                  <span class="font-data text-[10px] uppercase tracking-[0.16em] text-kelp">{{
                    card.sku
                  }}</span>
                  <span class="font-display text-xl font-extrabold tabular-nums text-steam">{{
                    card.price | currency
                  }}</span>
                </span>
                <span class="font-data text-[10px] uppercase tracking-[0.16em] text-kelp/70">
                  Confidence {{ percent(card.confidence) }}%
                </span>
              </button>
            </li>
          }
        </ul>
        <button
          type="button"
          (click)="clerk.reject()"
          class="pointer-events-auto self-start rounded-full border border-tsuba/40 px-4 py-2 text-sm font-medium text-tsuba transition-colors hover:bg-tsuba/10 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-yuzu"
          data-testid="clerk-reject"
        >
          None of these
        </button>
      } @else if (clerk.caption()) {
        <p
          class="max-w-xl rounded-2xl rounded-bl-sm border border-steam/10 bg-onsen-water/80 px-5 py-3 font-display text-xl font-semibold leading-snug text-steam backdrop-blur md:text-2xl"
          data-testid="clerk-caption"
        >
          {{ clerk.caption() }}
        </p>
      }

      <!-- Controls. Every one of these also has a key, listed in the shell. -->
      <div class="pointer-events-auto flex flex-wrap items-center gap-3">
        @if (clerk.pendingAdd(); as pending) {
          <button
            type="button"
            (click)="clerk.undoLast()"
            class="relative flex min-h-[44px] items-center gap-2 overflow-hidden rounded-full border border-tsuba bg-tsuba/15 px-5 text-sm font-semibold text-steam focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-yuzu"
            data-testid="clerk-undo"
          >
            <!-- The bar draining is the timer; a number alone reads as a countdown
                 to something bad rather than a window closing. -->
            <span
              class="absolute inset-y-0 left-0 bg-tsuba/35"
              [style.width.%]="undoProgress()"
              aria-hidden="true"
            ></span>
            <span class="relative"
              >Undo {{ pending.quantity > 1 ? pending.quantity + ' × ' : ''
              }}{{ pending.label }}</span
            >
            <span class="relative font-data text-[10px] tabular-nums text-steam/70"
              >{{ clerk.undoSecondsLeft() }}s</span
            >
          </button>
        }

        <!-- Nothing said yet is nothing to repeat, so the button follows the same
             signal the caption bubble does rather than offering a no-op. -->
        @if (clerk.caption()) {
          <button
            type="button"
            (click)="clerk.repeatLast()"
            class="flex min-h-[44px] items-center gap-2 rounded-full border border-kelp/40 bg-onsen-deep/70 px-5 text-sm font-semibold text-kelp transition-colors hover:border-kelp focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-yuzu"
            data-testid="clerk-repeat"
          >
            Say that again
          </button>
        }

        <!-- Never mind and help are answerable at any moment, so they are always
             here: gating them would add a branch that buys nothing. -->
        <button
          type="button"
          (click)="clerk.dismiss()"
          class="flex min-h-[44px] items-center gap-2 rounded-full border border-kelp/40 bg-onsen-deep/70 px-5 text-sm font-semibold text-kelp transition-colors hover:border-kelp focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-yuzu"
          data-testid="clerk-dismiss"
        >
          Never mind
        </button>

        <button
          type="button"
          (click)="clerk.speakHelp()"
          class="flex min-h-[44px] items-center gap-2 rounded-full border border-kelp/40 bg-onsen-deep/70 px-5 text-sm font-semibold text-kelp transition-colors hover:border-kelp focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-yuzu"
          data-testid="clerk-help"
        >
          What can you do?
        </button>

        @if (clerk.verdict() === 'duplicate' || clerk.verdict() === 'cooling') {
          <button
            type="button"
            (click)="clerk.scanNow()"
            class="flex min-h-[44px] items-center gap-2 rounded-full border border-kelp/40 bg-onsen-deep/70 px-5 text-sm font-semibold text-kelp transition-colors hover:border-kelp focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-yuzu"
            data-testid="clerk-look-again"
          >
            Look again
          </button>
        }

        <button
          type="button"
          (click)="clerk.toggleCamera()"
          [attr.aria-pressed]="clerk.cameraEnabled()"
          class="flex min-h-[44px] items-center gap-2 rounded-full border px-5 text-sm font-semibold transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-yuzu"
          [class]="
            clerk.cameraEnabled()
              ? 'border-kelp/40 bg-onsen-deep/70 text-kelp hover:border-kelp'
              : 'border-tsuba bg-tsuba/15 text-steam'
          "
          data-testid="clerk-camera-toggle"
        >
          <span aria-hidden="true">{{ clerk.cameraEnabled() ? '📷' : '🙈' }}</span>
          {{ clerk.cameraEnabled() ? 'Looking' : 'Camera off' }}
        </button>

        <button
          type="button"
          (click)="clerk.toggleAi()"
          [attr.aria-pressed]="clerk.aiEnabled()"
          class="flex min-h-[44px] items-center gap-2 rounded-full border px-5 text-sm font-semibold transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-yuzu"
          [class]="
            clerk.aiEnabled()
              ? 'border-kelp/40 bg-onsen-deep/70 text-kelp hover:border-kelp'
              : 'border-tsuba bg-tsuba/15 text-steam'
          "
          data-testid="clerk-ai-toggle"
        >
          <span aria-hidden="true">{{ clerk.aiEnabled() ? '✨' : '🏷️' }}</span>
          {{ clerk.aiEnabled() ? 'Recognizing' : 'Barcodes only' }}
        </button>

        @if (clerk.earSupported) {
          <button
            type="button"
            (click)="clerk.toggleMic()"
            [attr.aria-pressed]="clerk.micEnabled()"
            class="flex min-h-[44px] items-center gap-2 rounded-full border px-5 text-sm font-semibold transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-yuzu"
            [class]="
              clerk.micEnabled()
                ? 'border-yuzu bg-yuzu/15 text-steam'
                : 'border-kelp/40 bg-onsen-deep/70 text-kelp hover:border-kelp'
            "
            data-testid="clerk-mic"
          >
            <span aria-hidden="true">🎤</span>
            {{ clerk.micEnabled() ? 'Listening' : 'Talk to Capy' }}
          </button>
        }

        <!-- Muting is the one control here that outlives the session, so it has to
             read as a state rather than as an action: a cashier who finds the till
             silent on Monday needs to see that someone chose that on Friday. -->
        @if (clerk.voiceSupported) {
          <button
            type="button"
            (click)="clerk.toggleMute()"
            [attr.aria-pressed]="clerk.muted()"
            class="flex min-h-[44px] items-center gap-2 rounded-full border px-5 text-sm font-semibold transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-yuzu"
            [class]="
              clerk.muted()
                ? 'border-tsuba bg-tsuba/15 text-steam'
                : 'border-kelp/40 bg-onsen-deep/70 text-kelp hover:border-kelp'
            "
            data-testid="clerk-mute"
          >
            <span aria-hidden="true">{{ clerk.muted() ? '🔇' : '🔊' }}</span>
            {{ clerk.muted() ? 'Muted' : 'Speaking' }}
          </button>
        }

        <button
          type="button"
          (click)="checkout.emit()"
          [disabled]="pos.isCartEmpty()"
          class="flex min-h-[44px] items-center gap-2 rounded-full bg-yuzu px-5 text-sm font-bold text-onsen-deep transition-transform hover:-translate-y-0.5 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-steam disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:translate-y-0"
          data-testid="clerk-checkout"
        >
          Checkout
        </button>

        @if (clerk.micEnabled() && clerk.heard()) {
          <p class="font-data text-[10px] uppercase tracking-[0.16em] text-kelp/70">
            heard “{{ clerk.heard() }}”
          </p>
        }
      </div>
    </div>

    <!-- Captions and status for screen readers and for anyone with sound off.
         The voice is an enhancement; this is the actual channel. -->
    <p class="sr-only" aria-live="polite" data-testid="clerk-live-region">
      {{ clerk.caption() }}
    </p>
  `,
  styles: [
    `
      :host {
        display: flex;
        flex-direction: column;
        height: 100%;
        /* The stage below must stay clickable; children opt back in. */
        pointer-events: none;
      }
    `,
  ],
})
export class ClerkHudComponent implements AfterViewInit {
  @ViewChild('preview', { static: true })
  private readonly previewRef!: ElementRef<HTMLVideoElement>;

  private readonly camera = inject(CameraService);

  protected readonly clerk = inject(ClerkFacade);
  protected readonly pos = inject(PosFacade);

  /** Leave the clerk. */
  readonly exit = output<void>();
  /** Go to payment. Routing belongs to the shell, not here. */
  readonly checkout = output<void>();

  ngAfterViewInit(): void {
    // Same MediaStream, second element: a real live view rather than a still.
    this.camera.attachPreview(this.previewRef.nativeElement);
  }

  /** Remaining undo window as a percentage, for the draining bar. */
  protected undoProgress(): number {
    return Math.round((this.clerk.undoMsLeft() / UNDO_WINDOW_MS) * 100);
  }

  protected percent(confidence: number): number {
    return Math.round(confidence * 100);
  }

  /**
   * One short line under the preview explaining why she isn't looking.
   *
   * Without it, a cashier holding an item in front of a camera that is
   * deliberately waiting has no way to tell that from a camera that has hung.
   */
  protected hint(): string {
    // Checked before the gate verdict, which still reads 'warming' while off and
    // would render as "Waiting" — a camera that has been switched off is not
    // waiting for anything.
    if (!this.clerk.cameraEnabled()) {
      return 'Camera off';
    }
    // The gate verdict is frozen wherever it stopped when recognition went off, so
    // reporting it would describe a decision nothing is going to act on.
    if (!this.clerk.aiEnabled()) {
      return this.clerk.barcodeSupported() ? 'Barcodes only' : 'Not looking';
    }
    // A code is being read but has not been held long enough to count. Reported
    // before the barcode-priority line below — which is also true right now — because
    // this is the one the cashier can act on: keep it still. A deliberate wait nobody
    // is told about is indistinguishable from a reader that has failed.
    if (this.clerk.barcodeDwell() !== null) {
      return 'Hold the code';
    }
    // A code we stock is in frame, so the answer is already on its way for free and
    // the model has been told to stand down. Reported before the gate verdict,
    // which describes a frame nobody is going to pay for.
    if (this.clerk.barcodePriority()) {
      return 'Barcode first';
    }
    switch (this.clerk.verdict()) {
      case 'moving':
        return 'Hold still';
      case 'holding':
        return 'Focusing';
      case 'cooling':
        return 'Just a sec';
      case 'duplicate':
        return 'Next item';
      case 'capture':
        return 'Reading';
      default:
        return 'Waiting';
    }
  }
}
