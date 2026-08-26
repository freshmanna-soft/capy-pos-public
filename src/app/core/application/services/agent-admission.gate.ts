/**
 * Agent admission — the gate that decides whether an utterance is worth a model
 * turn at all.
 *
 * It exists because the ear is not a button. `SpeechRecognitionService` runs with
 * `recognition.continuous = true` and forwards **every** final result, so a
 * counter conversation, a customer three feet away and a recognizer re-firing the
 * same fragment all arrive looking exactly like a question addressed to the till.
 * Each one that reaches the runner is one to four model hops carrying the whole
 * catalogue.
 *
 * Pure, clock-injected and stateless, like `candidate-ranking.ts`: the decision is
 * a function of the utterance, a state record the caller owns, and the time. The
 * caller advances that record through `recordAdmittedTurn` once it has actually
 * spent a turn, so a refusal costs nothing and cannot corrupt the counters.
 *
 * Every refusal is *counted* by the caller, tagged with the reason below. A silent
 * refusal that left no trace would make "spend is bounded per session"
 * unfalsifiable and a mistuned threshold indistinguishable from a quiet shop.
 */

/**
 * Fewest words an utterance may have and still be a request.
 *
 * Three, because the two-word floor still admits the whole of ambient counter
 * speech — "yeah okay", "that's fine", "one second" — while every real question
 * for the till carries a verb, an object and usually a courtesy.
 */
export const MIN_WORDS = 3;

/**
 * Fewest characters, checked alongside the word count rather than instead of it.
 *
 * Three very short words — "yes ok fine", eleven characters — is agreement being
 * voiced at the counter, not a question for the till, and the word count alone
 * cannot tell it from three ordinary ones. Erring towards refusal is deliberate:
 * a refused question costs the cashier one repetition, and every refusal is
 * counted by reason, so a floor set too high is visible rather than merely quiet.
 */
export const MIN_CHARS = 12;

/**
 * Turns per rolling minute.
 *
 * Sized against a busy counter rather than against a demo: six open-ended
 * questions in a minute is already more conversation than a queue allows, and the
 * seventh in the same minute is far more likely to be the room talking than the
 * cashier.
 */
export const MAX_TURNS_PER_MINUTE = 6;

/** The rolling window the per-minute cap slides over. */
export const RATE_WINDOW_MS = 60_000;

/**
 * Turns per session, where a session is one visit to `/clerk`.
 *
 * The hard ceiling on what one shift can spend without anyone noticing. Reset by
 * `start()` and `stop()`, never persisted.
 */
export const MAX_TURNS_PER_SESSION = 40;

/**
 * How long the same words are treated as the same request.
 *
 * A stuck recognizer re-delivering an identical final result is the failure this
 * catches, and it re-delivers within a second or two. Eight seconds also covers
 * the cashier repeating herself because the first answer had not arrived yet —
 * which is a reason to wait, not a reason to bill twice.
 */
export const REPEAT_WINDOW_MS = 8000;

/** Why an utterance was not worth a turn. One series per reason, when counted. */
export type AgentAdmissionRefusal = 'too_short' | 'rate_limited' | 'session_cap' | 'repeat';

export type AgentAdmission = { admit: true } | { admit: false; reason: AgentAdmissionRefusal };

/**
 * The counters a session accumulates, owned by the caller.
 *
 * Held in the caller's private state rather than in a module-level singleton: the
 * facade is `providedIn: 'root'` and outlives the route, so a session's budget has
 * to be something it can throw away and rebuild at `start()`.
 */
export interface AgentAdmissionState {
  /** When each admitted turn was let through, oldest first. */
  admittedAt: number[];
  /** Every admitted turn this session, including those the rolling window forgot. */
  sessionTurns: number;
  /** The last utterance admitted, normalized, and when. */
  lastUtterance: string | null;
  lastUtteranceAt: number;
}

/** A fresh session's counters. */
export function emptyAdmissionState(): AgentAdmissionState {
  return { admittedAt: [], sessionTurns: 0, lastUtterance: null, lastUtteranceAt: 0 };
}

/**
 * Normalize for comparison only.
 *
 * Case, punctuation and runs of whitespace are all things a recognizer varies
 * between two deliveries of the same fragment, so a repeat check that respected
 * them would miss the case it exists for.
 */
export function normalizeUtterance(utterance: string): string {
  return utterance
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Whether this utterance may be paid for.
 *
 * The order of the checks is the order of the reasons a caller most needs to see.
 * `too_short` first, because it needs no state and is the overwhelming majority.
 * `session_cap` before `rate_limited`, because a session at its ceiling is also
 * trivially at its per-minute ceiling and the ceiling that actually stopped it is
 * the useful one. `repeat` last, so a duplicate arriving at a cap is reported as
 * the cap it hit.
 */
export function admitAgentTurn(
  utterance: string,
  state: AgentAdmissionState,
  now: number
): AgentAdmission {
  const normalized = normalizeUtterance(utterance);
  const words = normalized.length === 0 ? [] : normalized.split(' ');
  if (words.length < MIN_WORDS || normalized.length < MIN_CHARS) {
    return { admit: false, reason: 'too_short' };
  }
  if (state.sessionTurns >= MAX_TURNS_PER_SESSION) {
    return { admit: false, reason: 'session_cap' };
  }
  const recent = state.admittedAt.filter((at) => now - at < RATE_WINDOW_MS);
  if (recent.length >= MAX_TURNS_PER_MINUTE) {
    return { admit: false, reason: 'rate_limited' };
  }
  if (state.lastUtterance === normalized && now - state.lastUtteranceAt < REPEAT_WINDOW_MS) {
    return { admit: false, reason: 'repeat' };
  }
  return { admit: true };
}

/**
 * Spend one turn's worth of budget.
 *
 * Separate from the decision so the decision stays pure, and called only once the
 * caller has really started a turn — a gate that charged for its own refusals
 * would ratchet itself shut on a shop that was never listened to.
 *
 * The rolling window is pruned here rather than on read, so the array cannot grow
 * for the length of a shift.
 */
export function recordAdmittedTurn(
  state: AgentAdmissionState,
  utterance: string,
  now: number
): void {
  state.admittedAt = [...state.admittedAt.filter((at) => now - at < RATE_WINDOW_MS), now];
  state.sessionTurns += 1;
  state.lastUtterance = normalizeUtterance(utterance);
  state.lastUtteranceAt = now;
}
