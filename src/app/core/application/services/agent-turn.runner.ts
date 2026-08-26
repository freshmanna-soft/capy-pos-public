import {
  AgentBlock,
  AgentExchange,
  AgentStep,
  AgentToolCall,
  AgentToolResult,
  AgentTurnRequest,
  CLERK_AGENT_MUTATE_TOOLS,
} from '@core/application/dtos/agent.dto';
import { ClerkAgent } from '@core/application/ports/clerk-agent.port';
import { ClerkAgentTool, ClerkAgentTools } from '@core/application/services/clerk-agent-tools';
import { clampSpokenQuantity } from '@core/application/services/voice-intent.parser';

/**
 * The wall-clock budget for one whole turn, hops and tools included.
 *
 * **The primary budget**, and the only one sized against anything real. It sits
 * under `UNDO_WINDOW_MS` (4000) so an answer still lands while taking the add back
 * is a keystroke, and inside `MOOD_HOLD_MS` (4600) so the expression on her face
 * still describes the thing that caused it. A turn that ran longer than either
 * would be mutating a cart outside the window the whole design assumes.
 */
export const DEADLINE_MS = 3500;

/**
 * The hop ceiling — a sanity bound, not the budget.
 *
 * Three because the shape worth supporting is look, act, answer. Exhaustion
 * *returns* rather than throws: this runs inside a speech-recognition callback
 * where a rejected promise is swallowed whole and reads to the cashier as the till
 * doing nothing at all.
 */
export const MAX_HOPS = 3;

/**
 * How many times one turn may change the cart.
 *
 * One, because `openUndoWindow` clears the window before it opens the next: a
 * second add inside a turn would make the first unundoable while leaving its
 * optimistic log row standing as correct.
 *
 * **Invariant: `MAX_CART_CHANGES < MAX_HOPS`.** At least one hop must survive the
 * mutation for the model to say what it did, or silence becomes the designed
 * outcome of a turn that changed the sale. A later story raises this cap and has to
 * preserve the strict inequality.
 */
export const MAX_CART_CHANGES = 1;

/** How much of a turn's utterance is worth carrying on an event payload. */
export const MAX_EVENT_UTTERANCE = 120;

/** What one turn did, in the terms the facade reports and bills it in. */
export type AgentOutcomeKind = 'answered' | 'exhausted' | 'declined' | 'unavailable';

export interface AgentOutcome {
  kind: AgentOutcomeKind;
  /** Raw model prose, empty unless `answered`. The sanitizer, not this, makes it speakable. */
  speech: string;
  /** Hops actually taken, which is what `clerk.agent.hops` counts. */
  hops: number;
  /**
   * Wall-clock milliseconds per hop, in order.
   *
   * Reported rather than recorded here so the runner needs no telemetry dependency
   * and the facade needs no second clock — the histogram is one `observe()` per
   * entry.
   */
  hopMs: number[];
  /** Tool names in call order, including refused calls. Names only, never arguments. */
  tools: string[];
  /** Products this turn actually put in the cart, for the facade's turn memory. */
  productIds: string[];
  /** Whether the cart really changed because of this turn. */
  mutated: boolean;
  /** The whole turn's wall clock, for `clerk.agent.turn.ms`. */
  ms: number;
}

/**
 * The caps, and the two live readings a cap is measured against.
 *
 * The readings are functions rather than values because both are volatile inside a
 * turn: the sample timer runs at 125ms and a barcode add takes 300ms of dwell, so
 * the cart can move between two hops of the same turn. Snapshotting either would
 * make the guard describe a till that no longer exists.
 */
export interface AgentBudget {
  /** `PosFacade.cartRevision` — monotonic, and the only way to notice a foreign write. */
  cartRevision(): number;
  /** The add inside its undo window, or null. Compared by reference, so ownership is exact. */
  pendingAdd(): { productId: string } | null;
  /** Overrides, for a spec that needs a shorter clock. Defaults are the constants above. */
  deadlineMs?: number;
  maxHops?: number;
  maxCartChanges?: number;
}

/** A tool result the model can recover from. Never an exception — nothing here throws. */
type ToolError = 'unknown_tool' | 'duplicate_call' | 'one_cart_change_per_turn';

/** What one round of tool calls produced, and whether the turn may continue. */
interface ToolRound {
  results: AgentToolResult[];
  /** Set when something outside this turn changed the cart and the turn must stand down. */
  declined: boolean;
}

/** Everything one turn accumulates, in one object so the hop loop stays flat. */
interface TurnState {
  hops: number;
  hopMs: number[];
  tools: string[];
  productIds: string[];
  cartChanges: number;
  /** The revision at turn start — the honest source for `cartChangedThisTurn`. */
  startRevision: number;
  /** The revision this turn last left the cart at. A mismatch is a foreign write. */
  expectedRevision: number;
  /** The pending add this turn opened, held by reference so a foreign one cannot pass. */
  ownPending: { productId: string } | null;
  seen: Set<string>;
}

/**
 * AgentTurnRunner — the loop around one model hop.
 *
 * A plain exported class, deliberately **not** `@Injectable`: the tool table it
 * runs closes over facade privates, so an injector would have nothing to give it.
 * The same shape as `FrameGate`, `BarcodeGate` and `LookScheduler` — policy, pure
 * except for the clock, and injectable by hand from the one place that owns it.
 *
 * It is decomposed rather than written as one method because the alternative does
 * not pass the gate: a hop loop plus a six-way tool dispatch plus four outcome arms
 * in one function is well past `cognitive-complexity: 15`, which pre-commit runs at
 * `--max-warnings 0`.
 *
 * **`run()` never rejects.** Every failure — a hop that throws, an `AbortError`
 * from an adapter, a tool name that does not exist, a hop cap reached, a deadline
 * crossed — is an `AgentOutcome`. The caller is a speech callback: a rejection
 * there is swallowed by the browser and looks identical to a till that ignored the
 * cashier.
 */
export class AgentTurnRunner {
  constructor(
    private readonly agent: ClerkAgent,
    private readonly tools: ClerkAgentTools,
    private readonly budget: AgentBudget,
    private readonly now: () => number = Date.now
  ) {}

  private get deadlineMs(): number {
    return this.budget.deadlineMs ?? DEADLINE_MS;
  }

  private get maxHops(): number {
    return this.budget.maxHops ?? MAX_HOPS;
  }

  private get maxCartChanges(): number {
    return this.budget.maxCartChanges ?? MAX_CART_CHANGES;
  }

  /**
   * Run one turn to an outcome.
   *
   * @param utterance What the cashier said. Written onto every hop's request, so the
   *   thunk cannot disagree with the turn about what is being answered.
   * @param request A **thunk**, called once per hop. The till context has to be
   *   re-read each time for the reason `AgentTurnContext` gives: a cart snapshotted
   *   at the top of a 3500ms turn can describe a sale that a barcode has since
   *   changed.
   * @param signal The caller's abort — a second admitted phrase, an "undo", a
   *   checkout, the session ending.
   */
  async run(
    utterance: string,
    request: () => AgentTurnRequest,
    signal?: AbortSignal
  ): Promise<AgentOutcome> {
    const started = this.now();
    const state: TurnState = {
      hops: 0,
      hopMs: [],
      tools: [],
      productIds: [],
      cartChanges: 0,
      startRevision: this.budget.cartRevision(),
      expectedRevision: this.budget.cartRevision(),
      ownPending: null,
      seen: new Set<string>(),
    };
    const elapsed = (): number => this.now() - started;

    if (signal?.aborted) {
      return this.outcome('declined', '', state, elapsed());
    }

    // The deadline as a signal, not merely as a comparison. Without this the only
    // cancellation reaching a hop already in flight is the adapter's own request
    // timeout, which is long enough for a hop to come back and mutate the cart well
    // outside the undo window this budget was sized against.
    const controller = new AbortController();
    let deadlineFired = false;
    let callerAborted = false;
    const timer = setTimeout(() => {
      deadlineFired = true;
      controller.abort();
    }, this.deadlineMs);
    const onCallerAbort = (): void => {
      callerAborted = true;
      controller.abort();
    };
    signal?.addEventListener('abort', onCallerAbort, { once: true });

    try {
      return await this.loop(utterance, request, state, controller.signal, {
        elapsed,
        // Provenance matters because the two mean different things: the clock ran
        // out (exhausted, and worth a histogram) or the cashier moved on (declined,
        // and worth nothing at all).
        abortKind: (): AgentOutcomeKind =>
          callerAborted && !deadlineFired ? 'declined' : 'exhausted',
      });
    } finally {
      // Always, so no handle outlives the turn. A dangling deadline timer is exactly
      // the late-async leak the suite's one-tick drain was added to stop.
      clearTimeout(timer);
      signal?.removeEventListener('abort', onCallerAbort);
    }
  }

  /**
   * The hop loop.
   *
   * The wall clock is checked before every hop and again after every tool round,
   * because a round of tools between two hops is time the deadline is spending too.
   */
  private async loop(
    utterance: string,
    request: () => AgentTurnRequest,
    state: TurnState,
    signal: AbortSignal,
    clock: { elapsed: () => number; abortKind: () => AgentOutcomeKind }
  ): Promise<AgentOutcome> {
    const transcript: AgentExchange[] = [];

    while (state.hops < this.maxHops) {
      if (clock.elapsed() >= this.deadlineMs) {
        return this.outcome('exhausted', '', state, clock.elapsed());
      }

      const hopStarted = this.now();
      const step = await this.hop(utterance, request, state, transcript, signal);
      state.hops += 1;
      state.hopMs.push(this.now() - hopStarted);

      if (signal.aborted) {
        return this.outcome(clock.abortKind(), '', state, clock.elapsed());
      }
      if (step.kind === 'answer') {
        return this.outcome('answered', step.speech, state, clock.elapsed());
      }
      if (step.kind === 'declined') {
        return this.outcome('declined', '', state, clock.elapsed());
      }
      if (step.kind === 'unavailable') {
        return this.outcome('unavailable', '', state, clock.elapsed());
      }

      const round = this.runTools(step.calls, state);
      // Verbatim: the same `AgentBlock` references that came off the hop, with
      // nothing added, removed or re-serialized. Thinking blocks have to round-trip
      // byte-identical, and a typed mirror of the block union is a shape we would
      // get wrong on the first API addition.
      transcript.push({ assistant: step.assistant, results: round.results });
      if (round.declined) {
        return this.outcome('declined', '', state, clock.elapsed());
      }
      if (clock.elapsed() >= this.deadlineMs) {
        return this.outcome('exhausted', '', state, clock.elapsed());
      }
    }

    // The hop cap, reached. An outcome like any other — the alternative, raising
    // from here, is precisely what the port contract forbids.
    return this.outcome('exhausted', '', state, clock.elapsed());
  }

  /**
   * One hop, with every failure flattened into a step.
   *
   * A rejected `AbortError` and a resolved `abortedStep()` are both correct
   * behaviour from an adapter under abort, and both arrive here; so does an
   * adapter that threw for a reason nobody anticipated. All three become a step,
   * because there is no layer above this one that could do anything better with a
   * throw.
   */
  private async hop(
    utterance: string,
    request: () => AgentTurnRequest,
    state: TurnState,
    transcript: AgentExchange[],
    signal: AbortSignal
  ): Promise<AgentStep> {
    const base = request();
    const turnRequest: AgentTurnRequest = {
      ...base,
      utterance,
      context: {
        ...base.context,
        // The revision comparison is this field's only honest source: nothing else
        // in the system can tell that the cart moved rather than what it now holds.
        cartChangedThisTurn: this.budget.cartRevision() !== state.startRevision,
      },
      transcript,
    };
    try {
      return await this.agent.next(turnRequest, signal);
    } catch {
      return { kind: 'declined' };
    }
  }

  /**
   * Run one hop's tool calls, all of them, and return their results together.
   *
   * One exchange for the whole round because splitting results across turns
   * degrades parallel tool use — the model asked for three things at once and has
   * to be answered that way.
   */
  private runTools(calls: readonly AgentToolCall[], state: TurnState): ToolRound {
    const results: AgentToolResult[] = [];
    for (const call of calls) {
      state.tools.push(call.name);
      const dispatched = this.dispatch(call, state);
      if (dispatched.declined) {
        // Stop where we stand: something outside this turn owns the cart now, and
        // the results already collected are answers to a question that has changed.
        return { results, declined: true };
      }
      results.push(dispatched.result!);
    }
    return { results, declined: false };
  }

  /**
   * One tool call: refuse it, run it, or stand the turn down.
   *
   * The three refusals are all *tool results* rather than aborts, because each is
   * something the model can act on — and a refusal it is not told about is a
   * refusal it will simply repeat on the next hop.
   */
  private dispatch(
    call: AgentToolCall,
    state: TurnState
  ): { result?: AgentToolResult; declined: boolean } {
    const executor = this.executorFor(call.name);
    if (!executor) {
      // The tool contract is a two-place agreement between a prompt and this table,
      // with no compiler between them. A name that does not exist is expected
      // traffic, not a crash.
      return { result: errorResult(call.id, 'unknown_tool'), declined: false };
    }

    const key = dedupKey(call);
    if (state.seen.has(key)) {
      return { result: errorResult(call.id, 'duplicate_call'), declined: false };
    }
    state.seen.add(key);

    if (!isMutating(call.name)) {
      return { result: { id: call.id, output: executor(call.input).output }, declined: false };
    }
    return this.mutate(call, executor, state);
  }

  /**
   * The executor for a name the model chose, or nothing.
   *
   * `call.name` is model-controlled and the table is indexed with it directly, so
   * the lookup has to ask whether the table **owns** the name rather than whether
   * anything answered to it. On a plain object literal `__proto__` resolves to
   * `Object.prototype` — truthy, and not callable — while `toString`, `valueOf` and
   * `constructor` resolve to inherited functions that would be *invoked* with a
   * model-supplied argument. Both outcomes leave `dispatch` throwing a `TypeError`
   * out of a method whose whole contract is that it returns a tool result, and out
   * of a `run()` whose whole contract is that it never rejects.
   *
   * `Object.hasOwn` is the guard even though `createClerkAgentTools` also hands back
   * a null-prototype table: this class takes any `ClerkAgentTools`, and the one
   * place a model-controlled string meets a property lookup should not depend on
   * how its caller built the object.
   */
  private executorFor(name: string): ClerkAgentTool | undefined {
    if (!Object.hasOwn(this.tools, name)) {
      return undefined;
    }
    const executor = (this.tools as Record<string, unknown>)[name];
    return typeof executor === 'function' ? (executor as ClerkAgentTool) : undefined;
  }

  /**
   * A mutating call, behind the two guards that protect the undo window.
   *
   * The revision guard catches anything that changed the cart since this turn last
   * looked. The pending-add guard is narrower and kept alongside it on purpose: an
   * add whose window is still open from *before* this turn started leaves the
   * revision untouched, and clobbering it would make a barcode add unundoable while
   * leaving its optimistic row standing as correct.
   */
  private mutate(
    call: AgentToolCall,
    executor: ClerkAgentTool,
    state: TurnState
  ): { result?: AgentToolResult; declined: boolean } {
    if (this.budget.cartRevision() !== state.expectedRevision) {
      return { declined: true };
    }
    const pending = this.budget.pendingAdd();
    if (pending !== null && pending !== state.ownPending) {
      return { declined: true };
    }
    if (state.cartChanges >= this.maxCartChanges) {
      return {
        result: {
          id: call.id,
          output: {
            error: 'one_cart_change_per_turn',
            message:
              'You already changed the cart this turn. Tell the cashier what is still ' +
              'outstanding, then stop.',
          },
          isError: true,
        },
        declined: false,
      };
    }

    // Clamped here, before the facade sees it, and floored at 1: the same rule the
    // spoken path applies, applied to a number that came off a model.
    const run = executor({ ...call.input, quantity: clampSpokenQuantity(quantityOf(call.input)) });
    if (run.changedCart) {
      state.cartChanges += 1;
      state.expectedRevision = this.budget.cartRevision();
      state.ownPending = this.budget.pendingAdd();
      const added = state.ownPending?.productId;
      if (added) {
        state.productIds.push(added);
      }
    }
    return { result: { id: call.id, output: run.output }, declined: false };
  }

  private outcome(
    kind: AgentOutcomeKind,
    speech: string,
    state: TurnState,
    ms: number
  ): AgentOutcome {
    return {
      kind,
      speech: kind === 'answered' ? speech : '',
      hops: state.hops,
      hopMs: [...state.hopMs],
      tools: [...state.tools],
      productIds: [...state.productIds],
      mutated: state.cartChanges > 0,
      ms,
    };
  }
}

/** Whether a tool name is one of the two that write. */
function isMutating(name: string): boolean {
  return (CLERK_AGENT_MUTATE_TOOLS as readonly string[]).includes(name);
}

/**
 * The identity of a call within one turn: name plus canonicalized input.
 *
 * Keys sorted and string values folded, because a model that asks the same question
 * twice rarely spells it identically the second time — and the point of the dedup
 * is that the second ask costs nothing, not that it costs less.
 */
function dedupKey(call: AgentToolCall): string {
  const canonical = Object.keys(call.input)
    .sort()
    .map((key) => {
      const value = call.input[key];
      return `${key}=${typeof value === 'string' ? value.trim().toLowerCase() : JSON.stringify(value)}`;
    })
    .join('&');
  return `${call.name}(${canonical})`;
}

function quantityOf(input: Readonly<Record<string, unknown>>): number {
  const raw = input['quantity'];
  return typeof raw === 'number' ? raw : 1;
}

/** A refusal the model may recover from, in the shape the port defines for one. */
function errorResult(id: string, error: ToolError): AgentToolResult {
  return { id, output: { error }, isError: true };
}

/**
 * An utterance shortened for an event payload.
 *
 * The bus feeds a HUD panel, not an audit trail: what matters is which phrase a
 * turn belonged to, and a whole monologue on every event is a cost with no reader.
 */
export function truncateUtterance(utterance: string): string {
  return utterance.length <= MAX_EVENT_UTTERANCE
    ? utterance
    : `${utterance.slice(0, MAX_EVENT_UTTERANCE)}…`;
}

/** Assistant blocks, for a caller that wants to hand a transcript on unchanged. */
export type { AgentBlock };
