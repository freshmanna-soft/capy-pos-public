import { DEFAULT_FRAME_GATE_CONFIG, FrameGate, meanAbsoluteDifference } from './frame-gate';

/** A flat sample of a single luma value — the simplest "scene" to reason about. */
function flat(value: number, length = 16): Uint8Array {
  return new Uint8Array(length).fill(value);
}

const { settleMs, minIntervalMs } = DEFAULT_FRAME_GATE_CONFIG;

describe('FrameGate', () => {
  let gate: FrameGate;

  beforeEach(() => {
    gate = new FrameGate();
  });

  it('has nothing to compare on the first frame', () => {
    expect(gate.evaluate(flat(100), 0)).toBe('warming');
  });

  it('reports motion while the scene is changing', () => {
    gate.evaluate(flat(100), 0);
    expect(gate.evaluate(flat(200), 100)).toBe('moving');
  });

  it('waits for the scene to settle before looking', () => {
    gate.evaluate(flat(100), 0);
    // First still frame only starts the clock.
    expect(gate.evaluate(flat(100), 100)).toBe('holding');
    expect(gate.evaluate(flat(100), 100 + settleMs - 1)).toBe('holding');
    // minIntervalMs has also elapsed by here, so this is a real capture.
    expect(gate.evaluate(flat(100), minIntervalMs + settleMs + 100)).toBe('capture');
  });

  it('holds back a second look until the minimum interval has passed', () => {
    gate.evaluate(flat(100), 0);
    gate.evaluate(flat(100), 100);
    gate.evaluate(flat(100), minIntervalMs + settleMs + 100);

    // A different item, settled — but too soon after the last look.
    const soon = minIntervalMs + settleMs + 200;
    gate.evaluate(flat(200), soon); // the swap reads as motion
    gate.evaluate(flat(200), soon + 1); // first still frame starts the clock
    expect(gate.evaluate(flat(200), soon + settleMs + 2)).toBe('cooling');
  });

  it('refuses to re-identify the same scene', () => {
    // This is what stops one jar held up for five seconds being billed five times.
    gate.evaluate(flat(100), 0);
    gate.evaluate(flat(100), 100);
    expect(gate.evaluate(flat(100), minIntervalMs + settleMs)).toBe('capture');

    const later = minIntervalMs * 3;
    gate.evaluate(flat(100), later);
    expect(gate.evaluate(flat(100), later + settleMs + 1)).toBe('duplicate');
  });

  it('looks again once a genuinely different item is held up', () => {
    gate.evaluate(flat(100), 0);
    gate.evaluate(flat(100), 100);
    gate.evaluate(flat(100), minIntervalMs + settleMs);

    // Swap the item: a large change, then let it settle past the interval.
    const swap = minIntervalMs * 3;
    gate.evaluate(flat(220), swap);
    gate.evaluate(flat(220), swap + 100);
    expect(gate.evaluate(flat(220), swap + settleMs + 200)).toBe('capture');
  });

  it('forgets the last capture on request so the same scene can be re-read', () => {
    // The "show me again" path: without this the clerk would repeat the request
    // forever, because the identical frame is a duplicate.
    gate.evaluate(flat(100), 0);
    gate.evaluate(flat(100), 100);
    gate.evaluate(flat(100), minIntervalMs + settleMs);

    gate.forgetLastCapture();

    const retry = minIntervalMs * 3;
    gate.evaluate(flat(100), retry);
    expect(gate.evaluate(flat(100), retry + settleMs + 1)).toBe('capture');
  });

  it('tolerates sensor noise without reading it as motion', () => {
    // A couple of luma steps is auto-exposure drift, not a moving hand.
    gate.evaluate(flat(100), 0);
    const noisy = flat(100);
    noisy[0] = 104;
    noisy[3] = 97;
    expect(gate.evaluate(noisy, 100)).toBe('holding');
  });

  it('treats a scene claimed by something else as already read', () => {
    // A barcode identified the item, so the model must not be asked about the same
    // still scene moments later and add a second one.
    gate.evaluate(flat(100), 0);
    gate.evaluate(flat(100), 100);
    gate.claimCurrentScene(100);

    const later = minIntervalMs * 3;
    gate.evaluate(flat(100), later);
    expect(gate.evaluate(flat(100), later + settleMs + 1)).toBe('duplicate');
  });

  it('still reads the next item after a claimed scene', () => {
    gate.evaluate(flat(100), 0);
    gate.evaluate(flat(100), 100);
    gate.claimCurrentScene(100);

    // A different product is held up.
    const swap = minIntervalMs * 3;
    gate.evaluate(flat(220), swap);
    gate.evaluate(flat(220), swap + 100);
    expect(gate.evaluate(flat(220), swap + settleMs + 200)).toBe('capture');
  });

  it('ignores a claim made before any frame has been seen', () => {
    gate.claimCurrentScene(0);
    expect(gate.evaluate(flat(100), 0)).toBe('warming');
  });

  describe('progress toward the next look', () => {
    it('is nothing while the scene is moving', () => {
      gate.evaluate(flat(100), 0);
      gate.evaluate(flat(200), 100);
      expect(gate.progress(100)).toBe(0);
    });

    it('grows as the scene holds still', () => {
      gate.evaluate(flat(100), 0);
      gate.evaluate(flat(100), minIntervalMs);
      const early = gate.progress(minIntervalMs + settleMs * 0.25);
      const later = gate.progress(minIntervalMs + settleMs * 0.75);
      expect(early).toBeGreaterThan(0);
      expect(later).toBeGreaterThan(early);
    });

    it('is held back by whichever constraint is still shut', () => {
      // Settled long ago, but the minimum interval between looks has not passed —
      // so progress reports the interval, not the settle.
      gate.evaluate(flat(100), 0);
      gate.evaluate(flat(100), 10);
      gate.evaluate(flat(100), minIntervalMs + settleMs);
      const swap = minIntervalMs + settleMs + 10;
      gate.evaluate(flat(200), swap);
      gate.evaluate(flat(200), swap + 10);
      // Well past settleMs, but only a fraction into the cooldown.
      expect(gate.progress(swap + settleMs + 50)).toBeLessThan(1);
    });

    it('never exceeds one', () => {
      gate.evaluate(flat(100), 0);
      gate.evaluate(flat(100), 10);
      expect(gate.progress(minIntervalMs * 10)).toBe(1);
    });
  });

  it('starts over after a reset', () => {
    gate.evaluate(flat(100), 0);
    gate.reset();
    expect(gate.evaluate(flat(100), 100)).toBe('warming');
  });

  it('copies the sample it is given, so a reused buffer cannot corrupt it', () => {
    // CameraService hands out the same Uint8Array every frame for speed. If the
    // gate held the reference rather than a copy, every comparison would be
    // against the current frame and motion would never be detected.
    const buffer = flat(100);
    gate.evaluate(buffer, 0);
    buffer.fill(200);
    expect(gate.evaluate(buffer, 100)).toBe('moving');
  });

  it('treats a change in sample size as unusable rather than as motion', () => {
    gate.evaluate(flat(100, 16), 0);
    expect(gate.evaluate(flat(100, 32), 100)).toBe('warming');
  });
});

describe('meanAbsoluteDifference', () => {
  it('is zero for identical samples', () => {
    expect(meanAbsoluteDifference(flat(120), flat(120))).toBe(0);
  });

  it('is one for opposite extremes', () => {
    expect(meanAbsoluteDifference(flat(0), flat(255))).toBe(1);
  });

  it('normalises by length, so sample size does not change the scale', () => {
    const small = meanAbsoluteDifference(flat(0, 4), flat(51, 4));
    const large = meanAbsoluteDifference(flat(0, 1024), flat(51, 1024));
    expect(small).toBeCloseTo(large, 10);
  });

  it('reports maximum difference for mismatched or empty input', () => {
    expect(meanAbsoluteDifference(flat(0, 4), flat(0, 8))).toBe(1);
    expect(meanAbsoluteDifference(new Uint8Array(0), new Uint8Array(0))).toBe(1);
  });
});
