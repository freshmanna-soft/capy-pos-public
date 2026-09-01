import { TestBed } from '@angular/core/testing';
import {
  DEFAULT_TENANT_ID,
  DexieDatabase,
} from '@core/infrastructure/database/dexie-database.service';
import { RecognitionSampleService } from './recognition-sample.service';

describe('RecognitionSampleService', () => {
  let service: RecognitionSampleService;
  let add: ReturnType<typeof vi.fn>;
  let clear: ReturnType<typeof vi.fn>;
  let bulkDelete: ReturnType<typeof vi.fn>;
  let equalsToArray: ReturnType<typeof vi.fn>;
  let equalsCount: ReturnType<typeof vi.fn>;
  let toArray: ReturnType<typeof vi.fn>;
  let warn: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    add = vi.fn().mockResolvedValue('ok');
    clear = vi.fn().mockResolvedValue(undefined);
    bulkDelete = vi.fn().mockResolvedValue(undefined);
    equalsToArray = vi.fn().mockResolvedValue([]);
    equalsCount = vi.fn().mockResolvedValue(0);
    toArray = vi.fn().mockResolvedValue([]);
    warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined) as never;

    TestBed.configureTestingModule({
      providers: [
        RecognitionSampleService,
        {
          provide: DexieDatabase,
          useValue: {
            recognitionSamples: {
              add,
              clear,
              bulkDelete,
              toArray,
              where: () => ({
                equals: () => ({ toArray: equalsToArray, count: equalsCount }),
              }),
            },
          },
        },
      ],
    });
    service = TestBed.inject(RecognitionSampleService);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('stamps the row with the tenant, so one shop cannot read another', () => {
    service.record({
      logId: 'rec-1',
      productId: 'prod-1',
      tier: 'model',
      outcome: 'chosen',
      imageBase64: btoa('fake-jpeg-bytes'),
      width: 100,
      height: 100,
    });

    expect(add.mock.calls[0]![0]).toMatchObject({
      tenantId: DEFAULT_TENANT_ID,
      logId: 'rec-1',
      productId: 'prod-1',
      outcome: 'chosen',
    });
  });

  it('converts the captured base64 into a native Blob, not a data URI string', () => {
    service.record({
      logId: 'rec-1',
      productId: 'prod-1',
      tier: 'model',
      outcome: 'corrected',
      imageBase64: btoa('fake-jpeg-bytes'),
      width: 10,
      height: 10,
    });

    const row = add.mock.calls[0]![0];
    expect(row.imageBlob).toBeInstanceOf(Blob);
    expect(row.imageBlob.type).toBe('image/jpeg');
  });

  it('does not throw when the write fails — a sample is never worth failing a sale over', async () => {
    add.mockRejectedValueOnce(new Error('quota exceeded'));

    expect(() =>
      service.record({
        logId: 'rec-1',
        productId: 'prod-1',
        tier: 'model',
        outcome: 'chosen',
        imageBase64: btoa('x'),
        width: 1,
        height: 1,
      })
    ).not.toThrow();

    await Promise.resolve();
    expect(warn).toHaveBeenCalled();
  });

  it('counts by product through the where/equals chain', async () => {
    equalsCount.mockResolvedValueOnce(7);
    await expect(service.countByProduct('prod-1')).resolves.toBe(7);
  });

  describe('pruneOldest', () => {
    function sample(id: string, outcome: 'chosen' | 'corrected', ageMs: number) {
      return {
        id,
        productId: 'prod-1',
        outcome,
        createdAt: new Date(Date.now() - ageMs),
      };
    }

    it('does nothing when the product is under its cap', async () => {
      equalsToArray.mockResolvedValueOnce([sample('a', 'chosen', 1000)]);
      await service.pruneOldest('prod-1', 200);
      expect(bulkDelete).not.toHaveBeenCalled();
    });

    it('evicts the oldest chosen rows before any corrected row', async () => {
      // Oldest chosen row (id 'old') should go first, even though a newer
      // 'corrected' row exists — mistakes are the rarer, more valuable sample.
      equalsToArray.mockResolvedValueOnce([
        sample('old', 'chosen', 5000),
        sample('new', 'chosen', 1000),
        sample('mistake', 'corrected', 9000),
      ]);

      await service.pruneOldest('prod-1', 2);

      expect(bulkDelete).toHaveBeenCalledWith(['old']);
    });
  });

  it('clear() drops every sample', async () => {
    await service.clear();
    expect(clear).toHaveBeenCalled();
  });
});
