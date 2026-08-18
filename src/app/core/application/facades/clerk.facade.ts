import { Injectable, computed, effect, inject, signal } from '@angular/core';
import { CatalogHint, VisionCandidate } from '@core/application/dtos/recognition.dto';
import { VISION_RECOGNIZER } from '@core/application/ports/vision-recognizer.port';
import { PosFacade } from '@core/application/facades/pos.facade';
import { ProductService } from '@core/application/services/product.service';
import {
  AUTO_ADD_CONFIDENCE,
  CONSIDER_CONFIDENCE,
} from '@core/application/services/candidate-ranking';
import {
  RecognitionLogService,
  RecognitionTier,
} from '@core/application/services/recognition-log.service';
import { parseClerkIntent } from '@core/application/services/voice-intent.parser';
import { CameraService } from '@core/infrastructure/media/camera.service';
import {
  BarcodeGate,
  ScannedCode,
  pickPresentedCode,
} from '@core/infrastructure/media/barcode-gate';
import { BarcodeScannerService } from '@core/infrastructure/media/barcode-scanner.service';
import { FrameGate, GateVerdict } from '@core/infrastructure/media/frame-gate';
import { EventBusService } from '@core/infrastructure/messaging/event-bus.service';
import { EventSource, EventType, busEvent } from '@core/infrastructure/messaging/event-bus.events';
import { SpeechRecognitionService } from '@core/infrastructure/voice/speech-recognition.service';
import { SpeechSynthesisService } from '@core/infrastructure/voice/speech-synthesis.service';
import { TelemetryService } from '@core/infrastructure/telemetry/telemetry.service';
import { Product } from '@core/domain/entities/product.entity';
import {
  CodeOverlay,
  ClerkVisualState,
  ScanProgress,
} from '@features/clerk/canvas/capybara-renderer';

/**
 * Thresholds live with the ranking rules that enforce them, in
 * `candidate-ranking.ts`. Re-exported here because this is where callers expect
 * them and moving the import would be churn for its own sake.
 */
export { AUTO_ADD_CONFIDENCE, CONSIDER_CONFIDENCE };

/** How long an auto-added item stays reversible. */
export const UNDO_WINDOW_MS = 4000;

/** Motion sampling cadence. 8Hz is ample for settle detection and nearly free. */
const SAMPLE_INTERVAL_MS = 125;

/** Whether the camera is up and the clerk is working. */
export type ClerkPhase = 'off' | 'starting' | 'ready' | 'blocked';

/** An auto-added item, held for the length of the undo window. */
export interface PendingAdd {
  productId: string;
  label: string;
}

/**
 * ClerkFacade
 *
 * Runs the clerk: camera in, recognition out, cart written, capybara posed,
 * voice heard and spoken. The component below it renders signals and forwards
 * gestures; every decision lives here.
 *
 * Two design commitments worth stating.
 *
 * **The cart is not reimplemented.** Every add goes through
 * `PosFacade.tryAddToCart`, so stock validation, the `cart.item.added` event, the
 * audit trail, and the totals are the same code path as the manual terminal. A
 * clerk that wrote to `CartService` directly would drift from `/pos` the first
 * time either changed, and would silently sell stock that isn't there.
 *
 * **Recognition is gated three ways**, and the gates are the product. The frame
 * gate decides whether a frame is worth paying to look at; the confidence gate
 * decides whether to act, ask, or ask again; the undo window decides how long a
 * mistake stays cheap. Remove any one and this becomes either expensive,
 * untrustworthy, or both.
 */
@Injectable({ providedIn: 'root' })
export class ClerkFacade {
  private readonly camera = inject(CameraService);
  private readonly barcodes = inject(BarcodeScannerService);
  private readonly recognizer = inject(VISION_RECOGNIZER);
  private readonly voice = inject(SpeechSynthesisService);
  private readonly ear = inject(SpeechRecognitionService);
  private readonly pos = inject(PosFacade);
  private readonly products = inject(ProductService);
  private readonly eventBus = inject(EventBusService);
  private readonly telemetry = inject(TelemetryService);
  private readonly log = inject(RecognitionLogService);

  // ─── State ────────────────────────────────────────────────────────────────

  private readonly _phase = signal<ClerkPhase>('off');
  private readonly _visualState = signal<ClerkVisualState>('idle');
  private readonly _caption = signal('');
  private readonly _candidates = signal<VisionCandidate[]>([]);
  private readonly _confidence = signal(0);
  private readonly _pendingAdd = signal<PendingAdd | null>(null);
  private readonly _undoMsLeft = signal(0);
  private readonly _micEnabled = signal(false);
  private readonly _verdict = signal<GateVerdict>('warming');
  private readonly _busy = signal(false);
  private readonly _recognized = signal(0);
  private readonly _added = signal(0);
  private readonly _plopToken = signal(0);
  private readonly _codes = signal<CodeOverlay[]>([]);
  private readonly _frameSize = signal({ width: 0, height: 0 });
  private readonly _scanProgress = signal<ScanProgress>({ kind: 'hidden' });

  readonly phase = this._phase.asReadonly();
  readonly visualState = this._visualState.asReadonly();
  /**
   * Everything she says, as text. Rendered in a live region alongside the audio
   * so the voice is an enhancement and never the only channel.
   */
  readonly caption = this._caption.asReadonly();
  readonly candidates = this._candidates.asReadonly();
  readonly confidence = this._confidence.asReadonly();
  readonly pendingAdd = this._pendingAdd.asReadonly();
  readonly undoMsLeft = this._undoMsLeft.asReadonly();
  readonly micEnabled = this._micEnabled.asReadonly();
  /** Why the clerk isn't looking right now — drives the HUD's status hint. */
  readonly verdict = this._verdict.asReadonly();
  readonly busy = this._busy.asReadonly();
  readonly recognizedCount = this._recognized.asReadonly();
  readonly addedCount = this._added.asReadonly();
  /**
   * Increments each time an item really lands in the cart. The stage watches it
   * and drops the yuzu — tying the ripple to the cart write rather than to the
   * recognizer's confidence, so the animation can never claim a sale that
   * stock validation refused.
   */
  readonly plopToken = this._plopToken.asReadonly();
  /**
   * Barcodes currently in frame, for the stage to outline. Paired with the camera
   * size their bounds are relative to, because a box without it cannot be placed.
   */
  readonly codes = this._codes.asReadonly();
  readonly frameSize = this._frameSize.asReadonly();
  /** What the ring around the stage reports: closing in, or looking. */
  readonly scanProgress = this._scanProgress.asReadonly();
  /** False where the browser cannot read barcodes; the AI path carries on alone. */
  readonly barcodeSupported = this.barcodes.supported;

  readonly cameraStatus = this.camera.status;
  readonly cameraMessage = this.camera.message;
  /** Video inputs to choose between, and which one is live. */
  readonly cameras = this.camera.cameras;
  readonly activeCameraId = this.camera.activeCameraId;
  /** False with a single camera, so the HUD renders no picker at all. */
  readonly hasCameraChoice = this.camera.hasChoice;
  readonly heard = this.ear.interim;
  readonly voiceSupported = this.voice.supported;
  readonly earSupported = this.ear.supported;
  readonly recognizerKind = this.recognizer.kind;
  readonly speaking = this.voice.speaking;
  readonly lastBoundaryAt = this.voice.lastBoundaryAt;

  /**
   * Bumped when the cashier asks for checkout by voice. The shell watches it and
   * navigates — the facade has no business knowing about routes.
   */
  readonly checkoutRequested = signal(0);

  readonly undoSecondsLeft = computed(() => Math.ceil(this._undoMsLeft() / 1000));
  readonly awaitingChoice = computed(() => this._candidates().length > 0);

  /**
   * Candidates joined to the catalog for display.
   *
   * The recognizer returns ids and confidences; a cashier choosing between two
   * similar items needs the price and SKU to tell them apart, and those only
   * exist locally. `position` is 1-based because it is also the spoken command
   * ("two") and the keyboard shortcut — the number is information, not decoration.
   */
  readonly candidateCards = computed<CandidateCard[]>(() => {
    const catalog = this._catalog();
    return this._candidates().map((candidate, index) => {
      const product = catalog.find((entry) => entry.id === candidate.productId);
      return {
        position: index + 1,
        productId: candidate.productId,
        label: product?.name ?? candidate.label,
        sku: product?.sku ?? '—',
        price: product?.price ?? 0,
        emoji: product?.emoji,
        confidence: candidate.confidence,
      };
    });
  });

  /** Where she should look, in -1..1 stage space. */
  readonly gaze = computed<{ x: number; y: number }>(() => {
    switch (this._visualState()) {
      // Toward the camera preview on the right — she looks at what she's reading.
      case 'scanning':
        return { x: 0.5, y: 0.18 };
      case 'confused':
        return { x: -0.3, y: 0.1 };
      case 'found':
        return { x: 0, y: -0.12 };
      default:
        return { x: 0, y: 0 };
    }
  });

  private readonly gate = new FrameGate();
  private readonly barcodeGate = new BarcodeGate();
  /**
   * Barcode and SKU to product, rebuilt with the catalogue.
   *
   * In memory rather than a repository query: this is consulted on every frame a
   * code is visible, and a database round trip per frame would put latency between
   * holding a jar up and the box turning green — the one moment the feature has to
   * feel instant. The catalogue is already loaded for the vision path anyway.
   */
  private codeIndex = new Map<string, Product>();
  /**
   * The log row for the add currently inside its undo window.
   *
   * Whether a proposal was *right* is not known when it is made — it is known up to
   * four seconds later, when the cashier either lets it stand or takes it back. So
   * the row is written optimistically and amended when the window closes.
   */
  private openLogEntry: { id: string; productId: string } | null = null;
  /** A signal so `candidateCards` can join against it reactively. */
  private readonly _catalog = signal<Product[]>([]);
  private hints: CatalogHint[] = [];
  private sampleTimer: ReturnType<typeof setInterval> | null = null;
  private undoTimer: ReturnType<typeof setInterval> | null = null;
  private inFlight: AbortController | null = null;

  constructor() {
    this.ear.onFinalPhrase((phrase) => this.handlePhrase(phrase));

    // Barge-in guard. Without this she hears her own voice through the mic,
    // fails to parse an intent from it, and can answer her own question.
    effect(() => {
      if (this.voice.speaking()) {
        this.ear.pause();
      } else {
        this.ear.resume();
      }
    });
  }

  // ─── Session ──────────────────────────────────────────────────────────────

  /** Open the camera, load the catalog, and start looking. */
  async start(): Promise<void> {
    if (this._phase() === 'ready' || this._phase() === 'starting') {
      return;
    }
    this._phase.set('starting');
    this.gate.reset();

    // Catalog first: recognition without it would have nothing to choose from,
    // and an empty catalog is a clearer failure than a silent no-match.
    try {
      const catalog = await this.products.getActiveProducts();
      this._catalog.set(catalog);
      this.codeIndex = buildCodeIndex(catalog);
      this.hints = catalog.map((product) => ({
        id: product.id,
        name: product.name,
        sku: product.sku,
        category: product.category,
        emoji: product.emoji,
      }));
    } catch (error) {
      console.error('[Clerk] Could not load the catalog:', error);
      this._catalog.set([]);
      this.codeIndex = new Map();
      this.hints = [];
    }

    if (!(await this.camera.start())) {
      this._phase.set('blocked');
      this._visualState.set('confused');
      this.say(this.camera.message());
      return;
    }

    // Barcode support is an accelerator, not a requirement: where it exists a
    // barcoded item costs no recognition call at all, and where it doesn't the
    // clerk simply uses her eyes for everything.
    const canScan = await this.barcodes.prepare();

    this._phase.set('ready');
    this._visualState.set('idle');
    this.sampleTimer = setInterval(() => this.tick(), SAMPLE_INTERVAL_MS);
    this.say(
      canScan ? 'Hold something up, or show me a barcode.' : "Hold something up and I'll name it."
    );
  }

  /** Close the session and release the camera and microphone. */
  stop(): void {
    if (this.sampleTimer !== null) {
      clearInterval(this.sampleTimer);
      this.sampleTimer = null;
    }
    this.clearUndo();
    this.abortLook();
    this.ear.stop();
    this.voice.cancel();
    this.camera.stop();
    this._micEnabled.set(false);
    this._candidates.set([]);
    this._confidence.set(0);
    this._verdict.set('warming');
    this._codes.set([]);
    this._scanProgress.set({ kind: 'hidden' });
    this.barcodeGate.reset();
    this._visualState.set('idle');
    this._phase.set('off');
  }

  /**
   * Point the clerk at a different camera.
   *
   * Everything mid-flight belongs to the old angle and has to go: the frame gate's
   * motion history and its record of what it last identified, any candidates the
   * cashier hasn't answered, and any recognition already on the wire. Keeping the
   * gate's state across a switch would compare the first frame of the new camera
   * against the last frame of the old one and, worse, could reject a genuinely new
   * scene as a duplicate of something the other camera saw.
   */
  async selectCamera(deviceId: string): Promise<void> {
    if (this._phase() !== 'ready' || deviceId === this.activeCameraId()) {
      return;
    }
    this.abortLook();
    this._candidates.set([]);
    this._codes.set([]);
    this.barcodeGate.release();
    this.goIdle();

    // Hold the scan loop across the swap. Between aborting the old look and the
    // old stream actually stopping there is a moment where a tick could capture a
    // frame from the camera we are leaving, and attribute it to the new one.
    this._busy.set(true);
    try {
      const opened = await this.camera.select(deviceId);
      this.gate.reset();
      this.say(
        opened
          ? `Looking through ${this.camera.activeCameraLabel()}.`
          : // The service has already put the previous camera back.
            "That camera wouldn't open."
      );
    } finally {
      this._busy.set(false);
    }
  }

  /** Next camera in the list — the `C` shortcut. */
  async cycleCamera(): Promise<void> {
    const cameras = this.cameras();
    const current = this.activeCameraId();
    const index = cameras.findIndex((camera) => camera.deviceId === current);
    const next = cameras[(index + 1) % cameras.length];
    if (next && next.deviceId !== current) {
      await this.selectCamera(next.deviceId);
    }
  }

  toggleMic(): void {
    if (!this.ear.supported) {
      return;
    }
    if (this._micEnabled()) {
      this._micEnabled.set(false);
      this.ear.stop();
      this._visualState.set('idle');
      return;
    }
    this._micEnabled.set(true);
    this.ear.start();
    this.say("I'm listening.");
  }

  // ─── Scanning loop ────────────────────────────────────────────────────────

  /**
   * One sampling tick: look at the frame, decide whether it's worth identifying.
   *
   * Held back while a recognition is in flight or while candidates are on screen
   * — in both cases the cashier is mid-interaction, and a new capture would
   * replace the question they were about to answer.
   */
  private tick(): void {
    if (this._phase() !== 'ready' || this._busy() || this.awaitingChoice()) {
      this._scanProgress.set({ kind: this._busy() ? 'reading' : 'hidden' });
      return;
    }

    // Barcodes first, and on their own schedule. A code is unambiguous and reading
    // it is free, so there is no reason to make it wait for the scene to settle or
    // to pay a model to confirm what the bars already say.
    void this.scanForCodes();

    const sample = this.camera.sampleFrame();
    if (!sample) {
      return;
    }

    const now = performance.now();
    const verdict = this.gate.evaluate(sample, now);
    this._verdict.set(verdict);
    this._scanProgress.set(progressFor(verdict, this.gate.progress(now)));

    if (verdict === 'moving' && this._visualState() === 'idle' && this._micEnabled()) {
      this._visualState.set('listening');
    }
    if (verdict === 'capture') {
      void this.identify();
    }
  }

  /**
   * Look for barcodes in the current frame and act on a fresh one.
   *
   * Runs alongside the AI path rather than instead of it: a shop sells barcoded
   * jars and loose apples from the same counter, and the cashier should not have to
   * tell the till which kind of thing they are holding.
   */
  private async scanForCodes(): Promise<void> {
    const video = this.camera.detectionSource();
    if (!video) {
      return;
    }

    const found = await this.barcodes.detect(video);
    // Null means the frame was never examined. Feeding that to the gate as "no
    // code" would let a slow decoder look like the cashier briefly taking the item
    // away, and the next real detection would ring it up again.
    if (found === null) {
      return;
    }
    // The session may have ended, or a camera switch landed, while we were
    // decoding — in either case these boxes belong to a frame that no longer
    // exists and drawing them would leave brackets floating over nothing.
    if (this._phase() !== 'ready') {
      return;
    }
    this._frameSize.set({ width: video.videoWidth, height: video.videoHeight });

    const presented = pickPresentedCode(found, this.barcodeGate.minWidth);
    this._codes.set(this.overlaysFor(found, presented));

    const verdict = this.barcodeGate.observe(presented?.value ?? null, performance.now());
    if (verdict === 'new' && presented) {
      this.ringUpCode(presented.value);
    }
  }

  /** Every readable code gets a box; colour says whether we stock it. */
  private overlaysFor(found: readonly ScannedCode[], presented: ScannedCode | null): CodeOverlay[] {
    return found
      .filter((code) => code.box.width >= this.barcodeGate.minWidth || code === presented)
      .map((code) => ({ box: code.box, matched: this.codeIndex.has(code.value) }));
  }

  /**
   * Add the product a barcode identifies.
   *
   * A barcode is certainty, not a guess, so it goes straight in — the confidence
   * gate exists to handle the model being unsure, and there is nothing here to be
   * unsure about. It still routes through the same add path, so stock rules, the
   * undo window and the event trail are identical to every other route into the
   * cart.
   */
  private ringUpCode(value: string): void {
    const product = this.codeIndex.get(value);
    if (!product) {
      this._visualState.set('confused');
      this.say("That barcode isn't in the catalogue.");
      this.publish(EventType.CLERK_ITEM_REJECTED, { reason: 'unknown-barcode', barcode: value });
      return;
    }

    this._confidence.set(1);
    const added = this.addProduct(
      product,
      `One ${product.name.toLowerCase()}, added.`,
      { confidence: 1, auto: true, barcode: value },
      { tier: 'barcode', confidence: 1, candidateCount: 1 }
    );
    if (added) {
      // The bars have already said what this is, so stop the model being asked the
      // same question about the same still scene half a second later and adding a
      // second one. Deliberately not done for an unknown code: the catalogue may
      // simply be missing that barcode, and the model may still recognise the
      // packaging.
      this.gate.claimCurrentScene(performance.now());
      return;
    }
    // Out of stock: let the same code count as new again, because the cashier is
    // about to try something else with it in hand.
    this.barcodeGate.release();
  }

  /**
   * Look at whatever is in front of the camera right now.
   *
   * The frame gate deliberately refuses to re-identify a scene it has already
   * named, which is right almost always and wrong when the cashier knows better —
   * two identical-looking jars in a row, or a first answer they disagreed with.
   * This is the override, and the HUD surfaces it as "Look again" whenever the
   * gate is holding a duplicate back.
   */
  scanNow(): void {
    if (this._phase() !== 'ready' || this._busy()) {
      return;
    }
    this._candidates.set([]);
    this.gate.forgetLastCapture();
    void this.identify();
  }

  /**
   * Cancel a recognition already on the wire.
   *
   * Its frame is stale — the cashier has moved on, or the camera has changed — and
   * acting on the answer would add whatever the *previous* angle was looking at.
   */
  private abortLook(): void {
    this.inFlight?.abort();
    this.inFlight = null;
    this._busy.set(false);
  }

  private async identify(): Promise<void> {
    const frame = this.camera.captureFrame();
    if (!frame) {
      return;
    }

    this._busy.set(true);
    this._visualState.set('scanning');
    this._confidence.set(0);

    const controller = new AbortController();
    this.inFlight = controller;

    try {
      const result = await this.recognizer.identify(
        { imageBase64: frame.base64, mediaType: 'image/jpeg', catalog: this.hints },
        controller.signal
      );
      if (controller.signal.aborted) {
        return;
      }

      this._recognized.update((n) => n + 1);
      this.count('clerk.recognitions', { recognizer: this.recognizer.kind });

      const best = result.candidates[0];
      const confidence = best?.confidence ?? 0;
      this._confidence.set(confidence);

      if (!best || confidence < CONSIDER_CONFIDENCE) {
        this.askAgain(result.utterance);
        return;
      }

      if (confidence >= AUTO_ADD_CONFIDENCE) {
        this.autoAdd(best, result.utterance);
        return;
      }

      this.offerChoice(result.candidates, result.utterance);
    } finally {
      if (this.inFlight === controller) {
        this.inFlight = null;
      }
      this._busy.set(false);
    }
  }

  // ─── Confidence gates ─────────────────────────────────────────────────────

  /** Confident: put it in the cart and say so, with a way back. */
  private autoAdd(candidate: VisionCandidate, utterance: string): void {
    const product = this.findProduct(candidate.productId);
    if (!product) {
      this.askAgain("That isn't something I can ring up.");
      return;
    }

    const added = this.addProduct(
      product,
      utterance,
      { confidence: candidate.confidence, auto: true },
      { tier: 'model', confidence: candidate.confidence, candidateCount: 1 }
    );
    if (!added) {
      // Let the same scene be read again — the cashier is about to try something
      // else with the item still in hand.
      this.gate.forgetLastCapture();
    }
  }

  /**
   * The one way anything reaches the cart.
   *
   * Barcodes and the model both come through here, so stock validation, the undo
   * window, the spoken confirmation, the event trail and the telemetry are
   * identical whichever route was taken. The two callers differ only in which gate
   * they release when the add is refused, which is why that is left to them.
   *
   * @returns whether the product actually went in.
   */
  private addProduct(
    product: Product,
    utterance: string,
    meta: Record<string, unknown>,
    provenance?: { tier: RecognitionTier; confidence: number; candidateCount: number }
  ): boolean {
    const result = this.pos.tryAddToCart(product);
    if (!result.added) {
      // Stock rules are the terminal's, not the clerk's — she just reports them.
      this._visualState.set('confused');
      this._candidates.set([]);
      this.say(
        result.reason === 'out-of-stock'
          ? `${product.name} is out of stock.`
          : `That's all the ${product.name.toLowerCase()} in stock.`
      );
      this.publish(EventType.CLERK_ITEM_REJECTED, {
        productId: product.id,
        reason: result.reason,
      });
      if (provenance) {
        // Stock refused it, which says nothing about whether the recognition was
        // right — so it is recorded as an abstention, not a wrong answer.
        this.log.record({
          tier: provenance.tier,
          proposedProductId: product.id,
          confidence: provenance.confidence,
          candidateCount: provenance.candidateCount,
          outcome: 'rejected',
        });
      }
      return false;
    }

    this._added.update((n) => n + 1);
    this._candidates.set([]);
    this._visualState.set('found');
    this._plopToken.update((token) => token + 1);
    this.say(utterance || `One ${product.name.toLowerCase()}, added.`);
    // Opened first, and only then tracked: `openUndoWindow` clears the previous
    // window, and clearing a window stops tracking its log row — so assigning
    // before this call would have the new row wiped by its own window opening.
    this.openUndoWindow({ productId: product.id, label: product.name });
    if (provenance) {
      this.openLogEntry = {
        id: this.log.record({
          tier: provenance.tier,
          proposedProductId: product.id,
          confidence: provenance.confidence,
          candidateCount: provenance.candidateCount,
          // Optimistic: revised to 'undone' if the cashier takes it back.
          outcome: 'auto',
        }),
        productId: product.id,
      };
    }
    this.publish(EventType.CLERK_ITEM_RECOGNIZED, {
      productId: product.id,
      name: product.name,
      ...meta,
    });
    this.count('clerk.autoadds');
    return true;
  }

  /** Unsure between a few: show them and wait. */
  private offerChoice(candidates: VisionCandidate[], utterance: string): void {
    this._candidates.set(candidates.slice(0, 3));
    this._visualState.set('confused');
    this.say(utterance || 'Which one is it?');
  }

  /** Nothing usable: ask for a better look and allow the same scene again. */
  private askAgain(utterance: string): void {
    this.log.record({
      tier: 'model',
      confidence: this._confidence(),
      candidateCount: 0,
      outcome: 'unknown',
    });
    this._candidates.set([]);
    this._visualState.set('confused');
    this.say(utterance || "I can't tell what that is. Turn the label towards me?");
    // Without this the identical frame would be rejected as a duplicate and she
    // would repeat the request forever.
    this.gate.forgetLastCapture();
  }

  // ─── Cashier actions ──────────────────────────────────────────────────────

  /** Take the top candidate. */
  confirmTop(): void {
    this.chooseCandidate(1);
  }

  /** Take candidate `position` (1-based, as spoken and as labelled). */
  chooseCandidate(position: number): void {
    const offered = this._candidates();
    const candidate = offered[position - 1];
    if (!candidate) {
      return;
    }
    const product = this.findProduct(candidate.productId);
    const top = offered[0];
    this._candidates.set([]);
    if (!product) {
      this.askAgain("I've lost track of that one. Show me again?");
      return;
    }

    // The most valuable row in the log: what was offered first, and what the cashier
    // actually wanted. `corrected` means the ranking was wrong and here is the truth.
    this.log.record({
      tier: 'model',
      proposedProductId: top?.productId,
      confidence: top?.confidence ?? 0,
      candidateCount: offered.length,
      outcome: position === 1 ? 'chosen' : 'corrected',
      actualProductId: product.id,
    });
    // Route through the same auto-add path: a hand-picked item still has to
    // satisfy stock, still gets an undo window, still emits the same event.
    this.autoAdd({ ...candidate, confidence: 1 }, `One ${product.name.toLowerCase()}, added.`);
  }

  /** None of those. Look again. */
  reject(): void {
    const offered = this._candidates();
    if (offered.length > 0) {
      this.log.record({
        tier: 'model',
        proposedProductId: offered[0]?.productId,
        confidence: offered[0]?.confidence ?? 0,
        candidateCount: offered.length,
        outcome: 'rejected',
      });
    }
    this._candidates.set([]);
    this.gate.forgetLastCapture();
    this.goIdle();
    this.say('Show me again.');
    this.publish(EventType.CLERK_ITEM_REJECTED, { reason: 'operator-rejected' });
  }

  /** Reverse the last add. Exactly one decrement, matching exactly one add. */
  undoLast(): void {
    const pending = this._pendingAdd();
    if (!pending) {
      return;
    }
    this.pos.decreaseQuantity(pending.productId);
    // The undo window exists to make a mistake cheap; it is also the cleanest
    // label available for "that was wrong", so it revises the optimistic row.
    if (this.openLogEntry?.productId === pending.productId) {
      this.log.amend(this.openLogEntry.id, 'undone');
    }
    this.openLogEntry = null;
    this.clearUndo();
    this._added.update((n) => Math.max(0, n - 1));
    this.goIdle();
    this.say(`${pending.label} removed.`);
    // Let the same item be recognized again — undo usually means "wrong item",
    // and the cashier is about to hold up the right one. Both gates, because the
    // item may have been identified by sight or by its barcode.
    this.gate.forgetLastCapture();
    this.barcodeGate.release();
  }

  /** Read the running total aloud. */
  speakTotal(): void {
    const items = this.pos.totalItems();
    if (items === 0) {
      this.say('The cart is empty.');
      return;
    }
    const total = this.pos.total().toFixed(2);
    this.say(`${items} ${items === 1 ? 'item' : 'items'}, ${total} dollars.`);
  }

  // ─── Voice ────────────────────────────────────────────────────────────────

  /**
   * Handle one completed spoken phrase.
   *
   * `checkout` is returned to the caller rather than acted on here: navigation
   * belongs to the component that owns the route.
   */
  private handlePhrase(phrase: string): ClerkIntentOutcome {
    const intent = parseClerkIntent(
      phrase,
      this._candidates().map((candidate) => candidate.label)
    );

    switch (intent.kind) {
      case 'confirm':
        this.confirmTop();
        return 'handled';
      case 'reject':
        this.reject();
        return 'handled';
      case 'choose':
        this.chooseCandidate(intent.index);
        return 'handled';
      case 'undo':
        this.undoLast();
        return 'handled';
      case 'total':
        this.speakTotal();
        return 'handled';
      case 'mute':
        this.toggleMic();
        return 'handled';
      case 'checkout':
        this.checkoutRequested.set(this.checkoutRequested() + 1);
        return 'handled';
      default:
        return 'ignored';
    }
  }

  /** Say something, and caption it at the same moment. */
  private say(text: string): void {
    if (text.trim().length === 0) {
      return;
    }
    this._caption.set(text);
    this.voice.speak(text);
  }

  // ─── Undo window ──────────────────────────────────────────────────────────

  private openUndoWindow(pending: PendingAdd): void {
    this.clearUndo();
    this._pendingAdd.set(pending);
    this._undoMsLeft.set(UNDO_WINDOW_MS);
    // 250ms ticks: fine enough for a smooth countdown, coarse enough to be free.
    this.undoTimer = setInterval(() => {
      const left = this._undoMsLeft() - 250;
      if (left <= 0) {
        this.clearUndo();
        if (this._visualState() === 'found') {
          this.goIdle();
        }
        return;
      }
      this._undoMsLeft.set(left);
    }, 250);
  }

  private clearUndo(): void {
    // Left to stand: the optimistic 'auto' row is now known to be correct, so there
    // is nothing to amend — just stop tracking it.
    this.openLogEntry = null;
    if (this.undoTimer !== null) {
      clearInterval(this.undoTimer);
      this.undoTimer = null;
    }
    this._pendingAdd.set(null);
    this._undoMsLeft.set(0);
  }

  // ─── Helpers ──────────────────────────────────────────────────────────────

  /**
   * Return to waiting, and clear the confidence reading with it.
   *
   * The yuzu reports how sure she is about what she is looking at *now*. Leaving
   * the last reading behind would keep the fruit ripe and glowing over an empty
   * counter, which turns a live indicator into a stale one.
   */
  private goIdle(): void {
    this._visualState.set('idle');
    this._confidence.set(0);
  }

  private findProduct(productId: string): Product | undefined {
    return this._catalog().find((product) => product.id === productId);
  }

  private publish(type: EventType, payload: Record<string, unknown>): void {
    this.eventBus.publish(busEvent(type, EventSource.CLERK_FACADE, payload, 'normal'));
  }

  /**
   * Telemetry is never allowed to break a scan. The agent-monitor dashboard is
   * useful; it is not worth failing a sale over.
   */
  private count(name: string, tags?: Record<string, string>): void {
    try {
      this.telemetry.recordCounter(name, 1, tags);
    } catch (error) {
      console.warn(`[Clerk] Telemetry counter ${name} failed:`, error);
    }
  }
}

type ClerkIntentOutcome = 'handled' | 'ignored';

/**
 * Index a catalogue by every code that might be scanned off it.
 *
 * Barcode and SKU both, because shelf labels are commonly printed with the SKU as
 * a Code 128 while the product's own packaging carries an EAN — a till sees both
 * and should not care which it got.
 */
function buildCodeIndex(catalog: readonly Product[]): Map<string, Product> {
  const index = new Map<string, Product>();
  for (const product of catalog) {
    // First writer wins, so a deliberate barcode is never shadowed by another
    // product whose SKU happens to collide with it.
    for (const code of [product.barcode, product.sku]) {
      if (code && code.length > 0 && !index.has(code)) {
        index.set(code, product);
      }
    }
  }
  return index;
}

/**
 * Translate a gate verdict into what the ring should show.
 *
 * Nothing is shown when no look is coming: a full ring over a scene the gate has
 * already read would promise something that is never going to happen.
 */
function progressFor(verdict: GateVerdict, value: number): ScanProgress {
  switch (verdict) {
    case 'holding':
    case 'cooling':
      return { kind: 'settling', value };
    case 'capture':
      return { kind: 'reading' };
    default:
      return { kind: 'hidden' };
  }
}

/** One candidate, ready to render. */
export interface CandidateCard {
  /** 1-based — matches the spoken command and the number key. */
  position: number;
  productId: string;
  label: string;
  sku: string;
  price: number;
  emoji?: string;
  confidence: number;
}
