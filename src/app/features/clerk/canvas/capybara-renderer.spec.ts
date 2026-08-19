import { CapybaraRenderer, rampColor, withAlpha } from './capybara-renderer';
import { YUZU_RAMP } from './capybara-palette';

/**
 * jsdom has no real 2D context, so we hand the renderer a recording stub. That is
 * enough for these tests because none of them assert on pixels — they assert on
 * the rig, via `debugPose`, and on the loop's arithmetic.
 */
function stubCanvas(): { canvas: HTMLCanvasElement; calls: string[] } {
  const calls: string[] = [];
  const record =
    (name: string) =>
    (...args: unknown[]): void => {
      calls.push(
        `${name}(${args.map((a) => (typeof a === 'number' ? a.toFixed(2) : a)).join(',')})`
      );
    };

  const gradient = { addColorStop: record('addColorStop') };
  const context: Record<string, unknown> = {
    setTransform: record('setTransform'),
    clearRect: record('clearRect'),
    save: record('save'),
    restore: record('restore'),
    translate: record('translate'),
    scale: record('scale'),
    rotate: record('rotate'),
    beginPath: record('beginPath'),
    closePath: record('closePath'),
    moveTo: record('moveTo'),
    lineTo: record('lineTo'),
    quadraticCurveTo: record('quadraticCurveTo'),
    arcTo: record('arcTo'),
    arc: record('arc'),
    rect: record('rect'),
    clip: record('clip'),
    setLineDash: record('setLineDash'),
    ellipse: record('ellipse'),
    fill: record('fill'),
    stroke: record('stroke'),
    fillRect: record('fillRect'),
    createLinearGradient: () => gradient,
    createRadialGradient: () => gradient,
  };

  const canvas = {
    width: 0,
    height: 0,
    getContext: () => context,
  } as unknown as HTMLCanvasElement;
  (context as { canvas: HTMLCanvasElement }).canvas = canvas;

  return { canvas, calls };
}

/**
 * A monotonic frame clock shared by the helper below.
 *
 * It has to keep advancing across successive `settle` calls within a test: the
 * renderer derives its own timestep from the timestamps it is handed, so a helper
 * that restarted the clock would hand it a step backwards and quietly run the
 * simulation in reverse.
 */
let clock = 0;

/** Run frames at a steady 60fps for `seconds`, continuing from the last call. */
function settle(renderer: CapybaraRenderer, seconds = 2): void {
  const step = 1000 / 60;
  for (let i = 0; i < Math.round(seconds * 60); i++) {
    clock += step;
    renderer.render(clock);
  }
}

describe('CapybaraRenderer', () => {
  let canvas: HTMLCanvasElement;
  let calls: string[];
  let renderer: CapybaraRenderer;

  beforeEach(() => {
    clock = 1000;
    ({ canvas, calls } = stubCanvas());
    renderer = new CapybaraRenderer(canvas);
    renderer.resize(800, 600, 2);
  });

  it('refuses to construct without a 2D context', () => {
    const bare = { getContext: () => null } as unknown as HTMLCanvasElement;
    expect(() => new CapybaraRenderer(bare)).toThrow(/2D canvas context/);
  });

  describe('sizing', () => {
    it('scales the backing store by the device pixel ratio', () => {
      expect(canvas.width).toBe(1600);
      expect(canvas.height).toBe(1200);
      expect(calls).toContain('setTransform(2.00,0.00,0.00,2.00,0.00,0.00)');
    });

    it('never produces a zero-sized backing store', () => {
      renderer.resize(0, 0, 1);
      expect(canvas.width).toBe(1);
      expect(canvas.height).toBe(1);
    });

    it('draws nothing at zero size rather than dividing by it', () => {
      renderer.resize(0, 0, 1);
      calls.length = 0;
      expect(() => renderer.render(clock)).not.toThrow();
      expect(calls.filter((call) => call.startsWith('fill('))).toHaveLength(0);
    });
  });

  describe('poses', () => {
    it('leans in and narrows its eyes while scanning', () => {
      renderer.setState('scanning');
      settle(renderer);
      const pose = renderer.debugPose();
      expect(pose.lean).toBeGreaterThan(0.4);
      expect(pose.eyeOpen).toBeLessThan(0.8);
    });

    it('tilts its head and droops its ears when confused', () => {
      renderer.setState('confused');
      settle(renderer);
      const pose = renderer.debugPose();
      expect(pose.headTilt).toBeGreaterThan(0.12);
      expect(pose.earForward).toBeLessThan(0);
    });

    it('puts its ears forward while listening', () => {
      renderer.setState('listening');
      settle(renderer);
      expect(renderer.debugPose().earForward).toBeGreaterThan(0.8);
    });

    it('widens its eyes when it finds something', () => {
      renderer.setState('found');
      settle(renderer);
      expect(renderer.debugPose().eyeOpen).toBeGreaterThan(1.2);
    });

    it('bounces on arriving at found, rather than easing into it', () => {
      settle(renderer, 0.5);
      const before = renderer.debugPose();
      renderer.setState('found');
      settle(renderer, 1 / 60);
      // The impulse is velocity, so the very next frame has already moved.
      expect(renderer.debugPose().lean).not.toBe(before.lean);
    });

    it('returns to a neutral pose when it goes idle again', () => {
      renderer.setState('scanning');
      settle(renderer);
      renderer.setState('idle');
      settle(renderer, 3);
      const pose = renderer.debugPose();
      expect(Math.abs(pose.lean)).toBeLessThan(0.05);
      expect(pose.eyeOpen).toBeCloseTo(1, 1);
    });
  });

  describe('gaze', () => {
    it('turns its head toward what it is looking at', () => {
      renderer.lookAt(1, 0.5);
      settle(renderer);
      expect(renderer.debugPose().headTurn).toBeGreaterThan(0.8);
    });

    it('clamps gaze to the stage, so an out-of-range value cannot spin the head', () => {
      renderer.lookAt(50, -50);
      settle(renderer);
      expect(renderer.debugPose().headTurn).toBeLessThanOrEqual(1.05);
    });
  });

  describe('speech', () => {
    it('opens the mouth just after a word begins', () => {
      renderer.setState('speaking');
      settle(renderer, 0.5);
      const now = clock;
      renderer.setSpeech(true, now);
      // A few frames into the word, the mouth should be opening.
      for (let i = 1; i <= 4; i++) {
        renderer.render(now + i * 16);
      }
      expect(renderer.debugPose().mouth).toBeGreaterThan(0.1);
    });

    it('closes the mouth once it stops speaking', () => {
      renderer.setState('idle');
      renderer.setSpeech(true, clock);
      settle(renderer, 0.3);
      renderer.setSpeech(false, clock);
      settle(renderer, 1);
      expect(renderer.debugPose().mouth).toBeLessThan(0.1);
    });
  });

  describe('the yuzu', () => {
    it('lifts as confidence rises', () => {
      renderer.setConfidence(0.95);
      settle(renderer);
      expect(renderer.debugPose().yuzuLift).toBeGreaterThan(0.85);
    });

    it('clamps confidence to 0..1', () => {
      renderer.setConfidence(9);
      settle(renderer);
      expect(renderer.debugPose().yuzuLift).toBeLessThan(1.2);
    });

    it('drops and ripples on a plop', () => {
      renderer.plop();
      expect(renderer.debugPose().ripples).toBe(1);
      settle(renderer, 1 / 60);
      // The impulse is downward, so it dips below the resting height first.
      expect(renderer.debugPose().yuzuLift).toBeLessThan(0);
    });

    it('lets ripples expire instead of accumulating', () => {
      renderer.plop();
      settle(renderer, 3);
      expect(renderer.debugPose().ripples).toBe(0);
    });

    it('caps how many ripples are alive at once', () => {
      for (let i = 0; i < 20; i++) {
        renderer.plop();
      }
      expect(renderer.debugPose().ripples).toBeLessThanOrEqual(6);
    });
  });

  describe('the pond', () => {
    it('sends nothing through during the entrance', () => {
      // The reveal is the one choreographed moment; a fish crossing it competes.
      settle(renderer, 2);
      expect(renderer.debugPose().fish).toBe(false);
      expect(renderer.debugPose().frog).toBe(false);
    });

    it('sends a shoal past once the stage has settled', () => {
      settle(renderer, 12);
      expect(renderer.debugPose().fish).toBe(true);
    });

    it('lets the shoal leave rather than looping it', () => {
      settle(renderer, 12);
      expect(renderer.debugPose().fish).toBe(true);
      settle(renderer, 14);
      expect(renderer.debugPose().fish).toBe(false);
    });

    it('alternates fish and frog, so the two never arrive together', () => {
      settle(renderer, 12);
      expect(renderer.debugPose().fish).toBe(true);
      expect(renderer.debugPose().frog).toBe(false);
      expect(renderer.debugPose().ambientNext).toBe('frog');

      // Next visitor, whenever it comes, is the frog — and it comes alone.
      let sawFrog = false;
      for (let i = 0; i < 60 && !sawFrog; i++) {
        settle(renderer, 1);
        const pose = renderer.debugPose();
        // The invariant that matters: never both at once.
        expect(pose.fish && pose.frog).toBe(false);
        sawFrog = pose.frog;
      }
      expect(sawFrog).toBe(true);
    });

    it('lets the frog sink again', () => {
      // Walk forward until a frog shows up, then confirm it leaves.
      let appeared = false;
      for (let i = 0; i < 60 && !appeared; i++) {
        settle(renderer, 1);
        appeared = renderer.debugPose().frog;
      }
      expect(appeared).toBe(true);
      settle(renderer, 8);
      expect(renderer.debugPose().frog).toBe(false);
    });

    it('keeps the pond still when motion is reduced', () => {
      renderer.setReducedMotion(true);
      settle(renderer, 60);
      expect(renderer.debugPose().fish).toBe(false);
      expect(renderer.debugPose().frog).toBe(false);
    });

    it('clears anything mid-visit when motion is switched off', () => {
      settle(renderer, 12);
      expect(renderer.debugPose().fish).toBe(true);
      renderer.setReducedMotion(true);
      expect(renderer.debugPose().fish).toBe(false);
    });
  });

  describe('the frame clock', () => {
    it('clamps a long gap, so a backgrounded tab does not resume with one huge step', () => {
      renderer.render(clock); // first frame uses the 1/60 fallback step
      renderer.render(clock + 60_000); // a minute hidden
      // The second step is clamped to 50ms rather than integrating 60 seconds.
      expect(renderer.debugPose().breathT).toBeLessThanOrEqual(1 / 60 + 0.05);
    });

    it('advances the ambient clock at roughly real time', () => {
      settle(renderer, 1);
      expect(renderer.debugPose().breathT).toBeGreaterThan(0.9);
      expect(renderer.debugPose().breathT).toBeLessThan(1.1);
    });
  });

  describe('reduced motion', () => {
    it('freezes the ambient clocks', () => {
      renderer.setReducedMotion(true);
      settle(renderer, 2);
      expect(renderer.debugPose().breathT).toBe(0);
    });

    it('drops pending ripples', () => {
      renderer.plop();
      renderer.setReducedMotion(true);
      expect(renderer.debugPose().ripples).toBe(0);
    });

    it('still reports confidence through the yuzu', () => {
      // The motion goes away; the information must not.
      renderer.setReducedMotion(true);
      renderer.setConfidence(0.9);
      settle(renderer, 2);
      expect(renderer.debugPose().yuzuLift).toBeGreaterThan(0.8);
    });

    it('still reaches its poses', () => {
      renderer.setReducedMotion(true);
      renderer.setState('confused');
      settle(renderer, 2);
      expect(renderer.debugPose().headTilt).toBeGreaterThan(0.12);
    });
  });
});

describe('CapybaraRenderer overlays', () => {
  let canvas: HTMLCanvasElement;
  let calls: string[];
  let renderer: CapybaraRenderer;

  beforeEach(() => {
    clock = 1000;
    ({ canvas, calls } = stubCanvas());
    renderer = new CapybaraRenderer(canvas);
    renderer.resize(800, 600, 1);
  });

  /** Everything drawn since the last frame started. */
  function frame(): string[] {
    calls.length = 0;
    settle(renderer, 1 / 60);
    return calls;
  }

  describe('barcode boxes', () => {
    const box = { x: 0.25, y: 0.25, width: 0.5, height: 0.25 };

    /**
     * Strokes drawn in one frame. The capybara strokes plenty on her own — brows,
     * whiskers, the water line — so brackets are counted as a delta against a
     * frame with no codes rather than in absolute terms.
     */
    function strokes(): number {
      return frame().filter((call) => call === 'stroke()').length;
    }

    it('draws four brackets per code, and nothing without one', () => {
      // Brackets rather than a closed box: a rectangle over a barcode covers the
      // bars it is pointing at.
      renderer.setCodes([], { width: 1280, height: 720 });
      const baseline = strokes();

      renderer.setCodes([{ box, matched: true }], { width: 1280, height: 720 });
      expect(strokes()).toBe(baseline + 4);
    });

    it('draws nothing when the camera has not reported its size yet', () => {
      // The first frames after play() report zero dimensions.
      renderer.setCodes([], { width: 1280, height: 720 });
      const baseline = strokes();

      renderer.setCodes([{ box, matched: true }], { width: 0, height: 0 });
      expect(strokes()).toBe(baseline);
    });

    it('places the box where the code is, following the video crop', () => {
      // Stage and frame are both 4:3, so nothing is cropped and the box lands a
      // quarter across and a quarter down: (200, 150) of an 800x600 stage.
      renderer.setCodes([{ box, matched: true }], { width: 800, height: 600 });
      const drawn = frame();
      expect(drawn).toContain('lineTo(200.00,150.00)');
    });

    it('shifts the box when the video is cropped', () => {
      // A 16:9 camera on this 4:3 stage is scaled to fill the width and cropped top
      // and bottom, so the same normalised box lands higher up.
      renderer.setCodes([{ box, matched: true }], { width: 1600, height: 900 });
      const cropped = frame().find((call) => call.startsWith('lineTo(200.00,')) ?? '';
      expect(cropped).not.toBe('');
      expect(cropped).not.toBe('lineTo(200.00,150.00)');
    });

    it('handles several codes at once', () => {
      renderer.setCodes([], { width: 1280, height: 720 });
      const baseline = strokes();

      renderer.setCodes(
        [
          { box, matched: true },
          { box: { x: 0.1, y: 0.6, width: 0.2, height: 0.1 }, matched: false },
        ],
        { width: 1280, height: 720 }
      );
      expect(strokes()).toBe(baseline + 8);
    });
  });

  describe('the progress ring', () => {
    it('draws nothing when hidden', () => {
      renderer.setScanProgress({ kind: 'hidden' });
      expect(frame().filter((call) => call.startsWith('setLineDash'))).toHaveLength(0);
    });

    it('draws a track and a partial arc while settling', () => {
      renderer.setScanProgress({ kind: 'settling', value: 0.5 });
      const dashes = frame().filter((call) => call.startsWith('setLineDash'));
      // An empty dash for the full track, then a partial dash for the progress.
      expect(dashes.length).toBeGreaterThanOrEqual(2);
    });

    it('grows the arc with the value', () => {
      const lengthAt = (value: number): number => {
        renderer.setScanProgress({ kind: 'settling', value });
        const dash = frame().find((call) => /setLineDash\(\d/.test(call)) ?? '';
        return Number.parseFloat(dash.replace('setLineDash(', ''));
      };
      expect(lengthAt(0.8)).toBeGreaterThan(lengthAt(0.2));
    });

    it('clamps a value outside 0..1', () => {
      renderer.setScanProgress({ kind: 'settling', value: 5 });
      expect(() => frame()).not.toThrow();
    });

    it('sweeps while reading, rather than claiming a percentage', () => {
      renderer.setScanProgress({ kind: 'reading' });
      settle(renderer, 0.5);
      const first = frame();
      settle(renderer, 0.3);
      const second = frame();
      const offsetOf = (drawn: string[]): string =>
        drawn.find((call) => call.startsWith('setLineDash')) ?? '';
      // Same short arm each frame; it is the offset that moves.
      expect(offsetOf(first)).toBe(offsetOf(second));
    });

    it('stops the sweep when motion is reduced', () => {
      renderer.setReducedMotion(true);
      renderer.setScanProgress({ kind: 'reading' });
      expect(() => frame()).not.toThrow();
    });

    it('draws nothing at zero size', () => {
      renderer.resize(0, 0, 1);
      renderer.setScanProgress({ kind: 'settling', value: 0.5 });
      expect(frame().filter((call) => call.startsWith('setLineDash'))).toHaveLength(0);
    });
  });
});

describe('rampColor', () => {
  it('returns the first stop at zero and the last at one', () => {
    expect(rampColor(YUZU_RAMP, 0)).toBe('#7fa84e');
    expect(rampColor(YUZU_RAMP, 1)).toBe('#f0b429');
  });

  it('interpolates between stops', () => {
    // Halfway is the middle stop itself, not an average of the two ends.
    expect(rampColor(YUZU_RAMP, 0.5)).toBe('#c98f2b');
  });

  it('returns hex, so the result can be fed back through withAlpha', () => {
    // Regression: returning `rgb(...)` here produced `rgba(NaN, ...)` when the
    // yuzu's glow gradient re-parsed it, and canvas throws on a bad gradient
    // stop — which killed the whole animation loop for the rest of the session.
    for (let t = 0; t <= 1.0001; t += 0.05) {
      const withA = withAlpha(rampColor(YUZU_RAMP, t), 0.5);
      expect(withA).toMatch(/^rgba\(\d{1,3},\d{1,3},\d{1,3},[\d.]+\)$/);
      expect(withA).not.toContain('NaN');
    }
  });

  it('clamps out-of-range input', () => {
    expect(rampColor(YUZU_RAMP, -3)).toBe(rampColor(YUZU_RAMP, 0));
    expect(rampColor(YUZU_RAMP, 3)).toBe(rampColor(YUZU_RAMP, 1));
  });

  it('handles an empty ramp without throwing', () => {
    expect(rampColor([], 0.5)).toBe('#000000');
  });
});

describe('withAlpha', () => {
  it('converts a hex colour to rgba', () => {
    expect(withAlpha('#F0B429', 0.5)).toBe('rgba(240,180,41,0.5)');
  });

  it('clamps alpha', () => {
    expect(withAlpha('#000000', 4)).toBe('rgba(0,0,0,1)');
    expect(withAlpha('#000000', -4)).toBe('rgba(0,0,0,0)');
  });
});
