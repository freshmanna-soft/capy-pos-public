import { TestBed } from '@angular/core/testing';
import {
  DEFAULT_TENANT_ID,
  DexieDatabase,
  IRecognitionLogDB,
} from '@core/infrastructure/database/dexie-database.service';
import {
  RecognitionLogService,
  RecognitionOutcome,
  RecognitionTier,
  summariseRows,
} from './recognition-log.service';

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

describe('RecognitionLogService', () => {
  let service: RecognitionLogService;
  let add: ReturnType<typeof vi.fn>;
  let update: ReturnType<typeof vi.fn>;
  let clear: ReturnType<typeof vi.fn>;
  let toArray: ReturnType<typeof vi.fn>;
  let limit: ReturnType<typeof vi.fn>;
  let warn: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    add = vi.fn().mockResolvedValue('ok');
    update = vi.fn().mockResolvedValue(1);
    clear = vi.fn().mockResolvedValue(undefined);
    toArray = vi.fn().mockResolvedValue([]);
    limit = vi.fn().mockImplementation(() => ({ toArray }));
    warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined) as never;

    TestBed.configureTestingModule({
      providers: [
        RecognitionLogService,
        {
          provide: DexieDatabase,
          useValue: {
            recognitionLog: {
              add,
              update,
              clear,
              // Dexie's fluent read chain, only as far as this service uses it.
              orderBy: () => ({ reverse: () => ({ limit }) }),
            },
          },
        },
      ],
    });
    service = TestBed.inject(RecognitionLogService);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('returns the row id it wrote, so the verdict can amend the same row', () => {
    // Whether a proposal was right is only known when the undo window closes, so the
    // id is the link between the optimistic write and the correction.
    const id = service.record({
      tier: 'model',
      confidence: 0.9,
      candidateCount: 3,
      outcome: 'auto',
    });

    expect(id).toMatch(/^rec-/);
    expect(add).toHaveBeenCalledWith(expect.objectContaining({ id, tier: 'model' }));
  });

  it('stamps the row with the tenant, so one shop cannot read another', () => {
    service.record({ tier: 'barcode', confidence: 1, candidateCount: 1, outcome: 'auto' });

    expect(add.mock.calls[0]![0]).toMatchObject({ tenantId: DEFAULT_TENANT_ID });
  });

  it('leaves the product ids out entirely rather than writing undefined', () => {
    // Dexie indexes these; a literal `undefined` is a different thing from an absent
    // key and turns up in queries as a value.
    service.record({ tier: 'model', confidence: 0.4, candidateCount: 0, outcome: 'unknown' });

    const row = add.mock.calls[0]![0] as IRecognitionLogDB;
    expect('proposedProductId' in row).toBe(false);
    expect('actualProductId' in row).toBe(false);
  });

  it('keeps both product ids when a correction says what the truth was', () => {
    service.record({
      tier: 'model',
      proposedProductId: 'p1',
      actualProductId: 'p2',
      confidence: 0.7,
      candidateCount: 2,
      outcome: 'corrected',
    });

    expect(add.mock.calls[0]![0]).toMatchObject({
      proposedProductId: 'p1',
      actualProductId: 'p2',
      outcome: 'corrected',
    });
  });

  it('never lets a failed write reach the caller', async () => {
    // Telemetry is worth having and is never worth failing a sale over.
    add.mockRejectedValue(new Error('quota exceeded'));

    expect(() =>
      service.record({ tier: 'model', confidence: 0.9, candidateCount: 1, outcome: 'auto' })
    ).not.toThrow();

    await vi.waitFor(() => expect(warn).toHaveBeenCalled());
  });

  it('revises a row in place, and attaches the truth when there is one', () => {
    service.amend('rec-1', 'corrected', 'p2');

    expect(update).toHaveBeenCalledWith('rec-1', { outcome: 'corrected', actualProductId: 'p2' });
  });

  it('amends without a product when the cashier only said it was wrong', () => {
    service.amend('rec-1', 'undone');

    expect(update).toHaveBeenCalledWith('rec-1', { outcome: 'undone' });
  });

  it('swallows a failed amendment too', async () => {
    update.mockRejectedValue(new Error('row vanished'));

    expect(() => service.amend('rec-1', 'undone')).not.toThrow();

    await vi.waitFor(() => expect(warn).toHaveBeenCalled());
  });

  it('summarises only the recent window, not the whole table', async () => {
    // On a busy till this table grows without bound, and the useful question is
    // always "how is it doing now".
    toArray.mockResolvedValue([
      { tier: 'model', outcome: 'auto' },
      { tier: 'model', outcome: 'undone' },
    ]);

    const summary = await service.summarise();

    expect(limit).toHaveBeenCalledWith(500);
    expect(summary.find((entry) => entry.tier === 'model')?.precision).toBe(0.5);
  });

  it('drops the log when a till is reset', async () => {
    await service.clear();

    expect(clear).toHaveBeenCalled();
  });
});
