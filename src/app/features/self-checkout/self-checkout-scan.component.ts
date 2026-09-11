import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  ElementRef,
  ViewChild,
  computed,
  inject,
  signal,
} from '@angular/core';
import { DecimalPipe } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { PosFacade } from '@core/application/facades/pos.facade';
import { ProductService } from '@core/application/services/product.service';
import { Product } from '@core/domain/entities/product.entity';
import {
  BarcodeGate,
  INSTANT_TIMING,
  pickPresentedCode,
} from '@core/infrastructure/media/barcode-gate';
import { BarcodeScannerService } from '@core/infrastructure/media/barcode-scanner.service';
import { CameraService } from '@core/infrastructure/media/camera.service';
import { ScanIndex, buildScanIndex, resolveScannedCode } from './scan-resolution';

/** How often the lane looks at a frame while the camera is open. */
const POLL_MS = 120;

/**
 * What the lane is telling the customer about their last scan.
 *
 * A discriminated union rather than three loose signals: "found this" and "never
 * heard of that code" are mutually exclusive, and holding them separately is how a
 * screen ends up showing a green confirmation above a red not-found at once.
 */
type ScanFeedback =
  | { kind: 'none' }
  | { kind: 'added'; product: Product }
  | { kind: 'not-found'; code: string }
  | { kind: 'waiting'; code: string }
  | { kind: 'unavailable'; product: Product; reason: 'out-of-stock' | 'max-stock-reached' };

/**
 * SelfCheckoutScanComponent
 *
 * The scan-to-cart panel of the customer lane: read a code, resolve it against the
 * catalogue, add it to the cart, show the cart back.
 *
 * Composed the way `/clerk` is — the screen owns its own hardware lifecycle and
 * hands every domain decision to a facade — but it reaches `PosFacade` and
 * `BarcodeScannerService` directly rather than going through `ClerkFacade`. That is
 * deliberate and load-bearing: it keeps `vision-proxy` and `clerk-agent-relay` out
 * of self-checkout's blast radius entirely, which is why the `customer` role needs
 * `PROCESS_SALE` on `pos-api` and nothing else.
 *
 * Two ways in, on purpose. The camera is an accelerator: `BarcodeDetector` is
 * Chromium-only, so a lane on Safari would have no way to scan at all if typing
 * were not always available — and the typed field doubles as the input a hardware
 * scanner gun fires into.
 *
 * Scope stops at the cart. There is no pay step and nothing is submitted to
 * `pos-api` here; a self-checkout sale needs proof of a captured payment, and that
 * decision has not been made yet.
 */
@Component({
  selector: 'app-self-checkout-scan',
  standalone: true,
  imports: [FormsModule, DecimalPipe],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './self-checkout-scan.component.html',
})
export class SelfCheckoutScanComponent {
  private readonly pos = inject(PosFacade);
  private readonly products = inject(ProductService);
  private readonly camera = inject(CameraService);
  private readonly scanner = inject(BarcodeScannerService);

  @ViewChild('preview')
  private set previewRef(ref: ElementRef<HTMLVideoElement> | undefined) {
    // The element only exists while the camera panel is open, so it is taken the
    // moment it appears rather than in a lifecycle hook that has already run.
    this.preview = ref?.nativeElement ?? null;
    this.bindPreview();
  }
  private preview: HTMLVideoElement | null = null;

  /**
   * The catalogue, indexed by comparison key.
   *
   * Held as an index rather than looked up per scan against the repository: the
   * lane has to answer a scan while the customer is still holding the item, and a
   * per-scan round trip to IndexedDB is the kind of delay that makes people scan
   * the same jar twice.
   */
  private readonly index = signal<ScanIndex>(new Map());

  /**
   * A code that arrived before the catalogue did.
   *
   * The catalogue load is a promise started in the constructor, and a hardware
   * scanner gun fires the moment a customer reaches the lane — well inside that
   * window. Resolving a scan against the empty index would report a stocked item as
   * "we don't recognise 036000291452", which sends the customer to a staffed till
   * over a race they cannot see; dropping it silently is no better. So the code is
   * held and answered as soon as there is something to answer it against.
   *
   * One slot, not a queue: it holds the item in the customer's hand. Replaying a
   * burst would empty a backlog into the basket at once, and a customer who scanned
   * twice while nothing happened is owed one of that article, not two.
   */
  private pendingCode: string | null = null;

  private readonly _catalogueReady = signal(false);
  private readonly _catalogueError = signal(false);
  private readonly _detectorReady = signal(false);
  private readonly _scanning = signal(false);
  private readonly _typed = signal('');
  private readonly _feedback = signal<ScanFeedback>({ kind: 'none' });

  protected readonly catalogueReady = this._catalogueReady.asReadonly();
  protected readonly catalogueError = this._catalogueError.asReadonly();
  protected readonly scanning = this._scanning.asReadonly();
  protected readonly typed = this._typed.asReadonly();
  protected readonly feedback = this._feedback.asReadonly();

  /**
   * The feedback slot, flattened for the template.
   *
   * Angular's `@switch` does not narrow a discriminated union, so the fields are
   * read here where the narrowing is real rather than with optional chaining in the
   * template — which would compile happily and silently render nothing the day a
   * variant loses its product.
   */
  protected readonly feedbackKind = computed(() => this._feedback().kind);
  protected readonly addedName = computed(() => {
    const feedback = this._feedback();
    return feedback.kind === 'added' ? feedback.product.name : '';
  });
  protected readonly notFoundCode = computed(() => {
    const feedback = this._feedback();
    return feedback.kind === 'not-found' ? feedback.code : '';
  });
  protected readonly waitingCode = computed(() => {
    const feedback = this._feedback();
    return feedback.kind === 'waiting' ? feedback.code : '';
  });
  protected readonly unavailableName = computed(() => {
    const feedback = this._feedback();
    return feedback.kind === 'unavailable' ? feedback.product.name : '';
  });

  protected readonly items = this.pos.cartItems;
  protected readonly totalItems = this.pos.totalItems;
  protected readonly subtotal = this.pos.subtotal;
  protected readonly tax = this.pos.tax;
  protected readonly total = this.pos.total;
  protected readonly isCartEmpty = this.pos.isCartEmpty;

  /**
   * Whether to offer camera scanning at all.
   *
   * `supported` stays false until `prepare()` has actually resolved, and offering a
   * button that cannot work is worse than not offering one.
   */
  protected readonly canScan = computed(() => this._detectorReady() && this.scanner.supported());

  /**
   * Dwell/dropout judgement for the camera path, on the instant profile.
   *
   * Bars are the only thing this lane listens to — there is no model running
   * alongside it that a longer dwell would be giving time to — but the dedupe is
   * still mandatory: a jar held up for two seconds decodes sixteen times, and
   * without the gate that is sixteen jars on the receipt.
   */
  private readonly gate = new BarcodeGate({ timing: INSTANT_TIMING });

  private poll: ReturnType<typeof setTimeout> | null = null;

  constructor() {
    void this.loadCatalogue();
    // Asked once, up front: `supported` is false until the detector has actually
    // been built, so the button would otherwise never appear.
    void this.scanner.prepare().then((ready) => this._detectorReady.set(ready));
    // The camera must not outlive the panel under any exit — finishing, walking
    // away, or the shell navigating back to the till mid-scan.
    inject(DestroyRef).onDestroy(() => this.teardown());
  }

  protected onTyped(next: string): void {
    this._typed.set(next);
  }

  /**
   * Take whatever is in the field.
   *
   * The field is cleared on every outcome including a miss, because the next thing
   * that happens is another scan into the same input and a leftover code would be
   * appended to it.
   */
  protected submitTyped(): void {
    const raw = this._typed().trim();
    if (raw.length === 0) {
      return;
    }
    this._typed.set('');
    this.accept(raw);
  }

  /** Open the camera and start looking. */
  protected async startScanning(): Promise<void> {
    if (this._scanning()) {
      return;
    }
    this._scanning.set(true);
    const opened = await this.camera.start();
    if (!opened) {
      this._scanning.set(false);
      return;
    }
    this.bindPreview();
    this.tick();
  }

  /** Close the camera. */
  protected stopScanning(): void {
    this.teardown();
  }

  protected removeItem(productId: string): void {
    this.pos.removeFromCart(productId);
  }

  /**
   * Resolve one code and act on it.
   *
   * The raw code is what is compared *through* `barcodeKey()` — never stored
   * normalized, never compared as a string. A UPC-A registered as twelve digits and
   * an EAN-13 scan of the same article are the same product, and treating them as
   * two would put one article in the cart on two lines.
   */
  private accept(raw: string): void {
    if (!this._catalogueReady()) {
      // Nothing to resolve against yet. The error banner already speaks for the
      // failed-catalogue case, so only a load still in flight is worth holding for.
      if (!this._catalogueError()) {
        this.pendingCode = raw;
        this._feedback.set({ kind: 'waiting', code: raw.trim() });
      }
      return;
    }

    const product = resolveScannedCode(this.index(), raw);
    if (product === null) {
      this._feedback.set({ kind: 'not-found', code: raw.trim() });
      return;
    }

    const result = this.pos.tryAddToCart(product);
    this._feedback.set(
      result.added
        ? { kind: 'added', product }
        : { kind: 'unavailable', product, reason: result.reason ?? 'out-of-stock' }
    );
  }

  private async loadCatalogue(): Promise<void> {
    try {
      this.index.set(buildScanIndex(await this.products.getActiveProducts()));
      this._catalogueReady.set(true);
      this.acceptPending();
    } catch {
      // A lane that cannot read the catalogue can only mislead the customer, so it
      // says so rather than reporting every scan as an unknown code.
      this._catalogueError.set(true);
      // Whoever is holding that item is being sent to a staffed till; keeping the
      // code would ring it up if the panel ever gained a retry.
      this.pendingCode = null;
    }
  }

  /** Answer the scan that beat the catalogue, now that there is an index. */
  private acceptPending(): void {
    const held = this.pendingCode;
    if (held === null) {
      return;
    }
    this.pendingCode = null;
    this.accept(held);
  }

  /**
   * Look at one frame, then queue the next look.
   *
   * A self-rescheduling timeout rather than an interval: `detect` is slower than the
   * tick, and an interval would stack looks the service can only answer with "frame
   * not examined".
   */
  private tick(): void {
    this.poll = setTimeout(() => {
      void this.examine().finally(() => {
        if (this._scanning()) {
          this.tick();
        }
      });
    }, POLL_MS);
  }

  private async examine(): Promise<void> {
    const video = this.camera.detectionSource();
    if (video === null) {
      return;
    }
    const codes = await this.scanner.detect(video);
    if (codes === null) {
      // Not examined — deliberately not the same as "examined, found nothing".
      // Feeding the gate an absence here would let a slow decode convince it a code
      // still in front of the lens had been taken away and brought back.
      return;
    }

    const presented = pickPresentedCode(codes);
    const verdict = this.gate.observe(presented?.value ?? null, performance.now());
    if (verdict === 'new' && presented) {
      this.accept(presented.value);
    }
  }

  /**
   * Point the camera at the preview element, in whichever order they arrive.
   *
   * `attach()` only assigns `srcObject` if a stream already exists and never calls
   * `play()`, so attaching after the stream opens leaves a video with no pixels and
   * a decode loop that returns "frame not examined" forever — a silent hang
   * indistinguishable from "no barcode found". Calling this from both sides removes
   * the race.
   */
  private bindPreview(): void {
    if (this.preview === null) {
      return;
    }
    this.camera.attach(this.preview);
    void this.preview.play().catch(() => undefined);
  }

  private teardown(): void {
    if (this.poll !== null) {
      clearTimeout(this.poll);
      this.poll = null;
    }
    this._scanning.set(false);
    this.camera.stop();
  }
}
