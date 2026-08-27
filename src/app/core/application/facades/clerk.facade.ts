import { Injectable, computed, effect, inject, signal } from '@angular/core';
import { CatalogHint, VisionCandidate } from '@core/application/dtos/recognition.dto';
import { joinWithinSpeechBudget } from '@core/application/services/agent-speech.sanitizer';
import { VISION_RECOGNIZER } from '@core/application/ports/vision-recognizer.port';
import { AddToCartRejection, PosFacade } from '@core/application/facades/pos.facade';
import { ProductService } from '@core/application/services/product.service';
import {
  AUTO_ADD_CONFIDENCE,
  CONSIDER_CONFIDENCE,
  ChoiceActor,
  shouldScoreChoice,
} from '@core/application/services/candidate-ranking';
import {
  RecognitionLogService,
  RecognitionTier,
} from '@core/application/services/recognition-log.service';
import {
  clampSpokenQuantity,
  parseClerkIntent,
  rankLabelsBySpokenWords,
} from '@core/application/services/voice-intent.parser';
import { CameraService } from '@core/infrastructure/media/camera.service';
import {
  BarcodeGate,
  GATED_TIMING,
  INSTANT_TIMING,
  ScannedCode,
  pickPresentedCode,
} from '@core/infrastructure/media/barcode-gate';
import { BarcodeScannerService } from '@core/infrastructure/media/barcode-scanner.service';
import { FrameGate, GateVerdict } from '@core/infrastructure/media/frame-gate';
import { LookScheduler } from '@core/infrastructure/media/look-scheduler';
import { EventBusService } from '@core/infrastructure/messaging/event-bus.service';
import { EventSource, EventType, busEvent } from '@core/infrastructure/messaging/event-bus.events';
import {
  readAgentPreference,
  writeAgentPreference,
} from '@core/infrastructure/settings/clerk-agent-preference';
import { SpeechRecognitionService } from '@core/infrastructure/voice/speech-recognition.service';
import { SpeechSynthesisService } from '@core/infrastructure/voice/speech-synthesis.service';
import { TelemetryService } from '@core/infrastructure/telemetry/telemetry.service';
import { Product } from '@core/domain/entities/product.entity';
import {
  CodeOverlay,
  ClerkMood,
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

/**
 * Why an add put in fewer units than were asked for.
 *
 * The stock reasons are `AddToCartRejection`'s rather than restated, so the terminal
 * stays the single authority on what stock refuses and this only adds the failures
 * that are the clerk's own: a name that resolved to nothing, a name that resolved to
 * several things, and an id that no longer matches a product.
 */
export type SpokenAddReason = AddToCartRejection | 'unknown-product' | 'unknown-name' | 'ambiguous';

/**
 * What an add actually did, as opposed to whether it did anything.
 *
 * A boolean cannot express a short count, and a short count is the case a caller
 * most needs to report honestly: 2 in against 5 asked for is neither success nor
 * failure. Returning both numbers means a caller reports what happened instead of
 * re-deriving it by diffing the cart afterwards, which would be a second source of
 * truth about a write this method just made.
 *
 * `wanted` is the **clamped** want, so a caller that asked for 40 is told 5 and can
 * see the clamp rather than silently believing it was fully served.
 */
export interface SpokenAddOutcome {
  added: number;
  wanted: number;
  name: string;
  reason?: SpokenAddReason;
}

/** The mirror of `SpokenAddOutcome` for taking something back off the sale. */
export interface SpokenRemoveOutcome {
  removed: number;
  wanted: number;
  name: string;
  reason?: 'unknown-name' | 'ambiguous' | 'not-in-cart';
}

/** Motion sampling cadence. 8Hz is ample for settle detection and nearly free. */
const SAMPLE_INTERVAL_MS = 125;

/**
 * How long a mood lasts before she settles back to neutral.
 *
 * Just longer than the undo window, so the reaction to an add is still on her face
 * for as long as taking it back is cheap. An expression that outlives what caused
 * it has stopped describing anything.
 */
export const MOOD_HOLD_MS = 4600;

/**
 * The most words the clerk may say in one turn.
 *
 * A ceiling rather than a note about style. Speaking pauses the ear for the whole
 * utterance so she cannot hear herself, so the length of an answer is the length
 * of a window in which the cashier cannot correct her — and the longer the answer,
 * the more likely it is wrong and the more likely they want to. Forty words is
 * about fifteen seconds of a busy counter talked over.
 *
 * Exported so anything that produces prose can be measured against it instead of
 * restating the number as a sentence nothing can check.
 */
export const MAX_SPEECH_WORDS = 40;

/**
 * What she says when asked what she can do.
 *
 * A constant, not generated: the command set is closed, so the honest answer is
 * fixed, and a fixed answer costs nothing and cannot drift from the parser behind
 * her. Kept inside `MAX_SPEECH_WORDS` because a list of capabilities read at
 * length is the worst possible thing to be unable to interrupt.
 */
export const HELP_TEXT =
  'I can add or remove items by name, read the total, undo the last add, or take you to checkout. ' +
  'Say it, or use the keys on screen.';

/**
 * One line of the exchange between the cashier and the clerk.
 *
 * A separate channel from `caption`, not a replacement for it. `caption` is a
 * single slot written by `say()` and overwritten by the next one: exactly the
 * shape a one-shot recognition confirmation wants, and exactly the wrong shape
 * for a multi-turn exchange, where the cashier has to be able to see what they
 * asked next to what they were told. `caption` stays the source of the sr-only
 * live region so the announced channel does not double up.
 *
 * `author` is `ChoiceActor` rather than a union re-declared here, so there is one
 * vocabulary for the non-human side of this facade — the same word that lands in
 * a recognition-log row lands in the DOM.
 */
export interface ClerkExchange {
  id: number;
  author: ChoiceActor;
  text: string;
  /** True while she is working on an answer that has not been spoken yet. */
  pending: boolean;
}

/**
 * How many lines of the exchange stay on screen.
 *
 * A display bound, and deliberately independent of the runner's turn-memory
 * depth: the log is for the person, the memory is for the model. Six is about as
 * much as fits over a camera preview without the controls fighting it, and the
 * one line that matters most is still rendered as the caption bubble it always
 * was.
 */
export const MAX_EXCHANGES = 6;

/** Whether the camera is up and the clerk is working. */
export type ClerkPhase = 'off' | 'starting' | 'ready' | 'blocked';

/** One auto-added item inside the undo window. */
export interface PendingAddLine {
  productId: string;
  label: string;
  /**
   * How many went in, so undo takes back exactly what one command put in.
   * Without this a spoken "add three coffees" would undo to two, silently.
   */
  quantity: number;
}

/**
 * Everything one undo window can take back.
 *
 * A list rather than a single line, because a turn can act more than once: an
 * agent asked for three coffees and a sandwich makes two adds, and a window that
 * holds only the last of them would leave the first both unundoable and recorded
 * as correct. One window over N lines is what makes a multi-step turn reversible
 * as the unit the cashier experienced it as.
 *
 * `readonly` so no collaborator can push into a live window — lines are appended
 * by `openUndoWindow` and by nothing else.
 */
export interface PendingAdd {
  lines: readonly PendingAddLine[];
}

/**
 * One turn's claim on the undo window.
 *
 * Deliberately **not exported**: an add that carries a batch token appends to the
 * open window instead of replacing it, and the only thing allowed to hand that
 * token out is the facade method that opened the batch. Threaded down
 * `addByName` → `autoAdd` → `addProduct` as a parameter rather than read off an
 * ambient field, so a barcode add that lands mid-turn — which passes no token —
 * cannot be swept into the agent's batch, and undo can never reverse a
 * hand-scanned item.
 *
 * `outcomes` carries every add the turn attempted, refusals included, because the
 * sealed summary is the only thing that survives to report a short count once
 * per-line speech is deferred. `lines` is not restated here: the window is the
 * single source for what can be taken back.
 */
interface UndoBatch {
  outcomes: SpokenAddOutcome[];
  /**
   * Whether this batch owns the window that is currently open.
   *
   * False until its first line lands, and false again the moment anything clears the
   * window — a barcode add, a named removal that took the last line. Either way the
   * next line of the batch opens a fresh window rather than appending to one that is
   * gone or one that now belongs to somebody else.
   */
  open: boolean;
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
  private readonly _exchanges = signal<ClerkExchange[]>([]);
  private readonly _agentEnabled = signal(readAgentPreference());
  private readonly _candidates = signal<VisionCandidate[]>([]);
  private readonly _confidence = signal(0);
  private readonly _pendingAdd = signal<PendingAdd | null>(null);
  private readonly _undoMsLeft = signal(0);
  private readonly _micEnabled = signal(false);
  private readonly _cameraEnabled = signal(false);
  private readonly _aiEnabled = signal(true);
  private readonly _verdict = signal<GateVerdict>('warming');
  private readonly _busy = signal(false);
  private readonly _recognized = signal(0);
  private readonly _added = signal(0);
  private readonly _plopToken = signal(0);
  private readonly _codes = signal<CodeOverlay[]>([]);
  private readonly _frameSize = signal({ width: 0, height: 0 });
  private readonly _scanProgress = signal<ScanProgress>({ kind: 'hidden' });
  private readonly _barcodePriority = signal(false);
  private readonly _barcodeDwell = signal<number | null>(null);
  private readonly _mood = signal<ClerkMood>(ClerkMood.NEUTRAL);

  readonly phase = this._phase.asReadonly();
  readonly visualState = this._visualState.asReadonly();
  /**
   * How the last thing that happened went, as distinct from what she is doing.
   *
   * `visualState` is a job — looking, listening, waiting. This is the reaction to
   * an outcome, and it exists because the outcomes are what the voice was carrying:
   * an item went in, stock refused one, a code is not in the catalogue, she cannot
   * tell what she is looking at. Muting her closes that channel and leaves the
   * captions, which a cashier watching their own hands is not reading.
   */
  readonly mood = this._mood.asReadonly();
  /**
   * Everything she says, as text. Rendered in a live region alongside the audio
   * so the voice is an enhancement and never the only channel.
   */
  readonly caption = this._caption.asReadonly();
  /**
   * The last few turns of the exchange, oldest first.
   *
   * Additive to `caption`, which stays a single slot and stays the sr-only live
   * region, so the announced channel does not repeat itself once per surviving
   * line. What this adds is the cashier's own side: a phrase she misheard is only
   * diagnosable next to the answer it produced, and `caption` has no room for it.
   */
  readonly exchanges = this._exchanges.asReadonly();
  /**
   * Whether this till is allowed to hold a conversation, as opposed to taking
   * commands.
   *
   * The third of the three switches, and the same shape as the other two: the
   * camera decides whether she may look, `aiEnabled` whether she may guess at what
   * she sees, and this whether she may work out a phrase the keyword parser cannot
   * name. Off, the till is a closed command set — free, offline, and incapable of
   * being creative with a sale.
   *
   * Remembered across sessions, because its "on" position is the one that spends
   * money on a model, and a shop that has chosen not to should not have to choose
   * again after every refresh.
   */
  readonly agentEnabled = this._agentEnabled.asReadonly();
  readonly candidates = this._candidates.asReadonly();
  readonly confidence = this._confidence.asReadonly();
  readonly pendingAdd = this._pendingAdd.asReadonly();
  readonly undoMsLeft = this._undoMsLeft.asReadonly();
  readonly micEnabled = this._micEnabled.asReadonly();
  /**
   * Whether she is currently allowed to look.
   *
   * Separate from `phase` because a camera the cashier switched off is not a
   * session that ended: the mic, the cart, undo and checkout all keep working,
   * and voice alone is enough to ring a sale through.
   */
  readonly cameraEnabled = this._cameraEnabled.asReadonly();
  /**
   * Whether she is allowed to *guess*.
   *
   * Separate from the camera, and the reason it exists: a barcode is free and
   * certain, while a model call costs money and can be wrong. A shop whose stock
   * is all barcoded has no reason to pay for the second, and should be able to say
   * so without giving up the scanner or the voice commands.
   */
  readonly aiEnabled = this._aiEnabled.asReadonly();
  /** Why the clerk isn't looking right now — drives the HUD's status hint. */
  readonly verdict = this._verdict.asReadonly();
  /**
   * Whether a barcode is currently holding the model back.
   *
   * Its own signal rather than a verdict, because the frame gate has no vocabulary
   * for it: from the gate's side this is a perfectly good frame it was refused
   * permission to spend on. The cashier waiting for a guess that is deliberately
   * not coming is exactly who needs told why.
   */
  readonly barcodePriority = this._barcodePriority.asReadonly();
  /**
   * How far through its dwell the code being presented is, or null when none is.
   *
   * The dwell is a deliberate refusal to ring up a code that has only been glimpsed,
   * and a refusal the cashier cannot see is indistinguishable from a broken reader —
   * so it drives the same ring the model's waits do.
   */
  readonly barcodeDwell = this._barcodeDwell.asReadonly();
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
  /**
   * Whether her voice is off. Remembered between sessions, unlike the camera and
   * recognition switches — see `SpeechSynthesisService.setMuted`.
   */
  readonly muted = this.voice.muted;
  /**
   * How hard the mood should be played, 0..1.
   *
   * Full while she is muted, because the body is then the only channel left. Held
   * back when she can speak, where the words are already carrying it and a figure
   * mugging along with every sentence is the more annoying failure.
   */
  readonly moodIntensity = computed(() => (this.muted() ? 1 : 0.55));
  readonly lastBoundaryAt = this.voice.lastBoundaryAt;

  private readonly _checkoutRequested = signal(0);

  /**
   * Bumped when checkout is asked for. The shell watches it and navigates — the
   * facade has no business knowing about routes.
   *
   * Read-only on purpose: a writable signal here is a live, ungated path to
   * payment for anything holding this facade, and navigating to payment is the one
   * action the four second undo window does not cover. `requestCheckout()` is
   * therefore the only way in, so the path to the till is nameable and greppable.
   */
  readonly checkoutRequested = this._checkoutRequested.asReadonly();

  readonly undoSecondsLeft = computed(() => Math.ceil(this._undoMsLeft() / 1000));
  /**
   * What the Undo control says it will take back.
   *
   * A computed rather than an expression in the HUD, because a batched window has
   * no single label to interpolate and the phrasing of a count belongs beside
   * `describeQuantity` — the one place in this feature that knows how a quantity
   * reads. Empty with no window, which the HUD never renders.
   */
  readonly undoLabel = computed(() => describeUndoLabel(this._pendingAdd()?.lines ?? []));
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
   * Decides when — and whether — the frame gate's verdict actually becomes a
   * recognition call. The gate says a frame is worth looking at; this says the
   * scene has finished changing and that no barcode is about to answer for free.
   */
  private readonly looks = new LookScheduler();
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
  private openLogEntries: { id: string; productId: string }[] = [];
  /**
   * The turn currently allowed to append to the open window, or null.
   *
   * Held so `sealUndoBatch()` can find the batch it is closing; never consulted to
   * decide whether an add batches. That decision is the caller's, made by passing
   * the token or not — see `UndoBatch`.
   */
  private openBatch: UndoBatch | null = null;
  /**
   * Who put the candidates on screen.
   *
   * The recognition log measures how good the *recognizer* is, so a choice
   * between products the cashier named out loud must not be written to it — it
   * would look like a model proposal that needed correcting and drag the tier's
   * accuracy down for work the model never did.
   */
  private candidateOrigin: 'model' | 'voice' = 'model';
  /** A signal so `candidateCards` can join against it reactively. */
  private readonly _catalog = signal<Product[]>([]);
  private hints: CatalogHint[] = [];
  private sampleTimer: ReturnType<typeof setInterval> | null = null;
  private undoTimer: ReturnType<typeof setInterval> | null = null;
  private moodTimer: ReturnType<typeof setTimeout> | null = null;
  private inFlight: AbortController | null = null;
  /**
   * Monotonic id for exchange lines.
   *
   * A counter rather than the array index, because the array is trimmed from the
   * front: an index would be reused the moment a line scrolls off and `@for`'s
   * track would reuse the DOM node for a different utterance.
   */
  private exchangeSeq = 0;
  /** The cashier line still waiting for an answer, or null when none is. */
  private pendingLine: number | null = null;

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
      this.setMood(ClerkMood.ALERT);
      this.say(this.camera.message());
      return;
    }

    // Barcode support is an accelerator, not a requirement: where it exists a
    // barcoded item costs no recognition call at all, and where it doesn't the
    // clerk simply uses her eyes for everything.
    const canScan = await this.barcodes.prepare();

    this._phase.set('ready');
    this._visualState.set('idle');
    this._cameraEnabled.set(true);
    this.startSampling();
    this.say(
      canScan ? 'Hold something up, or show me a barcode.' : "Hold something up and I'll name it."
    );
  }

  /** Close the session and release the camera and microphone. */
  stop(): void {
    this.stopSampling();
    this.clearUndo();
    this.abortLook();
    this.ear.stop();
    this.voice.cancel();
    this.camera.stop();
    this._micEnabled.set(false);
    this._cameraEnabled.set(false);
    this._candidates.set([]);
    this._confidence.set(0);
    this._verdict.set('warming');
    this._codes.set([]);
    this._scanProgress.set({ kind: 'hidden' });
    this._barcodeDwell.set(null);
    // Nothing is left to react to, and a mood timer outliving the session would put
    // an expression back on a stage that has gone.
    this.setMood(ClerkMood.NEUTRAL);
    this.barcodeGate.reset();
    // Both gates and the scheduler: the frame a look was waiting on, and the code
    // that was holding one back, belong to a session that has ended.
    this.looks.reset();
    this._barcodePriority.set(false);
    // The exchange is one cashier's conversation, so it does not survive the session
    // that held it: leaving it up would show the next person on the till a dialogue
    // they were not part of, over a stage that has just been handed to them.
    this._exchanges.set([]);
    this.pendingLine = null;
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
    // Opening a camera to switch to it would defeat the privacy switch.
    if (!this._cameraEnabled()) {
      return;
    }
    this.abortLook();
    this._candidates.set([]);
    this._codes.set([]);
    this._barcodeDwell.set(null);
    this.barcodeGate.release();
    this.goIdle();

    // Hold the scan loop across the swap. Between aborting the old look and the
    // old stream actually stopping there is a moment where a tick could capture a
    // frame from the camera we are leaving, and attribute it to the new one.
    this._busy.set(true);
    try {
      const opened = await this.camera.select(deviceId);
      this.gate.reset();
      if (!opened) {
        this.setMood(ClerkMood.ALERT);
      }
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
    if (!this._cameraEnabled()) {
      return;
    }
    const cameras = this.cameras();
    const current = this.activeCameraId();
    const index = cameras.findIndex((camera) => camera.deviceId === current);
    const next = cameras[(index + 1) % cameras.length];
    if (next && next.deviceId !== current) {
      await this.selectCamera(next.deviceId);
    }
  }

  /**
   * Switch looking on or off without ending the session.
   *
   * A privacy control, not a shutdown: the stream is genuinely released so the
   * camera light goes out, while the mic, the cart, the undo window and checkout
   * carry on. That is the point — with the spoken add and remove commands the
   * till is fully usable blind, and a cashier serving someone who would rather
   * not be filmed should not have to leave the screen.
   *
   * Everything mid-flight belongs to a camera that is about to stop, so it all
   * goes: the look on the wire, the motion history, the codes drawn on screen and
   * any candidates nobody has answered.
   */
  async setCameraEnabled(on: boolean): Promise<void> {
    if (this._phase() !== 'ready' || on === this._cameraEnabled()) {
      return;
    }

    if (!on) {
      this._cameraEnabled.set(false);
      this.abortLook();
      this.stopSampling();
      this.camera.pause();
      this._codes.set([]);
      this._barcodeDwell.set(null);
      this._frameSize.set({ width: 0, height: 0 });
      this._confidence.set(0);
      this._verdict.set('warming');
      this._scanProgress.set({ kind: 'hidden' });
      // Candidates deliberately survive: answering "which one?" needs the catalog,
      // not the camera, and throwing away an unanswered question buys no privacy.
      // The barcode gate survives too — resetting it would let a code still lying
      // in front of a re-opened camera count as new and ring the item up twice.
      // She is still in the room, just not looking.
      this._visualState.set(this._micEnabled() ? 'listening' : 'idle');
      this.say(
        this._micEnabled()
          ? 'Camera off. Tell me what to add.'
          : 'Camera off. Turn it back on when you need me to look.'
      );
      return;
    }

    // Held busy across the reopen so a tick cannot capture a half-started stream.
    this._busy.set(true);
    try {
      // `resume`, not `start`: start re-reads the saved preference, so an operator
      // who had switched to the shelf camera without making it the default would
      // come back up looking at the wrong thing. The phase deliberately stays
      // 'ready' on failure — 'blocked' would throw up the terminal overlay and end
      // a session they only meant to un-pause.
      if (!(await this.camera.resume())) {
        this.setMood(ClerkMood.ALERT);
        this.say(this.camera.message());
        return;
      }
      this._cameraEnabled.set(true);
      // Motion history from before the pause describes a scene that is long gone.
      this.gate.reset();
      this.startSampling();
      this.goIdle();
      this.say('Camera on.');
    } finally {
      this._busy.set(false);
    }
  }

  /** Flip the camera — the `V` key and the HUD button. */
  toggleCamera(): Promise<void> {
    return this.setCameraEnabled(!this._cameraEnabled());
  }

  /**
   * Stop paying the model to look, without switching anything else off.
   *
   * Barcodes carry on being read, the camera stays live, and the voice commands
   * still work — so a shop with a barcode on everything gets a till that costs
   * nothing per item and is never wrong about what it sold. Turning it back on
   * costs nothing but the next frame.
   *
   * Anything the model was in the middle of goes: its answer describes a frame
   * from before the decision, and acting on it after being told to stop guessing
   * is exactly what this switch says not to do.
   */
  setAiEnabled(on: boolean): void {
    if (on === this._aiEnabled()) {
      return;
    }
    this._aiEnabled.set(on);

    if (!on) {
      this.abortLook();
      this._candidates.set([]);
      this._confidence.set(0);
      this._scanProgress.set({ kind: 'hidden' });
      // Any dwell in progress was measured against the gated profile; from here the
      // next read is instant, so there is no wait left to report.
      this._barcodeDwell.set(null);
      this.goIdle();
      // Said plainly, because with no barcode reader this leaves her unable to
      // identify anything at all and the cashier needs to know that now rather
      // than after holding up an apple.
      this.say(
        this.barcodeSupported()
          ? 'Recognition off. Barcodes only from here.'
          : "Recognition off — and this browser can't read barcodes, so I won't be able to name anything. Use the terminal, or turn me back on."
      );
      return;
    }

    // The scene she last looked at was judged under the old setting, so let it be
    // read again rather than held back as a duplicate.
    this.gate.forgetLastCapture();
    this.say('Recognition on. Hold something up.');
  }

  /** Flip recognition — the `A` key and the HUD button. */
  toggleAi(): void {
    this.setAiEnabled(!this._aiEnabled());
  }

  /**
   * Stop her working phrases out, or let her again.
   *
   * The operator's kill switch over the agent tier. Nothing else changes: the
   * camera, the barcode reader, the whole keyword command set and every button on
   * the HUD keep working, because those are the paths that cost nothing and cannot
   * invent anything. What closes is the parser's tail — the phrases a closed
   * keyword set was never going to name — which is exactly the traffic a model
   * would be paid to interpret.
   *
   * Written through to storage rather than held for the session, for the reason the
   * mute switch is: a shop that decided on Friday not to spend money on this has
   * not decided it again on Monday, and a switch that silently resets is a switch
   * that cannot be relied on.
   *
   * Confirmed out loud either way, following `setMuted`: a kill switch whose only
   * feedback is that nothing happens is indistinguishable from a kill switch that
   * did nothing.
   *
   * Tier seam: `agentEnabled()` is the gate the agent turn is fired behind, checked
   * alongside `handlePhrase`'s `default:` arm once that tier is wired.
   */
  setAgentEnabled(on: boolean): void {
    if (on === this._agentEnabled()) {
      return;
    }
    this._agentEnabled.set(on);
    writeAgentPreference(on);
    // A turn killed mid-flight still changed the sale, and a batch left open would
    // hold a window whose countdown never starts. Sealed before the confirmation, so
    // what went in is reported before the switch is acknowledged.
    this.sealUndoBatch();
    this.say(
      on
        ? "Conversational again. Anything the commands don't cover, I'll try to work out."
        : "Commands only from here. I'll still add, remove, total, undo and check out."
    );
  }

  /** Flip the agent tier — the `G` key and the HUD button. */
  toggleAgent(): void {
    this.setAgentEnabled(!this._agentEnabled());
  }

  /**
   * Silence her, or give her voice back.
   *
   * Nothing about how the till works changes: she still recognises, still rings
   * items up, still asks which of two jars it is. The only channel that closes is
   * the audio one, and the captions were already carrying every word of it — which
   * is why this is a mute rather than a "quiet mode" that also stops her asking.
   *
   * Confirmed either way, and the confirmation lands either way: muting captions
   * the line without speaking it, unmuting speaks it as well. A switch whose only
   * feedback is the absence of feedback is a switch nobody trusts.
   */
  setMuted(muted: boolean): void {
    if (muted === this.voice.muted()) {
      return;
    }
    this.voice.setMuted(muted);
    this.say(muted ? "Muted. I'll keep captioning everything." : 'Voice back on.');
  }

  /** Flip the voice — the `Q` key and the HUD button. */
  toggleMute(): void {
    this.setMuted(!this.voice.muted());
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

  private startSampling(): void {
    this.stopSampling();
    this.sampleTimer = setInterval(() => this.tick(), SAMPLE_INTERVAL_MS);
  }

  private stopSampling(): void {
    if (this.sampleTimer !== null) {
      clearInterval(this.sampleTimer);
      this.sampleTimer = null;
    }
  }

  /**
   * One sampling tick: look at the frame, decide whether it's worth identifying.
   *
   * Held back while a recognition is in flight or while candidates are on screen
   * — in both cases the cashier is mid-interaction, and a new capture would
   * replace the question they were about to answer.
   */
  private tick(): void {
    // The camera being off already stops the timer; the guard is here so a stray
    // tick in flight at that moment cannot sample a stream that is going away.
    if (!this._cameraEnabled()) {
      return;
    }
    if (this._phase() !== 'ready' || this._busy() || this.awaitingChoice()) {
      this._scanProgress.set({ kind: this._busy() ? 'reading' : 'hidden' });
      return;
    }

    // Barcodes first, and on their own schedule. A code is unambiguous and reading
    // it is free, so there is no reason to make it wait for the scene to settle or
    // to pay a model to confirm what the bars already say.
    void this.scanForCodes();

    // Everything below is the model's path. The frame gate exists to decide when a
    // recognition call is worth paying for, so with recognition off there is
    // nothing for it to schedule — and a barcode never needed it in the first
    // place.
    if (!this._aiEnabled()) {
      return;
    }

    const sample = this.camera.sampleFrame();
    if (!sample) {
      return;
    }

    const now = performance.now();
    const verdict = this.gate.evaluate(sample, now);

    // A waiting look belongs to the scene that armed it, so motion abandons it —
    // and hands the gate back the capture it spent, because nothing was actually
    // looked at and the item must not be refused as a duplicate when it finally
    // does settle.
    if (this.looks.pending && verdict === 'moving') {
      this.looks.cancel();
      this.gate.forgetLastCapture();
    }

    if (verdict === 'moving' && this._visualState() === 'idle' && this._micEnabled()) {
      this._visualState.set('listening');
    }

    // The gate opens once per settled scene and reports its cooldown afterwards, so
    // the scheduler has to be asked again on the ticks in between or a debounced
    // look would be armed and never released.
    if (verdict === 'capture' || this.looks.pending) {
      this.decideLook(now);
      return;
    }

    this._barcodePriority.set(this.looks.barcodeHasPriority(now));
    this._verdict.set(verdict);
    this._scanProgress.set(this.orDwell(progressFor(verdict, this.gate.progress(now))));
  }

  /**
   * Let a barcode's dwell speak over the model's waits.
   *
   * One ring, two things that can be waiting on it, and a rule for which wins: the
   * dwell is about to produce an answer, while the frame gate's progress describes
   * a look that this very code is standing in the way of.
   */
  private orDwell(fallback: ScanProgress): ScanProgress {
    const dwell = this._barcodeDwell();
    return dwell === null ? fallback : { kind: 'settling', value: dwell };
  }

  /**
   * Spend on this frame, wait a little longer, or stand down for a barcode.
   *
   * Kept separate from `tick` because these three are the money decision and the
   * rest of the tick is bookkeeping.
   */
  private decideLook(now: number): void {
    switch (this.looks.request(now)) {
      case 'look':
        this._barcodePriority.set(false);
        this._verdict.set('capture');
        this._scanProgress.set({ kind: 'reading' });
        void this.identify();
        return;
      case 'deferred':
        // Reported as a duplicate because that is what it is — this scene has
        // already been identified, just not by the model. It also puts "Look again"
        // back on screen, which is the way to overrule that on the rare frame where
        // the code belongs to something other than the item being sold.
        // The gate spent a capture opening for this frame, and nothing was paid on
        // it. Handing it back is what stops the *next* item being swallowed as a
        // duplicate of a scene the model never actually looked at.
        this.gate.undoLastCapture();
        this._barcodePriority.set(true);
        this._verdict.set('duplicate');
        // Nothing to report unless a code is mid-dwell — in which case that dwell is
        // the reason this look stood down, and it is what the ring should show.
        this._scanProgress.set(this.orDwell({ kind: 'hidden' }));
        return;
      case 'settling':
        // From where the cashier is standing this is still the settle window they
        // were already in — "keep it there" — so the ring carries on filling
        // instead of dropping to zero and starting again, which would read as the
        // till having lost its place.
        this._barcodePriority.set(false);
        this._verdict.set('holding');
        this._scanProgress.set(this.orDwell({ kind: 'settling', value: this.debounceRing(now) }));
        return;
    }
  }

  /**
   * Where the ring should sit while the debounce runs.
   *
   * The two waits are weighted by their real lengths, so one continuous fill moves
   * at a constant rate across the gate's settle window and the debounce that
   * follows it.
   */
  private debounceRing(now: number): number {
    const share = this.looks.debounceMs / (this.gate.settleMs + this.looks.debounceMs);
    return 1 - share + share * this.looks.progress(now);
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
    const overlays = this.overlaysFor(found, presented);
    this._codes.set(overlays);

    const now = performance.now();

    // Barcodes first, and this is where that is enforced rather than hoped for. A
    // code we stock is a free and certain answer to the question the model would be
    // paid to guess at, so while one is in frame the model stands down — including
    // the case that costs the most, where the decode is still running when the
    // frame gate opens and both would otherwise answer the same frame.
    //
    // Noted from the first frame a stocked code appears, dwell or no dwell: the
    // whole point of the wait is to be sure about the code, and paying the model to
    // guess during it would be spending money to answer a question that is already
    // being answered for free.
    if (overlays.some((overlay) => overlay.matched)) {
      this.looks.noteStockedCode(now);
    }

    // Which pair of waits applies. With recognition off the bars are the only thing
    // the till is listening to, so presenting one is the whole command and there is
    // nothing left for a dwell to protect — it lands on the frame it is read.
    const timing = this._aiEnabled() ? GATED_TIMING : INSTANT_TIMING;
    const verdict = this.barcodeGate.observe(presented?.value ?? null, now, timing);

    const dwell = verdict === 'dwelling' ? this.barcodeGate.dwellProgress(now, timing) : null;
    this._barcodeDwell.set(dwell);
    if (dwell !== null) {
      // Written here as well as in `tick` because the tick that armed this dwell has
      // already finished its own synchronous pass over the ring by the time the
      // decode resolves. Without this the first dwell would show nothing at all.
      this._scanProgress.set({ kind: 'settling', value: dwell });
    }

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
      this.setMood(ClerkMood.ALERT);
      this.say("That barcode isn't in the catalogue.");
      this.publish(EventType.CLERK_ITEM_REJECTED, { reason: 'unknown-barcode', barcode: value });
      return;
    }

    this._confidence.set(1);
    const outcome = this.addProduct(
      product,
      `One ${product.name.toLowerCase()}, added.`,
      { confidence: 1, auto: true, barcode: value },
      { tier: 'barcode', confidence: 1, candidateCount: 1 }
    );
    if (outcome.added > 0) {
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
    if (!this._cameraEnabled()) {
      this.say('The camera is off. Say "camera on" when you want me to look.');
      return;
    }
    if (!this._aiEnabled()) {
      this.say('Recognition is off. Show me a barcode, or tell me what to add.');
      return;
    }
    this._candidates.set([]);
    this.gate.forgetLastCapture();
    // Neither wait applies to a look that was asked for out loud. The debounce
    // exists to find out whether the cashier meant it, and a barcode's priority
    // exists to save money the cashier has just decided to spend.
    this.looks.cancel();
    this._barcodePriority.set(false);
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
    // The look was the only thing that could still have answered a "look at this",
    // so the line stops waiting with it rather than spinning against a request that
    // has been abandoned.
    this.settlePending();
    // A look still inside its debounce window is abandoned for the same reason as
    // one already on the wire: it was armed for a scene that no longer applies.
    this.looks.cancel();
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
      // Every answering path above went through `say()`, which has already settled
      // it; this catches the aborted return, which deliberately says nothing.
      this.settlePending();
    }
  }

  // ─── Confidence gates ─────────────────────────────────────────────────────

  /**
   * Confident: put it in the cart and say so, with a way back.
   *
   * @param tier which recognizer gets the credit, or null when nothing should be
   *   logged because no recognizer was involved — a spoken "add a coffee" is the
   *   cashier telling the till, not a proposal that could have been wrong.
   * @param quantity how many to ring up. Every unit still goes through stock
   *   validation on its own.
   * @returns what the add actually did, so a caller can report the count rather
   *   than infer it from the cart afterwards.
   */
  private autoAdd(
    candidate: VisionCandidate,
    utterance: string,
    tier: RecognitionTier | null = 'model',
    quantity = 1,
    batch?: UndoBatch
  ): SpokenAddOutcome {
    const product = this.findProduct(candidate.productId);
    if (!product) {
      this.askAgain("That isn't something I can ring up.");
      return {
        added: 0,
        wanted: clampSpokenQuantity(quantity),
        name: '',
        reason: 'unknown-product',
      };
    }

    const outcome = this.addProduct(
      product,
      utterance,
      { confidence: candidate.confidence, auto: true },
      tier === null ? undefined : { tier, confidence: candidate.confidence, candidateCount: 1 },
      quantity,
      batch
    );
    if (outcome.added === 0) {
      // Let the same scene be read again — the cashier is about to try something
      // else with the item still in hand.
      this.gate.forgetLastCapture();
    }
    return outcome;
  }

  /**
   * The one way anything reaches the cart.
   *
   * Barcodes and the model both come through here, so stock validation, the undo
   * window, the spoken confirmation, the event trail and the telemetry are
   * identical whichever route was taken. The two callers differ only in which gate
   * they release when the add is refused, which is why that is left to them.
   *
   * Quantity is applied by running the same single-item add that many times
   * rather than by writing a quantity straight into the cart: stock is checked
   * per unit, so "add three" against two in stock puts two in and says so,
   * instead of failing the whole command or overselling by one.
   *
   * The quantity is clamped here rather than trusted, because the loop guard is
   * what a bad number defeats: `added >= wanted` is permanently false for a
   * non-finite want, so the loop would run until stock refused and put the whole
   * shelf in the cart from one utterance — silently, and with a spoken line that
   * claimed success.
   *
   * @returns what went in, how much was wanted after clamping, and why it fell
   *   short if it did.
   */
  private addProduct(
    product: Product,
    utterance: string,
    meta: Record<string, unknown>,
    provenance?: { tier: RecognitionTier; confidence: number; candidateCount: number },
    quantity = 1,
    batch?: UndoBatch
  ): SpokenAddOutcome {
    const wanted = clampSpokenQuantity(quantity);
    let added = 0;
    let result = this.pos.tryAddToCart(product);
    while (result.added) {
      added++;
      if (added >= wanted) {
        break;
      }
      result = this.pos.tryAddToCart(product);
    }
    // The loop only exits on a refusal or on having enough, so a refused last
    // attempt is the only thing that can put a reason on the outcome.
    const reason = result.added ? undefined : result.reason;

    if (added === 0 && !result.added) {
      // Stock rules are the terminal's, not the clerk's — she just reports them.
      this._visualState.set('confused');
      this._candidates.set([]);
      this.reportAdd(
        batch,
        { added: 0, wanted, name: product.name, reason },
        ClerkMood.SORRY,
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
      return { added: 0, wanted, name: product.name, reason };
    }

    this._added.update((n) => n + added);
    this._candidates.set([]);
    this._visualState.set('found');
    this._plopToken.update((token) => token + added);
    // A short count is not a win, and it is reported rather than glossed over: the
    // cashier has to know the sale is one short before the customer is at the door.
    // Inside a batch both the mood and the words are held until the seal, which then
    // says all of it at once — see `reportAdd`.
    this.reportAdd(
      batch,
      { added, wanted, name: product.name, reason },
      added < wanted ? ClerkMood.SORRY : ClerkMood.HAPPY,
      added < wanted
        ? `Only ${added} ${product.name.toLowerCase()} in stock, so that's what I added.`
        : utterance || `${describeQuantity(added, product.name)}, added.`
    );
    // Opened first, and only then tracked: `openUndoWindow` clears the previous
    // window, and clearing a window stops tracking its log row — so assigning
    // before this call would have the new row wiped by its own window opening. The
    // same order holds for every appended line of a batch.
    this.openUndoWindow({ productId: product.id, label: product.name, quantity: added }, batch);
    if (provenance) {
      this.openLogEntries.push({
        id: this.log.record({
          tier: provenance.tier,
          proposedProductId: product.id,
          confidence: provenance.confidence,
          candidateCount: provenance.candidateCount,
          // Optimistic: revised to 'undone' if the cashier takes it back.
          outcome: 'auto',
        }),
        productId: product.id,
      });
    }
    this.publish(EventType.CLERK_ITEM_RECOGNIZED, {
      productId: product.id,
      name: product.name,
      quantity: added,
      ...meta,
    });
    this.count('clerk.autoadds', undefined, added);
    return { added, wanted, name: product.name, reason };
  }

  /** Unsure between a few: show them and wait. */
  private offerChoice(
    candidates: VisionCandidate[],
    utterance: string,
    origin: 'model' | 'voice' = 'model'
  ): void {
    this.candidateOrigin = origin;
    this._candidates.set(candidates.slice(0, 3));
    this._visualState.set('confused');
    this.setMood(ClerkMood.UNSURE);
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
    this.setMood(ClerkMood.UNSURE);
    this.say(utterance || "I can't tell what that is. Turn the label towards me?");
    // Without this the identical frame would be rejected as a duplicate and she
    // would repeat the request forever.
    this.gate.forgetLastCapture();
  }

  // ─── Cashier actions ──────────────────────────────────────────────────────

  /** Take the top candidate. */
  confirmTop(): void {
    this.takeCandidate(1, 'cashier');
  }

  /** Take candidate `position` (1-based, as spoken and as labelled). */
  chooseCandidate(position: number): void {
    this.takeCandidate(position, 'cashier');
  }

  /**
   * Take candidate `position` on behalf of `confirmedBy`.
   *
   * The actor is a parameter of this *private* method and deliberately not of the
   * public one: an optional actor argument on `chooseCandidate` would let anything
   * holding the facade claim to be the cashier, which is the exact hole the
   * predicate below closes. Every public caller — key, click, spoken confirm — is
   * the cashier, so they say so once, here.
   */
  private takeCandidate(
    position: number,
    confirmedBy: ChoiceActor,
    batch?: UndoBatch
  ): SpokenAddOutcome {
    const offered = this._candidates();
    const candidate = offered[position - 1];
    if (!candidate) {
      return { added: 0, wanted: 1, name: '', reason: 'unknown-product' };
    }
    const product = this.findProduct(candidate.productId);
    const top = offered[0];
    const origin = this.candidateOrigin;
    this._candidates.set([]);
    if (!product) {
      this.askAgain("I've lost track of that one. Show me again?");
      return { added: 0, wanted: 1, name: '', reason: 'unknown-product' };
    }

    // The most valuable row in the log: what was offered first, and what the cashier
    // actually wanted. `corrected` means the ranking was wrong and here is the truth.
    // Written only when a recognizer proposed the ranking *and* a human picked from
    // it — see `shouldScoreChoice` for why neither half is optional.
    const score = shouldScoreChoice(origin, confirmedBy);
    if (score) {
      this.log.record({
        tier: 'model',
        proposedProductId: top?.productId,
        confidence: top?.confidence ?? 0,
        candidateCount: offered.length,
        outcome: position === 1 ? 'chosen' : 'corrected',
        actualProductId: product.id,
      });
    }
    // Route through the same auto-add path: a hand-picked item still has to
    // satisfy stock, still gets an undo window, still emits the same event.
    // The tier comes off the same predicate, so a suppressed choice row cannot
    // leave a `tier: 'model'` add row behind it either.
    return this.autoAdd(
      { ...candidate, confidence: 1 },
      `One ${product.name.toLowerCase()}, added.`,
      score ? 'model' : null,
      1,
      batch
    );
  }

  /**
   * Ask the page to take this sale to payment. The one way in.
   *
   * Named and public so the path to the till is greppable: every other write the
   * clerk makes is covered by the four second undo window, and navigating to
   * payment is not — once the customer is looking at a total, taking it back is a
   * conversation rather than a keystroke. A writable signal gave anything holding
   * this facade that ability without leaving a trace of who used it.
   *
   * This is also the hook for ending a sale: the agentic clerk clears its turn
   * memory and aborts any in-flight turn here, so a turn cannot land against a cart
   * that has already been paid for.
   */
  requestCheckout(): void {
    this._checkoutRequested.update((n) => n + 1);
  }

  /** None of those. Look again. */
  reject(): void {
    const offered = this._candidates();
    if (offered.length > 0 && this.candidateOrigin === 'model') {
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

  /**
   * Reverse the last add. Exactly one decrement, matching exactly one add.
   *
   * Abort seam: `abortAgentTurn()` becomes this method's first statement once the
   * agent tier exists, as it does in `dismiss()` and in `handlePhrase`'s `checkout`
   * case — the three parser-answered verbs that mean "the cashier moved on".
   */
  undoLast(): void {
    const pending = this._pendingAdd();
    if (!pending) {
      // Silence here is the same bug as an unheard command: the cashier pressed
      // undo, or said it, and has no way to tell that from a dead control.
      this.say('Nothing to undo. Tell me which item to take off.');
      return;
    }
    const reversed = this.reverseLines(pending.lines);
    if (reversed.length === 0) {
      // The window can outlive the lines it refers to — a spoken removal, or a
      // checkout, may have emptied them all.
      this.clearUndo();
      this.say(describeAbsent(pending.lines));
      return;
    }
    // The undo window exists to make a mistake cheap; it is also the cleanest label
    // available for "that was wrong", so every row belonging to a line this actually
    // reversed is revised. Before `clearUndo`, which stops tracking them.
    for (const entry of this.openLogEntries) {
      if (reversed.some((line) => line.productId === entry.productId)) {
        this.log.amend(entry.id, 'undone');
      }
    }
    this.clearUndo();
    // What was actually taken back, never what was recorded: a line already gone
    // was skipped above and must not be counted off twice.
    const taken = reversed.reduce((sum, line) => sum + line.quantity, 0);
    this._added.update((n) => Math.max(0, n - taken));
    this.goIdle();
    // An undo is her mistake being corrected, not a routine edit.
    this.setMood(ClerkMood.SORRY);
    this.say(`${describeLines(reversed)} removed.`);
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

  /**
   * Say the last thing again.
   *
   * Deliberately not routed through `say()`: the caption is the thing being
   * repeated, so rewriting it with its own contents would make a repeat look like
   * a new answer on the screen reading of the session. The voice service keeps its
   * own mute gate, so a repeat while muted is dropped there rather than here — the
   * caption channel is the one that never goes quiet.
   *
   * With nothing said yet it answers anyway, following `undoLast`'s "Nothing to
   * undo": a control that does nothing is indistinguishable from a broken one.
   */
  repeatLast(): void {
    const spoken = this._caption();
    if (spoken.length === 0) {
      this.say('Nothing to repeat yet.');
      return;
    }
    this.voice.speak(spoken);
  }

  /**
   * Never mind. Acknowledge it and settle, and change nothing else.
   *
   * Touches neither the cart, the undo window, the candidates nor an in-flight
   * look. This means "the cashier moved on", not "put that back" — `undoLast` and
   * `reject` are the ones that take something back, and both are one word away. In
   * particular a pending add keeps the rest of its window: guessing that "never
   * mind" meant the last add would be the expensive reading of the cheap word.
   *
   * Abort seam: `abortAgentTurn()` becomes this method's first statement once the
   * agent tier exists, alongside the same insertion in `undoLast()` and in
   * `handlePhrase`'s `checkout` case.
   */
  dismiss(): void {
    this.say('Okay.');
    this.setMood(ClerkMood.NEUTRAL);
  }

  /** Name the small set of things she can do, from a constant. */
  speakHelp(): void {
    this.say(HELP_TEXT);
  }

  // ─── Voice ────────────────────────────────────────────────────────────────

  /**
   * Handle one completed spoken phrase, and put the cashier's side of it on screen.
   *
   * The phrase is recorded before it is routed, so the log reads in the order it
   * happened rather than answer-first, and recorded whatever the outcome: a phrase
   * that named no intent is precisely the one worth seeing, because silence from a
   * till and a phrase it never understood look identical from the counter.
   *
   * Any line still waiting is settled first. The ear is only paused while she is
   * *speaking*, so a look on the wire leaves the mic live and the cashier talks over
   * it — and `scanNow()` refuses while busy, so those phrases are answered by nothing
   * at all. Only one line can be waiting on the single in-flight look, so overwriting
   * the marker without settling stranded the previous line as pending for the rest of
   * the session, one spinner per interjection. A spinner nothing will ever clear reads
   * as a till that has hung, which is worse than attributing the answer to the later
   * line.
   */
  private handlePhrase(phrase: string): ClerkIntentOutcome {
    this.settlePending();
    this.pendingLine = this.recordExchange('cashier', phrase, true);
    const outcome = this.routePhrase(phrase);
    // `say()` settles the line as it answers, so anything still pending here got no
    // answer in this tick. Only a look genuinely answers later; everything else in
    // this facade is synchronous, so leaving the line pending would be a claim that
    // a reply is on its way when nothing is going to send one.
    if (!this._busy()) {
      this.settlePending();
    }
    return outcome;
  }

  /**
   * Route one phrase to the method that owns it.
   *
   * `checkout` is returned to the caller rather than acted on here: navigation
   * belongs to the component that owns the route.
   */
  private routePhrase(phrase: string): ClerkIntentOutcome {
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
      case 'add':
        this.addByName(intent.query, intent.quantity);
        return 'handled';
      case 'clearRequested':
        // Understood and refused. Emptying a sale is not undoable by the four
        // second window, so it stays a deliberate act on the terminal.
        this.say(
          "I can't clear the whole cart. Take items off one at a time, or use the terminal."
        );
        return 'handled';
      case 'remove':
        this.removeByName(intent.query, intent.quantity);
        return 'handled';
      case 'camera':
        void this.setCameraEnabled(intent.on);
        return 'handled';
      case 'ai':
        this.setAiEnabled(intent.on);
        return 'handled';
      case 'look':
        this.scanNow();
        return 'handled';
      case 'undo':
        this.undoLast();
        return 'handled';
      case 'total':
        this.speakTotal();
        return 'handled';
      case 'voice':
        this.setMuted(!intent.on);
        return 'handled';
      case 'mic':
        // Only ever off by voice. "Start listening" into a microphone that is
        // already off cannot be heard, so the way back in is the key or the button.
        if (this._micEnabled()) {
          this.toggleMic();
        }
        return 'handled';
      case 'checkout':
        // Abort seam: story 4 aborts any in-flight agent turn here, since this is
        // one of the three parser-answered verbs that mean "the cashier moved on".
        this.requestCheckout();
        return 'handled';
      case 'repeat':
        this.repeatLast();
        return 'handled';
      case 'dismiss':
        this.dismiss();
        return 'handled';
      case 'help':
        this.speakHelp();
        return 'handled';
      default:
        return 'ignored';
    }
  }

  /**
   * Ring up something the cashier named out loud.
   *
   * Matched against the whole catalogue rather than against whatever is on screen,
   * which is the entire point: "add a sandwich" has to work with the camera off,
   * with nothing in frame, and with no candidates showing.
   *
   * A name that fits more than one product is shown as a choice rather than
   * guessed at. The cards, the number keys and `chooseCandidate` are the ones
   * already there, so a spoken ambiguity is answered exactly the way a visual one
   * is — and neither path can charge for an item nobody named.
   */
  private addByName(
    query: string[],
    quantity: number,
    confirmedBy: ChoiceActor = 'cashier',
    batch?: UndoBatch
  ): SpokenAddOutcome {
    // Naming one of the products already on screen is answering the question she
    // asked, not starting a new command — and answering it through
    // `takeCandidate` is what writes the 'chosen' / 'corrected' row that tells
    // us whether the recognizer's ranking was any good. The actor is carried
    // through because that row is a claim about who confirmed the ranking.
    const onScreen = this.matchOnScreen(query);
    if (onScreen !== null) {
      return this.takeCandidate(onScreen, confirmedBy, batch);
    }

    const wanted = clampSpokenQuantity(quantity);
    const resolved = this.resolveSpokenName(query);

    if (resolved.kind === 'none') {
      this._visualState.set('confused');
      this.setMood(ClerkMood.UNSURE);
      this.say(`I don't have ${spokenName(query)} in the catalogue.`);
      this.publish(EventType.CLERK_ITEM_REJECTED, {
        reason: 'unknown-spoken-name',
        heard: query.join(' '),
      });
      return { added: 0, wanted, name: '', reason: 'unknown-name' };
    }

    if (resolved.kind === 'ambiguous') {
      this.offerChoice(
        resolved.products.slice(0, 3).map((product) => ({
          productId: product.id,
          label: product.name,
          // Certainty about the name, which is not certainty about which one —
          // that is what the choice is for.
          confidence: 1,
        })),
        `I have a few of those. Which one?`,
        'voice'
      );
      return { added: 0, wanted, name: '', reason: 'ambiguous' };
    }

    const product = resolved.product;
    // Left at zero on purpose: the yuzu reports how sure she is about what she can
    // *see*, and she was told this one. A full glow would claim a reading that
    // never happened.
    return this.autoAdd(
      { productId: product.id, label: product.name, confidence: 1 },
      `${describeQuantity(wanted, product.name)}, added.`,
      // Nothing recognized anything here, so nothing is scored for it.
      null,
      wanted,
      batch
    );
  }

  /**
   * Which on-screen card a spoken name decisively picks, if any.
   *
   * "Decisive" means one card ranked strictly above the rest. A tie is left for the
   * catalogue path rather than resolved by array order, because array order here is
   * the recognizer's ranking and picking by it would charge for an item nobody
   * actually named.
   *
   * @returns a 1-based card position, or null when nothing on screen settles it.
   */
  private matchOnScreen(query: string[]): number | null {
    const offered = this._candidates();
    if (offered.length === 0) {
      return null;
    }
    const ranked = rankLabelsBySpokenWords(
      query,
      offered.map((candidate) => candidate.label)
    );
    const top = ranked[0];
    const next = ranked[1];
    if (top === undefined) {
      return null;
    }
    const decisive =
      next === undefined || next.score !== top.score || next.coverage !== top.coverage;
    return decisive ? top.index + 1 : null;
  }

  /**
   * Resolve a spoken name against the loaded catalogue.
   *
   * The one ranking over `_catalog()` in the codebase, on purpose. A second one
   * would be a second answer to "what did she just name", and the two would drift
   * — so every caller that needs the question answered comes here, including the
   * ones that only want to know whether a product is stocked at all.
   *
   * The ambiguous arm carries the tied products rather than a bare flag: callers
   * render them (as cards, or as a tool's alternatives) and would otherwise have to
   * rank the catalogue again to find out what tied.
   *
   * No `ProductService` round trip — the catalogue is already loaded at `start()`.
   */
  private resolveSpokenName(
    query: string[]
  ):
    | { kind: 'none' }
    | { kind: 'one'; product: Product }
    | { kind: 'ambiguous'; products: Product[] } {
    const catalog = this._catalog();
    const ranked = rankLabelsBySpokenWords(
      query,
      catalog.map((product) => product.name)
    );
    const best = ranked[0];
    if (!best) {
      return { kind: 'none' };
    }

    const tied = ranked.filter((match) => match.score === best.score);
    if (tied.length > 1) {
      return { kind: 'ambiguous', products: tied.map((match) => catalog[match.index]!) };
    }
    return { kind: 'one', product: catalog[best.index]! };
  }

  /**
   * Answer a removal for something that is not in the cart.
   *
   * Two different failures with two different fixes: a product this till doesn't
   * sell, or one it sells that simply hasn't been rung up. Saying which one saves
   * the cashier from checking the wrong thing.
   *
   * Split out of `removeByName` to keep it under the complexity cap once it started
   * returning an outcome as well as speaking one.
   */
  private reportUnknownRemoval(query: string[], wanted: number): SpokenRemoveOutcome {
    // Through the one resolver, not a second ranking over the catalogue: the
    // question "does this shop sell it" has exactly one answer.
    const stocked = this.resolveSpokenName(query).kind !== 'none';
    this._visualState.set('confused');
    this.setMood(ClerkMood.UNSURE);
    this.say(
      stocked
        ? `There's no ${query.join(' ')} in the cart.`
        : `I don't have ${spokenName(query)} in the catalogue.`
    );
    this.publish(EventType.CLERK_ITEM_REJECTED, {
      reason: stocked ? 'not-in-cart' : 'unknown-spoken-name',
      heard: query.join(' '),
    });
    return { removed: 0, wanted, name: '', reason: stocked ? 'not-in-cart' : 'unknown-name' };
  }

  /**
   * Take something the cashier named back off the sale.
   *
   * Matched against the cart, not the catalogue: "remove the water bottle" is a
   * statement about this sale, and ranking against everything the shop sells
   * would happily match a product that was never rung up.
   *
   * An ambiguous removal asks instead of offering the candidate cards — those
   * cards add when you press them, so using them here would do the opposite of
   * what was asked.
   */
  private removeByName(query: string[], quantity: number): SpokenRemoveOutcome {
    const wanted = clampSpokenQuantity(quantity);
    const items = this.pos.cartItems();
    if (items.length === 0) {
      this.say('The cart is empty.');
      return { removed: 0, wanted, name: '', reason: 'not-in-cart' };
    }

    const ranked = rankLabelsBySpokenWords(
      query,
      items.map((item) => item.product.name)
    );
    const best = ranked[0];
    if (!best) {
      return this.reportUnknownRemoval(query, wanted);
    }

    const tied = ranked.filter((match) => match.score === best.score);
    if (tied.length > 1) {
      this._visualState.set('confused');
      this.setMood(ClerkMood.UNSURE);
      this.say(
        `I have ${tied
          .slice(0, 3)
          .map((match) => items[match.index]!.product.name.toLowerCase())
          .join(' and ')}. Which one?`
      );
      return { removed: 0, wanted, name: '', reason: 'ambiguous' };
    }

    const product = items[best.index]!.product;
    // Checked before decrementing, not after: `decreaseQuantity` throws when the
    // product isn't there, and this runs inside a speech callback where a thrown
    // error would be swallowed and the cashier would just see nothing happen.
    const inCart = this.pos.getQuantity(product.id);
    if (inCart === 0) {
      this.say(`There's no ${product.name.toLowerCase()} in the cart.`);
      return { removed: 0, wanted, name: product.name, reason: 'not-in-cart' };
    }

    // Clamped before it is bounded by the cart: `Math.min(NaN, inCart)` is `NaN`,
    // which makes `removing >= inCart` false and the `for` loop body never run — a
    // removal that silently does nothing and looks exactly like not being heard.
    const removing = Math.min(wanted, inCart);
    // Bounded by what is actually in the cart, never by what was asked for:
    // `decreaseQuantity` throws once the line is gone, and this runs inside a
    // speech callback where that error would be swallowed and look like silence.
    if (removing >= inCart) {
      this.pos.removeFromCart(product.id);
    } else {
      for (let i = 0; i < removing; i++) {
        this.pos.decreaseQuantity(product.id);
      }
    }

    // The pending undo describes a cart that no longer looks like that. Left alone
    // it would offer an "Undo" button that decrements a line this just emptied. Only
    // the named line goes: the rest of a batched window is still reversible.
    this.dropFromUndoWindow(product.id);

    this._added.update((n) => Math.max(0, n - removing));
    this.goIdle();
    // Deliberately neutral, unlike undo: taking a line off is an ordinary edit to
    // the sale, and an apology for it would be noise.
    this.setMood(ClerkMood.NEUTRAL);
    this.say(`${describeQuantity(removing, product.name)} removed.`);
    this.publish(EventType.CLERK_ITEM_REMOVED, {
      productId: product.id,
      name: product.name,
      quantity: removing,
    });
    // Deliberately not touching either gate, unlike `undoLast`. Undo means "wrong
    // item, the right one is coming"; naming an item to remove usually corrects
    // something from earlier in the sale. If it does happen to still be in frame,
    // releasing the barcode gate would ring it straight back and the removal would
    // look broken.
    return { removed: removing, wanted, name: product.name };
  }

  /** Say something, caption it, and put it in the exchange, all at one moment. */
  private say(text: string): void {
    if (text.trim().length === 0) {
      return;
    }
    this._caption.set(text);
    // Answering is what settles the question, so this happens before her line is
    // appended: the cashier's line stops waiting at the same instant the reply
    // lands, and no frame is ever rendered with both a pending question and its
    // answer under it.
    this.settlePending();
    this.recordExchange('agent', text);
    this.voice.speak(text);
  }

  // ─── Exchange ─────────────────────────────────────────────────────────────

  /**
   * Append one line and trim the log back to `MAX_EXCHANGES`.
   *
   * Trims from the front so the newest line is always kept: the bound is about how
   * much fits on screen, and dropping the newest to honour it would be the one
   * outcome nobody wants.
   *
   * @returns the new line's id, so a caller that has to come back and settle it can.
   */
  private recordExchange(author: ChoiceActor, text: string, pending = false): number {
    const id = ++this.exchangeSeq;
    this._exchanges.update((lines) =>
      [...lines, { id, author, text, pending }].slice(-MAX_EXCHANGES)
    );
    return id;
  }

  /**
   * Nothing is outstanding any more.
   *
   * Clears by id rather than clearing every flag, so a line that has already
   * scrolled off cannot be resurrected, and returns the array unchanged when there
   * is nothing to do — this runs on every `say()`, and a new array each time would
   * re-render the whole log for every utterance.
   */
  private settlePending(): void {
    const id = this.pendingLine;
    if (id === null) {
      return;
    }
    this.pendingLine = null;
    this._exchanges.update((lines) =>
      lines.some((line) => line.id === id && line.pending)
        ? lines.map((line) => (line.id === id ? { ...line, pending: false } : line))
        : lines
    );
  }

  /**
   * Put her in a mood, and start it fading.
   *
   * Every mood replaces the one before it and cancels its fade rather than queueing
   * behind it, so a run of quick scans reads as a run of quick reactions instead of
   * one long held expression. `neutral` is also how the mood is cleared — asking for
   * it stops the timer and settles her immediately, which is what ending a session
   * or a plain cart edit wants.
   */
  private setMood(mood: ClerkMood): void {
    if (this.moodTimer !== null) {
      clearTimeout(this.moodTimer);
      this.moodTimer = null;
    }
    this._mood.set(mood);
    if (mood === ClerkMood.NEUTRAL) {
      return;
    }
    this.moodTimer = setTimeout(() => {
      this.moodTimer = null;
      this._mood.set(ClerkMood.NEUTRAL);
    }, MOOD_HOLD_MS);
  }

  // ─── Undo window ──────────────────────────────────────────────────────────

  /**
   * Claim the undo window for one multi-step turn.
   *
   * The token this returns is the only thing that makes an add append to the open
   * window instead of replacing it, and it is handed down as a parameter — so an
   * add from anywhere else, a barcode above all, still supersedes the window
   * exactly as it does today. Every batch must be sealed; `sealUndoBatch()` belongs
   * in the caller's `finally`, because a batch left open holds a window whose
   * countdown has not started.
   */
  private beginUndoBatch(): UndoBatch {
    // Any batch still open belongs to a turn that has ended without sealing, and
    // leaving it would let two turns append to one window.
    this.sealUndoBatch();
    const batch: UndoBatch = { outcomes: [], open: false };
    this.openBatch = batch;
    return batch;
  }

  /**
   * Close the batch: one countdown, one mood, one utterance, one measurement.
   *
   * **The utterance is unconditional.** Per-line speech is deferred while a batch is
   * open, so this is the only thing left that can report what went into the sale —
   * including a short count, and including on a turn whose agent outcome is
   * `exhausted`, `declined` or `unavailable`. Those outcomes are silent for a turn
   * that changed *nothing*; a turn that changed the cart is never silent. A batch
   * that committed nothing and attempted nothing says nothing, which is the same
   * rule read the other way.
   *
   * @param answer the agent's own answer, spoken after the summary. The summary is
   *   exempt from the speech budget: the trim consumes the answer, and an
   *   over-budget summary is spoken alone.
   * @returns the summary, for a caller that has to log or assert it.
   */
  private sealUndoBatch(answer = ''): string {
    const batch = this.openBatch;
    this.openBatch = null;
    if (batch === null) {
      return '';
    }
    // Started here and nowhere else, which is what stops a line expiring mid-turn:
    // while the batch is open the window holds at full with no timer against it.
    if (batch.open) {
      this.measure('clerk.undo.batch.lines', this._pendingAdd()?.lines.length ?? 0);
      this.startUndoCountdown();
    }
    const summary = describeBatch(batch.outcomes);
    if (summary.length === 0) {
      return '';
    }
    // One mood for the turn, set at the instant the countdown starts, so
    // `MOOD_HOLD_MS > UNDO_WINDOW_MS` still holds per batch rather than per line.
    this.setMood(batch.outcomes.some(cameUpShort) ? ClerkMood.SORRY : ClerkMood.HAPPY);
    this.say(joinWithinSpeechBudget(summary, answer));
    return summary;
  }

  /**
   * Say one line's outcome now, or hand it to the seal to say later.
   *
   * One helper rather than a branch at each call site: speaking twice inside one
   * turn pauses the ear across the whole of both utterances, which is exactly the
   * window the cashier is most likely to want to correct her in.
   */
  private reportAdd(
    batch: UndoBatch | undefined,
    outcome: SpokenAddOutcome,
    mood: ClerkMood,
    utterance: string
  ): void {
    if (batch !== undefined) {
      batch.outcomes.push(outcome);
      return;
    }
    this.setMood(mood);
    this.say(utterance);
  }

  /**
   * Put one line inside the undo window.
   *
   * With a live batch token the line is **appended** and the window is refilled
   * without a countdown running, so N lines come back as one unit. With no token —
   * a barcode, a vision auto-add, a spoken single command — the previous window is
   * cleared and this one starts ticking immediately, byte for byte as before.
   */
  private openUndoWindow(line: PendingAddLine, batch?: UndoBatch): void {
    if (batch !== undefined && batch === this.openBatch && batch.open) {
      this._pendingAdd.update((pending) => ({ lines: [...(pending?.lines ?? []), line] }));
      this._undoMsLeft.set(UNDO_WINDOW_MS);
      return;
    }
    this.clearUndo();
    this._pendingAdd.set({ lines: [line] });
    this._undoMsLeft.set(UNDO_WINDOW_MS);
    if (batch !== undefined && batch === this.openBatch) {
      // The batch owns the window from here; the countdown waits for the seal.
      batch.open = true;
      return;
    }
    // Recorded for a single add too, so window size is comparable across tiers.
    this.measure('clerk.undo.batch.lines', 1);
    this.startUndoCountdown();
  }

  /**
   * Take back every line of the window, newest first.
   *
   * Newest first so the decrements unwind in the order they were made. Each line is
   * pre-checked against the cart and clamped to what is actually there:
   * `CartService.decreaseQuantity` throws on an absent line, and this runs inside a
   * speech callback where a throw is swallowed and reads as the till doing nothing.
   * A line already gone is skipped rather than thrown on.
   *
   * @returns what was really taken back, in insertion order so the cashier hears the
   *   lines in the order they went in.
   */
  private reverseLines(lines: readonly PendingAddLine[]): PendingAddLine[] {
    const taken: PendingAddLine[] = [];
    for (let i = lines.length - 1; i >= 0; i--) {
      const line = lines[i]!;
      const taking = Math.min(line.quantity, this.pos.getQuantity(line.productId));
      for (let unit = 0; unit < taking; unit++) {
        this.pos.decreaseQuantity(line.productId);
      }
      if (taking > 0) {
        taken.push({ ...line, quantity: taking });
      }
    }
    return taken.reverse();
  }

  /** 250ms ticks: fine enough for a smooth countdown, coarse enough to be free. */
  private startUndoCountdown(): void {
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

  /**
   * Take one product's line out of the open window, leaving the rest reversible.
   *
   * Amended before it is dropped: a cashier taking off the item she had just
   * proposed is the clearest ground truth the recognizer's accuracy ever gets. The
   * window only closes once its last line is gone.
   */
  private dropFromUndoWindow(productId: string): void {
    const pending = this._pendingAdd();
    if (pending === null) {
      return;
    }
    const remaining = pending.lines.filter((line) => line.productId !== productId);
    if (remaining.length === pending.lines.length) {
      return;
    }
    for (const entry of this.openLogEntries) {
      if (entry.productId === productId) {
        this.log.amend(entry.id, 'undone');
      }
    }
    if (remaining.length === 0) {
      this.clearUndo();
      return;
    }
    this.openLogEntries = this.openLogEntries.filter((entry) => entry.productId !== productId);
    this._pendingAdd.set({ lines: remaining });
  }

  private clearUndo(): void {
    // Left to stand: the optimistic 'auto' rows are now known to be correct, so
    // there is nothing to amend — just stop tracking them.
    this.openLogEntries = [];
    // A window that has gone cannot be appended to, so the turn that owned it loses
    // its claim on one. Not its report: the lines it already committed still have to
    // be spoken at the seal, or a deferred short count would go with the window.
    if (this.openBatch !== null) {
      this.openBatch.open = false;
    }
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
  private count(name: string, tags?: Record<string, string>, amount = 1): void {
    try {
      this.telemetry.recordCounter(name, amount, tags);
    } catch (error) {
      console.warn(`[Clerk] Telemetry counter ${name} failed:`, error);
    }
  }

  /** A distribution rather than a total — same contract, same reason for the catch. */
  private measure(name: string, value: number, tags?: Record<string, string>): void {
    try {
      this.telemetry.recordHistogram(name, value, tags);
    } catch (error) {
      console.warn(`[Clerk] Telemetry histogram ${name} failed:`, error);
    }
  }
}

type ClerkIntentOutcome = 'handled' | 'ignored';

/**
 * "One coffee" / "three coffees" — a count and a name that read aloud correctly.
 *
 * Naive pluralization, which is the right amount for spoken confirmations: the
 * cashier is listening for the number and already knows what they asked for.
 */
function describeQuantity(quantity: number, name: string): string {
  const label = name.toLowerCase();
  if (quantity <= 1) {
    return `One ${label}`;
  }
  return `${quantity} ${label}${/(?:s|x|z|ch|sh)$/.test(label) ? 'es' : 's'}`;
}

/**
 * "One coffee and 3 sandwiches" — several lines read as one phrase.
 *
 * Beside `describeQuantity` rather than in a template or a component: this is the
 * same question that method answers, asked of a list.
 */
function describeLines(lines: readonly PendingAddLine[]): string {
  return joinPhrases(lines.map((line) => describeQuantity(line.quantity, line.label)));
}

/** What the Undo control reads: today's text for one line, a unit count for many. */
function describeUndoLabel(lines: readonly PendingAddLine[]): string {
  const only = lines[0];
  if (only === undefined) {
    return '';
  }
  if (lines.length === 1) {
    return `Undo ${only.quantity > 1 ? `${only.quantity} × ` : ''}${only.label}`;
  }
  // Units rather than lines: "Undo 2 items" for three coffees would misdescribe
  // what the button is about to take off the sale.
  return `Undo ${lines.reduce((sum, line) => sum + line.quantity, 0)} items`;
}

/** Whether an add put in fewer units than were asked for. */
function cameUpShort(outcome: SpokenAddOutcome): boolean {
  return outcome.added < outcome.wanted;
}

/**
 * One utterance for everything a turn put in the sale.
 *
 * Every short count is stated as `added of wanted` rather than implied, because this
 * is the only thing left that reports it: per-line speech is deferred inside a
 * batch, and with the voice off `_caption` carries exactly this text. Empty for a
 * turn that attempted nothing, which is the one case the seal is allowed to be
 * silent in.
 */
function describeBatch(outcomes: readonly SpokenAddOutcome[]): string {
  const parts: string[] = [];
  const added = outcomes.filter((outcome) => outcome.added > 0);
  if (added.length > 0) {
    parts.push(`${describeLines(added.map(lineOf))}, added.`);
  }
  const short = outcomes.filter(cameUpShort);
  if (short.length > 0) {
    parts.push(
      `Short on ${joinPhrases(
        short.map((outcome) => `${outcome.name.toLowerCase()}, ${outcome.added} of ${outcome.wanted}`)
      )}.`
    );
  }
  return parts.join(' ');
}

/** An outcome as the window's phrasing sees it: a count and a name. */
function lineOf(outcome: SpokenAddOutcome): PendingAddLine {
  return { productId: '', label: outcome.name, quantity: outcome.added };
}

/** Nothing left to take back, said for one line or for several. */
function describeAbsent(lines: readonly PendingAddLine[]): string {
  const only = lines[0];
  return lines.length === 1 && only !== undefined
    ? `${only.label} is already off the sale.`
    : 'Those are already off the sale.';
}

/** "a", "a and b", "a, b and c" — one list, read aloud. */
function joinPhrases(phrases: readonly string[]): string {
  if (phrases.length <= 1) {
    return phrases[0] ?? '';
  }
  return `${phrases.slice(0, -1).join(', ')} and ${phrases[phrases.length - 1]}`;
}

/** Read back what was heard, for a name that matched nothing. */
function spokenName(query: string[]): string {
  return query.length > 0 ? `"${query.join(' ')}"` : 'that';
}

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
 *
 * Deliberately has no case for `capture`: a frame the gate opened for goes to
 * `decideLook`, which owns the ring from that point — it is the only thing that
 * knows whether the look is happening now, waiting out the debounce, or standing
 * down for a barcode.
 */
function progressFor(verdict: GateVerdict, value: number): ScanProgress {
  switch (verdict) {
    case 'holding':
    case 'cooling':
      return { kind: 'settling', value };
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
