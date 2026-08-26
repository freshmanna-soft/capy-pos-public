import { InjectionToken } from '@angular/core';
import { AgentStep, AgentTurnRequest } from '@core/application/dtos/agent.dto';

/**
 * ClerkAgent Port
 *
 * Swap seam for the phrases the deterministic parser could not name. The clerk's
 * language path is a cascade — barcode, then the keyword parser, then this — and
 * an agent fires only from the parser's `default:` arm. The head of the
 * distribution ("yes", "two", "undo", "total", "add a coffee") stays at zero
 * tokens, sub-millisecond and offline; only the tail pays.
 *
 * Mirrors the VisionRecognizer port convention: interface here in the
 * application layer, implementations in infrastructure, bound once through the
 * token below.
 *
 * **One model hop, not one turn.** `next()` returns a single `AgentStep`. The
 * loop around it — wall-clock deadline, hop cap, tool dispatch, quantity
 * clamping, dedup — is application policy and lives in its own plain class beside
 * `FrameGate`, `BarcodeGate` and `LookScheduler`, for the reason
 * `rankCandidates` gives about its own threshold: a prompt is a request, not a
 * guarantee, and these limits are the client's. Keeping the loop out of the
 * adapter is also what lets the mock be a fixed rotation of steps rather than a
 * second implementation of the loop.
 *
 * Implementations MUST NOT throw for ordinary failures (network down, non-200,
 * unparseable body, model declined). The consequence here is sharper than on the
 * vision path: this runs inside a speech-recognition callback, where a rejected
 * promise is swallowed and reads to the cashier as the till doing nothing at all.
 * Return `unavailableStep()` and let the facade decide what to say — which, for
 * this tier, is nothing.
 */
export interface ClerkAgent {
  /**
   * Take one model hop.
   *
   * @param request The utterance, the catalog, the live till context, and this
   * turn's completed hops. `request.transcript.length` is the hop index.
   * @param signal Aborts an in-flight hop.
   *
   * The signal is a requirement, not a courtesy. It is how the caller's
   * wall-clock deadline and the cashier moving on both reach a hop that is
   * already in flight, so an implementation MUST check it at every `await`
   * boundary, MUST abandon any in-flight I/O when it fires, and MUST resolve
   * `abortedStep()` — never throw an `AbortError`, and never resolve a step that
   * carries speech. Get this wrong and the only cancellation left is an
   * adapter-side request timeout, which is long enough that a hop still running
   * after the deadline can mutate the cart outside the undo window the turn
   * budget was sized for. Deriving the signal from a deadline belongs to the
   * caller; honouring it belongs to every adapter.
   */
  next(request: AgentTurnRequest, signal?: AbortSignal): Promise<AgentStep>;

  /** Short label for the status line, e.g. 'demo' or 'claude'. */
  readonly kind: string;
}

export const CLERK_AGENT = new InjectionToken<ClerkAgent>('CLERK_AGENT');
