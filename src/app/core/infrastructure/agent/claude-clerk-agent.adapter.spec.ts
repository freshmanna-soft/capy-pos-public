import { TestBed } from '@angular/core/testing';
import { AUTH_GATEWAY } from '@core/application/auth/ports/auth-gateway.port';
import { AgentTurnRequest } from '@core/application/dtos/agent.dto';
import { ClaudeClerkAgentAdapter } from './claude-clerk-agent.adapter';

const REQUEST: AgentTurnRequest = {
  utterance: 'add two oat milks',
  catalog: [
    { id: 'p1', name: 'Avocado', sku: 'AVO-1', category: 'Produce' },
    { id: 'p2', name: 'Oat Milk', sku: 'OAT-1', category: 'Dairy' },
  ],
  context: {
    cartLines: [],
    totalItems: 0,
    total: 0,
    offer: [],
    cartChangedThisTurn: false,
  },
  memory: [],
  transcript: [],
};

/** A fetch stub that returns one JSON body. */
function respondWith(body: unknown, ok = true, status = 200): ReturnType<typeof vi.fn> {
  return vi.fn().mockResolvedValue({
    ok,
    status,
    json: () => Promise.resolve(body),
  } as unknown as Response);
}

describe('ClaudeClerkAgentAdapter', () => {
  let adapter: ClaudeClerkAgentAdapter;
  let getAccessToken: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    getAccessToken = vi.fn().mockReturnValue('jwt-token');
    TestBed.configureTestingModule({
      providers: [ClaudeClerkAgentAdapter, { provide: AUTH_GATEWAY, useValue: { getAccessToken } }],
    });
    adapter = TestBed.inject(ClaudeClerkAgentAdapter);
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('identifies itself as the live agent', () => {
    expect(adapter.kind).toBe('claude');
  });

  it('posts to the clerk/agent path under the shared API by default', async () => {
    const fetchMock = respondWith({ kind: 'declined' });
    vi.stubGlobal('fetch', fetchMock);

    await adapter.next(REQUEST);

    const [url] = fetchMock.mock.calls[0] as [string];
    expect(url).toContain('/clerk/agent');
    expect(url.startsWith('http')).toBe(true);
  });

  describe('the request it sends', () => {
    it('posts exactly the fields the relay validates, nothing else', async () => {
      const fetchMock = respondWith({ kind: 'declined' });
      vi.stubGlobal('fetch', fetchMock);

      await adapter.next(REQUEST);

      const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
      expect(init.method).toBe('POST');
      expect(JSON.parse(init.body as string)).toEqual({
        utterance: REQUEST.utterance,
        catalog: REQUEST.catalog,
        context: REQUEST.context,
        memory: REQUEST.memory,
        transcript: REQUEST.transcript,
      });
    });

    it('carries the caller’s bearer token when one exists', async () => {
      const fetchMock = respondWith({ kind: 'declined' });
      vi.stubGlobal('fetch', fetchMock);

      await adapter.next(REQUEST);

      const init = (fetchMock.mock.calls[0] as [string, RequestInit])[1];
      expect((init.headers as Record<string, string>)['Authorization']).toBe('Bearer jwt-token');
    });

    it('omits the header entirely when there is no session — self-checkout has none', async () => {
      // This till is not only operated by staff — a customer running a
      // self-service checkout never authenticates, so getAccessToken() returns
      // null here on purpose, not as an edge case. The hop must still be sent.
      getAccessToken.mockReturnValue(null);
      const fetchMock = respondWith({ kind: 'declined' });
      vi.stubGlobal('fetch', fetchMock);

      await adapter.next(REQUEST);

      const init = (fetchMock.mock.calls[0] as [string, RequestInit])[1];
      expect((init.headers as Record<string, string>)['Authorization']).toBeUndefined();
    });
  });

  describe('validating what comes back', () => {
    it('accepts a declined step', async () => {
      vi.stubGlobal('fetch', respondWith({ kind: 'declined' }));

      const step = await adapter.next(REQUEST);

      expect(step).toEqual({ kind: 'declined' });
    });

    it('accepts a well-formed answer step', async () => {
      vi.stubGlobal(
        'fetch',
        respondWith({
          kind: 'answer',
          assistant: [{ type: 'text', text: 'Two oat milks, added.' }],
          speech: 'Two oat milks, added.',
        })
      );

      const step = await adapter.next(REQUEST);

      expect(step).toEqual({
        kind: 'answer',
        assistant: [{ type: 'text', text: 'Two oat milks, added.' }],
        speech: 'Two oat milks, added.',
      });
    });

    it('accepts a well-formed tools step', async () => {
      vi.stubGlobal(
        'fetch',
        respondWith({
          kind: 'tools',
          assistant: [
            {
              type: 'tool_use',
              id: 't1',
              name: 'add_by_name',
              input: { name: 'Oat Milk', quantity: 2 },
            },
          ],
          calls: [{ id: 't1', name: 'add_by_name', input: { name: 'Oat Milk', quantity: 2 } }],
        })
      );

      const step = await adapter.next(REQUEST);

      expect(step.kind).toBe('tools');
      expect(step).toMatchObject({
        calls: [{ id: 't1', name: 'add_by_name', input: { name: 'Oat Milk', quantity: 2 } }],
      });
    });

    it('accepts a tool call naming a tool this client has never heard of', async () => {
      // The port's own contract: a model can name a tool that doesn't exist,
      // and the executor lookup downstream is where that gets caught — not
      // here. Rejecting it here would make an adapter upgrade required every
      // time the relay's tool list changes.
      vi.stubGlobal(
        'fetch',
        respondWith({
          kind: 'tools',
          assistant: [{ type: 'tool_use', id: 't1', name: 'some_future_tool', input: {} }],
          calls: [{ id: 't1', name: 'some_future_tool', input: {} }],
        })
      );

      const step = await adapter.next(REQUEST);

      expect(step.kind).toBe('tools');
    });

    it.each([
      ['an unrecognized kind', { kind: 'mystery' }],
      ['an entirely empty body', {}],
      ['an answer with no speech', { kind: 'answer', assistant: [], speech: '' }],
      ['an answer with a non-string speech', { kind: 'answer', assistant: [], speech: 42 }],
      ['an answer with a non-array assistant', { kind: 'answer', assistant: 'nope', speech: 'hi' }],
      ['a tools step with a non-array calls', { kind: 'tools', assistant: [], calls: 'nope' }],
      ['a tools step with zero calls', { kind: 'tools', assistant: [], calls: [] }],
      [
        'a tool call missing an id',
        { kind: 'tools', assistant: [], calls: [{ name: 'add_by_name', input: {} }] },
      ],
      [
        'a tool call missing input',
        { kind: 'tools', assistant: [], calls: [{ id: 't1', name: 'add_by_name' }] },
      ],
      [
        'a tool call whose input is not an object',
        { kind: 'tools', assistant: [], calls: [{ id: 't1', name: 'add_by_name', input: 'nope' }] },
      ],
    ])('resolves unavailable on %s', async (_label, body) => {
      vi.stubGlobal('fetch', respondWith(body));

      const step = await adapter.next(REQUEST);

      expect(step).toEqual({ kind: 'unavailable' });
    });
  });

  describe('failure', () => {
    it('resolves unavailable on a relay error rather than throwing', async () => {
      // next() runs inside a speech-recognition callback; a rejected promise
      // there is swallowed and reads to the cashier as the till doing nothing.
      vi.stubGlobal('fetch', respondWith({ error: 'boom' }, false, 502));

      const step = await adapter.next(REQUEST);

      expect(step).toEqual({ kind: 'unavailable' });
    });

    it('resolves unavailable when the network is gone', async () => {
      vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('Failed to fetch')));

      const step = await adapter.next(REQUEST);

      expect(step).toEqual({ kind: 'unavailable' });
    });

    it('resolves aborted, never a thrown AbortError, when the caller cancels', async () => {
      const controller = new AbortController();
      vi.stubGlobal(
        'fetch',
        vi.fn().mockImplementation(() => {
          controller.abort();
          return Promise.reject(new DOMException('Aborted', 'AbortError'));
        })
      );

      const step = await adapter.next(REQUEST, controller.signal);

      // declined carries no speech — abortedStep()'s exact shape.
      expect(step).toEqual({ kind: 'declined' });
    });
  });
});
