import {
  BarcodeGate,
  DEFAULT_BARCODE_GATE_CONFIG,
  ScannedCode,
  pickPresentedCode,
} from './barcode-gate';

const { absenceMs } = DEFAULT_BARCODE_GATE_CONFIG;

function code(value: string, width = 0.3, height = 0.2, x = 0.1, y = 0.1): ScannedCode {
  return { value, format: 'ean_13', box: { x, y, width, height } };
}

describe('BarcodeGate', () => {
  let gate: BarcodeGate;

  beforeEach(() => {
    gate = new BarcodeGate();
  });

  it('reports nothing when the frame is empty', () => {
    expect(gate.observe(null, 0)).toBe('idle');
  });

  it('rings up a code the first time it appears', () => {
    expect(gate.observe('111', 0)).toBe('new');
  });

  it('ignores the same code while it is still being held', () => {
    // Sixteen frames of one jar is one jar, not sixteen.
    expect(gate.observe('111', 0)).toBe('new');
    for (let t = 125; t < 2000; t += 125) {
      expect(gate.observe('111', t)).toBe('held');
    }
  });

  it('survives a brief detection dropout without re-adding', () => {
    // Detection drops for a frame or two whenever a hand shifts. Treating that as
    // a new presentation would charge for one item twice.
    gate.observe('111', 0);
    gate.observe(null, 125);
    gate.observe(null, 250);
    expect(gate.observe('111', 375)).toBe('held');
  });

  it('rings up the same product again once it has really been taken away', () => {
    // Three identical yoghurts must ring up three times.
    expect(gate.observe('111', 0)).toBe('new');
    let t = 125;
    while (t < 125 + absenceMs + 200) {
      gate.observe(null, t);
      t += 125;
    }
    expect(gate.observe('111', t)).toBe('new');
  });

  it('treats a swap for a different product as a new scan straight away', () => {
    expect(gate.observe('111', 0)).toBe('new');
    expect(gate.observe('222', 125)).toBe('new');
  });

  it('lets a released code be scanned again immediately', () => {
    // Used when an add was refused — out of stock, or undone — because the cashier
    // still has the item in hand and must not be ignored.
    gate.observe('111', 0);
    gate.release();
    expect(gate.observe('111', 125)).toBe('new');
  });

  it('starts clean after a reset', () => {
    gate.observe('111', 0);
    gate.reset();
    expect(gate.observe('111', 125)).toBe('new');
  });

  it('exposes the minimum width so callers filter consistently', () => {
    expect(new BarcodeGate({ minWidth: 0.2 }).minWidth).toBe(0.2);
  });

  it('honours a custom absence window', () => {
    const quick = new BarcodeGate({ absenceMs: 100 });
    quick.observe('111', 0);
    quick.observe(null, 200);
    expect(quick.observe('111', 300)).toBe('new');
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
