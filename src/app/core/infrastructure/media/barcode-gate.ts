/** A code seen in the frame, with its bounds normalised to 0..1 of the frame. */
export interface ScannedCode {
  value: string;
  format: string;
  box: { x: number; y: number; width: number; height: number };
}

/** What the gate thinks about the code currently in frame. */
export type BarcodeVerdict =
  /** A fresh presentation, held long enough to be meant. Act on it exactly once. */
  | 'new'
  /**
   * A code is being read but has not been held long enough to count yet.
   *
   * The frame in which a decoder first resolves a code is not evidence that anyone
   * meant to sell it — a shelf label sweeping past the lens decodes perfectly.
   */
  | 'dwelling'
  /** The same code, still being held up. Already dealt with. */
  | 'held'
  /** Nothing in frame. */
  | 'idle';

/**
 * The two waits that turn a stream of decodes into a sale, as one value.
 *
 * A profile rather than two arguments because the pair has to move together: a
 * dwell longer than the absence window would let a code complete its dwell out of
 * frames it was never continuously present for, and an absence window shorter than
 * a decoder flicker would charge twice for one jar. They are also the whole
 * difference between the clerk's two modes, so keeping them as data means the modes
 * are two constants rather than two code paths.
 */
export interface BarcodeTiming {
  /**
   * How long a code must be continuously presented before it rings up.
   *
   * The restraint the reader otherwise has none of. Long enough that a code
   * crossing the frame on its way somewhere else is ignored, short enough that
   * holding an item up deliberately never feels like waiting.
   */
  dwellMs: number;
  /**
   * How long a code must be gone before showing it again counts as a new item.
   *
   * This is the harder of the two. Three identical yoghurts must ring up three
   * times, so "same code" cannot simply mean "ignore" — but detection also drops
   * out for a frame or two while a hand shifts, and treating every dropout as a
   * new presentation would charge for one yoghurt three times. The window has to
   * be comfortably longer than a detection flicker and shorter than the time it
   * takes to swap one item for the next.
   */
  absenceMs: number;
}

/**
 * With recognition on: hold it there for a beat.
 *
 * The model is watching the same frame, and a code that rings up instantly also
 * rings up accidentally. 300ms is a little over two sampling ticks — past the
 * point where a code is merely passing through and well short of feeling slow.
 */
export const GATED_TIMING: BarcodeTiming = { dwellMs: 300, absenceMs: 900 };

/**
 * Barcode-only mode: no dwell, and the shortest absence window that is still safe.
 *
 * With recognition off there is nothing to protect and nothing to disambiguate —
 * the bars are the only thing the till is listening to, so presenting one is the
 * whole command and it should land immediately.
 *
 * The absence window deliberately does not go to zero with the dwell. It is the
 * only thing standing between a one-frame decode dropout and charging twice for
 * one jar, and at a 125ms sampling cadence 350ms tolerates a two-frame gap while
 * still letting identical items scan back to back about two and a half times
 * faster than the gated profile.
 */
export const INSTANT_TIMING: BarcodeTiming = { dwellMs: 0, absenceMs: 350 };

export interface BarcodeGateConfig {
  /** Timing used when `observe` is not given a profile of its own. */
  timing: BarcodeTiming;
  /**
   * Smallest a code may appear and still count, as a fraction of frame width.
   *
   * Stops the clerk ringing up a barcode on a poster across the room, or on the
   * packaging of something already bagged behind the customer.
   */
  minWidth: number;
}

export const DEFAULT_BARCODE_GATE_CONFIG: BarcodeGateConfig = {
  timing: GATED_TIMING,
  minWidth: 0.08,
};

/**
 * BarcodeGate — turns a stream of per-frame detections into discrete scans.
 *
 * A barcode reader fires continuously: hold a jar up for two seconds at 8Hz and
 * the camera sees the same code sixteen times. Without this, that is sixteen
 * jars on the receipt.
 *
 * It also decides *when* one of those sightings becomes a sale. The dwell is the
 * restraint: a code has to be held, not merely seen, and the caller chooses how
 * long by which timing profile it passes — so the same gate is a careful reader
 * with the model running alongside it and an instant one when the bars are the
 * only thing the till is listening to.
 *
 * Pure and clock-injected, like `FrameGate`, because the entire difficulty is
 * timing — presentation, dwell, dropout, re-presentation — and none of it is
 * testable against a real camera.
 */
export class BarcodeGate {
  private readonly config: BarcodeGateConfig;

  /** The code currently considered "in hand", already rung up. */
  private active: string | null = null;
  private lastSeenAt = 0;
  /**
   * A code being read but not yet accepted, and when it was first seen.
   *
   * Separate from `active` because the two answer different questions: `active` is
   * "this has been dealt with", `pending` is "this is being offered". A code that
   * never completes its dwell must leave no trace of either kind, or the item it
   * belongs to could not be scanned properly a moment later.
   */
  private pending: { code: string; since: number; lastSeenAt: number } | null = null;

  constructor(config: Partial<BarcodeGateConfig> = {}) {
    this.config = { ...DEFAULT_BARCODE_GATE_CONFIG, ...config };
  }

  /**
   * Show the gate one frame's worth of detections.
   *
   * @param code The code being presented, or null when the frame holds none.
   * @param timing Which pair of waits to judge it by. Defaults to the gate's own.
   */
  observe(
    code: string | null,
    nowMs: number,
    timing: BarcodeTiming = this.config.timing
  ): BarcodeVerdict {
    if (code === null) {
      // Only forget either code once it has been gone long enough to be a
      // deliberate removal rather than a flicker.
      if (this.active !== null && nowMs - this.lastSeenAt > timing.absenceMs) {
        this.active = null;
      }
      if (this.pending !== null && nowMs - this.pending.lastSeenAt > timing.absenceMs) {
        this.pending = null;
      }
      return 'idle';
    }

    if (code === this.active) {
      this.lastSeenAt = nowMs;
      return 'held';
    }

    // Either nothing was in hand, or a different product replaced it. Both start a
    // dwell — swapping items is the common case at a counter, and a swap is exactly
    // when a code belonging to neither item is most likely to cross the frame.
    if (
      this.pending === null ||
      this.pending.code !== code ||
      // A gap longer than a flicker restarts the dwell rather than counting toward
      // it. Without this a code left in front of a camera that was switched off for
      // ten seconds would complete its dwell on the first frame after it came back,
      // out of presence nobody was there to see.
      nowMs - this.pending.lastSeenAt > timing.absenceMs
    ) {
      this.pending = { code, since: nowMs, lastSeenAt: nowMs };
    } else {
      // Deliberately kept across a dropout shorter than the absence window: a
      // decoder that loses the code every third frame would otherwise restart the
      // dwell forever and never ring anything up at all.
      this.pending.lastSeenAt = nowMs;
    }

    if (nowMs - this.pending.since < timing.dwellMs) {
      return 'dwelling';
    }

    this.active = code;
    this.lastSeenAt = nowMs;
    this.pending = null;
    return 'new';
  }

  /**
   * How far through its dwell the code being offered is, 0..1.
   *
   * Exposed so the stage can fill its ring over the real wait — a restraint the
   * cashier cannot see is indistinguishable from a till that has stopped working.
   */
  dwellProgress(nowMs: number, timing: BarcodeTiming = this.config.timing): number {
    if (this.pending === null) {
      return 0;
    }
    if (timing.dwellMs <= 0) {
      return 1;
    }
    return Math.min(1, Math.max(0, (nowMs - this.pending.since) / timing.dwellMs));
  }

  /**
   * Forget both the held code and any dwell in progress, so presenting the same
   * code again counts as new.
   *
   * Used when a scan was rejected — out of stock, or undone — because the cashier
   * is about to re-present the same item and must not be ignored.
   */
  release(): void {
    this.active = null;
    this.pending = null;
  }

  reset(): void {
    this.active = null;
    this.lastSeenAt = 0;
    this.pending = null;
  }

  /** Smallest acceptable code width, so callers filter consistently. */
  get minWidth(): number {
    return this.config.minWidth;
  }
}

/**
 * Choose which code in the frame the cashier means.
 *
 * Two rules, both there to stop the gate oscillating. Codes too small to be a
 * deliberate presentation are dropped, and of what remains the largest wins —
 * the nearest code is the one being held up. Without the size rule, two products
 * both visible would alternate frame to frame and each alternation would read as
 * a new scan.
 */
export function pickPresentedCode(
  codes: readonly ScannedCode[],
  minWidth = DEFAULT_BARCODE_GATE_CONFIG.minWidth
): ScannedCode | null {
  let best: ScannedCode | null = null;
  for (const code of codes) {
    if (code.value.length === 0 || code.box.width < minWidth) {
      continue;
    }
    if (best === null || code.box.width * code.box.height > best.box.width * best.box.height) {
      best = code;
    }
  }
  return best;
}
