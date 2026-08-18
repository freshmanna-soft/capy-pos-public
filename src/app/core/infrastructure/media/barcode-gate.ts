/** A code seen in the frame, with its bounds normalised to 0..1 of the frame. */
export interface ScannedCode {
  value: string;
  format: string;
  box: { x: number; y: number; width: number; height: number };
}

/** What the gate thinks about the code currently in frame. */
export type BarcodeVerdict =
  /** A fresh presentation. Act on it exactly once. */
  | 'new'
  /** The same code, still being held up. Already dealt with. */
  | 'held'
  /** Nothing in frame. */
  | 'idle';

export interface BarcodeGateConfig {
  /**
   * How long a code must be gone before showing it again counts as a new item.
   *
   * This is the whole difficulty. Three identical yoghurts must ring up three
   * times, so "same code" cannot simply mean "ignore" — but detection also drops
   * out for a frame or two while a hand shifts, and treating every dropout as a
   * new presentation would charge for one yoghurt three times. The window has to
   * be comfortably longer than a detection flicker and shorter than the time it
   * takes to swap one item for the next.
   */
  absenceMs: number;
  /**
   * Smallest a code may appear and still count, as a fraction of frame width.
   *
   * Stops the clerk ringing up a barcode on a poster across the room, or on the
   * packaging of something already bagged behind the customer.
   */
  minWidth: number;
}

export const DEFAULT_BARCODE_GATE_CONFIG: BarcodeGateConfig = {
  absenceMs: 900,
  minWidth: 0.08,
};

/**
 * BarcodeGate — turns a stream of per-frame detections into discrete scans.
 *
 * A barcode reader fires continuously: hold a jar up for two seconds at 8Hz and
 * the camera sees the same code sixteen times. Without this, that is sixteen
 * jars on the receipt.
 *
 * Pure and clock-injected, like `FrameGate`, because the entire difficulty is
 * timing — presentation, dropout, re-presentation — and none of it is testable
 * against a real camera.
 */
export class BarcodeGate {
  private readonly config: BarcodeGateConfig;

  /** The code currently considered "in hand". */
  private active: string | null = null;
  private lastSeenAt = 0;

  constructor(config: Partial<BarcodeGateConfig> = {}) {
    this.config = { ...DEFAULT_BARCODE_GATE_CONFIG, ...config };
  }

  /**
   * Show the gate one frame's worth of detections.
   *
   * @param code The code being presented, or null when the frame holds none.
   */
  observe(code: string | null, nowMs: number): BarcodeVerdict {
    if (code === null) {
      // Only forget the held code once it has been gone long enough to be a
      // deliberate removal rather than a flicker.
      if (this.active !== null && nowMs - this.lastSeenAt > this.config.absenceMs) {
        this.active = null;
      }
      return 'idle';
    }

    if (code === this.active) {
      this.lastSeenAt = nowMs;
      return 'held';
    }

    // Either nothing was in hand, or a different product replaced it. Both are a
    // new scan — swapping items is the common case at a counter.
    this.active = code;
    this.lastSeenAt = nowMs;
    return 'new';
  }

  /**
   * Forget the held code so presenting it again counts as new.
   *
   * Used when a scan was rejected — out of stock, or undone — because the cashier
   * is about to re-present the same item and must not be ignored.
   */
  release(): void {
    this.active = null;
  }

  reset(): void {
    this.active = null;
    this.lastSeenAt = 0;
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
