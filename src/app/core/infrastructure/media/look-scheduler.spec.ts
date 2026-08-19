import { DEFAULT_LOOK_SCHEDULER_CONFIG, LookScheduler } from './look-scheduler';

const { debounceMs, barcodeGraceMs } = DEFAULT_LOOK_SCHEDULER_CONFIG;

/** The facade's sampling cadence, which is what drives this in production. */
const TICK_MS = 125;

describe('LookScheduler', () => {
  let scheduler: LookScheduler;

  beforeEach(() => {
    scheduler = new LookScheduler();
  });

  describe('debouncing', () => {
    it('waits out the debounce window before spending anything', () => {
      expect(scheduler.request(0)).toBe('settling');

      for (let t = TICK_MS; t < debounceMs; t += TICK_MS) {
        expect(scheduler.request(t)).toBe('settling');
      }

      expect(scheduler.request(debounceMs)).toBe('look');
    });

    it('reports one look, not one per tick, for a scene that stays put', () => {
      // The gate re-opens on every tick of a still scene. Without the debounce
      // disarming itself, each of those would be a separate recognition call.
      const decisions: string[] = [];
      for (let t = 0; t <= debounceMs + TICK_MS * 2; t += TICK_MS) {
        decisions.push(scheduler.request(t));
      }

      expect(decisions.filter((decision) => decision === 'look')).toHaveLength(1);
    });

    it('starts the wait again when the scene moves mid-window', () => {
      // A hand nudging an item square is not a new item, and it is not a settled
      // one either. Both readings are wrong; waiting is right.
      scheduler.request(0);
      scheduler.request(TICK_MS);
      scheduler.cancel();

      expect(scheduler.pending).toBe(false);
      expect(scheduler.request(debounceMs)).toBe('settling');
      expect(scheduler.request(debounceMs + debounceMs)).toBe('look');
    });

    it('fills its progress across the window and no further', () => {
      expect(scheduler.progress(0)).toBe(0);
      scheduler.request(0);

      const early = scheduler.progress(debounceMs * 0.25);
      const late = scheduler.progress(debounceMs * 0.75);
      expect(early).toBeGreaterThan(0);
      expect(late).toBeGreaterThan(early);
      expect(scheduler.progress(debounceMs * 4)).toBe(1);
    });

    it('reports no progress when nothing is waiting', () => {
      expect(scheduler.progress(1000)).toBe(0);
      scheduler.request(0);
      scheduler.request(debounceMs);
      expect(scheduler.progress(debounceMs)).toBe(0);
    });
  });

  describe('barcodes first', () => {
    it('refuses to pay for a guess while a stocked code is in frame', () => {
      scheduler.noteStockedCode(0);

      expect(scheduler.request(TICK_MS)).toBe('deferred');
    });

    it('drops a look that was already waiting when a code turns up', () => {
      // The decode and the model race over the same frame. The model losing that
      // race is the whole point — it is the expensive way to learn what the bars
      // already say.
      expect(scheduler.request(0)).toBe('settling');

      scheduler.noteStockedCode(TICK_MS);

      expect(scheduler.request(TICK_MS)).toBe('deferred');
      expect(scheduler.pending).toBe(false);
    });

    it('holds the model back through a detection dropout', () => {
      scheduler.noteStockedCode(0);

      // Two frames with nothing decoded is a hand shifting, not the item leaving.
      expect(scheduler.request(TICK_MS * 2)).toBe('deferred');
      expect(scheduler.barcodeHasPriority(barcodeGraceMs)).toBe(true);
    });

    it('looks again once the code has really gone', () => {
      scheduler.noteStockedCode(0);
      const after = barcodeGraceMs + TICK_MS;

      expect(scheduler.request(after)).toBe('settling');
      expect(scheduler.request(after + debounceMs)).toBe('look');
    });

    it('has no opinion before any code has been seen', () => {
      expect(scheduler.barcodeHasPriority(0)).toBe(false);
    });
  });

  it('forgets the barcode as well as the pending look on reset', () => {
    // A session or camera switch means the frame the code was seen in is gone.
    scheduler.noteStockedCode(0);
    scheduler.request(0);

    scheduler.reset();

    expect(scheduler.pending).toBe(false);
    expect(scheduler.barcodeHasPriority(TICK_MS)).toBe(false);
  });

  it('takes configuration for tills that want a longer or shorter wait', () => {
    const patient = new LookScheduler({ debounceMs: 1000 });

    expect(patient.debounceMs).toBe(1000);
    expect(patient.request(0)).toBe('settling');
    expect(patient.request(500)).toBe('settling');
    expect(patient.request(1000)).toBe('look');
  });
});
