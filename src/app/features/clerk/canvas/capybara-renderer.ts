import {
  MOOD_TINTS,
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

/**
 * How the last thing that happened went.
 *
 * A separate axis from `ClerkVisualState`, not more values on it, because the two
 * are genuinely independent: she can be listening while still sorry about the item
 * she just took back, and every combination of the two is meaningful.
 *
 * Four outcomes and a resting state, chosen because they are the four a cashier has
 * to respond to differently — it went in, stock refused it, I don't know what that
 * is, something is wrong with the code or the camera. This is what the voice was
 * carrying, and muting her is what makes it the body's job.
 */
export const ClerkMood = {
  NEUTRAL: 'neutral',
  HAPPY: 'happy',
  UNSURE: 'unsure',
  SORRY: 'sorry',
  ALERT: 'alert',
} as const;
export type ClerkMood = (typeof ClerkMood)[keyof typeof ClerkMood];

/**
 * The one-off movement a mood arrives with.
 *
 * Moods hold a pose; gestures are the moment of change, and they are what make an
 * expression register on a stage nobody is staring at. A sustained pose that simply
 * appeared is easy to miss; a nod is not.
 */
type GestureKind = 'nod' | 'shake' | 'tilt' | 'perk';

/** How long each gesture plays for, in seconds. */
const GESTURE_SECONDS: Record<GestureKind, number> = {
  nod: 0.8,
  shake: 1,
  tilt: 0.9,
  perk: 0.6,
};

/** Longest frame step we will integrate. Guards against a backgrounded tab. */
const MAX_DT_S = 0.05;

/** Capybara geometry is authored in these units; head width is ~224. */
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
  private mood: ClerkMood = ClerkMood.NEUTRAL;
  /** 0..1. How hard the mood is played — full when she has no voice to use. */
  private moodStrength = 0;
  /** The gesture currently playing, and how far into it we are, in seconds. */
  private gesture: { kind: GestureKind; t: number } | null = null;
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
   * How the last outcome went, and how hard to play it.
   *
   * Intensity is a separate argument rather than baked into the mood because the
   * same outcome is played differently depending on whether she can also say it:
   * muted, the body is the only channel and gets to use all of itself.
   *
   * A gesture fires only on a *change* of mood — being asked for the mood she is
   * already in is the every-frame case, and re-triggering the movement on it would
   * produce a permanent twitch.
   */
  setMood(mood: ClerkMood, intensity: number): void {
    this.moodStrength = clamp01(intensity);
    if (mood === this.mood) {
      return;
    }
    this.mood = mood;
    const gesture = MOOD_GESTURES[mood];
    // Reduced motion keeps the pose and drops the movement: the information is in
    // the shape she holds, and the nod is only there to draw the eye to it.
    this.gesture = gesture === null || this.reducedMotion ? null : { kind: gesture, t: 0 };
    if (mood === ClerkMood.HAPPY && !this.reducedMotion) {
      // Same trick as arriving at `found`: the bounce comes from the spring, so it
      // carries whatever the body was already doing instead of overriding it.
      this.bob.velocity -= 16;
    }
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
      this.gesture = null;
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
    mood: ClerkMood;
    moodStrength: number;
    gesture: GestureKind | null;
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
      mood: this.mood,
      moodStrength: this.moodStrength,
      gesture: this.gesture?.kind ?? null,
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

    if (this.gesture !== null) {
      this.gesture.t += dt;
      if (this.gesture.t > GESTURE_SECONDS[this.gesture.kind]) {
        this.gesture = null;
      }
    }

    const pose = POSES[this.state];
    // The mood is added to the pose rather than replacing it, and scaled, so the job
    // she is doing still reads underneath the reaction. `neutral` is all zeroes,
    // which is what makes an un-moody clerk behave exactly as she did before.
    const mood = MOOD_OFFSETS[this.mood];
    const k = this.moodStrength;
    const swing = this.gestureSwing();

    this.lean.step(pose.lean + mood.lean * k, dt);
    this.headTilt.step(pose.headTilt + this.gazeX * 0.05 + mood.headTilt * k + swing.headTilt, dt);
    this.headTurn.step(this.gazeX + swing.headTurn, dt);
    this.earForward.step(pose.earForward + mood.earForward * k + swing.earForward, dt);
    this.eyeOpen.step(pose.eyeOpen + mood.eyeOpen * k + swing.eyeOpen, dt);
    this.bob.step(0, dt);
    this.halo.step(this.state === 'listening' ? 1 : 0, dt);
    this.yuzuLift.step(this.confidence, dt);
    this.mouth.step(this.mouthTarget(nowMs, pose.mouthBias + mood.mouthBias * k), dt);

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

  /**
   * What the gesture currently playing adds to the rig, decaying to nothing.
   *
   * Only partly scaled by mood strength: the sustained pose is what gets dialled
   * back when she can speak, while the movement that announces it stays legible
   * either way — a gesture nobody notices is not worth simulating.
   */
  private gestureSwing(): {
    headTilt: number;
    headTurn: number;
    earForward: number;
    eyeOpen: number;
  } {
    const gesture = this.gesture;
    if (gesture === null) {
      return { headTilt: 0, headTurn: 0, earForward: 0, eyeOpen: 0 };
    }
    const duration = GESTURE_SECONDS[gesture.kind];
    const decay = Math.max(0, 1 - gesture.t / duration);
    const phase = (gesture.t / duration) * Math.PI * 2;
    const amount = (0.55 + 0.45 * this.moodStrength) * decay;

    switch (gesture.kind) {
      // Two dips of the head. Yes, that went in.
      case 'nod':
        return {
          headTilt: Math.sin(phase * 2) * 0.14 * amount,
          headTurn: 0,
          earForward: 0,
          eyeOpen: 0,
        };
      // One and a half turns side to side, slower than the nod, because a shake
      // read at the same speed looks like a shiver.
      case 'shake':
        return {
          headTilt: 0,
          headTurn: Math.sin(phase * 1.5) * 0.45 * amount,
          earForward: 0,
          eyeOpen: 0,
        };
      // The universal "hm?": lean the head over and let the ears fall with it.
      case 'tilt':
        return {
          headTilt: Math.sin(phase * 0.5) * 0.12 * amount,
          headTurn: 0,
          earForward: -0.25 * amount,
          eyeOpen: 0,
        };
      // A start. Ears up, eyes wide, gone again in half a second.
      case 'perk':
        return {
          headTilt: 0,
          headTurn: 0,
          earForward: 0.7 * amount,
          eyeOpen: 0.3 * amount,
        };
    }
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
    // Sized so the whole figure — towel to waterline — occupies roughly a third
    // of the stage height. She used to be a quarter, which read as a distant
    // decoration rather than someone serving you; at this size her expression is
    // legible across a counter, which is the only reason she has one.
    //
    // The ceiling is set by the HUD, not by taste: the caption and candidate
    // trays own everything below the waterline and the camera preview owns the
    // top right, so she may grow into the empty middle and no further.
    const scale = Math.min(h * 0.00168, w * 0.00126);
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

    this.paintMoodWash();
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

  /**
   * A wash of colour behind her, in the mood's own hue.
   *
   * The quietest possible version of an expression, and the one that survives being
   * seen out of the corner of an eye: yuzu for an item that went in, persimmon for
   * something wrong, cold water for an apology. It sits behind the figure and never
   * gains an edge, so it reads as light in the room rather than as a badge.
   */
  private paintMoodWash(): void {
    const strength = this.moodStrength;
    if (this.mood === ClerkMood.NEUTRAL || strength < 0.05) {
      return;
    }
    const ctx = this.context;
    const colour = MOOD_TINTS[this.mood];
    const gradient = ctx.createRadialGradient(0, -40, 40, 0, -40, 300);
    gradient.addColorStop(0, withAlpha(colour, 0.22 * strength));
    gradient.addColorStop(1, withAlpha(colour, 0));
    ctx.fillStyle = gradient;
    ctx.beginPath();
    ctx.arc(0, -40, 300, 0, Math.PI * 2);
    ctx.fill();
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
    ctx.ellipse(4, 46, 172, 22, 0, 0, Math.PI * 2);
    ctx.fill();

    // Shoulders and back: a broad loaf. Capybaras have almost no waist, and
    // giving her one would read as a different animal.
    //
    // The coat is now a flat fill rather than a three-stop gradient down the whole
    // figure. That gradient was the single biggest reason she read as *painted* —
    // every cartoon of this animal is drawn as one colour with at most a shadow, and
    // a body lit from top to bottom looks like a rendering of a toy instead of a
    // drawing of a capybara.
    const top = -20 + breath * 0.4;
    ctx.fillStyle = ONSEN.capy;
    roundedRect(ctx, -152, top, 304, 240, 122);
    ctx.fill();

    // The one concession to depth, and it is doing two jobs: the volume turns under
    // her chin, and everything below the waterline goes dark.
    //
    // That second job is why it runs all the way to the deep water colour. A flat
    // coat is the right style above the surface and a liability below it — the water
    // overlay is translucent, so an evenly-lit body carried on glowing through it as
    // a pale blob the width of the stage, which is the "stain on the water" the
    // overlay's own comment warns about. The gradient that used to do this
    // incidentally is gone, so it is done deliberately here.
    ctx.save();
    roundedRect(ctx, -152, top, 304, 240, 122);
    ctx.clip();
    const shade = ctx.createLinearGradient(0, top + 45, 0, top + 170);
    shade.addColorStop(0, withAlpha(ONSEN.capyDark, 0));
    shade.addColorStop(0.35, withAlpha(ONSEN.capyDark, 0.45));
    shade.addColorStop(1, withAlpha(ONSEN.deep, 0.8));
    ctx.fillStyle = shade;
    ctx.fillRect(-152, top, 304, 240);
    ctx.restore();

    // A light wrap around the silhouette. Not an outline — a cartoon keyline would
    // fight the painted water — but enough of a rim to lift her off the bath and
    // make the volume read as plush rather than flat.
    ctx.strokeStyle = withAlpha(ONSEN.capyLight, 0.14);
    ctx.lineWidth = 6;
    roundedRect(ctx, -152, top, 304, 240, 122);
    ctx.stroke();

    // Pale chest, as on the animal, and the thing that stops the body reading as
    // one undifferentiated brown mass now that it is this large.
    //
    // A flat ellipse at any useful opacity showed its own edge and turned into a
    // bubble stuck to her front, so this is a radial gradient that fades out
    // entirely before it gets there.
    //
    // It sits high, in the strip of her that is actually above the water. Centred on
    // the body it was mostly submerged, which is a pale patch spent where nobody can
    // see it and, worse, one more thing showing through the surface.
    const chest = ctx.createRadialGradient(0, top + 26, 8, 0, top + 26, 92);
    chest.addColorStop(0, withAlpha(ONSEN.capyMuzzle, 0.34));
    chest.addColorStop(1, withAlpha(ONSEN.capyMuzzle, 0));
    ctx.fillStyle = chest;
    ctx.beginPath();
    ctx.ellipse(0, top + 26, 92, 58, 0, 0, Math.PI * 2);
    ctx.fill();

    this.paintPaws();

    ctx.restore();
  }

  /**
   * Two front paws resting at the waterline.
   *
   * The most recognisable cue in the whole figure for the least ink: a capybara in a
   * bath is always drawn with its paws up on the rim, and without them the body is
   * simply a loaf that happens to be in water. They sit at the surface rather than on
   * a tub edge, because this bath is a pond and has no rim.
   *
   * Two toe creases, not three — three start to read as fingers.
   */
  private paintPaws(): void {
    const ctx = this.context;
    for (const side of [-1, 1] as const) {
      ctx.save();
      ctx.translate(side * 94, 24);
      ctx.rotate(side * 0.1);
      ctx.fillStyle = ONSEN.capy;
      roundedRect(ctx, -34, -19, 68, 38, 19);
      ctx.fill();
      ctx.strokeStyle = withAlpha(ONSEN.capyDark, 0.22);
      ctx.lineWidth = 3;
      roundedRect(ctx, -34, -19, 68, 38, 19);
      ctx.stroke();
      ctx.strokeStyle = withAlpha(ONSEN.capyDark, 0.3);
      ctx.lineWidth = 2.5;
      ctx.lineCap = 'round';
      for (const dx of [-9, 9]) {
        ctx.beginPath();
        ctx.moveTo(dx, -3);
        ctx.lineTo(dx, 11);
        ctx.stroke();
      }
      ctx.restore();
    }
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

    // The head is a drawn shape rather than a rounded rectangle.
    //
    // A capybara's skull genuinely is blocky, and the first version leaned on
    // that: a 216×170 box with a 36 radius. Rendered, it read as a crate with a
    // face on it. The correction after that went too far the other way — a shape
    // that narrowed into a chin, which is a bear cub, or a bunny, or anything but
    // this animal.
    //
    // What it is now is what every cartoon of a capybara is: a rounded square. Wider
    // than tall, flat across the crown, and still nearly full width at the jaw, so
    // the silhouette is a soft block rather than an egg. Flat-filled for the same
    // reason as the body.
    ctx.fillStyle = ONSEN.capy;
    headPath(ctx, turn);
    ctx.fill();

    // Same light wrap as the body, so the two read as one piece of the same toy.
    ctx.strokeStyle = withAlpha(ONSEN.capyLight, 0.24);
    ctx.lineWidth = 6;
    headPath(ctx, turn);
    ctx.stroke();

    this.paintCheeks(turn);
    this.paintMuzzle(turn);
    this.paintEyes(turn, MOOD_OFFSETS[this.mood].brow * this.moodStrength);
    this.paintTowel(tilt);

    ctx.restore();
  }

  /**
   * Warm patches high on the cheeks.
   *
   * The cheapest friendliness in the whole drawing: two soft ellipses of the
   * persimmon already in the palette, at an alpha low enough that they read as
   * colour in the skin rather than as makeup. They sit under the eyes and outside
   * the muzzle so nothing has to move to accommodate them.
   *
   * They warm further when she is pleased, which is the one place a blush is worth
   * having — and it costs a number, not a drawing.
   */
  private paintCheeks(turn: number): void {
    const ctx = this.context;
    const pleased = this.mood === ClerkMood.HAPPY ? this.moodStrength : 0;
    for (const side of [-1, 1] as const) {
      ctx.fillStyle = withAlpha(ONSEN.tsuba, 0.13 + pleased * 0.13);
      ctx.beginPath();
      ctx.ellipse(side * 88 + turn * 10, -46, 25, 16, side * 0.12, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  private paintEars(turn: number): void {
    const ctx = this.context;
    // Forward when listening, drooped when confused, plus the idle twitch.
    const forward = this.earForward.value;
    const twitch = this.earTwitch * 0.18;

    // Set high and out on the corners of the crown, where a square head puts them.
    // A capybara's ears are almost vestigial next to a bear's, and oversizing them is
    // the fastest way to draw the wrong animal — but under-sizing them into two dark
    // pips read as damage rather than as ears. These are the smallest that still say
    // ear at counter distance.
    //
    // Coat-coloured with a warm inner, never near-black: a dark blob on the skull
    // reads as a hole.
    for (const side of [-1, 1] as const) {
      ctx.save();
      ctx.translate(side * (100 + turn * 6), -136);
      ctx.rotate(side * (0.3 - forward * 0.45 + (side > 0 ? twitch : -twitch * 0.6)));
      ctx.fillStyle = ONSEN.capy;
      ctx.beginPath();
      ctx.ellipse(0, 0, 21, 18, side * 0.18, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = withAlpha(ONSEN.capyDark, 0.35);
      ctx.lineWidth = 3;
      ctx.stroke();
      ctx.fillStyle = withAlpha(ONSEN.tsuba, 0.3);
      ctx.beginPath();
      ctx.ellipse(-side * 3, 2, 11, 9, side * 0.18, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }
  }

  /**
   * Muzzle, nose and mouth.
   *
   * This is where most of the "that isn't a normal cartoon capybara" lived. The face
   * had a nose slab, a philtrum, a wide smile spanning most of the muzzle and six
   * whiskers reaching past the silhouette. Each was defensible as a piece of the real
   * animal; together they were a lot of ink on a face whose whole style depends on
   * having very little.
   *
   * What is left is what the drawings of this animal actually have: one soft blunt
   * snout, one small wide nose, and one short curve of a mouth. Nothing else.
   *
   * The jaw still hinges rather than the hole growing — the upper lip stays put and
   * the lower edge drops, which is how a mouth opens; scaling an ellipse about its
   * centre made the whole face appear to inflate.
   */
  private paintMuzzle(turn: number): void {
    const ctx = this.context;
    const mouthOpen = this.mouth.value;
    const mx = turn * 10;

    // The muzzle is a soft block, not an ellipse. This is where the species lives now
    // that the skull is a rounded square: the roundness buys friendliness up there,
    // the bluntness down here keeps it a capybara rather than a bear cub.
    ctx.fillStyle = ONSEN.capyMuzzle;
    roundedRect(ctx, mx - 62, -48, 124, 58, 28);
    ctx.fill();

    // Nose: wide, flat and small. It is a feature of the face, not the largest thing
    // on it — at the old size the dark rectangle read as the mouth, which left the
    // actual mouth below it looking like a second one.
    ctx.fillStyle = ONSEN.ink;
    roundedRect(ctx, mx - 19, -42, 38, 17, 8);
    ctx.fill();

    // The upper lip: one short smile, drawn once, whether or not the jaw is open.
    // Narrow and close under the nose — a mouth spanning the whole muzzle is a
    // grin, and a grin held permanently is unsettling in a way a smile is not.
    const lipY = -8;
    const corner = 20;
    const drawUpperLip = (): void => {
      ctx.moveTo(mx - corner, lipY - 9);
      ctx.quadraticCurveTo(mx - 10, lipY + 5, mx, lipY);
      ctx.quadraticCurveTo(mx + 10, lipY + 5, mx + corner, lipY - 9);
    };

    if (mouthOpen > 0.04) {
      // Open: the upper lip is the top edge and the jaw swings down from it.
      const drop = 3 + mouthOpen * 17;
      ctx.fillStyle = withAlpha(ONSEN.ink, 0.88);
      ctx.beginPath();
      drawUpperLip();
      ctx.quadraticCurveTo(mx + corner * 0.5, lipY + drop, mx, lipY + drop);
      ctx.quadraticCurveTo(mx - corner * 0.5, lipY + drop, mx - corner, lipY - 9);
      ctx.closePath();
      ctx.fill();

      // Tongue, only once she is open enough for it to be a tongue rather than a
      // stripe. Muted rather than the palette's full persimmon: a saturated red at
      // this size reads as a wound, not as speech.
      if (mouthOpen > 0.55) {
        ctx.fillStyle = withAlpha(ONSEN.tsuba, 0.5);
        ctx.beginPath();
        ctx.ellipse(mx, lipY + drop * 0.72, 10, 4 + mouthOpen * 2.5, 0, 0, Math.PI * 2);
        ctx.fill();
      }
    } else {
      ctx.strokeStyle = withAlpha(ONSEN.ink, 0.6);
      ctx.lineWidth = 4;
      ctx.beginPath();
      drawUpperLip();
      ctx.stroke();
    }
  }

  /**
   * Two dot eyes, and a brow only when the mood asks for one.
   *
   * Smaller and simpler than they were. The old pair carried a wide soft highlight, a
   * hard spec and a third light on the far side, which is how you draw a wet eye —
   * and three lights on a 15-unit dot is how you draw a glass bead. One small spec is
   * the whole style: everything else about this face is flat, and the eyes cannot be
   * the exception.
   *
   * @param brow signed mood strength: above zero raises a brow, below zero lowers
   *   one, and zero — the resting face — draws none at all.
   */
  private paintEyes(turn: number, brow: number): void {
    const ctx = this.context;
    // Combine the deliberate squint with the involuntary blink.
    const open = Math.max(0, this.eyeOpen.value * (1 - this.lidClosed));

    for (const side of [-1, 1] as const) {
      const ex = side * 62 + turn * 12;
      // Set wide and just above the middle of the face. On a real capybara the eyes
      // sit high and close together, and drawing that faithfully is what made the
      // first version look like it was appraising you — eyes high on a face is an
      // adult proportion and we read it as one. Wide and lowish is the same trick
      // every plush version of every animal uses.
      const ey = -80;
      const radius = 15;

      ctx.fillStyle = ONSEN.ink;
      ctx.beginPath();
      ctx.ellipse(ex, ey, radius, radius * clamp01(open), 0, 0, Math.PI * 2);
      ctx.fill();

      if (open > 0.35) {
        // One spec, small, offset with the gaze so the eyes track without moving.
        ctx.fillStyle = withAlpha(ONSEN.steam, 0.9);
        ctx.beginPath();
        ctx.arc(ex - 5 + this.gazeX * 3, ey - 5 + this.gazeY * 2.5, 3.4, 0, Math.PI * 2);
        ctx.fill();
      }

      const lift = Math.min(1, Math.abs(brow));
      if (lift > 0.15) {
        // Raised for a question, lowered for an apology — and drawn lighter than the
        // eye it sits over either way. At the old weight it read as a permanent frown
        // on a face this size, which is exactly why it is no longer permanent.
        const offset = brow > 0 ? -12 : 6;
        ctx.strokeStyle = withAlpha(ONSEN.capyDark, 0.5 * lift);
        ctx.lineWidth = 4;
        ctx.lineCap = 'round';
        ctx.beginPath();
        ctx.moveTo(ex - 15, ey - 26 + offset);
        ctx.quadraticCurveTo(ex, ey - 32 + offset, ex + 15, ey - 26 + offset);
        ctx.stroke();
      }
    }
  }

  /** The folded towel — the one costume piece, and the onsen tell. */
  private paintTowel(tilt: number): void {
    const ctx = this.context;
    ctx.save();
    ctx.translate(0, -152);
    ctx.rotate(-tilt * 0.35);
    // Wider and thicker than the head it sits on, with a big radius: a folded
    // towel is a soft object, and drawing it as a crisp bar reintroduced exactly
    // the hard horizontal the head no longer has.
    ctx.fillStyle = ONSEN.steam;
    roundedRect(ctx, -90, -38, 180, 46, 20);
    ctx.fill();
    ctx.fillStyle = withAlpha(ONSEN.kelp, 0.22);
    roundedRect(ctx, -90, -20, 180, 9, 4);
    ctx.fill();
    ctx.strokeStyle = withAlpha(ONSEN.capyDark, 0.16);
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(-46, -38);
    ctx.lineTo(-46, 8);
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
    // Pushed out to clear the wider body. It has to float beside her in open
    // water — overlapping her flank turns the one thing on this stage allowed to
    // ask for attention into a button sewn onto her side.
    const x = 214;
    const radius = 22 + lift * 4;

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

/**
 * What each mood adds to the pose, before intensity scaling.
 *
 * `neutral` is exactly zero in every channel, and that row is load-bearing: it is
 * what makes a clerk with nothing to react to behave precisely as she did before
 * moods existed, and it is why these are added to the pose rather than blended with
 * it. Anything non-zero at rest would be a permanent expression.
 *
 * `brow` is the odd one out — not a rig spring but a signed instruction to the face:
 * above zero draws a raised brow, below zero a lowered one, and zero draws none at
 * all. A brow over a placid face is what made her look like she was appraising the
 * customer, so at rest she has none.
 */
const MOOD_OFFSETS: Record<
  ClerkMood,
  {
    lean: number;
    headTilt: number;
    earForward: number;
    eyeOpen: number;
    mouthBias: number;
    brow: number;
  }
> = {
  neutral: { lean: 0, headTilt: 0, earForward: 0, eyeOpen: 0, mouthBias: 0, brow: 0 },
  // Up and forward, ears out, mouth open a little. The whole body says yes.
  happy: { lean: 0.14, headTilt: -0.03, earForward: 0.5, eyeOpen: 0.16, mouthBias: 0.24, brow: 0 },
  // Head over, one brow up, ears half back — the pose you make at a question.
  unsure: {
    lean: -0.08,
    headTilt: 0.11,
    earForward: -0.3,
    eyeOpen: -0.04,
    mouthBias: 0.04,
    brow: 1,
  },
  // Down and back, ears flat, eyes narrowed. Legible across a counter as "no".
  sorry: { lean: -0.16, headTilt: 0.05, earForward: -0.8, eyeOpen: -0.28, mouthBias: 0, brow: -1 },
  // Forward, ears up, eyes wide: something needs looking at right now.
  alert: { lean: 0.22, headTilt: 0, earForward: 0.95, eyeOpen: 0.3, mouthBias: 0.1, brow: 1 },
};

/**
 * The movement each mood arrives with, or null for one that simply settles.
 *
 * `sorry` shakes rather than droops because a droop is the pose it is already
 * holding — the gesture has to be the thing the pose is not, or the change of mood
 * passes unnoticed.
 */
const MOOD_GESTURES: Record<ClerkMood, GestureKind | null> = {
  neutral: null,
  happy: 'nod',
  unsure: 'tilt',
  sorry: 'shake',
  alert: 'perk',
};

/**
 * The head outline, as a closed path ready to fill or stroke.
 *
 * Symmetric about `turn * 4`, so turning the head shifts the whole shape rather
 * than skewing it. Four cubic segments: crown, right cheek down to the jaw, chin,
 * and the mirror back up.
 *
 * The control points describe a rounded square: flat across the crown, full width
 * from the cheek all the way down to the jaw, and only the last few units rounding
 * into the chin. That is the shape every cartoon of this animal uses, and the reason
 * is that a head which tapers downward is a different animal — the taper was what
 * made the previous version read as a bear cub in a bath.
 *
 * Authored in the same local units as everything else: the head is 240 wide and
 * 176 tall, sitting from y = -150 to y = 26.
 */
function headPath(ctx: CanvasRenderingContext2D, turn: number): void {
  const x = turn * 4;
  const hw = 120; // half width, held from the cheeks to the jaw
  const top = -150;
  const bottom = 26;
  const cheek = -50; // where the head reaches full width

  ctx.beginPath();
  ctx.moveTo(x, top);
  // Crown: flat across the middle, then turning down sharply into the corner.
  ctx.bezierCurveTo(x + hw * 0.74, top, x + hw, top + 22, x + hw, cheek);
  // Straight down the cheek, then a short round into the chin.
  ctx.bezierCurveTo(x + hw, bottom - 26, x + hw * 0.8, bottom, x, bottom);
  ctx.bezierCurveTo(x - hw * 0.8, bottom, x - hw, bottom - 26, x - hw, cheek);
  ctx.bezierCurveTo(x - hw, top + 22, x - hw * 0.74, top, x, top);
  ctx.closePath();
}

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
