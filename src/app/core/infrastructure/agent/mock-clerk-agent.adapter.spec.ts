import {
  AgentExchange,
  AgentStep,
  AgentTurnRequest,
  CLERK_AGENT_MUTATE_TOOLS,
  CLERK_AGENT_READ_TOOLS,
  CLERK_AGENT_TOOL_NAMES,
  MAX_SPEECH_WORDS,
} from '@core/application/dtos/agent.dto';
import { CatalogHint } from '@core/application/dtos/recognition.dto';
import {
  MOCK_MAX_HOPS_PER_TURN,
  MOCK_MAX_LATENCY_MS,
  MOCK_MIN_LATENCY_MS,
  MOCK_ROTATION_PERIOD,
  MOCK_TURN_BUDGET_MS,
  MockClerkAgent,
} from './mock-clerk-agent.adapter';

const CATALOG: CatalogHint[] = [
  { id: 'p1', name: 'Avocado', sku: 'AVO-1', category: 'Produce' },
  { id: 'p2', name: 'Oat Milk', sku: 'OAT-1', category: 'Dairy' },
  { id: 'p3', name: 'Sourdough', sku: 'BRD-1', category: 'Bakery' },
];

function request(
  transcript: AgentExchange[] = [],
  catalog: CatalogHint[] = CATALOG,
  totalItems = 2
): AgentTurnRequest {
  return {
    utterance: 'do you sell oat milk',
    catalog,
    context: {
      cartLines: [{ name: 'Avocado', quantity: totalItems }],
      totalItems,
      total: 6.5,
      offer: [],
      cartChangedThisTurn: false,
    },
    memory: [],
    transcript,
  };
}

/** The user turn a caller sends back after running a tools step. */
function exchangeFor(step: Extract<AgentStep, { kind: 'tools' }>): AgentExchange {
  return {
    assistant: step.assistant,
    results: step.calls.map((call) => ({ id: call.id, output: { ok: true } })),
  };
}

describe('MockClerkAgent', () => {
  let adapter: MockClerkAgent;

  beforeEach(() => {
    // The adapter fakes a 400-900ms hop so the HUD exercises its real loading
    // states. Fake timers skip that wait here rather than adding a test-only
    // latency seam to production code.
    vi.useFakeTimers();
    // Nothing in this adapter logs today. Muting keeps a stray log from a later
    // arm inside the spec that caused it, per the cross-spec leak in #109/#112.
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    adapter = new MockClerkAgent();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  /** One hop, with the simulated latency fast-forwarded. */
  async function hop(req: AgentTurnRequest, signal?: AbortSignal): Promise<AgentStep> {
    const pending = adapter.next(req, signal);
    await vi.advanceTimersByTimeAsync(MOCK_MAX_LATENCY_MS + 1);
    return pending;
  }

  /**
   * One whole turn, driven the way the turn runner will: feed the transcript back
   * after every tools step and stop when a step is terminal. The cap is
   * deliberately above `MOCK_MAX_HOPS_PER_TURN` so an over-long turn shows up as a
   * failed assertion rather than a hang.
   */
  async function runTurn(catalog: CatalogHint[] = CATALOG): Promise<AgentStep[]> {
    const transcript: AgentExchange[] = [];
    const steps: AgentStep[] = [];

    for (let i = 0; i < MOCK_MAX_HOPS_PER_TURN + 2; i++) {
      const step = await hop(request(transcript, catalog));
      steps.push(step);
      if (step.kind !== 'tools') {
        break;
      }
      transcript.push(exchangeFor(step));
    }

    return steps;
  }

  it('identifies itself as the demo agent', () => {
    expect(adapter.kind).toBe('demo');
  });

  it('walks the published rotation and wraps after four turns', async () => {
    // The rotation is the contract: every step kind has to be reachable in a demo
    // and in a test without a model, and the same phrase count has to produce the
    // same shape on every run.
    const turns: AgentStep[][] = [];
    for (let i = 0; i < MOCK_ROTATION_PERIOD + 2; i++) {
      turns.push(await runTurn());
    }

    expect(turns.map((steps) => steps.map((step) => step.kind))).toEqual([
      ['tools', 'answer'],
      ['tools', 'answer'],
      ['answer'],
      ['declined'],
      // Turn 4 wraps onto turn 0, and turn 5 onto turn 1.
      ['tools', 'answer'],
      ['tools', 'answer'],
    ]);
  });

  it('never takes more hops in a turn than it publishes', async () => {
    for (let i = 0; i < MOCK_ROTATION_PERIOD + 1; i++) {
      const steps = await runTurn();
      expect(steps.length).toBeLessThanOrEqual(MOCK_MAX_HOPS_PER_TURN);
    }
  });

  it('indexes the rotation by hop rather than by call count', async () => {
    // A call-count rotation would make the second phrase depend on how many hops
    // the first happened to take, which is unusable as a fixture. Two hop-0 calls
    // in a row are therefore two turns, not one turn advanced twice.
    const first = await hop(request());
    const second = await hop(request());

    expect(first.kind).toBe('tools');
    expect(second.kind).toBe('tools');
    expect(first).not.toEqual(second);
  });

  it('answers on any hop at or beyond the published cap', async () => {
    // The defensive arm: a caller that overran the shape still gets a step it can
    // finish on, so the mock can never drive one into hop-cap exhaustion.
    const overrun: AgentExchange[] = [
      { assistant: [{ type: 'text', text: 'one' }], results: [] },
      { assistant: [{ type: 'text', text: 'two' }], results: [] },
    ];
    expect(overrun).toHaveLength(MOCK_MAX_HOPS_PER_TURN);

    const step = await hop(request(overrun));

    expect(step.kind).toBe('answer');
  });

  it('calls one read tool on the first turn and one mutate tool on the second', async () => {
    const readTurn = await runTurn();
    const mutateTurn = await runTurn();

    const read = readTurn[0] as Extract<AgentStep, { kind: 'tools' }>;
    const mutate = mutateTurn[0] as Extract<AgentStep, { kind: 'tools' }>;

    expect(read.calls).toHaveLength(1);
    expect(CLERK_AGENT_READ_TOOLS).toContain(read.calls[0]!.name);
    expect(mutate.calls).toHaveLength(1);
    expect(CLERK_AGENT_MUTATE_TOOLS).toContain(mutate.calls[0]!.name);
  });

  it('derives tool ids from the rotation coordinates so a transcript is stable', async () => {
    const [first] = await runTurn();
    const call = (first as Extract<AgentStep, { kind: 'tools' }>).calls[0]!;

    expect(call.id).toBe('mock-tool-0-0');
  });

  it('only ever names tools from the shared tuples', async () => {
    for (let i = 0; i < MOCK_ROTATION_PERIOD * 2; i++) {
      for (const step of await runTurn()) {
        if (step.kind === 'tools') {
          for (const call of step.calls) {
            expect(CLERK_AGENT_TOOL_NAMES).toContain(call.name);
          }
        }
      }
    }
  });

  it('speaks within the speech budget, with nothing the sanitizer would have to strip', async () => {
    const spoken: string[] = [];
    for (let i = 0; i < MOCK_ROTATION_PERIOD * 2; i++) {
      for (const step of await runTurn()) {
        if (step.kind === 'answer') {
          spoken.push(step.speech);
        }
      }
    }

    expect(spoken.length).toBeGreaterThan(0);
    for (const speech of spoken) {
      expect(speech.trim().split(/\s+/).length).toBeLessThanOrEqual(MAX_SPEECH_WORDS);
      // No markdown, emoji, URL, SKU or id — the mock is a valid fixture for the
      // sanitizer's specs, not something the sanitizer has to fix.
      expect(speech).not.toMatch(/[*_`#[\]|]|https?:|[A-Z]{3}-\d/);
    }
  });

  it('talks about the cart it was handed rather than inventing one', async () => {
    // Turn 0, both hops, with an empty cart in context: the answer has to describe
    // that cart and not the one the previous demo left behind.
    const opening = (await hop(request([], CATALOG, 0))) as Extract<AgentStep, { kind: 'tools' }>;
    const closing = await hop(request([exchangeFor(opening)], CATALOG, 0));
    expect(closing.kind).toBe('answer');
    expect((closing as Extract<AgentStep, { kind: 'answer' }>).speech).toMatch(
      /nothing in the cart/i
    );

    // Turn 2 of the rotation answers on its first hop, so the context reaches
    // speech with no tool round trip in between.
    await runTurn();
    const [answerOnly] = await runTurn();
    expect(answerOnly!.kind).toBe('answer');
    expect((answerOnly as Extract<AgentStep, { kind: 'answer' }>).speech).toContain('2 items');

    // One item is singular. A hop 1 answers without moving the turn counter on.
    const single = await hop(request([{ assistant: [], results: [] }], CATALOG, 1));
    expect((single as Extract<AgentStep, { kind: 'answer' }>).speech).toContain('1 item,');
  });

  it('reports itself unavailable on an empty catalog rather than inventing a product', async () => {
    const step = await hop(request([], []));

    expect(step.kind).toBe('unavailable');
    expect(step).not.toHaveProperty('speech');
  });

  it('does not consume a rotation slot on an unanswerable hop', async () => {
    await hop(request([], []));
    const [first] = await runTurn();

    expect(first!.kind).toBe('tools');
    expect((first as Extract<AgentStep, { kind: 'tools' }>).calls[0]!.id).toBe('mock-tool-0-0');
  });

  it('resolves promptly with no speech when the caller aborts', async () => {
    const controller = new AbortController();
    const pending = adapter.next(request(), controller.signal);
    controller.abort();

    const step = await pending;

    expect(step.kind).toBe('declined');
    expect(step).not.toHaveProperty('speech');
  });

  it('never rejects, whatever it is handed', async () => {
    const cases: Promise<AgentStep>[] = [
      hop(request()),
      hop(request([], [])),
      hop(request([{ assistant: [], results: [] }])),
    ];

    await expect(Promise.all(cases)).resolves.toHaveLength(cases.length);
  });

  it('publishes a turn budget a caller can size a deadline against', () => {
    expect(MOCK_TURN_BUDGET_MS).toBe(MOCK_MAX_HOPS_PER_TURN * MOCK_MAX_LATENCY_MS);
    expect(MOCK_MIN_LATENCY_MS).toBeLessThan(MOCK_MAX_LATENCY_MS);
  });
});

describe('clerk agent tool tuples', () => {
  // The relay owns the tool schemas and the browser owns the executors, keyed by
  // name, with no compiler between them. This is the cheapest available guard on
  // that two-place agreement.
  it('is the concatenation of the read and mutate tuples', () => {
    expect(CLERK_AGENT_TOOL_NAMES).toEqual([
      ...CLERK_AGENT_READ_TOOLS,
      ...CLERK_AGENT_MUTATE_TOOLS,
    ]);
    expect(CLERK_AGENT_TOOL_NAMES).toHaveLength(6);
  });

  it('keeps read and mutate disjoint and repeats no name', () => {
    const read = new Set<string>(CLERK_AGENT_READ_TOOLS);
    const overlap = CLERK_AGENT_MUTATE_TOOLS.filter((name) => read.has(name));

    expect(overlap).toEqual([]);
    expect(new Set<string>(CLERK_AGENT_TOOL_NAMES).size).toBe(CLERK_AGENT_TOOL_NAMES.length);
  });
});
