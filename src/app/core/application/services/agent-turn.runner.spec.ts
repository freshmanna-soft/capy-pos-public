import {
  AgentBlock,
  AgentStep,
  AgentToolCall,
  AgentToolName,
  AgentToolResult,
  AgentTurnRequest,
  CLERK_AGENT_MUTATE_TOOLS,
  CLERK_AGENT_TOOL_NAMES,
} from '@core/application/dtos/agent.dto';
import { ClerkAgent } from '@core/application/ports/clerk-agent.port';
import { MOOD_HOLD_MS, UNDO_WINDOW_MS } from '@core/application/facades/clerk.facade';
import { MAX_SPOKEN_QUANTITY } from '@core/application/services/voice-intent.parser';
import { ClerkAgentTool, ClerkAgentTools } from './clerk-agent-tools';
import {
  AgentBudget,
  AgentTurnRunner,
  DEADLINE_MS,
  MAX_CART_CHANGES,
  MAX_EVENT_UTTERANCE,
  MAX_HOPS,
  truncateUtterance,
} from './agent-turn.runner';

/** The two live readings a cap is measured against, as a spec can move them. */
interface Till {
  revision: number;
  pending: { productId: string } | null;
}

function till(): Till {
  return { revision: 1, pending: null };
}

function budgetOf(state: Till, overrides: Partial<AgentBudget> = {}): AgentBudget {
  return {
    cartRevision: () => state.revision,
    pendingAdd: () => state.pending,
    ...overrides,
  };
}

/** A clock the spec advances by hand, so no test waits on a real deadline. */
function clockOf(): { now: () => number; advance: (by: number) => void } {
  let ms = 0;
  return {
    now: () => ms,
    advance: (by: number) => {
      ms += by;
    },
  };
}

/** Every executor a no-op, so a test only has to say what it cares about. */
function toolsOf(overrides: Partial<Record<AgentToolName, ClerkAgentTool>> = {}): ClerkAgentTools {
  const table: Record<AgentToolName, ClerkAgentTool> = {
    look_up_product: () => ({ output: { found: false } }),
    read_cart: () => ({ output: { totalItems: 0 } }),
    check_stock: () => ({ output: { found: false } }),
    read_offer: () => ({ output: { offer: [] } }),
    add_by_name: () => ({ output: { added: 1 }, changedCart: true }),
    remove_by_name: () => ({ output: { removed: 1 }, changedCart: true }),
  };
  return { ...table, ...overrides };
}

/** What one hop was actually asked, snapshotted before the runner moves on. */
interface HopSnapshot {
  utterance: string;
  cartChangedThisTurn: boolean;
  transcriptLength: number;
}

interface ScriptedAgent extends ClerkAgent {
  readonly hops: HopSnapshot[];
  readonly requests: AgentTurnRequest[];
}

/**
 * An agent that reads from a script, repeating its last step forever.
 *
 * Repetition is what makes the hop-cap test honest: a model that keeps asking for
 * tools is exactly the shape `MAX_HOPS` exists to stop.
 */
function scripted(steps: readonly AgentStep[], onHop?: (index: number) => void): ScriptedAgent {
  const hops: HopSnapshot[] = [];
  const requests: AgentTurnRequest[] = [];
  return {
    kind: 'scripted',
    hops,
    requests,
    next: (request: AgentTurnRequest): Promise<AgentStep> => {
      const index = hops.length;
      hops.push({
        utterance: request.utterance,
        cartChangedThisTurn: request.context.cartChangedThisTurn,
        transcriptLength: request.transcript.length,
      });
      requests.push(request);
      onHop?.(index);
      return Promise.resolve(steps[Math.min(index, steps.length - 1)]!);
    },
  };
}

/** An agent that hangs until its hop is aborted, for the two abort provenances. */
function hanging(): ClerkAgent {
  return {
    kind: 'hanging',
    next: (_request, signal) =>
      new Promise<AgentStep>((resolve) => {
        signal?.addEventListener('abort', () => resolve({ kind: 'declined' }), { once: true });
      }),
  };
}

function call(
  name: string,
  input: Record<string, unknown> = {},
  id = `call-${name}`
): AgentToolCall {
  return { id, name, input };
}

function toolStep(...calls: AgentToolCall[]): AgentStep {
  return { kind: 'tools', assistant: [{ type: 'tool_use' }], calls };
}

function answerStep(speech = 'Two avocados, four pounds.'): AgentStep {
  return { kind: 'answer', assistant: [{ type: 'text', text: speech }], speech };
}

function requestOf(): AgentTurnRequest {
  return {
    utterance: 'placeholder, overwritten by the runner',
    catalog: [{ id: 'p1', name: 'Avocado', sku: 'P1-SKU', category: 'Produce' }],
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
}

/** A runner over a till, with the pieces a test wants to reach afterwards. */
function runnerOf(
  agent: ClerkAgent,
  options: {
    state?: Till;
    tools?: ClerkAgentTools;
    budget?: Partial<AgentBudget>;
    now?: () => number;
  } = {}
): { runner: AgentTurnRunner; request: ReturnType<typeof vi.fn> } {
  const state = options.state ?? till();
  const request = vi.fn(requestOf);
  const runner = new AgentTurnRunner(
    agent,
    options.tools ?? toolsOf(),
    budgetOf(state, options.budget),
    options.now
  );
  return { runner, request };
}

/** The results of one completed hop, as the next hop was told them. */
function resultsOfHop(agent: ScriptedAgent, hop: number): AgentToolResult[] {
  return agent.requests.at(-1)!.transcript[hop]!.results;
}

describe('AgentTurnRunner', () => {
  describe('budget constants', () => {
    it('keeps a hop spare for speech after the one cart change a turn may make', () => {
      // The invariant the mutation guard is built on: at least one hop has to
      // survive the write, or silence becomes the designed outcome of a turn that
      // changed the sale.
      expect(MAX_CART_CHANGES).toBeLessThan(MAX_HOPS);
    });

    it('finishes inside both the undo window and the mood hold', () => {
      // A turn that outran either would be mutating a cart outside the window the
      // whole design assumes, wearing a face that describes nothing.
      expect(DEADLINE_MS).toBeLessThan(UNDO_WINDOW_MS);
      expect(DEADLINE_MS).toBeLessThan(MOOD_HOLD_MS);
    });
  });

  describe('answering', () => {
    it('reports the prose the model wrote, unchanged, and one hop', async () => {
      const agent = scripted([answerStep('Four pounds twenty.')]);
      const { runner, request } = runnerOf(agent);

      const outcome = await runner.run('how much is that', request);

      expect(outcome.kind).toBe('answered');
      // Raw prose: making it speakable belongs to the sanitizer, not to this.
      expect(outcome.speech).toBe('Four pounds twenty.');
      expect(outcome.hops).toBe(1);
      expect(outcome.hopMs).toHaveLength(1);
      expect(outcome.tools).toEqual([]);
      expect(outcome.productIds).toEqual([]);
      expect(outcome.mutated).toBe(false);
    });

    it('writes the utterance of the turn onto every hop, whatever the thunk says', async () => {
      const agent = scripted([toolStep(call('read_cart')), answerStep()]);
      const { runner, request } = runnerOf(agent);

      await runner.run('what is on the sale', request);

      expect(agent.hops.map((hop) => hop.utterance)).toEqual([
        'what is on the sale',
        'what is on the sale',
      ]);
    });

    it('re-reads the till once per hop rather than snapshotting it', async () => {
      const agent = scripted([toolStep(call('read_cart')), answerStep()]);
      const { runner, request } = runnerOf(agent);

      await runner.run('what is on the sale', request);

      expect(request).toHaveBeenCalledTimes(2);
    });

    it('tells the model the cart moved when the revision moved', async () => {
      const state = till();
      const agent = scripted([toolStep(call('read_cart')), answerStep()], (index) => {
        if (index === 0) {
          // A barcode add landing between two hops of the same turn.
          state.revision += 1;
        }
      });
      const { runner, request } = runnerOf(agent, { state });

      await runner.run('what is on the sale', request);

      expect(agent.hops.map((hop) => hop.cartChangedThisTurn)).toEqual([false, true]);
    });

    it('hands the assistant blocks back verbatim, by reference', async () => {
      const block: AgentBlock = { type: 'thinking', signature: 'opaque' };
      const step: AgentStep = { kind: 'tools', assistant: [block], calls: [call('read_cart')] };
      const agent = scripted([step, answerStep()]);
      const { runner, request } = runnerOf(agent);

      await runner.run('what is on the sale', request);

      // Thinking blocks have to round-trip byte-identical, so nothing may be
      // re-serialized on the way back into the transcript.
      expect(agent.requests[1]!.transcript[0]!.assistant[0]).toBe(block);
      expect(agent.hops.map((hop) => hop.transcriptLength)).toEqual([0, 1]);
    });
  });

  describe('outcomes that carry no speech', () => {
    it('reports a refusal by the model as declined', async () => {
      const agent = scripted([{ kind: 'declined' }]);
      const { runner, request } = runnerOf(agent);

      const outcome = await runner.run('what is on the sale', request);

      expect(outcome.kind).toBe('declined');
      expect(outcome.speech).toBe('');
    });

    it('reports an unreachable model as unavailable', async () => {
      const agent = scripted([{ kind: 'unavailable' }]);
      const { runner, request } = runnerOf(agent);

      const outcome = await runner.run('what is on the sale', request);

      expect(outcome.kind).toBe('unavailable');
      expect(outcome.speech).toBe('');
    });

    it('never rejects when an adapter throws', async () => {
      // The caller is a speech callback: a rejection there is swallowed by the
      // browser and reads to the cashier as a till that ignored her.
      const agent: ClerkAgent = {
        kind: 'broken',
        next: () => Promise.reject(new Error('adapter blew up')),
      };
      const { runner, request } = runnerOf(agent);

      await expect(runner.run('what is on the sale', request)).resolves.toMatchObject({
        kind: 'declined',
      });
    });

    it('declines before the first hop when the caller has already aborted', async () => {
      const agent = scripted([answerStep()]);
      const { runner, request } = runnerOf(agent);

      const outcome = await runner.run('what is on the sale', request, AbortSignal.abort());

      expect(outcome.kind).toBe('declined');
      expect(outcome.hops).toBe(0);
      expect(agent.hops).toHaveLength(0);
    });

    it('declines when the cashier moves on mid-hop', async () => {
      const controller = new AbortController();
      const { runner, request } = runnerOf(hanging());

      const running = runner.run('what is on the sale', request, controller.signal);
      controller.abort();

      expect((await running).kind).toBe('declined');
    });

    it('reports the deadline firing mid-hop as exhausted, not as a refusal', async () => {
      // Provenance matters: the clock running out is worth a histogram, the cashier
      // moving on is worth nothing at all.
      const { runner, request } = runnerOf(hanging(), { budget: { deadlineMs: 5 } });

      const outcome = await runner.run('what is on the sale', request);

      expect(outcome.kind).toBe('exhausted');
    });
  });

  describe('the caps', () => {
    it('stops at the hop ceiling and returns rather than throwing', async () => {
      // A fresh input per hop, so the dedup cannot answer the second hop for it.
      let asked = 0;
      const insatiable: ClerkAgent = {
        kind: 'insatiable',
        next: () => {
          asked += 1;
          return Promise.resolve(toolStep(call('read_cart', { hop: asked }, `call-${asked}`)));
        },
      };
      const { runner, request } = runnerOf(insatiable);

      const outcome = await runner.run('what is on the sale', request);

      expect(outcome.kind).toBe('exhausted');
      expect(outcome.hops).toBe(MAX_HOPS);
      expect(outcome.hopMs).toHaveLength(MAX_HOPS);
      expect(asked).toBe(MAX_HOPS);
    });

    it('stops before a hop the wall clock cannot pay for', async () => {
      const clock = clockOf();
      const agent = scripted([toolStep(call('read_cart'))], () => clock.advance(DEADLINE_MS));
      const { runner, request } = runnerOf(agent, { now: clock.now });

      const outcome = await runner.run('what is on the sale', request);

      expect(outcome.kind).toBe('exhausted');
      expect(outcome.hops).toBe(1);
      expect(outcome.ms).toBeGreaterThanOrEqual(DEADLINE_MS);
    });

    it('counts a tool round against the same clock as the hops', async () => {
      const clock = clockOf();
      const agent = scripted([toolStep(call('read_cart'))]);
      const tools = toolsOf({
        read_cart: () => {
          clock.advance(DEADLINE_MS);
          return { output: { totalItems: 0 } };
        },
      });
      const { runner, request } = runnerOf(agent, { now: clock.now, tools });

      const outcome = await runner.run('what is on the sale', request);

      expect(outcome.kind).toBe('exhausted');
      expect(outcome.hops).toBe(1);
    });

    it('leaves no deadline timer behind', async () => {
      vi.useFakeTimers();
      try {
        const agent = scripted([answerStep()]);
        const { runner, request } = runnerOf(agent);

        await runner.run('what is on the sale', request);

        // A dangling deadline timer is exactly the late-async leak the one-tick
        // drain in the suite setup was added to stop.
        expect(vi.getTimerCount()).toBe(0);
      } finally {
        vi.useRealTimers();
      }
    });
  });

  describe('tool dispatch', () => {
    it('runs a read tool and pairs its output with the call id', async () => {
      const agent = scripted([toolStep(call('read_cart')), answerStep()]);
      const tools = toolsOf({ read_cart: () => ({ output: { totalItems: 3 } }) });
      const { runner, request } = runnerOf(agent, { tools });

      const outcome = await runner.run('what is on the sale', request);

      expect(resultsOfHop(agent, 0)).toEqual<AgentToolResult[]>([
        { id: 'call-read_cart', output: { totalItems: 3 } },
      ]);
      expect(outcome.tools).toEqual(['read_cart']);
    });

    it('answers a whole round of parallel calls in one exchange', async () => {
      const agent = scripted([
        toolStep(call('read_cart'), call('read_offer'), call('look_up_product', { name: 'oat' })),
        answerStep(),
      ]);
      const { runner, request } = runnerOf(agent);

      const outcome = await runner.run('what is on the sale', request);

      // One exchange, three results: the model asked for three things at once and
      // has to be answered that way or parallel tool use degrades.
      expect(agent.requests[1]!.transcript).toHaveLength(1);
      expect(resultsOfHop(agent, 0)).toHaveLength(3);
      expect(outcome.tools).toEqual(['read_cart', 'read_offer', 'look_up_product']);
    });

    it('tells the model a name it invented does not exist, and carries on', async () => {
      const agent = scripted([toolStep(call('apply_discount', { percent: 50 })), answerStep()]);
      const { runner, request } = runnerOf(agent);

      const outcome = await runner.run('knock half off that', request);

      expect(resultsOfHop(agent, 0)).toEqual<AgentToolResult[]>([
        { id: 'call-apply_discount', output: { error: 'unknown_tool' }, isError: true },
      ]);
      // Refused calls are still named: a refusal nobody counted is a refusal
      // nobody can tune.
      expect(outcome.tools).toEqual(['apply_discount']);
      expect(outcome.kind).toBe('answered');
    });

    it.each(['__proto__', 'constructor', 'toString', 'valueOf', 'hasOwnProperty'])(
      'refuses "%s" instead of reaching Object.prototype',
      async (name) => {
        // The table is indexed with a model-controlled string. On a plain object
        // literal every name here resolves to an inherited member — a truthy
        // non-executor, or worse a callable one — so the lookup has to ask whether
        // the table *owns* the name, not merely whether something answered.
        const agent = scripted([toolStep(call(name, {}, 'call-proto')), answerStep()]);
        const { runner, request } = runnerOf(agent);

        const outcome = await runner.run('what is on the sale', request);

        expect(resultsOfHop(agent, 0)).toEqual<AgentToolResult[]>([
          { id: 'call-proto', output: { error: 'unknown_tool' }, isError: true },
        ]);
        expect(outcome.kind).toBe('answered');
      }
    );

    it('refuses an entry the table owns but cannot call', async () => {
      // The guard is about callability, not only about ownership: a table built by
      // hand — or by a future factory — is not a compiler-checked artefact by the
      // time a model-chosen string reaches it.
      const tools = { ...toolsOf(), read_cart: 'not an executor' } as unknown as ClerkAgentTools;
      const agent = scripted([toolStep(call('read_cart', {}, 'call-broken')), answerStep()]);
      const { runner, request } = runnerOf(agent, { tools });

      const outcome = await runner.run('what is on the sale', request);

      expect(resultsOfHop(agent, 0)).toEqual<AgentToolResult[]>([
        { id: 'call-broken', output: { error: 'unknown_tool' }, isError: true },
      ]);
      expect(outcome.kind).toBe('answered');
    });

    it('never rejects on a prototype-shaped tool name', async () => {
      // The failure this replaces was not a wrong answer but a rejected promise out
      // of `run()`, which the speech callback swallows whole.
      const agent = scripted([toolStep(call('__proto__')), answerStep()]);
      const { runner, request } = runnerOf(agent);

      await expect(runner.run('what is on the sale', request)).resolves.toMatchObject({
        kind: 'answered',
      });
    });

    it('lets a real call in the same round through beside a refused one', async () => {
      const state = till();
      const agent = scripted([
        toolStep(call('__proto__'), call('add_by_name', { name: 'avocado' })),
        answerStep('One avocado, added.'),
      ]);
      const tools = toolsOf({
        add_by_name: () => {
          state.revision += 1;
          state.pending = { productId: 'p1' };
          return { output: { added: 1, name: 'Avocado' }, changedCart: true };
        },
      });
      const { runner, request } = runnerOf(agent, { state, tools });

      const outcome = await runner.run('add an avocado', request);

      expect(outcome.mutated).toBe(true);
      expect(outcome.productIds).toEqual(['p1']);
      expect(outcome.tools).toEqual(['__proto__', 'add_by_name']);
    });

    it('answers the same question twice for free', async () => {
      const readCart = vi.fn<ClerkAgentTool>(() => ({ output: { totalItems: 0 } }));
      const agent = scripted([
        toolStep(call('read_cart', {}, 'first'), call('read_cart', {}, 'second')),
        answerStep(),
      ]);
      const { runner, request } = runnerOf(agent, { tools: toolsOf({ read_cart: readCart }) });

      await runner.run('what is on the sale', request);

      expect(readCart).toHaveBeenCalledTimes(1);
      expect(resultsOfHop(agent, 0)[1]).toEqual<AgentToolResult>({
        id: 'second',
        output: { error: 'duplicate_call' },
        isError: true,
      });
    });

    it('reads two spellings of the same question as one', async () => {
      // A model asking again rarely spells it identically, and the point of the
      // dedup is that the second ask costs nothing rather than less.
      const lookUp = vi.fn<ClerkAgentTool>(() => ({ output: { found: true } }));
      const agent = scripted([
        toolStep(
          call('look_up_product', { name: 'Avocado', ripe: true }, 'first'),
          call('look_up_product', { ripe: true, name: ' avocado ' }, 'second')
        ),
        answerStep(),
      ]);
      const { runner, request } = runnerOf(agent, { tools: toolsOf({ look_up_product: lookUp }) });

      await runner.run('have you got avocados', request);

      expect(lookUp).toHaveBeenCalledTimes(1);
      expect(resultsOfHop(agent, 0)[1]!.output).toEqual({ error: 'duplicate_call' });
    });
  });

  describe('mutating tools', () => {
    it('is the two names the shared tuple calls mutating', () => {
      expect([...CLERK_AGENT_MUTATE_TOOLS]).toEqual(['add_by_name', 'remove_by_name']);
    });

    it('clamps a quantity that came off a model before the facade sees it', async () => {
      const add = vi.fn<ClerkAgentTool>(() => ({ output: { added: 5 } }));
      const agent = scripted([toolStep(call('add_by_name', { name: 'avocado', quantity: 99 }))]);
      const { runner, request } = runnerOf(agent, { tools: toolsOf({ add_by_name: add }) });

      await runner.run('add ninety nine avocados', request);

      expect(add).toHaveBeenCalledWith({ name: 'avocado', quantity: MAX_SPOKEN_QUANTITY });
    });

    it.each([
      [0, 1],
      [-3, 1],
      ['two', 1],
      [2.7, 2],
    ])('floors a quantity of %p at %i', async (quantity, expected) => {
      const add = vi.fn<ClerkAgentTool>(() => ({ output: { added: expected } }));
      const agent = scripted([toolStep(call('add_by_name', { name: 'avocado', quantity }))]);
      const { runner, request } = runnerOf(agent, { tools: toolsOf({ add_by_name: add }) });

      await runner.run('add avocados', request);

      expect(add).toHaveBeenCalledWith({ name: 'avocado', quantity: expected });
    });

    it('records what the turn really put in the cart', async () => {
      const state = till();
      const agent = scripted([
        toolStep(call('add_by_name', { name: 'avocado' })),
        answerStep('One avocado, added.'),
      ]);
      const tools = toolsOf({
        add_by_name: () => {
          state.revision += 1;
          state.pending = { productId: 'p1' };
          return { output: { added: 1 }, changedCart: true };
        },
      });
      const { runner, request } = runnerOf(agent, { state, tools });

      const outcome = await runner.run('add an avocado', request);

      expect(outcome.mutated).toBe(true);
      expect(outcome.productIds).toEqual(['p1']);
      expect(outcome.kind).toBe('answered');
    });

    it('does not spend the budget on an add that changed nothing', async () => {
      // An add that resolved to nothing spoke and put cards up but did not touch
      // the sale, so it must not spend the budget that protects the undo window.
      const add = vi.fn<ClerkAgentTool>(() => ({
        output: { added: 0, reason: 'ambiguous' },
        changedCart: false,
      }));
      const agent = scripted([
        toolStep(call('add_by_name', { name: 'milk' }, 'first')),
        toolStep(call('add_by_name', { name: 'oat milk' }, 'second')),
        answerStep('Oat milk, added.'),
      ]);
      const { runner, request } = runnerOf(agent, { tools: toolsOf({ add_by_name: add }) });

      const outcome = await runner.run('add a milk', request);

      expect(add).toHaveBeenCalledTimes(2);
      expect(outcome.mutated).toBe(false);
      expect(outcome.productIds).toEqual([]);
    });

    it('refuses a second cart change and leaves the cart alone', async () => {
      const state = till();
      const add = vi.fn<ClerkAgentTool>(() => {
        state.revision += 1;
        state.pending = { productId: 'p1' };
        return { output: { added: 1 }, changedCart: true };
      });
      const agent = scripted([
        toolStep(call('add_by_name', { name: 'avocado' }, 'first')),
        toolStep(call('add_by_name', { name: 'oat milk' }, 'second')),
        answerStep('Avocado added; the milk still needs doing.'),
      ]);
      const { runner, request } = runnerOf(agent, { state, tools: toolsOf({ add_by_name: add }) });

      const outcome = await runner.run('add an avocado and a milk', request);

      expect(add).toHaveBeenCalledTimes(1);
      expect(resultsOfHop(agent, 1)[0]).toMatchObject({ id: 'second', isError: true });
      expect(resultsOfHop(agent, 1)[0]!.output['error']).toBe('one_cart_change_per_turn');
      expect(outcome.kind).toBe('answered');
      expect(outcome.productIds).toEqual(['p1']);
    });

    it('stands the turn down when something outside it changed the cart', async () => {
      const state = till();
      const add = vi.fn<ClerkAgentTool>(() => ({ output: { added: 1 }, changedCart: true }));
      const agent = scripted(
        [toolStep(call('read_cart'), call('add_by_name', { name: 'avocado' })), answerStep()],
        () => {
          // A barcode add landing while the hop was in flight.
          state.revision += 1;
        }
      );
      const { runner, request } = runnerOf(agent, { state, tools: toolsOf({ add_by_name: add }) });

      const outcome = await runner.run('add an avocado', request);

      expect(add).not.toHaveBeenCalled();
      expect(outcome.kind).toBe('declined');
      expect(outcome.mutated).toBe(false);
      // The results already collected answer a question that has changed, so the
      // turn stops where it stands rather than reporting them.
      expect(agent.hops).toHaveLength(1);
    });

    it('stands down rather than clobbering an add whose window is still open', async () => {
      // A pending add from before this turn leaves the revision untouched, so the
      // revision guard cannot see it — and clobbering it would make a barcode add
      // unundoable while leaving its optimistic row standing as correct.
      const state: Till = { revision: 1, pending: { productId: 'p9' } };
      const add = vi.fn<ClerkAgentTool>(() => ({ output: { added: 1 }, changedCart: true }));
      const agent = scripted([toolStep(call('add_by_name', { name: 'avocado' })), answerStep()]);
      const { runner, request } = runnerOf(agent, { state, tools: toolsOf({ add_by_name: add }) });

      const outcome = await runner.run('add an avocado', request);

      expect(add).not.toHaveBeenCalled();
      expect(outcome.kind).toBe('declined');
    });

    it('does not stand down over the pending add it opened itself', async () => {
      // Under a raised cap, ownership is what tells the window of this turn from a
      // foreign one — which is why the comparison is by reference.
      const state = till();
      const agent = scripted([
        toolStep(call('add_by_name', { name: 'avocado' }, 'first')),
        toolStep(call('add_by_name', { name: 'oat milk' }, 'second')),
        answerStep('Both added.'),
      ]);
      let added = 0;
      const tools = toolsOf({
        add_by_name: () => {
          added += 1;
          state.revision += 1;
          state.pending = { productId: `p${added}` };
          return { output: { added: 1 }, changedCart: true };
        },
      });
      const { runner, request } = runnerOf(agent, { state, tools, budget: { maxCartChanges: 2 } });

      const outcome = await runner.run('add an avocado and a milk', request);

      expect(outcome.kind).toBe('answered');
      expect(outcome.productIds).toEqual(['p1', 'p2']);
      expect(outcome.mutated).toBe(true);
    });

    it('records nothing when a write reports a change but opened no window', async () => {
      // `changedCart` and the pending add are two different readings, and only the
      // second names a product — a change with no window has nothing to record.
      const state = till();
      const agent = scripted([toolStep(call('remove_by_name', { name: 'avocado' })), answerStep()]);
      const tools = toolsOf({
        remove_by_name: () => {
          state.revision += 1;
          return { output: { removed: 1 }, changedCart: true };
        },
      });
      const { runner, request } = runnerOf(agent, { state, tools });

      const outcome = await runner.run('take the avocado off', request);

      expect(outcome.mutated).toBe(true);
      expect(outcome.productIds).toEqual([]);
    });
  });
});

describe('truncateUtterance', () => {
  it('leaves a phrase inside the budget alone', () => {
    expect(truncateUtterance('add two avocados')).toBe('add two avocados');
  });

  it('leaves a phrase exactly at the budget alone', () => {
    const exact = 'a'.repeat(MAX_EVENT_UTTERANCE);
    expect(truncateUtterance(exact)).toBe(exact);
  });

  it('cuts a monologue to the budget and says so', () => {
    const long = 'a'.repeat(MAX_EVENT_UTTERANCE + 20);

    const cut = truncateUtterance(long);

    expect(cut).toBe(`${'a'.repeat(MAX_EVENT_UTTERANCE)}…`);
    expect(cut).toHaveLength(MAX_EVENT_UTTERANCE + 1);
  });
});

describe('the tool-name contract', () => {
  it('names every tool the runner may be asked for exactly once', () => {
    expect(new Set(CLERK_AGENT_TOOL_NAMES).size).toBe(CLERK_AGENT_TOOL_NAMES.length);
  });
});
