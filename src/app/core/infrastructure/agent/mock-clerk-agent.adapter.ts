import { Injectable } from '@angular/core';
import {
  AgentStep,
  AgentToolCall,
  AgentToolName,
  AgentTurnRequest,
  abortedStep,
  unavailableStep,
} from '@core/application/dtos/agent.dto';
import { ClerkAgent } from '@core/application/ports/clerk-agent.port';

/**
 * How long a fake hop takes, so the HUD exercises its real loading states. The
 * simulated latency is the only nondeterminism in this adapter.
 */
export const MOCK_MIN_LATENCY_MS = 400;
export const MOCK_MAX_LATENCY_MS = 900;

/**
 * How many hops one mock turn ever takes.
 *
 * Strictly below the turn runner's hop cap of three, so exhausting the cap is
 * never the mock's fault and every mock turn keeps a hop in hand to answer in.
 */
export const MOCK_MAX_HOPS_PER_TURN = 2;

/**
 * The worst case for one whole mock turn, on a real clock.
 *
 * Exported so a budget spec can assert `deadlineMs > MOCK_TURN_BUDGET_MS` and an
 * e2e can wait on a stated number, instead of both restating an implied one.
 */
export const MOCK_TURN_BUDGET_MS = MOCK_MAX_HOPS_PER_TURN * MOCK_MAX_LATENCY_MS;

/** How many turns the published rotation takes to come back round. */
export const MOCK_ROTATION_PERIOD = 4;

/**
 * The one read call and the one mutate call the rotation makes. Typed as
 * `AgentToolName` so a name that drifts out of the shared tuples fails to
 * compile here rather than at a missing executor later.
 */
const MOCK_READ_TOOL: AgentToolName = 'check_stock';
const MOCK_MUTATE_TOOL: AgentToolName = 'add_by_name';

/**
 * MockClerkAgent
 *
 * The agent used when `environment.features.clerkAgent` is off — every
 * environment today. It lets the whole agentic clerk path run with no API key, no
 * network and no cost, which matters for three reasons: the unit and e2e suites
 * need an agent with fixed output, a demo needs to work on a plane, and the HUD
 * needs a way to reach every step kind on demand.
 *
 * Deterministic rather than random, and indexed by **(turn, hop)** rather than by
 * call count. The hop comes from `request.transcript.length` — which doubles as a
 * check that the caller is feeding the transcript back — and the internal turn
 * counter advances only when the hop is 0. Indexing on a bare call count would
 * make what the mock does on the cashier's *second* phrase depend on how many
 * hops the first phrase happened to take, which is unusable as a fixture.
 *
 * The published rotation, period four, is a contract other stories depend on:
 *
 *   turn ≡ 0 (mod 4): hop 0 → tools, one read call; hop 1 → answer
 *   turn ≡ 1 (mod 4): hop 0 → tools, one mutate call; hop 1 → answer
 *   turn ≡ 2 (mod 4): hop 0 → answer, no tools
 *   turn ≡ 3 (mod 4): hop 0 → declined
 *
 * Answers come from `request.context` and `request.catalog` only, so this adapter
 * has zero constructor dependencies — it needs no repository to talk about a cart
 * the caller already described.
 */
@Injectable()
export class MockClerkAgent implements ClerkAgent {
  readonly kind = 'demo';

  /** -1 until the first hop 0 arrives, so the first turn is turn 0. */
  private turnIndex = -1;

  async next(request: AgentTurnRequest, signal?: AbortSignal): Promise<AgentStep> {
    await this.pause(signal);
    if (signal?.aborted) {
      return abortedStep();
    }

    if (request.catalog.length === 0) {
      return unavailableStep();
    }

    // Neither guard above consumes a rotation slot: an aborted or unanswerable hop
    // is not a mock turn, so the rotation stays readable across one.
    const hop = request.transcript.length;
    if (hop === 0) {
      this.turnIndex++;
    }
    const turn = Math.max(0, this.turnIndex);

    // Defensive arm. A caller that overran the published shape still gets a step
    // it can finish on, so the mock can never drive one into hop-cap exhaustion.
    if (hop >= MOCK_MAX_HOPS_PER_TURN) {
      return this.answer(request);
    }
    // Hop 1 closes the two-hop arms of the rotation.
    if (hop > 0) {
      return this.answer(request);
    }

    switch (turn % MOCK_ROTATION_PERIOD) {
      case 0:
        return this.tools(request, MOCK_READ_TOOL, turn, hop);
      case 1:
        return this.tools(request, MOCK_MUTATE_TOOL, turn, hop);
      case 2:
        return this.answer(request);
      default:
        return { kind: 'declined' };
    }
  }

  /**
   * One tool call, named from the shared tuples and with an id derived from the
   * rotation coordinates so a transcript is assertable and stable across runs.
   */
  private tools(
    request: AgentTurnRequest,
    name: AgentToolName,
    turn: number,
    hop: number
  ): AgentStep {
    const hint = request.catalog[turn % request.catalog.length]!;
    const call: AgentToolCall = {
      id: `mock-tool-${turn}-${hop}`,
      name,
      input: { name: hint.name },
    };
    return {
      kind: 'tools',
      assistant: [
        { type: 'text', text: 'Let me check.' },
        { type: 'tool_use', ...call },
      ],
      calls: [call],
    };
  }

  /**
   * A fixed short sentence built from the live context: well within the speech
   * budget, and free of markdown, emoji, URLs, SKUs and ids, so the mock is a
   * valid fixture for the sanitizer's specs rather than something the sanitizer
   * has to fix.
   */
  private answer(request: AgentTurnRequest): AgentStep {
    const { totalItems, total } = request.context;
    const speech =
      totalItems === 0
        ? 'Nothing in the cart yet, so there is nothing to total.'
        : `That is ${totalItems} ${totalItems === 1 ? 'item' : 'items'}, ${total.toFixed(2)} in total.`;
    return { kind: 'answer', assistant: [{ type: 'text', text: speech }], speech };
  }

  /**
   * Simulated round-trip. Resolves early on abort and clears its timer, so a
   * cancelled turn does not hold one open for the better part of a second.
   */
  private pause(signal?: AbortSignal): Promise<void> {
    const ms = MOCK_MIN_LATENCY_MS + Math.random() * (MOCK_MAX_LATENCY_MS - MOCK_MIN_LATENCY_MS);
    return new Promise<void>((resolve) => {
      const timer = setTimeout(resolve, ms);
      signal?.addEventListener(
        'abort',
        () => {
          clearTimeout(timer);
          resolve();
        },
        { once: true }
      );
    });
  }
}
