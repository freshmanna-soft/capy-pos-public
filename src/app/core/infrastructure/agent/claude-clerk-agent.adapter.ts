import { Injectable, inject } from '@angular/core';
import { AUTH_GATEWAY } from '@core/application/auth/ports/auth-gateway.port';
import {
  AgentBlock,
  AgentStep,
  AgentToolCall,
  AgentTurnRequest,
  abortedStep,
  unavailableStep,
} from '@core/application/dtos/agent.dto';
import { ClerkAgent } from '@core/application/ports/clerk-agent.port';
import { environment } from '../../../../environments/environment';

/**
 * Backstop wall-clock ceiling for one hop.
 *
 * The turn runner derives its own `AbortSignal` from `DEADLINE_MS` (3.5s for
 * the whole turn, `agent-turn.runner.ts`) and passes it to `next()` — that is
 * the real cancellation path. This is only a backstop for a caller that
 * invokes `next()` with no signal at all, generous enough that it is never
 * what actually cancels a hop in normal operation.
 */
const REQUEST_TIMEOUT_MS = 10000;

/** Shape the relay is contracted to return. Validated, never trusted. */
interface RelayResponse {
  kind?: unknown;
  assistant?: unknown;
  calls?: unknown;
  speech?: unknown;
}

/**
 * ClaudeClerkAgentAdapter
 *
 * Sends one hop's request to this deployment's clerk-agent relay, which owns
 * the system prompt, the tool schemas, and the model call itself — see
 * infra/clerk-agent-relay/README.md. Active only when
 * `environment.features.clerkAgent` is true.
 *
 * Structurally mirrors `ClaudeVisionAdapter` for the same reason it exists:
 * the API key lives behind the relay, never in the browser bundle. Two things
 * differ because the port requires it:
 *
 * - Every failure path resolves `unavailableStep()`/`abortedStep()` rather
 *   than throwing, never `emptyRecognition()` — this is the agent port's own
 *   vocabulary, and the consequence of getting it wrong is sharper here:
 *   `next()` runs inside a speech-recognition callback, where a rejected
 *   promise is swallowed and reads to the cashier as the till doing nothing.
 * - The response is parsed into the `AgentStep` union's four kinds, not a
 *   fixed DTO shape — `tools`/`answer`/`declined`/`unavailable`, matching what
 *   `relay.ts`'s own `toStep()` produces server-side.
 */
@Injectable()
export class ClaudeClerkAgentAdapter implements ClerkAgent {
  readonly kind = 'claude';

  private readonly auth = inject(AUTH_GATEWAY);
  /**
   * An absolute `clerkAgentApiUrl` wins, so the relay can be pointed at a
   * locally running instance without dragging the rest of the app's API
   * along with it — mirrors `ClaudeVisionAdapter`'s `endpoint` exactly.
   */
  private readonly endpoint =
    environment.clerkAgentApiUrl.length > 0
      ? environment.clerkAgentApiUrl
      : `${environment.apiUrl}${environment.clerkAgentApiPath}`;

  async next(request: AgentTurnRequest, signal?: AbortSignal): Promise<AgentStep> {
    const timeout = new AbortController();
    const timer = setTimeout(() => timeout.abort(), REQUEST_TIMEOUT_MS);
    // Either the caller's own deadline/abandon or the backstop should cancel
    // the hop that's actually in flight.
    signal?.addEventListener('abort', () => timeout.abort(), { once: true });

    try {
      const response = await fetch(this.endpoint, {
        method: 'POST',
        signal: timeout.signal,
        headers: this.buildHeaders(),
        body: JSON.stringify({
          utterance: request.utterance,
          catalog: request.catalog,
          context: request.context,
          memory: request.memory,
          transcript: request.transcript,
        }),
      });

      if (!response.ok) {
        console.error(`[ClerkAgent] Relay returned ${response.status}`);
        return unavailableStep();
      }

      return this.parse((await response.json()) as RelayResponse);
    } catch (error) {
      // A caller abort (the turn deadline, or the cashier moving on) is a
      // normal cancellation, not a failure — the port requires abortedStep(),
      // never a thrown AbortError reaching the turn runner.
      if (signal?.aborted) {
        return abortedStep();
      }
      console.error('[ClerkAgent] Hop request failed:', error);
      return unavailableStep();
    } finally {
      clearTimeout(timer);
    }
  }

  private buildHeaders(): Record<string, string> {
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    const token = this.auth.getAccessToken();
    if (token) {
      headers['Authorization'] = `Bearer ${token}`;
    }
    return headers;
  }

  /**
   * Validate the relay's response into an `AgentStep`.
   *
   * Defensive on purpose: this is network input. An unrecognized `kind`, a
   * malformed tool call, or an assistant block that isn't an array all
   * resolve `unavailableStep()` rather than reach the turn runner as
   * something it has to trust.
   */
  private parse(body: RelayResponse): AgentStep {
    switch (body.kind) {
      case 'declined':
        return { kind: 'declined' };
      case 'tools': {
        const assistant = this.parseAssistant(body.assistant);
        const calls = assistant === null ? null : this.parseCalls(body.calls);
        if (assistant === null || calls === null || calls.length === 0) {
          return unavailableStep();
        }
        return { kind: 'tools', assistant, calls };
      }
      case 'answer': {
        const assistant = this.parseAssistant(body.assistant);
        if (
          assistant === null ||
          typeof body.speech !== 'string' ||
          body.speech.trim().length === 0
        ) {
          return unavailableStep();
        }
        return { kind: 'answer', assistant, speech: body.speech.trim() };
      }
      default:
        return unavailableStep();
    }
  }

  /**
   * Assistant blocks are held opaque and handed back as received — the
   * port's own contract for why: a typed mirror of Anthropic's block union
   * is a shape this client would get wrong the first time the API adds a
   * member. Only the array-ness is checked.
   */
  private parseAssistant(raw: unknown): AgentBlock[] | null {
    return Array.isArray(raw) ? (raw as AgentBlock[]) : null;
  }

  private parseCalls(raw: unknown): AgentToolCall[] | null {
    if (!Array.isArray(raw)) {
      return null;
    }
    const calls: AgentToolCall[] = [];
    for (const entry of raw) {
      const call = this.parseCall(entry);
      if (call === null) {
        return null;
      }
      calls.push(call);
    }
    return calls;
  }

  /**
   * `name` is checked only for being a non-empty string, not membership in
   * `CLERK_AGENT_TOOL_NAMES` — the port's own DTO comment is explicit that a
   * model can name a tool that doesn't exist, and the executor lookup
   * downstream is where that is caught, not here.
   */
  private parseCall(entry: unknown): AgentToolCall | null {
    if (typeof entry !== 'object' || entry === null) {
      return null;
    }
    const record = entry as Record<string, unknown>;
    const id = record['id'];
    const name = record['name'];
    const input = record['input'];

    if (typeof id !== 'string' || id.length === 0) {
      return null;
    }
    if (typeof name !== 'string' || name.length === 0) {
      return null;
    }
    if (typeof input !== 'object' || input === null) {
      return null;
    }
    return { id, name, input: input as Record<string, unknown> };
  }
}
