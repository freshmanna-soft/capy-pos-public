import {
  ONSEN,
  POND_LIFE,
  SCAN_BOX,
  WATER_LINE,
  YUZU_RAMP,
} from '@features/clerk/canvas/capybara-palette';
import { NormalisedRect, coverRect, roundedPerimeter } from '@features/clerk/canvas/stage-mapping';

/**
 * What the clerk is doing, expressed as a pose rather than a status.
 *
 * These are the six things a cashier needs to read across the counter without
 * looking at any text: is she waiting, hearing me, looking at something, sure,
 * unsure, or talking.
 */
export type ClerkVisualState =
  | 'idle'
  | 'listening'
  | 'scanning'
  | 'found'
  | 'confused'
  | 'speaking';

/** Longest frame step we will integrate. Guards against a backgrounded tab. */
const MAX_DT_S = 0.05;

/** Capybara geometry is authored in these units; head width is ~212. */
const LOCAL_WATER_Y = 40;

interface Ripple {
  /** Seconds since it was born. */
  age: number;
  x: number;
  y: number;
}

/**
 * The bath is a pond, so things live in it.
 *
 * A shoal drifts past, and on the next turn a frog surfaces, blinks and sinks.
 * They alternate rather than overlap: two ambient events at once starts to read
 * as an aquarium screensaver, and the yuzu is supposed to be the only thing on
 * this stage that asks to be looked at. Everything here is drawn low-contrast
 * and below the water overlay for the same reason — it should register when you
 * happen to look, and never pull the eye off a candidate card.
 */
type AmbientKind = 'fish' | 'frog';

interface Shoal {
  /** Seconds since it entered. */
  age: number;
  /** 1 = swimming right, -1 = swimming left. */
  direction: 1 | -1;
  /** Depth below the surface, as a fraction of the submerged area. */
  depth: number;
  /** Seconds to cross the stage. */
  duration: number;
  /** Per-fish scatter, so the shoal isn't a rigid line. */
  offsets: readonly { x: number; y: number; scale: number }[];
}

interface Frog {
  /** Seconds since it started to surface. */
  age: number;
  /** Horizontal position as a fraction of stage width. */
  x: number;
}

/**
 * A barcode found in the frame, ready to draw over.
 *
 * `matched` is the only thing the box says: green for something this shop sells,
 * red for a code it can read but does not stock. Deliberately not "valid" or
 * "scanned" — the cashier does not care whether the checksum passed, they care
 * whether it is about to go in the basket.
 */
export interface CodeOverlay {
  /** Bounds in normalised frame coordinates. */
  box: NormalisedRect;
  matched: boolean;
}

/**
 * What the ring around the stage is reporting.
 *
 * One indicator, one question: how close is the clerk to looking, and is she
 * looking now. The undo window keeps its own draining pill — two countdowns on one
 * screen competing for the same meaning is worse than either alone.
 */
export type ScanProgress =
  | { kind: 'hidden' }
  /** Closing in on a look. `value` runs 0..1. */
  | { kind: 'settling'; value: number }
  /** A look is in flight; duration unknown, so the ring sweeps. */
  | { kind: 'reading' };

/** Inset of the progress ring from the stage edge, in stage pixels. */
const RING_INSET = 7;
const RING_RADIUS = 16;
const RING_WIDTH = 3;

/** How long after entering before the first ambient event. */
const AMBIENT_FIRST_DELAY_S = 9;
/** Gap between events. Long enough to feel incidental rather than scheduled. */
const AMBIENT_MIN_GAP_S = 16;
const AMBIENT_MAX_GAP_S = 26;
/** How long a frog stays up: rise, two blinks, sink. */
const FROG_LIFETIME_S = 5.2;
const SHOAL_SIZE = 7;

/**
 * Critically-ish damped spring. Every rig channel is one of these.
 *
 * Springs rather than eased tweens because the clerk's state changes at
 * unpredictable moments — a recognition can land mid-blink, mid-lean, mid-turn.
 * A tween restarted from an arbitrary position stutters; a spring carries its
 * velocity through, so an interrupted movement redirects instead of snapping.
 */
class Spring {
  velocity = 0;

  constructor(
    public value: number,
    private readonly stiffness: number,
    private readonly damping: number
  ) {}

  step(target: number, dt: number): number {
    const acceleration = (target - this.value) * this.stiffness - this.velocity * this.damping;
    this.velocity += acceleration * dt;
    this.value += this.velocity * dt;
    return this.value;
  }

  /** Jump straight there — used when motion is switched off. */
  snap(target: number): void {
    this.value = target;
    this.velocity = 0;
  }
}

/**
 * CapybaraRenderer
 *
 * Draws the clerk: the bath, the capybara, and the yuzu that carries the model's
 * confidence. Every pixel is generated — no sprites, no image assets — so she
 * scales to any counter display, costs nothing to load, and can react
 * continuously to state instead of switching between a handful of frames.
 *
 * Framework-free by design. It takes a canvas and numbers and produces pixels,
 * which means the whole rig can be unit tested against a stub context: that a
 * `confused` state actually tilts the head, that reduced motion stops the
 * breathing, that the frame clock survives a backgrounded tab. None of that is
 * testable if the animation lives inside a component.
 *
 * The one place all the boldness is spent is the yuzu. It bobs on the surface,
 * ripens green through amber to yuzu yellow as confidence climbs, and when an
 * item is auto-added it plops and the ripple is the confirmation. That single
 * object replaces a progress bar and a toast, which is why everything around it
 * is kept flat and quiet.
 */
export class CapybaraRenderer {
  private readonly context: CanvasRenderingContext2D;

  private width = 0;
  private height = 0;

  private state: ClerkVisualState = 'idle';
  private reducedMotion = false;

  /** 0..1 from the recognizer. Drives the yuzu, nothing else. */
  private confidence = 0;
  /** Where she should look, in -1..1 stage space. */
  private gazeX = 0;
  private gazeY = 0;
  /** `performance.now()` of the last spoken word start, from the voice service. */
  private lastBoundaryAt = 0;
  private speaking = false;

  // Rig channels. Stiffness/damping are tuned per channel: ears and eyelids are
  // fast and twitchy, the body lean is slow and heavy.
  private readonly lean = new Spring(0, 90, 16);
  private readonly headTilt = new Spring(0, 110, 15);
  private readonly headTurn = new Spring(0, 80, 14);
  private readonly earForward = new Spring(0, 200, 20);
  private readonly eyeOpen = new Spring(1, 220, 22);
  private readonly mouth = new Spring(0, 320, 26);
  private readonly bob = new Spring(0, 130, 12);
  private readonly yuzuLift = new Spring(0, 70, 13);
  private readonly halo = new Spring(0, 90, 18);

  /** Ambient clocks, in seconds. Kept separate so reduced motion can freeze them. */
  private breathT = 0;
  private waterT = 0;

  private lidClosed = 0;
  private blinkTimer = 1.4;
  private blinkPhase = 0;
  private pendingBlinks = 0;

  private earTwitch = 0;
  private earTwitchTimer = 3;

  private ripples: Ripple[] = [];

  /** Ambient life. At most one of these is ever non-null. */
  private shoal: Shoal | null = null;
  private frog: Frog | null = null;
  private ambientCountdown = AMBIENT_FIRST_DELAY_S;
  /** Which event is due next. Alternates on every fire. */
  private ambientNext: AmbientKind = 'fish';

  private codes: readonly CodeOverlay[] = [];
  /** Intrinsic camera size, needed to repeat the video's object-cover transform. */
  private frameSize = { width: 0, height: 0 };
  private scanProgress: ScanProgress = { kind: 'hidden' };

  private lastFrameAt = 0;
  /** Seconds the entrance has been running; gates the reveal sequence. */
  private entranceT = 0;

  constructor(canvas: HTMLCanvasElement) {
    const context = canvas.getContext('2d');
    if (!context) {
      throw new Error('CapybaraRenderer requires a 2D canvas context');
    }
    this.context = context;
  }

  /**
   * Match the backing store to the element's CSS size and the device pixel
   * ratio, then work in CSS pixels for the rest of the frame.
   */
  resize(cssWidth: number, cssHeight: number, dpr: number): void {
    const canvas = this.context.canvas;
    canvas.width = Math.max(1, Math.round(cssWidth * dpr));
    canvas.height = Math.max(1, Math.round(cssHeight * dpr));
    this.width = cssWidth;
    this.height = cssHeight;
    this.context.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  setState(state: ClerkVisualState): void {
    if (state === this.state) {
      return;
    }
    // Arriving at `found` is a physical event, not just a pose: give the body an
    // upward impulse so the bounce comes from the spring rather than a keyframe.
    if (state === 'found') {
      this.bob.velocity -= 26;
    }
    this.state = state;
  }

  /**
   * Barcodes to outline this frame, and the camera size their bounds are relative
   * to. Passed together because a box without its frame size cannot be placed.
   */
  setCodes(codes: readonly CodeOverlay[], frame: { width: number; height: number }): void {
    this.codes = codes;
    this.frameSize = frame;
  }

  /** What the ring around the stage should report. */
  setScanProgress(progress: ScanProgress): void {
    this.scanProgress = progress;
  }

  /** 0..1. Ripens and lifts the yuzu. */
  setConfidence(confidence: number): void {
    this.confidence = Math.min(1, Math.max(0, confidence));
  }

  /** Where to look, in -1..1 stage space; (0,0) is straight at the cashier. */
  lookAt(x: number, y: number): void {
    this.gazeX = Math.min(1, Math.max(-1, x));
    this.gazeY = Math.min(1, Math.max(-1, y));
  }

  /** Mouth-sync input: whether she's talking, and when the last word began. */
  setSpeech(speaking: boolean, lastBoundaryAt: number): void {
    this.speaking = speaking;
    this.lastBoundaryAt = lastBoundaryAt;
  }

  /**
   * The yuzu drops into the water — this is the auto-add confirmation.
   *
   * Called by the facade the moment an item lands in the cart, so the ripple is
   * tied to the real cart write rather than to the recognizer's optimism.
   */
  plop(): void {
    // Sized for the 0..1 lift range. A larger impulse drives the lift negative
    // and, when colour was derived from lift, made a just-sold item look unripe.
    this.yuzuLift.velocity -= 1.8;
    this.ripples.push({ age: 0, x: 185, y: LOCAL_WATER_Y });
    if (this.ripples.length > 6) {
      this.ripples.shift();
    }
  }

  /**
   * Honour `prefers-reduced-motion`.
   *
   * Everything ambient stops: breathing, bobbing, water shimmer, steam, blinking,
   * the entrance. The yuzu still reports confidence, statically, through colour
   * and height — the information survives even though the motion doesn't.
   */
  setReducedMotion(reduced: boolean): void {
    this.reducedMotion = reduced;
    if (reduced) {
      this.lidClosed = 0;
      this.earTwitch = 0;
      this.ripples = [];
      this.shoal = null;
      this.frog = null;
      this.entranceT = 99;
    }
  }

  /** Restart the entrance sequence. */
  resetEntrance(): void {
    this.entranceT = this.reducedMotion ? 99 : 0;
  }

  /** One frame. `nowMs` should come from the rAF timestamp. */
  render(nowMs: number): void {
    const dt =
      this.lastFrameAt === 0
        ? 1 / 60
        : // Clamped at both ends: the ceiling stops a backgrounded tab resuming
          // with one enormous step, and the floor stops a non-monotonic timestamp
          // running the simulation backwards.
          Math.max(0, Math.min(MAX_DT_S, (nowMs - this.lastFrameAt) / 1000));
    this.lastFrameAt = nowMs;

    this.advance(dt, nowMs);
    this.paint();
  }

  /**
   * The rig's current values.
   *
   * Exists so the animation can be verified — that `confused` really tilts the
   * head, that reduced motion really freezes the ambient clocks, that a long
   * frame gap is clamped. The alternative is asserting on sequences of canvas
   * draw calls, which tests the drawing code's incidental structure rather than
   * its behaviour and breaks on every visual tweak.
   */
  debugPose(): Readonly<{
    lean: number;
    headTilt: number;
    headTurn: number;
    earForward: number;
    eyeOpen: number;
    mouth: number;
    yuzuLift: number;
    breathT: number;
    ripples: number;
    fish: boolean;
    frog: boolean;
    ambientNext: AmbientKind;
  }> {
    return {
      lean: this.lean.value,
      headTilt: this.headTilt.value,
      headTurn: this.headTurn.value,
      earForward: this.earForward.value,
      eyeOpen: this.eyeOpen.value,
      mouth: this.mouth.value,
      yuzuLift: this.yuzuLift.value,
      breathT: this.breathT,
      ripples: this.ripples.length,
      fish: this.shoal !== null,
      frog: this.frog !== null,
      ambientNext: this.ambientNext,
    };
  }

  // ── simulation ────────────────────────────────────────────────────────────

  private advance(dt: number, nowMs: number): void {
    this.entranceT += dt;

    if (!this.reducedMotion) {
      this.breathT += dt;
      this.waterT += dt;
      this.advanceBlink(dt);
      this.advanceEarTwitch(dt);
      this.advanceAmbient(dt);
    }

    const pose = POSES[this.state];

    this.lean.step(pose.lean, dt);
    this.headTilt.step(pose.headTilt + this.gazeX * 0.05, dt);
    this.headTurn.step(this.gazeX, dt);
    this.earForward.step(pose.earForward, dt);
    this.eyeOpen.step(pose.eyeOpen, dt);
    this.bob.step(0, dt);
    this.halo.step(this.state === 'listening' ? 1 : 0, dt);
    this.yuzuLift.step(this.confidence, dt);
    this.mouth.step(this.mouthTarget(nowMs, pose.mouthBias), dt);

    for (const ripple of this.ripples) {
      ripple.age += dt;
    }
    this.ripples = this.ripples.filter((ripple) => ripple.age < 1.6);
  }

  /**
   * How open the mouth should be right now.
   *
   * Driven from the elapsed time since the last word boundary: each word starts
   * a fast open and a slower close, with a small odd-word variation so
   * consecutive words don't produce an identical mechanical flap. This tracks
   * words rather than phonemes because word starts are the only timing signal
   * the browser exposes for synthesized speech.
   */
  private mouthTarget(nowMs: number, bias: number): number {
    if (!this.speaking) {
      return bias;
    }
    const since = (nowMs - this.lastBoundaryAt) / 1000;
    if (since < 0 || since > 0.45) {
      return bias + 0.08;
    }
    const envelope = since < 0.06 ? since / 0.06 : Math.max(0, 1 - (since - 0.06) / 0.3);
    // Alternate the peak a little, keyed on the boundary timestamp so it's
    // stable within a word.
    const variation = 0.78 + (Math.floor(this.lastBoundaryAt / 97) % 3) * 0.09;
    return Math.max(bias, envelope * variation);
  }

  private advanceBlink(dt: number): void {
    if (this.blinkPhase > 0) {
      this.blinkPhase = Math.max(0, this.blinkPhase - dt);
      // 0.13s total: shut fast, open a touch slower. Triangular is close enough
      // at this duration and cheaper than easing.
      const t = 1 - this.blinkPhase / 0.13;
      this.lidClosed = t < 0.45 ? t / 0.45 : Math.max(0, 1 - (t - 0.45) / 0.55);
      if (this.blinkPhase === 0) {
        this.lidClosed = 0;
        if (this.pendingBlinks > 0) {
          this.pendingBlinks--;
          this.blinkPhase = 0.13;
        }
      }
      return;
    }

    this.blinkTimer -= dt;
    if (this.blinkTimer <= 0) {
      this.blinkPhase = 0.13;
      // Real blinking is irregular and sometimes doubled. Evenly spaced single
      // blinks are the thing that makes a drawn face read as a machine.
      this.pendingBlinks = Math.random() < 0.22 ? 1 : 0;
      this.blinkTimer = 2.2 + Math.random() * 3.8;
    }
  }

  /**
   * Run the pond's own life: age whatever is currently visiting, and when nothing
   * is, count down to the next visitor and alternate which kind it is.
   *
   * Alternating is what keeps this from becoming an aquarium: you get fish, then
   * a while later a frog, then fish again — never both at once, and never so
   * often that it stops being a surprise.
   */
  private advanceAmbient(dt: number): void {
    if (this.shoal !== null) {
      this.shoal.age += dt;
      if (this.shoal.age > this.shoal.duration) {
        this.shoal = null;
      }
      return;
    }

    if (this.frog !== null) {
      this.frog.age += dt;
      if (this.frog.age > FROG_LIFETIME_S) {
        this.frog = null;
      }
      return;
    }

    // Nothing arrives during the entrance — the reveal is choreographed and a
    // fish swimming through it would fight the one moment that is.
    if (this.entranceT < 2.5) {
      return;
    }

    this.ambientCountdown -= dt;
    if (this.ambientCountdown > 0) {
      return;
    }

    if (this.ambientNext === 'fish') {
      this.spawnShoal();
      this.ambientNext = 'frog';
    } else {
      this.spawnFrog();
      this.ambientNext = 'fish';
    }
    this.ambientCountdown =
      AMBIENT_MIN_GAP_S + Math.random() * (AMBIENT_MAX_GAP_S - AMBIENT_MIN_GAP_S);
  }

  private spawnShoal(): void {
    const direction = Math.random() < 0.5 ? 1 : -1;
    this.shoal = {
      age: 0,
      direction,
      // Upper water. Deep enough to be clearly submerged, shallow enough to stay
      // clear of the caption and the candidate trays along the bottom edge.
      depth: 0.16 + Math.random() * 0.24,
      // Quick enough to read as a shoal passing rather than as drifting debris.
      duration: 6.5 + Math.random() * 2,
      offsets: Array.from({ length: SHOAL_SIZE }, (_, i) => ({
        // A loose trailing cluster rather than a formation, spread over about a
        // seventh of the stage. Any wider and only two of them are ever on
        // screen at once, which reads as one lost fish rather than a shoal.
        x: -i * (0.018 + (i % 3) * 0.006),
        y: (i % 2 === 0 ? 1 : -1) * (7 + (i % 4) * 8),
        scale: 0.78 + ((i * 37) % 45) / 100,
      })),
    };
  }

  private spawnFrog(): void {
    this.frog = {
      age: 0,
      // The far side from the capybara and the yuzu, which both sit right of
      // centre. Nothing else is using this corner.
      x: 0.1 + Math.random() * 0.14,
    };
  }

  private advanceEarTwitch(dt: number): void {
    if (this.earTwitch > 0) {
      this.earTwitch = Math.max(0, this.earTwitch - dt * 6);
      return;
    }
    this.earTwitchTimer -= dt;
    if (this.earTwitchTimer <= 0) {
      this.earTwitch = 1;
      this.earTwitchTimer = 3 + Math.random() * 4;
    }
  }

  // ── painting ──────────────────────────────────────────────────────────────

  private paint(): void {
    const ctx = this.context;
    const { width: w, height: h } = this;
    ctx.clearRect(0, 0, w, h);
    if (w === 0 || h === 0) {
      return;
    }

    const waterY = h * WATER_LINE;
    // Sized so the whole figure — towel to waterline — occupies roughly a
    // quarter of the stage height. Bigger than this and she stops being a clerk
    // at a counter and becomes a mascot filling the screen, which crowds the
    // caption and the candidate trays that have to be readable over her.
    const scale = Math.min(h * 0.00125, w * 0.00095);
    // Centred: the yuzu sits to her right and still clears the camera preview.
    const cx = w * 0.5;
    const cy = waterY - LOCAL_WATER_Y * scale;

    // Entrance: steam clears, then she rises. Collapsed to nothing under
    // reduced motion, where entranceT starts past the end.
    const reveal = clamp01(this.entranceT / 0.9);
    const rise = easeOut(clamp01((this.entranceT - 0.45) / 0.8));

    this.paintVignette(w, h, reveal);
    this.paintWaterBody(w, h, waterY);

    ctx.save();
    ctx.translate(cx, cy + (1 - rise) * 120 * scale);
    ctx.scale(scale, scale);
    ctx.globalAlpha = rise;

    this.paintHalo();
    this.paintBody();
    this.paintHead();
    ctx.restore();

    // Water drawn over her a second time at low alpha: she is *in* the bath, and
    // this is what sells the depth without a mask.
    this.paintWaterOverlay(w, h, waterY);
    // Fish after the overlay. The overlay is opaque enough to hide her submerged
    // bulk, which also erased anything drawn beneath it — so the shoal carries its
    // own low alpha instead and sits optically in the water rather than under it.
    this.paintShoal(w, h, waterY);
    this.paintSurface(w, h, waterY);
    // The frog breaks the surface, so it goes on top of it.
    this.paintFrog(w, waterY);

    ctx.save();
    ctx.translate(cx, cy);
    ctx.scale(scale, scale);
    ctx.globalAlpha = rise;
    this.paintRipples();
    this.paintYuzu();
    ctx.restore();

    if (this.state === 'scanning') {
      this.paintScanSweep(w, waterY);
    }
    this.paintSteam(w, waterY, reveal);

    // Both of these annotate the real world rather than the bath, so they go over
    // everything: a bracket half-hidden behind a capybara points at nothing, and a
    // progress ring is chrome.
    this.paintCodes(w, h);
    this.paintProgressRing(w, h);
  }

  /** Warm dark falloff at the edges, so the treated camera feed reads as a room. */
  private paintVignette(w: number, h: number, reveal: number): void {
    const ctx = this.context;
    const gradient = ctx.createRadialGradient(
      w * 0.45,
      h * 0.4,
      0,
      w * 0.45,
      h * 0.4,
      Math.max(w, h) * 0.78
    );
    gradient.addColorStop(0, 'rgba(20,16,14,0)');
    gradient.addColorStop(0.55, 'rgba(20,16,14,0.36)');
    gradient.addColorStop(1, 'rgba(20,16,14,0.9)');
    ctx.save();
    // Inverted: the steam is thickest at the start and clears as she arrives.
    ctx.globalAlpha = 0.55 + (1 - reveal) * 0.45;
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, w, h);
    ctx.restore();
  }

  private paintWaterBody(w: number, h: number, waterY: number): void {
    const ctx = this.context;
    const gradient = ctx.createLinearGradient(0, waterY, 0, h);
    gradient.addColorStop(0, withAlpha(ONSEN.waterSurface, 0.82));
    gradient.addColorStop(0.35, withAlpha(ONSEN.water, 0.93));
    gradient.addColorStop(1, withAlpha(ONSEN.deep, 0.97));
    ctx.fillStyle = gradient;
    ctx.fillRect(0, waterY, w, h - waterY);
  }

  private paintWaterOverlay(w: number, h: number, waterY: number): void {
    const ctx = this.context;
    // Opaque enough that her submerged bulk is a suggestion rather than a shape.
    // At lower alpha the whole body showed through as a pale blob spanning the
    // lower half of the stage, which read as a stain on the water.
    const gradient = ctx.createLinearGradient(0, waterY, 0, h);
    gradient.addColorStop(0, withAlpha(ONSEN.waterSurface, 0.7));
    gradient.addColorStop(0.4, withAlpha(ONSEN.water, 0.93));
    gradient.addColorStop(1, withAlpha(ONSEN.water, 0.98));
    ctx.fillStyle = gradient;
    ctx.fillRect(0, waterY, w, h - waterY);
  }

  /** The surface line plus a few slow caustics. */
  private paintSurface(w: number, h: number, waterY: number): void {
    const ctx = this.context;
    const amplitude = this.reducedMotion ? 0 : 2.4;

    ctx.save();
    ctx.strokeStyle = withAlpha(ONSEN.steam, 0.26);
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    for (let x = 0; x <= w; x += 8) {
      const y = waterY + Math.sin(x * 0.014 + this.waterT * 1.1) * amplitude;
      if (x === 0) {
        ctx.moveTo(x, y);
      } else {
        ctx.lineTo(x, y);
      }
    }
    ctx.stroke();

    if (!this.reducedMotion) {
      ctx.fillStyle = withAlpha(ONSEN.steam, 0.05);
      for (let i = 0; i < 3; i++) {
        const phase = this.waterT * (0.22 + i * 0.07) + i * 2.1;
        const y = waterY + 26 + i * 34;
        const cx = w * (0.5 + Math.sin(phase) * 0.3);
        ctx.beginPath();
        ctx.ellipse(cx, y, w * 0.2, 5 + i * 2, 0, 0, Math.PI * 2);
        ctx.fill();
      }
    }
    ctx.restore();
  }

  /** Soft pulse behind her while she's listening — an "I'm hearing you" light. */
  private paintHalo(): void {
    const strength = this.halo.value;
    if (strength < 0.01) {
      return;
    }
    const ctx = this.context;
    const pulse = this.reducedMotion ? 1 : 1 + Math.sin(this.waterT * 3.2) * 0.06;
    const radius = 250 * pulse;
    const gradient = ctx.createRadialGradient(0, -60, 60, 0, -60, radius);
    gradient.addColorStop(0, withAlpha(ONSEN.kelp, 0.3 * strength));
    gradient.addColorStop(1, withAlpha(ONSEN.kelp, 0));
    ctx.fillStyle = gradient;
    ctx.beginPath();
    ctx.arc(0, -60, radius, 0, Math.PI * 2);
    ctx.fill();
  }

  private paintBody(): void {
    const ctx = this.context;
    const breath = this.reducedMotion ? 0 : Math.sin(this.breathT * 1.5) * 5;
    const bob = this.bob.value;

    ctx.save();
    ctx.translate(0, bob);

    // Contact shadow where she meets the water. Subtle: at full strength it
    // reads as a stain on the surface rather than as her own shadow.
    ctx.fillStyle = withAlpha(ONSEN.deep, 0.26);
    ctx.beginPath();
    ctx.ellipse(4, 44, 148, 20, 0, 0, Math.PI * 2);
    ctx.fill();

    // Shoulders and back: a broad loaf. Capybaras have almost no waist, and
    // giving her one would read as a different animal.
    const bodyGradient = ctx.createLinearGradient(0, -60, 0, 170);
    bodyGradient.addColorStop(0, ONSEN.capyLight);
    bodyGradient.addColorStop(0.4, ONSEN.capy);
    bodyGradient.addColorStop(1, ONSEN.capyDark);
    ctx.fillStyle = bodyGradient;
    roundedRect(ctx, -132, -18 + breath * 0.4, 264, 220, 84);
    ctx.fill();

    ctx.restore();
  }

  private paintHead(): void {
    const ctx = this.context;
    const breath = this.reducedMotion ? 0 : Math.sin(this.breathT * 1.5) * 3;
    const tilt = this.headTilt.value;
    const turn = this.headTurn.value;

    ctx.save();
    ctx.translate(this.lean.value * 26 + turn * 16, -34 + this.bob.value * 1.15 + breath);
    ctx.rotate(tilt);

    this.paintEars(turn);

    // Blocky head, wider than tall. The squareness is the single most
    // recognizable thing about a capybara's face — at a large corner radius she
    // reads as a bear cub or a hamster instead, so the radius stays well under
    // a quarter of the height.
    const headGradient = ctx.createLinearGradient(0, -148, 0, 20);
    headGradient.addColorStop(0, ONSEN.capyLight);
    headGradient.addColorStop(0.55, ONSEN.capy);
    headGradient.addColorStop(1, ONSEN.capyDark);
    ctx.fillStyle = headGradient;
    roundedRect(ctx, -108 + turn * 4, -150, 216, 170, 36);
    ctx.fill();

    this.paintMuzzle(turn);
    this.paintEyes(turn);
    this.paintTowel(tilt);

    ctx.restore();
  }

  private paintEars(turn: number): void {
    const ctx = this.context;
    // Forward when listening, drooped when confused, plus the idle twitch.
    const forward = this.earForward.value;
    const twitch = this.earTwitch * 0.18;

    // Small, set high and close to the skull. A capybara's ears are almost
    // vestigial next to a bear's, and oversizing them is the fastest way to draw
    // the wrong animal.
    for (const side of [-1, 1] as const) {
      ctx.save();
      ctx.translate(side * (90 + turn * 6), -138);
      ctx.rotate(side * (0.3 - forward * 0.45 + (side > 0 ? twitch : -twitch * 0.6)));
      ctx.fillStyle = ONSEN.capyDark;
      roundedRect(ctx, -16, -14, 32, 28, 12);
      ctx.fill();
      ctx.fillStyle = withAlpha(ONSEN.ink, 0.32);
      roundedRect(ctx, -8 - side * 2, -7, 16, 15, 7);
      ctx.fill();
      ctx.restore();
    }
  }

  private paintMuzzle(turn: number): void {
    const ctx = this.context;
    const mouthOpen = this.mouth.value;
    const mx = turn * 10;

    // Blunt pale muzzle.
    ctx.fillStyle = ONSEN.capyMuzzle;
    ctx.beginPath();
    ctx.ellipse(mx, -14, 76, 50, 0, 0, Math.PI * 2);
    ctx.fill();

    // Nose: wide, flat, dark.
    ctx.fillStyle = ONSEN.ink;
    roundedRect(ctx, mx - 25, -46, 50, 28, 13);
    ctx.fill();
    ctx.fillStyle = withAlpha(ONSEN.capyLight, 0.25);
    roundedRect(ctx, mx - 17, -43, 34, 8, 4);
    ctx.fill();

    // Mouth: a closed seam that opens into a rounded shape. Capybaras have a
    // split upper lip, which is what the centre notch is.
    ctx.strokeStyle = withAlpha(ONSEN.ink, 0.75);
    ctx.lineWidth = 4;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(mx, -16);
    ctx.lineTo(mx, -6);
    ctx.stroke();

    if (mouthOpen > 0.04) {
      ctx.fillStyle = withAlpha(ONSEN.tsuba, 0.85);
      ctx.beginPath();
      ctx.ellipse(
        mx,
        -6 + mouthOpen * 4,
        11 + mouthOpen * 7,
        2 + mouthOpen * 11,
        0,
        0,
        Math.PI * 2
      );
      ctx.fill();
    } else {
      ctx.beginPath();
      ctx.moveTo(mx - 16, -4);
      ctx.quadraticCurveTo(mx, 4, mx + 16, -4);
      ctx.stroke();
    }

    // Whiskers — three a side, fanned. Thin and low-contrast: at full strength
    // they read as scratches on the screen.
    ctx.strokeStyle = withAlpha(ONSEN.steam, 0.3);
    ctx.lineWidth = 2;
    for (const side of [-1, 1] as const) {
      for (let i = 0; i < 3; i++) {
        ctx.beginPath();
        ctx.moveTo(mx + side * 52, -20 + i * 11);
        ctx.quadraticCurveTo(mx + side * 96, -30 + i * 15, mx + side * 132, -34 + i * 22);
        ctx.stroke();
      }
    }
  }

  private paintEyes(turn: number): void {
    const ctx = this.context;
    // Combine the deliberate squint with the involuntary blink.
    const open = Math.max(0, this.eyeOpen.value * (1 - this.lidClosed));

    for (const side of [-1, 1] as const) {
      const ex = side * 54 + turn * 12;
      const ey = -94;

      // Set high and far back on the head, as on the animal.
      ctx.fillStyle = ONSEN.ink;
      ctx.beginPath();
      ctx.ellipse(ex, ey, 15, 15 * clamp01(open), 0, 0, Math.PI * 2);
      ctx.fill();

      if (open > 0.35) {
        // Two highlights: a large soft one for wetness and a hard spec. One
        // alone looks either flat or glassy.
        ctx.fillStyle = withAlpha(ONSEN.steam, 0.5);
        ctx.beginPath();
        ctx.ellipse(
          ex - 5 + this.gazeX * 3,
          ey - 5 + this.gazeY * 2,
          4.5,
          4.5 * clamp01(open),
          0,
          0,
          Math.PI * 2
        );
        ctx.fill();
        ctx.fillStyle = withAlpha(ONSEN.steam, 0.9);
        ctx.beginPath();
        ctx.arc(ex - 6 + this.gazeX * 3, ey - 6 + this.gazeY * 2, 1.8, 0, Math.PI * 2);
        ctx.fill();
      }

      // Brow: a short stroke that lifts when she's surprised and lowers when
      // she's squinting. Does most of the emotional work for very little ink.
      const brow = this.state === 'found' ? -10 : this.state === 'scanning' ? -2 : -6;
      ctx.strokeStyle = withAlpha(ONSEN.capyDark, 0.7);
      ctx.lineWidth = 4;
      ctx.beginPath();
      ctx.moveTo(ex - 13, ey + brow - 12);
      ctx.quadraticCurveTo(ex, ey + brow - 17, ex + 13, ey + brow - 12);
      ctx.stroke();
    }
  }

  /** The folded towel — the one costume piece, and the onsen tell. */
  private paintTowel(tilt: number): void {
    const ctx = this.context;
    ctx.save();
    ctx.translate(0, -152);
    ctx.rotate(-tilt * 0.35);
    ctx.fillStyle = ONSEN.steam;
    roundedRect(ctx, -76, -34, 152, 40, 12);
    ctx.fill();
    ctx.fillStyle = withAlpha(ONSEN.kelp, 0.22);
    roundedRect(ctx, -76, -18, 152, 8, 4);
    ctx.fill();
    ctx.strokeStyle = withAlpha(ONSEN.capyDark, 0.18);
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(-40, -34);
    ctx.lineTo(-40, 6);
    ctx.stroke();
    ctx.restore();
  }

  /**
   * The signature: a yuzu floating on the surface whose colour and height are
   * the model's confidence.
   */
  private paintYuzu(): void {
    const ctx = this.context;
    const lift = this.yuzuLift.value;
    const bobY = this.reducedMotion ? 0 : Math.sin(this.waterT * 1.8) * 3;
    const y = LOCAL_WATER_Y - 6 - lift * 26 + bobY;
    const x = 185;
    const radius = 20 + lift * 4;

    // Ripening: unripe green → amber → yuzu. Two-stop ramp so the midpoint is a
    // real colour rather than a muddy average of the ends.
    //
    // Taken from confidence, not from the spring's height. The plop drives the
    // height physically downward, and deriving colour from it would flash the
    // fruit back to unripe at the exact moment an item was confidently sold.
    const ripeness = this.confidence;
    const color = rampColor(YUZU_RAMP, ripeness);

    // Glow only once it means something — a permanent halo would make the low
    // and high states look alike.
    if (ripeness > 0.35) {
      const glow = ctx.createRadialGradient(x, y, radius * 0.5, x, y, radius * 3);
      glow.addColorStop(0, withAlpha(color, 0.4 * ripeness));
      glow.addColorStop(1, withAlpha(color, 0));
      ctx.fillStyle = glow;
      ctx.beginPath();
      ctx.arc(x, y, radius * 3, 0, Math.PI * 2);
      ctx.fill();
    }

    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.arc(x, y, radius, 0, Math.PI * 2);
    ctx.fill();

    // Peel dimple and leaf, so it reads as citrus rather than a status dot.
    ctx.fillStyle = withAlpha(ONSEN.deep, 0.2);
    ctx.beginPath();
    ctx.ellipse(x + 6, y + 5, radius * 0.5, radius * 0.34, 0.5, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = withAlpha(ONSEN.steam, 0.55);
    ctx.beginPath();
    ctx.ellipse(x - 7, y - 8, 5, 3.5, -0.5, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#5E8A3F';
    ctx.beginPath();
    ctx.ellipse(x + 2, y - radius - 3, 9, 4.5, -0.4, 0, Math.PI * 2);
    ctx.fill();
  }

  private paintRipples(): void {
    const ctx = this.context;
    for (const ripple of this.ripples) {
      const t = ripple.age / 1.6;
      const radius = 18 + t * 150;
      ctx.strokeStyle = withAlpha(ONSEN.steam, 0.42 * (1 - t));
      ctx.lineWidth = 3 * (1 - t) + 0.6;
      ctx.beginPath();
      // Flattened: a ring on a surface seen at an angle is an ellipse.
      ctx.ellipse(ripple.x, ripple.y, radius, radius * 0.26, 0, 0, Math.PI * 2);
      ctx.stroke();
    }
  }

  /**
   * A shoal drifting past, well below the surface.
   *
   * Silhouettes only — no eyes, no detail, no highlight. At this alpha the shape
   * and the motion are all that survive anyway, and detail would make them
   * compete with the capybara for attention. They fade in and out at the edges
   * rather than popping, because a fish appearing from nothing reads as a glitch.
   */
  private paintShoal(w: number, h: number, waterY: number): void {
    const shoal = this.shoal;
    if (shoal === null) {
      return;
    }

    const progress = shoal.age / shoal.duration;
    // Ease in and out of the frame over the first and last 12% of the crossing.
    const edgeFade = Math.min(1, progress / 0.12, (1 - progress) / 0.12);
    if (edgeFade <= 0) {
      return;
    }

    const ctx = this.context;
    const baseY = waterY + (h - waterY) * shoal.depth;
    // Travel from one edge to the other, with a margin so the lagging fish are
    // fully off-stage at both ends.
    const lead = shoal.direction === 1 ? progress * 1.35 - 0.2 : 1.2 - progress * 1.35;

    ctx.save();
    // Faint on purpose. Legible when you look at the water, never competing with
    // the yuzu, which is the only thing here allowed to ask for attention.
    ctx.globalAlpha = 0.3 * edgeFade;
    ctx.fillStyle = POND_LIFE.fish;

    for (const fish of shoal.offsets) {
      const x = (lead + fish.x * shoal.direction) * w;
      if (x < -60 || x > w + 60) {
        continue;
      }
      // A slow vertical weave, phase-shifted per fish so the shoal undulates
      // instead of moving as one rigid object.
      const weave = Math.sin(this.waterT * 1.6 + fish.x * 30) * 5;
      const size = 17 * fish.scale;

      ctx.save();
      ctx.translate(x, baseY + fish.y + weave);
      ctx.scale(shoal.direction, 1);

      ctx.beginPath();
      ctx.ellipse(0, 0, size, size * 0.42, 0, 0, Math.PI * 2);
      ctx.fill();

      // Forked tail, angled with the weave so it looks like it is doing the work.
      const kick = Math.sin(this.waterT * 7 + fish.x * 30) * 0.35;
      ctx.beginPath();
      ctx.moveTo(-size * 0.85, 0);
      ctx.lineTo(-size * 1.7, -size * (0.45 + kick));
      ctx.lineTo(-size * 1.45, 0);
      ctx.lineTo(-size * 1.7, size * (0.45 - kick));
      ctx.closePath();
      ctx.fill();

      ctx.restore();
    }
    ctx.restore();
  }

  /**
   * A frog surfacing for a moment.
   *
   * Rises, sits, blinks twice, sinks — the whole visit is a little over five
   * seconds. Only the top of the head clears the water, which is both what a
   * frog actually does and the cheapest way to make it read at this size: two
   * eye bumps on a dome is unmistakable, where a whole frog at 30 pixels is mush.
   */
  private paintFrog(w: number, waterY: number): void {
    const frog = this.frog;
    if (frog === null) {
      return;
    }

    const t = frog.age / FROG_LIFETIME_S;
    // Rise over the first fifth, hold, sink over the last fifth.
    const surfaced = Math.min(1, t / 0.2, (1 - t) / 0.2);
    if (surfaced <= 0) {
      return;
    }

    const ctx = this.context;
    const x = frog.x * w;
    const bob = Math.sin(this.waterT * 1.8 + 1.2) * 2;
    // Sits *in* the surface: the visible dome is the part above the water line.
    const y = waterY + 4 - surfaced * 16 + bob;
    // Small, but not so small it reads as a speck. At 15 the eyes stopped being
    // legible on a counter display; this is the smallest size that still says frog.
    const size = 19;

    ctx.save();
    ctx.globalAlpha = surfaced;

    // Head, clipped to the waterline so it emerges rather than hovering.
    ctx.save();
    ctx.beginPath();
    ctx.rect(x - size * 2, y - size * 2, size * 4, waterY + 5 - (y - size * 2));
    ctx.clip();
    ctx.fillStyle = POND_LIFE.frogBody;
    ctx.beginPath();
    ctx.ellipse(x, y + size * 0.5, size, size * 0.78, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();

    // Eye bumps sitting proud of the head, the way a frog's do.
    const blink = this.frogBlink(t);
    for (const side of [-1, 1] as const) {
      const ex = x + side * size * 0.52;
      const ey = y - size * 0.1;
      ctx.fillStyle = POND_LIFE.frogHead;
      ctx.beginPath();
      ctx.arc(ex, ey, size * 0.36, 0, Math.PI * 2);
      ctx.fill();

      ctx.fillStyle = POND_LIFE.frogEye;
      ctx.beginPath();
      ctx.ellipse(ex, ey, size * 0.2, size * 0.2 * blink, 0, 0, Math.PI * 2);
      ctx.fill();

      if (blink > 0.4) {
        ctx.fillStyle = ONSEN.ink;
        ctx.beginPath();
        ctx.ellipse(ex, ey, size * 0.09, size * 0.16 * blink, 0, 0, Math.PI * 2);
        ctx.fill();
      }
    }

    // The disturbance where it meets the water, so it displaces something.
    ctx.strokeStyle = withAlpha(ONSEN.steam, 0.22 * surfaced);
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.ellipse(x, waterY + 3, size * 1.5, size * 0.3, 0, 0, Math.PI * 2);
    ctx.stroke();

    ctx.restore();
  }

  /**
   * Frog eyelids: open, then two blinks partway through the visit.
   *
   * 1 is fully open, 0 fully shut. The blinks are what make it read as alive
   * rather than as a decal on the water.
   */
  private frogBlink(t: number): number {
    for (const at of [0.42, 0.58]) {
      const delta = Math.abs(t - at);
      if (delta < 0.035) {
        return delta / 0.035;
      }
    }
    return 1;
  }

  /** A slow bar of light while she's looking — visible "working" without a spinner. */
  private paintScanSweep(w: number, waterY: number): void {
    const ctx = this.context;
    const t = this.reducedMotion ? 0.5 : (this.waterT * 0.7) % 1;
    const y = t * waterY;
    const gradient = ctx.createLinearGradient(0, y - 60, 0, y + 60);
    gradient.addColorStop(0, withAlpha(ONSEN.kelp, 0));
    gradient.addColorStop(0.5, withAlpha(ONSEN.kelp, 0.16));
    gradient.addColorStop(1, withAlpha(ONSEN.kelp, 0));
    ctx.fillStyle = gradient;
    ctx.fillRect(0, y - 60, w, 120);
  }

  private paintSteam(w: number, waterY: number, reveal: number): void {
    if (this.reducedMotion) {
      return;
    }
    const ctx = this.context;
    ctx.save();
    // Radial gradients, not flat ellipses. A hard-edged translucent shape at
    // this size reads as a smudge on the lens; steam has no edge at all.
    for (let i = 0; i < 5; i++) {
      const phase = this.waterT * 0.32 + i * 1.7;
      const climb = (this.waterT * 22 + i * 95) % 300;
      const x = w * (0.12 + i * 0.19) + Math.sin(phase) * w * 0.05;
      const y = waterY - 20 - climb;
      const radius = 60 + i * 12 + climb * 0.25;
      // Fades in off the water and thins out as it rises, like the real thing.
      const strength = (0.05 + (1 - reveal) * 0.16) * Math.min(1, climb / 60) * (1 - climb / 300);
      if (strength <= 0.002) {
        continue;
      }
      const plume = ctx.createRadialGradient(x, y, 0, x, y, radius);
      plume.addColorStop(0, withAlpha(ONSEN.steam, strength));
      plume.addColorStop(0.6, withAlpha(ONSEN.steam, strength * 0.35));
      plume.addColorStop(1, withAlpha(ONSEN.steam, 0));
      ctx.fillStyle = plume;
      ctx.beginPath();
      ctx.arc(x, y, radius, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
  }

  /**
   * Outline each detected barcode where it actually sits in the frame.
   *
   * Drawn as corner brackets rather than a closed rectangle: a full box over a
   * barcode covers the bars it is pointing at, and brackets read as "this thing
   * here" while leaving the label legible. Colour carries the whole message —
   * green means this shop sells it, red means the code scans but is not stocked.
   */
  private paintCodes(w: number, h: number): void {
    if (this.codes.length === 0) {
      return;
    }
    const ctx = this.context;

    for (const code of this.codes) {
      const rect = coverRect(code.box, this.frameSize, { width: w, height: h });
      if (rect.width <= 0 || rect.height <= 0) {
        continue;
      }

      const colour = code.matched ? SCAN_BOX.matched : SCAN_BOX.unknown;
      // Corner arms scale with the box but stay inside it, so a small code gets
      // small brackets rather than four strokes overlapping into a blob.
      const arm = Math.max(6, Math.min(rect.width, rect.height) * 0.28);

      ctx.save();
      // A soft outer glow lifts the brackets off busy packaging; without it a
      // green stroke on a green box disappears.
      ctx.shadowColor = withAlpha(colour, 0.55);
      ctx.shadowBlur = 10;
      ctx.strokeStyle = colour;
      ctx.lineWidth = 3;
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';

      for (const [cx, cy, dx, dy] of [
        [rect.x, rect.y, 1, 1],
        [rect.x + rect.width, rect.y, -1, 1],
        [rect.x + rect.width, rect.y + rect.height, -1, -1],
        [rect.x, rect.y + rect.height, 1, -1],
      ] as const) {
        ctx.beginPath();
        ctx.moveTo(cx + dx * arm, cy);
        ctx.lineTo(cx, cy);
        ctx.lineTo(cx, cy + dy * arm);
        ctx.stroke();
      }
      ctx.restore();
    }
  }

  /**
   * A thin ring around the whole stage reporting how close a look is.
   *
   * At the edge rather than anywhere central because it is peripheral
   * information: a cashier holding an item up is watching their hands, and the
   * border of the display is the only part still in view. Quiet on purpose — the
   * yuzu is the one element on this stage allowed to be loud.
   */
  private paintProgressRing(w: number, h: number): void {
    if (this.scanProgress.kind === 'hidden') {
      return;
    }

    const ctx = this.context;
    const width = w - RING_INSET * 2;
    const height = h - RING_INSET * 2;
    if (width <= 0 || height <= 0) {
      return;
    }
    const perimeter = roundedPerimeter(width, height, RING_RADIUS);

    ctx.save();
    ctx.lineWidth = RING_WIDTH;
    ctx.lineCap = 'round';

    // A faint full ring as the track, so a barely-started ring reads as one that
    // is filling rather than as a stray mark in the corner.
    ctx.strokeStyle = withAlpha(ONSEN.kelp, 0.12);
    ctx.setLineDash([]);
    roundedRect(ctx, RING_INSET, RING_INSET, width, height, RING_RADIUS);
    ctx.stroke();

    ctx.strokeStyle = withAlpha(ONSEN.kelp, 0.85);
    if (this.scanProgress.kind === 'settling') {
      ctx.setLineDash([clamp01(this.scanProgress.value) * perimeter, perimeter]);
      ctx.lineDashOffset = 0;
    } else {
      // Reading: the duration is unknown, so a short arm sweeps the perimeter
      // instead of pretending to a percentage.
      const arm = perimeter * 0.18;
      ctx.setLineDash([arm, perimeter - arm]);
      ctx.lineDashOffset = this.reducedMotion ? 0 : -((this.waterT * perimeter * 0.55) % perimeter);
    }
    roundedRect(ctx, RING_INSET, RING_INSET, width, height, RING_RADIUS);
    ctx.stroke();
    ctx.restore();
  }
}

/** Per-state rig targets. Kept as data so a test can assert the pose directly. */
const POSES: Record<
  ClerkVisualState,
  { lean: number; headTilt: number; earForward: number; eyeOpen: number; mouthBias: number }
> = {
  idle: { lean: 0, headTilt: 0, earForward: 0, eyeOpen: 1, mouthBias: 0 },
  listening: { lean: 0.15, headTilt: -0.04, earForward: 1, eyeOpen: 1.05, mouthBias: 0 },
  scanning: { lean: 0.55, headTilt: 0.02, earForward: 0.4, eyeOpen: 0.72, mouthBias: 0 },
  found: { lean: 0.2, headTilt: -0.02, earForward: 0.7, eyeOpen: 1.28, mouthBias: 0.2 },
  confused: { lean: -0.1, headTilt: 0.17, earForward: -0.55, eyeOpen: 0.95, mouthBias: 0.05 },
  speaking: { lean: 0.08, headTilt: 0, earForward: 0.2, eyeOpen: 1, mouthBias: 0.1 },
};

/** Rounded rectangle via arcTo — supported everywhere, unlike `roundRect`. */
function roundedRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number
): void {
  const radius = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + radius, y);
  ctx.arcTo(x + w, y, x + w, y + h, radius);
  ctx.arcTo(x + w, y + h, x, y + h, radius);
  ctx.arcTo(x, y + h, x, y, radius);
  ctx.arcTo(x, y, x + w, y, radius);
  ctx.closePath();
}

function clamp01(value: number): number {
  return Math.min(1, Math.max(0, value));
}

function easeOut(t: number): number {
  return 1 - Math.pow(1 - t, 3);
}

/** Pick a colour along a ramp of hex stops. */
export function rampColor(ramp: readonly string[], t: number): string {
  if (ramp.length === 0) {
    return '#000000';
  }
  const clamped = clamp01(t) * (ramp.length - 1);
  const index = Math.min(ramp.length - 2, Math.floor(clamped));
  const from = ramp[index] ?? ramp[0]!;
  const to = ramp[index + 1] ?? from;
  return mixHex(from, to, clamped - index);
}

/**
 * Blend two hex colours, returning hex.
 *
 * Hex out, not `rgb(...)`: the result is routinely fed straight back into
 * `withAlpha`, which parses hex. Returning a functional colour string here made
 * that produce `rgba(NaN, ...)`, which canvas rejects — and a rejected gradient
 * stop throws mid-frame.
 */
function mixHex(from: string, to: string, t: number): string {
  const a = parseHex(from);
  const b = parseHex(to);
  const channel = (i: number) =>
    Math.round(a[i]! + (b[i]! - a[i]!) * clamp01(t))
      .toString(16)
      .padStart(2, '0');
  return `#${channel(0)}${channel(1)}${channel(2)}`;
}

function parseHex(hex: string): [number, number, number] {
  const value = hex.replace('#', '');
  return [
    parseInt(value.slice(0, 2), 16),
    parseInt(value.slice(2, 4), 16),
    parseInt(value.slice(4, 6), 16),
  ];
}

/** Hex + alpha as `rgba()`, so palette constants stay single-source. */
export function withAlpha(hex: string, alpha: number): string {
  const [r, g, b] = parseHex(hex);
  return `rgba(${r},${g},${b},${clamp01(alpha)})`;
}
