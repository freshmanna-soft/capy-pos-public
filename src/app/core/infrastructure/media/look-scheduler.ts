/**
 * What should happen to a model look right now.
 *
 * Only `look` spends money. The other three are the reasons not to, and the HUD
 * uses them the same way it uses the frame gate's verdicts — so a till that is
 * deliberately not looking never looks like a till that has hung.
 */
export type LookDecision =
  /** Armed, and inside the debounce window. Hold still a moment longer. */
  | 'settling'
  /** A barcode owns this frame. The bars will say what it is for free. */
  | 'deferred'
  /** Send it. */
  | 'look';

export interface LookSchedulerConfig {
  /**
   * Quiet period between the frame gate opening and the model being paid.
   *
   * The gate's own settle window asks "has the scene stopped moving"; this asks
   * "has it stayed stopped". They are not the same question at a counter, where an
   * item is routinely set down, nudged square, and turned to face the camera —
   * three separate stillnesses inside a second, each of which the gate alone would
   * bill for. 400ms is longer than that fidgeting and short enough to disappear
   * into a recognition call that takes several seconds anyway.
   */
  debounceMs: number;
  /**
   * How long a barcode in frame keeps the model out of it.
   *
   * The same length as the barcode gate's absence window, and for the same
   * reason: detection drops out for a frame or two while a hand shifts, and a
   * shorter window here would let the model be paid to guess at a jar whose bars
   * were readable a moment ago and will be again.
   */
  barcodeGraceMs: number;
}

export const DEFAULT_LOOK_SCHEDULER_CONFIG: LookSchedulerConfig = {
  debounceMs: 400,
  barcodeGraceMs: 900,
};

/**
 * LookScheduler — decides *when* a model look happens, and whether it should
 * happen at all now that a barcode has been seen.
 *
 * The frame gate answers "is this frame worth looking at". Two questions it
 * deliberately does not answer sit on top of it, and both cost money to get
 * wrong:
 *
 * **Has the scene finished changing?** The gate opens the moment a scene has held
 * still for its settle window, which a hand still placing an item satisfies
 * repeatedly. Debouncing the decision — rather than the frame — coalesces those
 * into the single look the cashier meant.
 *
 * **Is anything cheaper about to answer the same question?** A barcode is free
 * and certain. If one is in frame, paying a model to guess at the packaging
 * around it is pure waste, so a look is deferred while the bars have priority.
 * The debounce window is also what gives an in-flight decode time to land before
 * the money is spent: the decoder and the model would otherwise race over the
 * same frame, and the model always loses that race expensively.
 *
 * Pure and clock-injected like `FrameGate` and `BarcodeGate` — the whole thing is
 * timing, and timing is not testable against a real camera.
 */
export class LookScheduler {
  private readonly config: LookSchedulerConfig;

  /** When the current look was armed, or null when nothing is waiting. */
  private armedAt: number | null = null;
  /** When a code we stock was last seen in frame. */
  private lastCodeAt: number | null = null;

  constructor(config: Partial<LookSchedulerConfig> = {}) {
    this.config = { ...DEFAULT_LOOK_SCHEDULER_CONFIG, ...config };
  }

  /**
   * Record that a barcode the shop actually stocks is in frame.
   *
   * Deliberately only for codes that resolve to a product. An unknown code is not
   * an answer — the catalogue may simply be missing that barcode — and the model
   * may well recognise the packaging, so it must not be held back.
   */
  noteStockedCode(nowMs: number): void {
    this.lastCodeAt = nowMs;
  }

  /** Whether a barcode still owns the frame. */
  barcodeHasPriority(nowMs: number): boolean {
    return this.lastCodeAt !== null && nowMs - this.lastCodeAt <= this.config.barcodeGraceMs;
  }

  /**
   * Ask for a look, or ask again about the one already waiting.
   *
   * Called on every sampling tick while the gate wants a look, which is what lets
   * the same call both start the debounce and finish it — there is no timer of its
   * own, so a look can never fire after the session it belonged to has ended.
   */
  request(nowMs: number): LookDecision {
    if (this.barcodeHasPriority(nowMs)) {
      // Not merely postponed: the frame this look was armed for is the one the
      // bars are already answering.
      this.armedAt = null;
      return 'deferred';
    }
    if (this.armedAt === null) {
      this.armedAt = nowMs;
    }
    if (nowMs - this.armedAt < this.config.debounceMs) {
      return 'settling';
    }
    this.armedAt = null;
    return 'look';
  }

  /** True while a look is armed and waiting out the debounce. */
  get pending(): boolean {
    return this.armedAt !== null;
  }

  /**
   * Drop the waiting look.
   *
   * For when the scene it was armed for has gone: the item moved again, the camera
   * changed, recognition was switched off, or the session ended.
   */
  cancel(): void {
    this.armedAt = null;
  }

  /** How far through the debounce window the waiting look is, 0..1. */
  progress(nowMs: number): number {
    if (this.armedAt === null) {
      return 0;
    }
    return Math.min(1, Math.max(0, (nowMs - this.armedAt) / this.config.debounceMs));
  }

  /** Full reset, for starting or restarting a session. */
  reset(): void {
    this.armedAt = null;
    this.lastCodeAt = null;
  }

  /** Exposed so the caller can size the progress ring over the real window. */
  get debounceMs(): number {
    return this.config.debounceMs;
  }
}
