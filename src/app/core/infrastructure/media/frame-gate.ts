/**
 * What the gate decided about the frame it was just shown.
 *
 * Only `capture` means "send this to the recognizer". Everything else is a
 * reason not to, and the HUD uses them to explain itself to the cashier.
 */
export type GateVerdict =
  /** First frame — nothing to compare against yet. */
  | 'warming'
  /** The scene is changing. Wait for a hand to stop moving. */
  | 'moving'
  /** Still, but not still for long enough yet. */
  | 'holding'
  /** Still and settled, but we looked too recently. */
  | 'cooling'
  /** Still and settled, but it's the same thing we already identified. */
  | 'duplicate'
  /** Send it. */
  | 'capture';

export interface FrameGateConfig {
  /**
   * Mean per-pixel difference (0..1) above which the scene counts as moving.
   * Too low and camera noise reads as motion; too high and a slow hand never
   * settles. 0.035 tolerates sensor noise and auto-exposure drift.
   */
  motionThreshold: number;
  /** How long the scene must hold still before we look. */
  settleMs: number;
  /** Hard floor between two looks, whatever else happens. */
  minIntervalMs: number;
  /**
   * How different the scene must be from the last thing we identified before
   * it counts as a new item. Above the motion threshold, because a cashier
   * swapping one jar for another produces a large change and we don't want a
   * small wobble to re-bill the same jar.
   */
  dedupeThreshold: number;
}

export const DEFAULT_FRAME_GATE_CONFIG: FrameGateConfig = {
  motionThreshold: 0.035,
  settleMs: 350,
  minIntervalMs: 1200,
  dedupeThreshold: 0.06,
};

/**
 * FrameGate — decides which camera frames are worth paying to look at.
 *
 * This is the difference between a feature that costs cents and one that costs
 * dollars a minute. A recognition call is roughly $0.007; a 30fps camera would
 * spend about $12 every minute if every frame went to the model. Almost all of
 * those frames are worthless anyway: blurred mid-motion, or the twentieth
 * identical view of a jar someone is still holding up.
 *
 * So the gate models what a person does when handed something to identify:
 * wait for it to stop moving, look once, and don't look again until it changes.
 *
 * Pure and framework-free — it takes a downsampled grayscale sample and a
 * timestamp, and returns a verdict. That makes the pacing logic testable without
 * a camera, which is the only practical way to verify it.
 */
export class FrameGate {
  private readonly config: FrameGateConfig;

  /** The previous sample, for motion detection. */
  private previous: Uint8Array | null = null;
  /** The sample at the moment of the last capture, for deduplication. */
  private captured: Uint8Array | null = null;
  /** The one before it, so a capture nobody spent can be handed back. */
  private previousCaptured: Uint8Array | null = null;
  private previousCaptureAt = 0;
  /** When the scene last stopped moving. Null while it's moving. */
  private stillSince: number | null = null;
  private lastCaptureAt = 0;

  constructor(config: Partial<FrameGateConfig> = {}) {
    this.config = { ...DEFAULT_FRAME_GATE_CONFIG, ...config };
  }

  /**
   * Show the gate one frame.
   *
   * @param sample Downsampled grayscale luma, same length on every call.
   * @param nowMs Monotonic timestamp. Injected rather than read from the clock
   *   so tests can drive the settle and cooldown windows directly.
   */
  evaluate(sample: Uint8Array, nowMs: number): GateVerdict {
    const previous = this.previous;
    // Copy: callers reuse their sample buffer between frames, and we hold on to
    // this one across calls.
    this.previous = Uint8Array.from(sample);

    if (previous === null || previous.length !== sample.length) {
      return 'warming';
    }

    if (meanAbsoluteDifference(previous, sample) > this.config.motionThreshold) {
      this.stillSince = null;
      return 'moving';
    }

    if (this.stillSince === null) {
      this.stillSince = nowMs;
      return 'holding';
    }

    if (nowMs - this.stillSince < this.config.settleMs) {
      return 'holding';
    }

    if (nowMs - this.lastCaptureAt < this.config.minIntervalMs) {
      return 'cooling';
    }

    if (
      this.captured !== null &&
      this.captured.length === sample.length &&
      meanAbsoluteDifference(this.captured, sample) < this.config.dedupeThreshold
    ) {
      return 'duplicate';
    }

    this.remember();
    this.captured = Uint8Array.from(sample);
    this.lastCaptureAt = nowMs;
    return 'capture';
  }

  /**
   * How close the gate is to allowing the next look, from 0 to 1.
   *
   * Progress is limited by whichever constraint is still shut: a scene that has
   * held still long enough may still be waiting out the minimum interval, and one
   * that is well past the interval may only just have stopped moving. Taking the
   * lower of the two is what makes the ring on screen mean "this is how close I am"
   * rather than "one of two things I need is ready".
   *
   * Says nothing about whether a look will actually happen — a settled scene the
   * gate has already identified reports 1 and is still refused as a duplicate. The
   * caller pairs this with the verdict.
   */
  progress(nowMs: number): number {
    if (this.stillSince === null) {
      return 0;
    }
    const settled = (nowMs - this.stillSince) / this.config.settleMs;
    const cooled = (nowMs - this.lastCaptureAt) / this.config.minIntervalMs;
    return Math.min(1, Math.max(0, Math.min(settled, cooled)));
  }

  /**
   * Record the scene in front of the camera as already dealt with, without
   * emitting a capture.
   *
   * For when something *other* than the model identified what is in frame — a
   * barcode, most obviously. Without this the barcode rings the item up, the scene
   * then holds still for a third of a second, the gate opens, and the model is
   * asked to identify the very same jar and adds a second one. Claiming the scene
   * makes the ordinary duplicate rule cover it.
   *
   * No-op before the first frame, when there is no scene to claim.
   */
  claimCurrentScene(nowMs: number): void {
    if (this.previous === null) {
      return;
    }
    this.remember();
    this.captured = Uint8Array.from(this.previous);
    this.lastCaptureAt = nowMs;
  }

  /**
   * Hand back the last claim on the scene, as though this frame had never opened
   * the gate.
   *
   * For a caller that decided not to spend after all — a barcode answered the same
   * frame for free, most likely. Distinct from `forgetLastCapture`, and the
   * difference matters in opposite directions: forgetting clears the record
   * outright, which leaves whatever the gate had identified *before* this frame
   * unclaimed and invites a second look at something already sold; this restores
   * that earlier record, so a scene nobody looked at stays lookable while one that
   * was already answered stays shut.
   *
   * Without it, a look refused for a barcode still costs the frame it was refused
   * on: the gate would go on believing it had identified whatever was in front of
   * it, and the next item to arrive would be swallowed as a duplicate.
   *
   * One level deep, which is all any caller needs — a capture is either acted on or
   * handed back within the same tick.
   */
  undoLastCapture(): void {
    this.captured = this.previousCaptured;
    this.lastCaptureAt = this.previousCaptureAt;
  }

  /**
   * Forget what we last identified, so the same scene will be looked at again.
   *
   * The facade calls this when the clerk asks the cashier to show an item again:
   * without it, the second look would be rejected as a duplicate and she would
   * repeat the request forever.
   */
  forgetLastCapture(): void {
    this.captured = null;
    this.stillSince = null;
  }

  /**
   * How long a scene must hold still before the gate opens.
   *
   * Exposed so a caller that adds its own wait on top can weight a single progress
   * indicator across both, rather than showing two that each fill from zero.
   */
  get settleMs(): number {
    return this.config.settleMs;
  }

  /** Full reset, for starting or restarting a session. */
  reset(): void {
    this.previous = null;
    this.captured = null;
    this.previousCaptured = null;
    this.previousCaptureAt = 0;
    this.stillSince = null;
    this.lastCaptureAt = 0;
  }

  /** Keep the current claim on the scene, so it can be restored. */
  private remember(): void {
    this.previousCaptured = this.captured;
    this.previousCaptureAt = this.lastCaptureAt;
  }
}

/**
 * Mean absolute difference between two samples, normalized to 0..1.
 *
 * Cheap and adequate: on a 32x32 sample this is 1024 subtractions, so it can run
 * every animation frame without competing with the canvas for budget.
 */
export function meanAbsoluteDifference(a: Uint8Array, b: Uint8Array): number {
  if (a.length === 0 || a.length !== b.length) {
    return 1;
  }
  let total = 0;
  for (let i = 0; i < a.length; i++) {
    total += Math.abs(a[i]! - b[i]!);
  }
  return total / (a.length * 255);
}
