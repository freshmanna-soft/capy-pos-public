import { CatalogHint, RecognitionRequest } from '@core/application/dtos/recognition.dto';
import { MockVisionAdapter } from './mock-vision.adapter';
import { AUTO_ADD_CONFIDENCE, CONSIDER_CONFIDENCE } from '@core/application/facades/clerk.facade';

const CATALOG: CatalogHint[] = [
  { id: 'p1', name: 'Avocado', sku: 'AVO-1', category: 'Produce' },
  { id: 'p2', name: 'Oat Milk', sku: 'OAT-1', category: 'Dairy' },
  { id: 'p3', name: 'Sourdough', sku: 'BRD-1', category: 'Bakery' },
];

function request(catalog = CATALOG): RecognitionRequest {
  return { imageBase64: 'x', mediaType: 'image/jpeg', catalog };
}

describe('MockVisionAdapter', () => {
  let adapter: MockVisionAdapter;

  beforeEach(() => {
    // The adapter fakes a 400-900ms round trip so the UI exercises its real
    // loading states. Fake timers skip that wait here rather than adding a
    // test-only latency seam to production code.
    vi.useFakeTimers();
    adapter = new MockVisionAdapter();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  /** One look, with the simulated latency fast-forwarded. */
  async function look(catalog?: CatalogHint[]) {
    const pending = adapter.identify(request(catalog));
    await vi.advanceTimersByTimeAsync(1000);
    return pending;
  }

  it('identifies itself as the demo recognizer', () => {
    expect(adapter.kind).toBe('demo');
  });

  it('cycles high, medium then low confidence', async () => {
    // The cycle is the point: every branch of the clerk's confidence gate has to
    // be reachable in a demo and in a test without stubbing a model.
    const first = await look();
    const second = await look();
    const third = await look();

    expect(first.candidates[0]!.confidence).toBeGreaterThanOrEqual(AUTO_ADD_CONFIDENCE);
    expect(first.candidates).toHaveLength(1);

    expect(second.candidates.length).toBeGreaterThan(1);
    expect(second.candidates[0]!.confidence).toBeGreaterThanOrEqual(CONSIDER_CONFIDENCE);
    expect(second.candidates[0]!.confidence).toBeLessThan(AUTO_ADD_CONFIDENCE);

    expect(third.empty).toBe(true);
    expect(third.candidates).toHaveLength(0);
  });

  it('returns the same sequence for a fresh adapter', async () => {
    const a = await look();
    adapter = new MockVisionAdapter();
    const b = await look();
    expect(a).toEqual(b);
  });

  it('names a different product on each pass so a demo is not all avocados', async () => {
    const first = await look();
    await look();
    await look();
    const fourth = await look();

    expect(fourth.candidates[0]!.productId).not.toBe(first.candidates[0]!.productId);
  });

  it('only ever names products from the catalog it was given', async () => {
    const known = new Set(CATALOG.map((hint) => hint.id));
    for (let i = 0; i < 12; i++) {
      const result = await look();
      for (const candidate of result.candidates) {
        expect(known.has(candidate.productId)).toBe(true);
      }
    }
  });

  it('orders medium-confidence candidates most likely first', async () => {
    await look();
    const { candidates } = await look();
    const confidences = candidates.map((candidate) => candidate.confidence);
    expect([...confidences].sort((a, b) => b - a)).toEqual(confidences);
  });

  it('says something speakable every time', async () => {
    for (let i = 0; i < 6; i++) {
      const { utterance } = await look();
      expect(utterance.length).toBeGreaterThan(0);
    }
  });

  it('reports an empty catalog rather than inventing a product', async () => {
    const result = await look([]);
    expect(result.empty).toBe(true);
    expect(result.utterance).toMatch(/catalog/i);
  });

  it('never returns more candidates than the catalog holds', async () => {
    const single: CatalogHint[] = [CATALOG[0]!];
    await look(single); // high-confidence pass
    const medium = await look(single); // medium pass would like three
    expect(medium.candidates).toHaveLength(1);
  });

  it('resolves promptly when the caller aborts', async () => {
    const controller = new AbortController();
    const pending = adapter.identify(request(), controller.signal);
    controller.abort();
    const result = await pending;
    expect(result.empty).toBe(true);
    expect(result.candidates).toHaveLength(0);
  });
});
