import { IRecognitionLogDB } from '@core/infrastructure/database/dexie-database.service';
import { RecognitionOutcome, RecognitionTier, summariseRows } from './recognition-log.service';

function row(tier: RecognitionTier, outcome: RecognitionOutcome): IRecognitionLogDB {
  return {
    id: `${tier}-${outcome}-${Math.random()}`,
    tier,
    outcome,
    confidence: 0.9,
    candidateCount: 1,
    createdAt: new Date(),
  };
}

/** The tier's summary out of a full set. */
function of(tier: RecognitionTier, rows: IRecognitionLogDB[]) {
  return summariseRows(rows).find((entry) => entry.tier === tier)!;
}

describe('summariseRows', () => {
  it('reports every tier even with no data', () => {
    // A tier missing from the report reads as "not implemented" rather than
    // "not used yet", which are different problems.
    const summary = summariseRows([]);
    expect(summary.map((entry) => entry.tier)).toEqual(['barcode', 'samples', 'model']);
    expect(summary.every((entry) => entry.total === 0)).toBe(true);
  });

  it('has no precision when nothing decisive has happened', () => {
    // Reporting 0 would read as broken and 1 would read as perfect; a tier that has
    // only ever abstained has neither.
    const summary = of('model', [row('model', 'unknown'), row('model', 'rejected')]);
    expect(summary.precision).toBeNull();
    expect(summary.abstained).toBe(2);
  });

  it('counts an add that was left to stand as correct', () => {
    const summary = of('barcode', [row('barcode', 'auto')]);
    expect(summary.correct).toBe(1);
    expect(summary.precision).toBe(1);
  });

  it('counts an undo as wrong', () => {
    // The undo window is the cheapest signal available for "that was wrong".
    const summary = of('model', [row('model', 'auto'), row('model', 'undone')]);
    expect(summary.correct).toBe(1);
    expect(summary.wrong).toBe(1);
    expect(summary.precision).toBe(0.5);
  });

  it('counts a correction as wrong, and the top candidate being taken as correct', () => {
    const summary = of('model', [row('model', 'chosen'), row('model', 'corrected')]);
    expect(summary.correct).toBe(1);
    expect(summary.wrong).toBe(1);
  });

  it('keeps abstentions out of precision', () => {
    // Asking instead of guessing is not an error, and counting it as one would push
    // the system toward guessing.
    const summary = of('model', [
      row('model', 'auto'),
      row('model', 'unknown'),
      row('model', 'rejected'),
    ]);
    expect(summary.precision).toBe(1);
    expect(summary.total).toBe(3);
    expect(summary.abstained).toBe(2);
  });

  it('keeps the tiers apart', () => {
    const rows = [row('barcode', 'auto'), row('model', 'undone'), row('model', 'auto')];
    expect(of('barcode', rows).precision).toBe(1);
    expect(of('model', rows).precision).toBe(0.5);
    expect(of('samples', rows).total).toBe(0);
  });

  it('ignores a tier it does not know about', () => {
    const rogue = { ...row('model', 'auto'), tier: 'telepathy' };
    expect(summariseRows([rogue]).every((entry) => entry.total === 0)).toBe(true);
  });
});
