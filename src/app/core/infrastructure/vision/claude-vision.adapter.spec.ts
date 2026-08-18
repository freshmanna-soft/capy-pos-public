import { TestBed } from '@angular/core/testing';
import { AUTH_GATEWAY } from '@core/application/auth/ports/auth-gateway.port';
import { CatalogHint, RecognitionRequest } from '@core/application/dtos/recognition.dto';
import { ClaudeVisionAdapter } from './claude-vision.adapter';

const CATALOG: CatalogHint[] = [
  { id: 'p1', name: 'Avocado', sku: 'AVO-1', category: 'Produce' },
  { id: 'p2', name: 'Oat Milk', sku: 'OAT-1', category: 'Dairy' },
];

const REQUEST: RecognitionRequest = {
  imageBase64: 'ZmFrZQ==',
  mediaType: 'image/jpeg',
  catalog: CATALOG,
};

/** A fetch stub that returns one JSON body. */
function respondWith(body: unknown, ok = true, status = 200): ReturnType<typeof vi.fn> {
  return vi.fn().mockResolvedValue({
    ok,
    status,
    json: () => Promise.resolve(body),
  } as unknown as Response);
}

describe('ClaudeVisionAdapter', () => {
  let adapter: ClaudeVisionAdapter;
  let getAccessToken: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    getAccessToken = vi.fn().mockReturnValue('jwt-token');
    TestBed.configureTestingModule({
      providers: [ClaudeVisionAdapter, { provide: AUTH_GATEWAY, useValue: { getAccessToken } }],
    });
    adapter = TestBed.inject(ClaudeVisionAdapter);
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('posts to the vision path under the shared API by default', async () => {
    const fetchMock = respondWith({ candidates: [], utterance: '' });
    vi.stubGlobal('fetch', fetchMock);

    await adapter.identify(REQUEST);

    // No absolute override configured in the test environment, so the endpoint is
    // built from apiUrl + visionApiPath.
    const [url] = fetchMock.mock.calls[0] as [string];
    expect(url).toContain('/vision/identify');
    expect(url.startsWith('http')).toBe(true);
  });

  it('identifies itself as the live recognizer', () => {
    expect(adapter.kind).toBe('claude');
  });

  describe('the request it sends', () => {
    it('posts the frame and the catalog to the proxy', async () => {
      const fetchMock = respondWith({ candidates: [], utterance: 'Nothing there.' });
      vi.stubGlobal('fetch', fetchMock);

      await adapter.identify(REQUEST);

      const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
      expect(url).toContain('/vision/identify');
      expect(init.method).toBe('POST');
      expect(JSON.parse(init.body as string)).toEqual({
        image: REQUEST.imageBase64,
        mediaType: 'image/jpeg',
        catalog: CATALOG,
      });
    });

    it('carries the operator’s bearer token', async () => {
      const fetchMock = respondWith({ candidates: [], utterance: '' });
      vi.stubGlobal('fetch', fetchMock);

      await adapter.identify(REQUEST);

      const init = (fetchMock.mock.calls[0] as [string, RequestInit])[1];
      expect((init.headers as Record<string, string>)['Authorization']).toBe('Bearer jwt-token');
    });

    it('omits the header entirely when there is no session', async () => {
      getAccessToken.mockReturnValue(null);
      const fetchMock = respondWith({ candidates: [], utterance: '' });
      vi.stubGlobal('fetch', fetchMock);

      await adapter.identify(REQUEST);

      const init = (fetchMock.mock.calls[0] as [string, RequestInit])[1];
      expect((init.headers as Record<string, string>)['Authorization']).toBeUndefined();
    });
  });

  describe('validating what comes back', () => {
    it('accepts a well-formed candidate', async () => {
      vi.stubGlobal(
        'fetch',
        respondWith({
          candidates: [{ productId: 'p1', label: 'Avocado', confidence: 0.91 }],
          utterance: 'One avocado, added.',
        })
      );

      const result = await adapter.identify(REQUEST);

      expect(result.empty).toBe(false);
      expect(result.candidates).toEqual([{ productId: 'p1', label: 'Avocado', confidence: 0.91 }]);
      expect(result.utterance).toBe('One avocado, added.');
    });

    it('drops a product id that is not in the catalog it sent', async () => {
      // A hallucinated SKU must never reach the cart. This is the whole reason
      // the catalog is sent with the frame.
      vi.stubGlobal(
        'fetch',
        respondWith({
          candidates: [{ productId: 'not-a-product', label: 'Mystery', confidence: 0.99 }],
          utterance: 'One mystery, added.',
        })
      );

      const result = await adapter.identify(REQUEST);

      expect(result.candidates).toHaveLength(0);
      expect(result.empty).toBe(true);
    });

    it('clamps a confidence outside 0..1', async () => {
      vi.stubGlobal(
        'fetch',
        respondWith({
          candidates: [
            { productId: 'p1', label: 'Avocado', confidence: 4 },
            { productId: 'p2', label: 'Oat Milk', confidence: -2 },
          ],
          utterance: 'Sure.',
        })
      );

      const result = await adapter.identify(REQUEST);

      expect(result.candidates[0]!.confidence).toBe(1);
      expect(result.candidates[1]!.confidence).toBe(0);
    });

    it('refuses to act on a near-tie, whatever the model claimed', async () => {
      // Two confident guesses a hair apart used to auto-add the first one, which
      // meant the till bought whichever product the model happened to list first.
      vi.stubGlobal(
        'fetch',
        respondWith({
          candidates: [
            { productId: 'p1', label: 'Avocado', confidence: 0.93 },
            { productId: 'p2', label: 'Oat Milk', confidence: 0.91 },
          ],
          utterance: 'One avocado, added.',
        })
      );

      const result = await adapter.identify(REQUEST);

      expect(result.candidates[0]!.confidence).toBeLessThan(0.85);
      // Both survive, so the cashier gets a choice rather than a coin flip.
      expect(result.candidates.map((c) => c.productId)).toEqual(['p1', 'p2']);
    });

    it('sorts candidates most likely first', async () => {
      vi.stubGlobal(
        'fetch',
        respondWith({
          candidates: [
            { productId: 'p1', label: 'Avocado', confidence: 0.4 },
            { productId: 'p2', label: 'Oat Milk', confidence: 0.8 },
          ],
          utterance: 'Which?',
        })
      );

      const result = await adapter.identify(REQUEST);

      expect(result.candidates.map((c) => c.productId)).toEqual(['p2', 'p1']);
    });

    it.each([
      ['a non-array candidates field', { candidates: 'nope', utterance: 'hi' }],
      ['candidate entries that are not objects', { candidates: [null, 7], utterance: 'hi' }],
      [
        'a missing confidence',
        { candidates: [{ productId: 'p1', label: 'Avocado' }], utterance: 'hi' },
      ],
      [
        'a non-finite confidence',
        { candidates: [{ productId: 'p1', label: 'Avocado', confidence: NaN }], utterance: 'hi' },
      ],
      ['an entirely empty body', {}],
    ])('survives %s', async (_label, body) => {
      vi.stubGlobal('fetch', respondWith(body));

      const result = await adapter.identify(REQUEST);

      expect(result.candidates).toHaveLength(0);
      expect(result.empty).toBe(true);
      expect(result.utterance.length).toBeGreaterThan(0);
    });

    it('caps the candidates it will show', async () => {
      const many = Array.from({ length: 9 }, (_, i) => ({
        productId: i % 2 === 0 ? 'p1' : 'p2',
        label: 'x',
        confidence: 0.5,
      }));
      vi.stubGlobal('fetch', respondWith({ candidates: many, utterance: 'Which?' }));

      const result = await adapter.identify(REQUEST);

      expect(result.candidates.length).toBeLessThanOrEqual(3);
    });
  });

  describe('failure', () => {
    it('returns an empty result on a proxy error rather than throwing', async () => {
      // The clerk calls this from a scanning loop; a rejected promise would end
      // the session over one dropped request.
      vi.stubGlobal('fetch', respondWith({ error: 'boom' }, false, 502));

      const result = await adapter.identify(REQUEST);

      expect(result.empty).toBe(true);
      expect(result.utterance).toMatch(/again/i);
    });

    it('returns an empty result when the network is gone', async () => {
      vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('Failed to fetch')));

      const result = await adapter.identify(REQUEST);

      expect(result.empty).toBe(true);
      expect(result.utterance.length).toBeGreaterThan(0);
    });

    it('stays silent when the caller aborted, because that is not a failure', async () => {
      const controller = new AbortController();
      vi.stubGlobal(
        'fetch',
        vi.fn().mockImplementation(() => {
          controller.abort();
          return Promise.reject(new DOMException('Aborted', 'AbortError'));
        })
      );

      const result = await adapter.identify(REQUEST, controller.signal);

      // Nothing to say: the cashier already moved on.
      expect(result.utterance).toBe('');
      expect(result.empty).toBe(true);
    });
  });
});
