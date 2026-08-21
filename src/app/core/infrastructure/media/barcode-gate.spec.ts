import {
  BarcodeGate,
  BarcodeTiming,
  GATED_TIMING,
  INSTANT_TIMING,
  ScannedCode,
  pickPresentedCode,
} from './barcode-gate';

const { dwellMs, absenceMs } = GATED_TIMING;

function code(value: string, width = 0.3, height = 0.2, x = 0.1, y = 0.1): ScannedCode {
  return { value, format: 'ean_13', box: { x, y, width, height } };
}

/**
 * Hold `value` up from `from` until `until`, on the 125ms sampling cadence.
 *
 * Takes the timing profile because the empty frames matter as much as the full ones:
 * judging a run of absences by the wrong profile is exactly the mistake the two
 * modes exist to make visible.
 */
function hold(
  gate: BarcodeGate,
  value: string | null,
  from: number,
  until: number,
  timing: BarcodeTiming = GATED_TIMING
): void {
  for (let t = from; t < until; t += 125) {
    gate.observe(value, t, timing);
  }
}

describe('BarcodeGate', () => {
  let gate: BarcodeGate;

  beforeEach(() => {
    gate = new BarcodeGate();
  });

  it('reports nothing when the frame is empty', () => {
    expect(gate.observe(null, 0)).toBe('idle');
  });

  it('waits for the code to be held before ringing it up', () => {
    // The frame a decoder first resolves a code in is not evidence anyone meant to
    // sell it — a shelf label sweeping past the lens decodes perfectly.
    expect(gate.observe('111', 0)).toBe('dwelling');
    expect(gate.observe('111', 125)).toBe('dwelling');
    expect(gate.observe('111', dwellMs)).toBe('new');
  });

  it('never rings up a code that only crosses the frame', () => {
    // The whole point of the dwell: two frames of a code on its way somewhere else.
    expect(gate.observe('111', 0)).toBe('dwelling');
    expect(gate.observe('111', 125)).toBe('dwelling');
    hold(gate, null, 250, 250 + absenceMs + 200);
    // And the item it belonged to is still scannable afterwards — an abandoned dwell
    // must leave no trace, or the code would be treated as already dealt with.
    expect(gate.observe('111', 1500)).toBe('dwelling');
  });

  it('ignores the same code while it is still being held', () => {
    // Sixteen frames of one jar is one jar, not sixteen.
    hold(gate, '111', 0, dwellMs);
    expect(gate.observe('111', dwellMs)).toBe('new');
    for (let t = dwellMs + 125; t < 2000; t += 125) {
      expect(gate.observe('111', t)).toBe('held');
    }
  });

  it('keeps counting the dwell through a brief detection dropout', () => {
    // A decoder that loses the code every third frame would otherwise restart the
    // dwell forever and never ring anything up at all.
    expect(gate.observe('111', 0)).toBe('dwelling');
    gate.observe(null, 125);
    expect(gate.observe('111', 250)).toBe('dwelling');
    expect(gate.observe('111', dwellMs + 50)).toBe('new');
  });

  it('restarts the dwell after a gap longer than a flicker', () => {
    // The camera-off case: a code left in front of a paused camera must not complete
    // its dwell on the first frame after it comes back, out of presence nobody saw.
    expect(gate.observe('111', 0)).toBe('dwelling');
    expect(gate.observe('111', absenceMs + 500)).toBe('dwelling');
  });

  it('survives a brief detection dropout without re-adding', () => {
    // Detection drops for a frame or two whenever a hand shifts. Treating that as
    // a new presentation would charge for one item twice.
    hold(gate, '111', 0, dwellMs);
    expect(gate.observe('111', dwellMs)).toBe('new');
    gate.observe(null, dwellMs + 125);
    gate.observe(null, dwellMs + 250);
    expect(gate.observe('111', dwellMs + 375)).toBe('held');
  });

  it('rings up the same product again once it has really been taken away', () => {
    // Three identical yoghurts must ring up three times.
    hold(gate, '111', 0, dwellMs);
    expect(gate.observe('111', dwellMs)).toBe('new');
    const gone = dwellMs + absenceMs + 200;
    hold(gate, null, dwellMs + 125, gone);
    // A second sale is a second presentation, so it earns its own dwell.
    expect(gate.observe('111', gone)).toBe('dwelling');
    expect(gate.observe('111', gone + dwellMs)).toBe('new');
  });

  it('starts a fresh dwell when a different product is swapped in', () => {
    hold(gate, '111', 0, dwellMs);
    expect(gate.observe('111', dwellMs)).toBe('new');
    // A swap is exactly when a code belonging to neither item is most likely to
    // cross the frame, so it is the last place to skip the wait.
    expect(gate.observe('222', dwellMs + 125)).toBe('dwelling');
    expect(gate.observe('222', dwellMs + 125 + dwellMs)).toBe('new');
  });

  it('lets a released code be scanned again after one more dwell', () => {
    // Used when an add was refused — out of stock, or undone — because the cashier
    // still has the item in hand and must not be ignored.
    hold(gate, '111', 0, dwellMs);
    gate.observe('111', dwellMs);
    gate.release();
    expect(gate.observe('111', dwellMs + 125)).toBe('dwelling');
    expect(gate.observe('111', dwellMs * 2 + 125)).toBe('new');
  });

  it('drops a dwell in progress when released', () => {
    // Release means "forget everything about that code", not "forget the sale": a
    // half-finished dwell surviving it would ring up on the very next frame.
    gate.observe('111', 0);
    gate.release();
    expect(gate.observe('111', 125)).toBe('dwelling');
  });

  it('starts clean after a reset', () => {
    hold(gate, '111', 0, dwellMs);
    gate.observe('111', dwellMs);
    gate.reset();
    expect(gate.observe('111', dwellMs + 125)).toBe('dwelling');
  });

  it('exposes the minimum width so callers filter consistently', () => {
    expect(new BarcodeGate({ minWidth: 0.2 }).minWidth).toBe(0.2);
  });

  describe('barcode-only mode', () => {
    it('rings a code up on the frame it is read', () => {
      // With recognition off the bars are the only thing the till is listening to,
      // so presenting one is the whole command and there is nothing to protect.
      expect(gate.observe('111', 0, INSTANT_TIMING)).toBe('new');
    });

    it('lets the same product ring up again far sooner', () => {
      expect(gate.observe('111', 0, INSTANT_TIMING)).toBe('new');
      hold(gate, null, 125, 500, INSTANT_TIMING);
      expect(gate.observe('111', 500, INSTANT_TIMING)).toBe('new');
      // The gated profile would still be calling that the same jar.
      const careful = new BarcodeGate();
      careful.observe('111', 0);
      careful.observe('111', dwellMs);
      hold(careful, null, dwellMs + 125, 500);
      expect(careful.observe('111', 500)).toBe('held');
    });

    it('lets a dwell already in progress finish the moment the mode changes', () => {
      // The cashier hitting the recognition switch with a code already in frame: from
      // that frame on the bars are the only thing the till is listening to, so the
      // wait it was halfway through is over rather than restarted.
      expect(gate.observe('111', 0)).toBe('dwelling');
      expect(gate.dwellProgress(125, INSTANT_TIMING)).toBe(1);
      expect(gate.observe('111', 125, INSTANT_TIMING)).toBe('new');
    });

    it('still refuses to charge twice for a one-frame dropout', () => {
      // The dwell can go to zero; the absence window cannot, or a decoder that
      // blinks would sell the same jar twice.
      expect(gate.observe('111', 0, INSTANT_TIMING)).toBe('new');
      gate.observe(null, 125, INSTANT_TIMING);
      expect(gate.observe('111', 250, INSTANT_TIMING)).toBe('held');
    });
  });

  describe('dwellProgress', () => {
    it('is zero when nothing is being offered', () => {
      expect(gate.dwellProgress(0)).toBe(0);
      gate.observe(null, 125);
      expect(gate.dwellProgress(125)).toBe(0);
    });

    it('fills across the dwell and stops at one', () => {
      gate.observe('111', 0);
      expect(gate.dwellProgress(0)).toBe(0);
      expect(gate.dwellProgress(dwellMs / 2)).toBeCloseTo(0.5, 5);
      expect(gate.dwellProgress(dwellMs * 3)).toBe(1);
    });

    it('has nothing to report in barcode-only mode', () => {
      // Not a special case in the arithmetic — there is simply never a code waiting
      // in that mode, because every one of them is accepted on the frame it is read.
      // The ring stays hidden as a consequence rather than by a rule of its own.
      expect(gate.observe('111', 0, INSTANT_TIMING)).toBe('new');
      expect(gate.dwellProgress(0, INSTANT_TIMING)).toBe(0);
    });
  });
});

describe('pickPresentedCode', () => {
  it('finds nothing in an empty frame', () => {
    expect(pickPresentedCode([])).toBeNull();
  });

  it('picks the only code', () => {
    expect(pickPresentedCode([code('111')])?.value).toBe('111');
  });

  it('prefers the nearest code, which is the largest', () => {
    // Two products in view would otherwise alternate frame to frame, and every
    // alternation would read as a new scan.
    const chosen = pickPresentedCode([code('far', 0.1, 0.08), code('near', 0.4, 0.3)]);
    expect(chosen?.value).toBe('near');
  });

  it('ignores codes too small to be a deliberate presentation', () => {
    // A barcode on a poster across the room is not something being bought.
    expect(pickPresentedCode([code('distant', 0.03, 0.02)])).toBeNull();
  });

  it('ignores an empty value', () => {
    expect(pickPresentedCode([code('', 0.4, 0.3)])).toBeNull();
  });

  it('respects a caller-supplied minimum width', () => {
    expect(pickPresentedCode([code('111', 0.1)], 0.2)).toBeNull();
    expect(pickPresentedCode([code('111', 0.3)], 0.2)?.value).toBe('111');
  });

  it('compares area, not width alone', () => {
    const chosen = pickPresentedCode([code('wide-thin', 0.5, 0.05), code('square', 0.4, 0.4)]);
    expect(chosen?.value).toBe('square');
  });
});
