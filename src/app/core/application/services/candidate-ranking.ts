import { VisionCandidate } from '@core/application/dtos/recognition.dto';

/**
 * Confidence at or above which an item goes straight into the cart.
 *
 * Set from the cost of being wrong. Below this the clerk asks, which costs the
 * cashier a tap; above it she acts, which can overcharge a customer. 0.85 keeps
 * the silent-mistake rate low, and the undo window covers what gets through.
 */
export const AUTO_ADD_CONFIDENCE = 0.85;

/** Below this, candidates aren't worth showing — she asks for another look. */
export const CONSIDER_CONFIDENCE = 0.5;

/**
 * How close two candidates have to be before the gap between them is meaningless.
 *
 * Confidence is not precise to two decimal places. A 0.93 against a 0.91 is not
 * evidence that the first is right; it is two guesses that happen to have been
 * written down in that order.
 */
export const AMBIGUITY_MARGIN = 0.05;

/** Confidence a demoted top candidate is capped at — safely inside the ask band. */
const DEMOTED_CONFIDENCE = 0.8;

/**
 * Rank candidates, and refuse to let a near-tie act on its own.
 *
 * This is the rule that stops the till buying whichever product the recogniser
 * happened to list first. Sorting alone does not do it: when the top two are
 * effectively tied, sorting still produces a winner, and that winner is decided by
 * array order — which is chance. The customer pays for the chance.
 *
 * So a top candidate within `AMBIGUITY_MARGIN` of the runner-up is capped below the
 * auto-add threshold. Nothing is discarded and nothing is reordered beyond the sort:
 * the effect is only that the clerk asks instead of assuming, which is the outcome
 * the confidence bands already handle well.
 *
 * Deliberately not in the proxy. The proxy's prompt asks for distinct confidences,
 * but a prompt is a request, not a guarantee — and this threshold is the client's,
 * so the client is where it has to be enforced. It also then covers every tier that
 * produces candidates, not just the model.
 */
export function rankCandidates(candidates: readonly VisionCandidate[]): VisionCandidate[] {
  const sorted = [...candidates]
    .map((candidate) => ({
      ...candidate,
      confidence: Math.min(1, Math.max(0, candidate.confidence)),
    }))
    .sort((a, b) => b.confidence - a.confidence);

  const [top, runnerUp] = sorted;
  if (!top || !runnerUp) {
    return sorted;
  }

  if (
    top.confidence >= AUTO_ADD_CONFIDENCE &&
    top.confidence - runnerUp.confidence < AMBIGUITY_MARGIN
  ) {
    sorted[0] = { ...top, confidence: DEMOTED_CONFIDENCE };
  }
  return sorted;
}

/** Whether a ranked list is confident enough to act on without asking. */
export function isCertain(candidates: readonly VisionCandidate[]): boolean {
  return (candidates[0]?.confidence ?? 0) >= AUTO_ADD_CONFIDENCE;
}

/**
 * Who confirmed a choice between candidates.
 *
 * `'agent'` rather than `'assistant'` deliberately: `assistant` is already the
 * Anthropic message role in the agentic-clerk DTOs, so `confirmedBy: 'assistant'`
 * would read as "the model said this" at a glance rather than "the model picked
 * this". Every other name in that tier is already `agent`.
 */
export type ChoiceActor = 'cashier' | 'agent';

/**
 * Whether a confirmed choice is worth a recognition-log row.
 *
 * A `'chosen'` / `'corrected'` row is a claim about two parties at once: a
 * *recognizer* proposed a ranking, and a *human* agreed with it or corrected it.
 * Those rows are the ground truth every accuracy figure for a tier is measured
 * against, so a row written when either half is missing does not merely add noise
 * — it silently moves the number the recognizer is judged by.
 *
 * Both halves therefore have to hold. `proposedBy === 'model'` covers the
 * proposal: a spoken "add a coffee" put the cards up itself, so there is no
 * ranking to score. `confirmedBy === 'cashier'` covers the confirmation: an agent
 * picking a card is agreeing with a recognizer on the customer's behalf, and one
 * turn later it is worse than that — the agent steers the cashier onto card 2, she
 * says "the sparkling one", and the resulting `'corrected'` row measures agreement
 * with the *agent* rather than with the recognizer.
 *
 * Suppressing that row is not optional and not a policy knob. A caller that wants
 * the row anyway is asking to forge audit evidence, which is why this is a
 * predicate over both axes rather than a flag either side can pass.
 *
 * Lives here for the reason `rankCandidates` already gives: the client owns these
 * thresholds, and a rule kept here covers every tier that produces candidates
 * rather than only the one it was written for.
 */
export function shouldScoreChoice(
  proposedBy: 'model' | 'voice',
  confirmedBy: ChoiceActor
): boolean {
  return proposedBy === 'model' && confirmedBy === 'cashier';
}
