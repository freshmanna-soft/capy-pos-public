import { VisionCandidate } from '@core/application/dtos/recognition.dto';
import {
  AMBIGUITY_MARGIN,
  AUTO_ADD_CONFIDENCE,
  isCertain,
  rankCandidates,
} from './candidate-ranking';

function candidate(productId: string, confidence: number): VisionCandidate {
  return { productId, label: productId, confidence };
}

describe('rankCandidates', () => {
  it('returns an empty list unchanged', () => {
    expect(rankCandidates([])).toEqual([]);
  });

  it('orders most likely first', () => {
    const ranked = rankCandidates([candidate('a', 0.4), candidate('b', 0.9), candidate('c', 0.6)]);
    expect(ranked.map((entry) => entry.productId)).toEqual(['b', 'c', 'a']);
  });

  it('leaves a clear winner alone', () => {
    const ranked = rankCandidates([candidate('a', 0.95), candidate('b', 0.4)]);
    expect(ranked[0]!.confidence).toBe(0.95);
    expect(isCertain(ranked)).toBe(true);
  });

  it('does not act on a near-tie', () => {
    // The whole point. Two confident guesses a hair apart are not evidence that the
    // first is right — they are two guesses written down in an order decided by
    // chance, and acting on that charges the customer for the chance.
    const ranked = rankCandidates([candidate('a', 0.93), candidate('b', 0.91)]);

    expect(isCertain(ranked)).toBe(false);
    expect(ranked[0]!.confidence).toBeLessThan(AUTO_ADD_CONFIDENCE);
  });

  it('keeps both options when it demotes a tie, so the cashier can choose', () => {
    const ranked = rankCandidates([candidate('a', 0.93), candidate('b', 0.91)]);

    expect(ranked.map((entry) => entry.productId)).toEqual(['a', 'b']);
    expect(ranked[1]!.confidence).toBe(0.91);
  });

  it('acts when the gap is wide enough to mean something', () => {
    const ranked = rankCandidates([
      candidate('a', 0.95),
      candidate('b', 0.95 - AMBIGUITY_MARGIN - 0.01),
    ]);
    expect(isCertain(ranked)).toBe(true);
  });

  it('leaves an already-uncertain pair alone', () => {
    // Both are in the ask band already; there is nothing to demote.
    const ranked = rankCandidates([candidate('a', 0.7), candidate('b', 0.69)]);
    expect(ranked[0]!.confidence).toBe(0.7);
  });

  it('never demotes a single candidate, however it got there', () => {
    // One confident answer with nothing to be confused with is exactly the case
    // auto-add exists for.
    const ranked = rankCandidates([candidate('a', 0.99)]);
    expect(isCertain(ranked)).toBe(true);
  });

  it('clamps confidences outside 0..1', () => {
    const ranked = rankCandidates([candidate('a', 4), candidate('b', -2)]);
    expect(ranked[0]!.confidence).toBe(1);
    expect(ranked[1]!.confidence).toBe(0);
  });

  it('does not mutate its input', () => {
    const input = [candidate('a', 0.93), candidate('b', 0.91)];
    rankCandidates(input);
    expect(input[0]!.confidence).toBe(0.93);
  });
});

describe('isCertain', () => {
  it('is false for nothing at all', () => {
    expect(isCertain([])).toBe(false);
  });

  it('is true exactly at the threshold', () => {
    expect(isCertain([candidate('a', AUTO_ADD_CONFIDENCE)])).toBe(true);
    expect(isCertain([candidate('a', AUTO_ADD_CONFIDENCE - 0.001)])).toBe(false);
  });
});
