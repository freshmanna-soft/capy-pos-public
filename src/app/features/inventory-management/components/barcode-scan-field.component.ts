import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  ElementRef,
  ViewChild,
  computed,
  inject,
  input,
  output,
  signal,
} from '@angular/core';
import { FormsModule } from '@angular/forms';
import { CameraService } from '@core/infrastructure/media/camera.service';
import { BarcodeScannerService } from '@core/infrastructure/media/barcode-scanner.service';
import { pickPresentedCode } from '@core/infrastructure/media/barcode-gate';
import { describeBarcode } from '@core/domain/utils/barcode';
import { BadgeComponent } from '@shared/ui/atoms/badge/badge.component';
import { ButtonComponent } from '@shared/ui/atoms/button/button.component';
import { InputComponent } from '@shared/ui/atoms/input/input.component';

/** How often to ask the decoder for a look. */
const POLL_INTERVAL_MS = 150;

/**
 * Give up after this long and release the camera.
 *
 * A camera left running because someone walked away mid-registration is both a
 * privacy problem and a battery one, and the person who comes back has no idea
 * how long it has been on.
 */
const SCAN_TIMEOUT_MS = 25_000;

type ScanState = 'idle' | 'starting' | 'scanning' | 'failed';

/**
 * BarcodeScanFieldComponent
 *
 * The barcode field on the product form: typed, scanned by camera, or fired in by
 * a hardware gun. All three routes land in the same field and are compared the same
 * way, because the value is a product's identity and the till will trust it
 * absolutely.
 *
 * Three decisions worth keeping:
 *
 * **Its own `CameraService`.** The service is `providedIn: 'root'` and the clerk
 * holds that instance along with its attached video elements and session state.
 * A component-level provider gives this dialog an independent one, so opening the
 * scanner cannot disturb a clerk session or inherit its stream.
 *
 * **`start()` and `stop()` only — never `select()`.** The remembered-camera key is
 * module level, shared across every instance, so selecting a device here would
 * silently change which camera the *clerk* opens next time. Whatever the browser
 * hands us is good enough to read a barcode held up to it.
 *
 * **A hardware gun's Enter is swallowed.** Guns type their digits and press Enter.
 * Left alone that Enter would submit the form with nothing in it but a barcode.
 * This field always consumes Enter and treats it as "code complete" instead — a
 * fixed rule rather than a guess at typing speed, because a heuristic that mistakes
 * a fast typist for a scanner fails in exactly the situation it was added for.
 *
 * **What is emitted is what arrived.** Not the normalized form — the till indexes
 * `product.barcode` verbatim and looks up the raw string the decoder reports, which
 * for a UPC-E is the 8-digit compressed code. Saving the expanded 12-digit
 * equivalent would leave every UPC-E product unscannable at the counter. The
 * canonical form is used to *describe* the code and to compare it against the
 * catalogue, never to decide what to store.
 */
@Component({
  selector: 'app-barcode-scan-field',
  standalone: true,
  imports: [FormsModule, InputComponent, ButtonComponent, BadgeComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  // An instance of its own; see the class comment.
  providers: [CameraService],
  template: `
    <div class="flex flex-col gap-2">
      <app-input
        id="barcode"
        label="Barcode"
        type="text"
        inputMode="numeric"
        autocomplete="off"
        testId="input-barcode"
        placeholder="Scan, or type the digits"
        [error]="error()"
        [hint]="error() ? '' : hint()"
        [ngModel]="value()"
        [ngModelOptions]="{ standalone: true }"
        (ngModelChange)="onTyped($event)"
        (keydown.enter)="onEnter($event)"
      >
        @if (canScan()) {
          <app-button
            inputAction
            variant="secondary"
            size="sm"
            [testId]="scanning() ? 'btn-scan-cancel' : 'btn-scan'"
            [ariaLabel]="scanning() ? 'Stop scanning' : 'Scan barcode with the camera'"
            (clicked)="toggleScan()"
          >
            {{ scanning() ? 'Stop' : '📷 Scan' }}
          </app-button>
        }
      </app-input>

      @if (state() === 'scanning' || state() === 'starting') {
        <div
          class="overflow-hidden rounded-lg border border-gray-300 bg-gray-900"
          data-testid="barcode-scan-preview"
        >
          <video
            #preview
            class="block aspect-video w-full object-cover"
            muted
            playsinline
            autoplay
            aria-hidden="true"
          ></video>
          <p class="px-3 py-2 text-xs text-gray-300" aria-live="polite">
            {{
              state() === 'starting' ? 'Starting the camera…' : 'Hold the barcode up to the camera'
            }}
          </p>
        </div>
      }

      @if (state() === 'failed') {
        <p class="text-sm text-amber-700" role="status" data-testid="barcode-scan-failed">
          {{ failure() }}
        </p>
      }

      <!-- What the code in the field appears to be. A mistyped digit is invisible
           in a row of thirteen; naming the format and flagging a bad check digit
           is what makes it findable. -->
      @if (status(); as chip) {
        <div class="flex items-center gap-2">
          <app-badge [variant]="chip.variant" data-testid="barcode-status">{{
            chip.label
          }}</app-badge>
          @if (duplicateName()) {
            <button
              type="button"
              class="text-sm font-medium text-blue-700 underline"
              (click)="openDuplicate.emit()"
              data-testid="btn-open-duplicate"
            >
              Open {{ duplicateName() }}
            </button>
          }
        </div>
      }
    </div>
  `,
})
export class BarcodeScanFieldComponent {
  private readonly camera = inject(CameraService);
  private readonly scanner = inject(BarcodeScannerService);

  @ViewChild('preview')
  private set previewRef(ref: ElementRef<HTMLVideoElement> | undefined) {
    // The element only exists while the panel is open, so it is taken the moment it
    // appears rather than in a lifecycle hook that has already run by then.
    this.preview = ref?.nativeElement ?? null;
    this.bindPreview();
  }

  private preview: HTMLVideoElement | null = null;

  /**
   * Point the camera at the preview element, in whichever order they arrive.
   *
   * `attach()` only assigns `srcObject` if a stream already exists, and it never
   * calls `play()` — that happens inside the service's own `open()`, and only for an
   * element that was already attached. So attaching after the stream opens leaves a
   * video with no pixels, `videoWidth` stuck at 0, and a decode loop that returns
   * "frame not examined" forever: a silent hang indistinguishable from "no barcode
   * found". Calling this from both sides removes the race.
   */
  private bindPreview(): void {
    if (!this.preview) {
      return;
    }
    this.camera.attach(this.preview);
    void this.preview.play().catch(() => undefined);
  }

  readonly value = input('');
  /** A blocking problem with this code — a duplicate. Shown in place of the hint. */
  readonly error = input('');
  /** The product this code already belongs to, if any. */
  readonly duplicateName = input<string | null>(null);

  readonly valueChange = output<string>();
  readonly openDuplicate = output<void>();

  private readonly _state = signal<ScanState>('idle');
  private readonly _failure = signal('');
  private readonly _detectorReady = signal(false);

  protected readonly state = this._state.asReadonly();
  protected readonly failure = this._failure.asReadonly();
  protected readonly scanning = computed(
    () => this._state() === 'scanning' || this._state() === 'starting'
  );

  /**
   * Whether to offer camera scanning at all.
   *
   * `BarcodeDetector` is Chromium-only and absent on Safari, Firefox and Chromium
   * on Windows and Linux, and `supported` stays false until `prepare()` has
   * actually resolved. Offering a button that cannot work is worse than not
   * offering one — typing the digits always works.
   */
  protected readonly canScan = computed(() => this._detectorReady() && this.scanner.supported());

  protected readonly status = computed<{ label: string; variant: BadgeVariant } | null>(() => {
    if (this.duplicateName()) {
      return { label: 'Already registered', variant: 'danger' };
    }
    const raw = this.value().trim();
    if (raw.length === 0) {
      return null;
    }
    const described = describeBarcode(raw);
    if (described.uncheckable) {
      return { label: 'Custom code', variant: 'secondary' };
    }
    return described.valid
      ? { label: `${FORMAT_LABELS[described.kind]} · checks out`, variant: 'success' }
      : { label: `${FORMAT_LABELS[described.kind]} · check digit looks wrong`, variant: 'warning' };
  });

  protected readonly hint = computed(() =>
    this.canScan() ? '' : 'Type the digits, or use a scanner gun'
  );

  private poll: ReturnType<typeof setTimeout> | null = null;
  private deadline: ReturnType<typeof setTimeout> | null = null;

  constructor() {
    // Asked once, up front: `supported` is false until the detector has actually
    // been built, so the button would otherwise never appear.
    void this.scanner.prepare().then((ready) => this._detectorReady.set(ready));

    // The camera must not outlive the field under any exit — cancelling, saving,
    // closing the dialog, or navigating away mid-scan.
    inject(DestroyRef).onDestroy(() => this.teardown());
  }

  protected onTyped(next: string | number | null): void {
    this.valueChange.emit(next === null ? '' : String(next));
  }

  /**
   * Enter inside the barcode field never submits.
   *
   * This is what makes a scanner gun safe: its trailing Enter would otherwise save
   * a product whose only filled field is the barcode.
   */
  protected onEnter(event: Event): void {
    event.preventDefault();
    // Trimmed, not normalized — a gun sometimes appends whitespace, but the digits
    // themselves are the identity and are stored exactly as scanned.
    this.valueChange.emit(this.value().trim());
  }

  protected toggleScan(): void {
    if (this.scanning()) {
      this.teardown();
      this._state.set('idle');
      return;
    }
    void this.startScan();
  }

  private async startScan(): Promise<void> {
    this._failure.set('');
    this._state.set('starting');

    // `start`, never `select`: see the class comment on the shared preference key.
    if (!(await this.camera.start())) {
      this._state.set('failed');
      // The service's own wording for a busy device is "Another app is using the
      // camera", which is misleading when the other app is this same POS with the
      // clerk view open — the one thing the person can actually act on.
      this._failure.set(
        this.camera.status() === 'error'
          ? 'The camera is in use. Close the Capy Clerk view if it is open, or type the barcode.'
          : this.camera.message() || 'The camera did not start.'
      );
      return;
    }

    this._state.set('scanning');
    this.bindPreview();
    this.scheduleTick();
    this.deadline = setTimeout(() => {
      this.teardown();
      this._state.set('failed');
      this._failure.set("I couldn't read a barcode. Try again, or type the digits.");
    }, SCAN_TIMEOUT_MS);
  }

  /**
   * One look per completed decode, rather than one per fixed interval.
   *
   * A decode can take longer than the interval, and re-arming only after the
   * previous attempt finished means we never queue work the decoder will refuse.
   */
  private scheduleTick(): void {
    this.poll = setTimeout(() => void this.tick(), POLL_INTERVAL_MS);
  }

  private async tick(): Promise<void> {
    this.poll = null;
    if (this._state() !== 'scanning') {
      return;
    }

    const video = this.camera.detectionSource();
    if (!video) {
      this.scheduleTick();
      return;
    }

    const found = await this.scanner.detect(video);
    // Null means this frame was never examined — a decode was already in flight, or
    // the video had no pixels yet. That is not "no barcode here", so it must not
    // end the scan; an empty array means examined-and-nothing, which also just
    // means keep looking.
    if (found === null || found.length === 0) {
      this.scheduleTick();
      return;
    }

    // The same rule the till uses: ignore codes too small to be deliberate — a
    // barcode on a poster across the room is not what is being registered — and
    // pick the largest when several are in view.
    const presented = pickPresentedCode(found);
    if (!presented) {
      this.scheduleTick();
      return;
    }

    this.teardown();
    this._state.set('idle');
    // Verbatim: see the note on storage in the class comment.
    this.valueChange.emit(presented.value);
  }

  /** Release the camera and both timers. Safe to call more than once. */
  private teardown(): void {
    if (this.poll !== null) {
      clearTimeout(this.poll);
      this.poll = null;
    }
    if (this.deadline !== null) {
      clearTimeout(this.deadline);
      this.deadline = null;
    }
    this.camera.stop();
  }
}

type BadgeVariant = 'primary' | 'secondary' | 'success' | 'warning' | 'danger' | 'info';

const FORMAT_LABELS: Record<string, string> = {
  ean13: 'EAN-13',
  ean8: 'EAN-8',
  upca: 'UPC-A',
  upce: 'UPC-E',
  gtin14: 'ITF-14',
  other: 'Custom code',
};
