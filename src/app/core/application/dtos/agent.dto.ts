/**
 * Agent DTOs — the wire shape between the clerk and whatever answers the phrases
 * the deterministic parser could not name.
 *
 * These live in the application layer for the same reason the recognition DTOs
 * do: both the port and its adapters depend on them, and neither should import
 * from the other.
 *
 * One vocabulary note, fixed here so the rest of the epic does not re-litigate
 * it. Nothing on this path carries an actor field: the agent supplies *words*,
 * the existing deterministic resolver still picks the product. A facade-side
 * choice or log row written after an agent turn uses the actor value
 * `'assistant'`; there is no `'agent'` origin value anywhere. For the same
 * reason `RecognitionTier` gains no fourth member — an agent-driven add inherits
 * `tier = null` exactly as a spoken add does, because nothing recognized
 * anything.
 */
import { CatalogHint } from '@core/application/dtos/recognition.dto';

/**
 * One opaque block of an assistant turn.
 *
 * Deliberately untyped. On `claude-opus-5` an assistant turn can carry thinking
 * blocks that must round-trip byte-identical on the next hop, and a typed mirror
 * of the block union is a shape we would get wrong the first time the API adds a
 * member. No client may normalize, re-serialize or field-strip an assistant
 * block: hold it as received and hand it back as received.
 */
export type AgentBlock = Readonly<Record<string, unknown>>;

/** One tool the model asked for. */
export interface AgentToolCall {
  /** The Anthropic `tool_use.id`, echoed back so results pair with calls. */
  id: string;
  /**
   * Kept as `string` rather than `AgentToolName`: a model can name a tool that
   * does not exist, and the executor lookup is where that is caught. The tuples
   * below are the source of truth for what *should* arrive.
   */
  name: string;
  /** Already parsed — no caller has to `JSON.parse` an argument blob. */
  input: Readonly<Record<string, unknown>>;
}

/** What running one tool produced. */
export interface AgentToolResult {
  /** The `AgentToolCall.id` this answers. */
  id: string;
  /**
   * Pre-summarized: counted, named, rounded facts, never a record. A tool that
   * hands back a product row makes the clerk read a product row aloud.
   */
  output: Readonly<Record<string, unknown>>;
  /**
   * A failure the model may recover from ("no such product"), **not** an
   * exception. Nothing on this path throws.
   */
  isError?: boolean;
}

/**
 * One completed hop: what the model said, and what its tools answered.
 *
 * Held by the caller so the port stays stateless. Two properties matter to
 * anyone building one:
 *
 * - All of a hop's results go back in **one** user turn. Splitting them across
 *   turns degrades parallel tool use.
 * - `transcript.length` **is** the hop index, which is why an implementation may
 *   key its behaviour on it — the mock adapter does exactly that.
 */
export interface AgentExchange {
  assistant: AgentBlock[];
  results: AgentToolResult[];
}

/** What one earlier turn in this session did. Tool *names* only — a logged catalog is not an audit line. */
export interface AgentMemory {
  phrase: string;
  tools: string[];
  productIds: string[];
}

/** One line of the cart, as the agent is allowed to see it. */
export interface AgentCartLine {
  name: string;
  quantity: number;
}

/** One candidate currently on offer to the cashier, by the position she can say. */
export interface AgentOfferLine {
  position: number;
  label: string;
}

/**
 * The till as it stands right now.
 *
 * **Volatile: rebuilt per hop from live signals, never cached.** The sample timer
 * runs at 125ms and the barcode gate dwells 300ms, so a barcode add can land
 * between two hops of the same turn; a context captured once at the top of the
 * turn would describe a cart that no longer exists.
 */
export interface AgentTurnContext {
  cartLines: readonly AgentCartLine[];
  totalItems: number;
  total: number;
  offer: readonly AgentOfferLine[];
  cartChangedThisTurn: boolean;
}

/** One request for one model hop. */
export interface AgentTurnRequest {
  /** What the cashier said, verbatim, after the parser declined to name it. */
  utterance: string;
  /**
   * Reuses `CatalogHint` from the vision path on purpose — there is no second
   * catalog shape in this codebase.
   */
  catalog: CatalogHint[];
  context: AgentTurnContext;
  /**
   * The turns before this one, oldest first; empty on the first phrase of a
   * session. A list rather than a single record because `phrase` is singular:
   * one `AgentMemory` is one earlier turn, the way one `AgentExchange` is one
   * hop.
   */
  memory: readonly AgentMemory[];
  /** This turn's completed hops, oldest first. Length is the hop index. */
  transcript: AgentExchange[];
}

/**
 * The outcome of one model hop.
 *
 * `declined` is a refusal — HTTP 200 with empty content, the model choosing not
 * to answer. `unavailable` is the network being down, a non-200, or a body that
 * would not parse. Neither is ever an exception, and neither carries speech,
 * exactly as `emptyRecognition('')` already means "say nothing" on the vision
 * path.
 */
export type AgentStep =
  | { kind: 'tools'; assistant: AgentBlock[]; calls: AgentToolCall[] }
  | { kind: 'answer'; assistant: AgentBlock[]; speech: string }
  | { kind: 'declined' }
  | { kind: 'unavailable' };

/** The "we could not reach the model" step. Never throw; return this. */
export function unavailableStep(): AgentStep {
  return { kind: 'unavailable' };
}

/**
 * The step a hop resolves to when the caller aborts.
 *
 * A caller abort is normal — the deadline passed, or the cashier moved on — not
 * a failure, so it must produce no speech. `declined` is that shape.
 */
export function abortedStep(): AgentStep {
  return { kind: 'declined' };
}

/**
 * The speech budget for one answer, in words.
 *
 * A number rather than prose because two later stories have to assert against
 * it. It exists because the barge-in effect pauses the ear for the whole
 * utterance: a long answer deafens the till during exactly the window the
 * cashier is most likely to correct it.
 *
 * **Enforcement is not here.** The sanitizer that trims to this budget — at the
 * last sentence boundary, never mid-word — belongs to the turn runner. It also
 * cannot be pushed down into the tool schema, because structured outputs do not
 * support `maxLength`.
 */
export const MAX_SPEECH_WORDS = 40;

/**
 * Tool names, as one source of truth.
 *
 * The relay will own the tool *schemas* and the browser will own the *executors*
 * keyed by name, with no compiler between them — the same silent-drift class
 * `RECOGNITION_SCHEMA` and `ProxyResponse` already live with. One exported tuple
 * is the cheapest guard available: both sides import it, and both suites can
 * assert against it.
 *
 * The read/mutate split is what makes one-cart-change accounting assertable
 * without a second hand-maintained list. Names only — no schemas and no
 * executors live here.
 */
export const CLERK_AGENT_READ_TOOLS = [
  'look_up_product',
  'read_cart',
  'check_stock',
  'read_offer',
] as const;

export const CLERK_AGENT_MUTATE_TOOLS = ['add_by_name', 'remove_by_name'] as const;

export const CLERK_AGENT_TOOL_NAMES = [
  ...CLERK_AGENT_READ_TOOLS,
  ...CLERK_AGENT_MUTATE_TOOLS,
] as const;

/** Every name a well-behaved model may ask for. */
export type AgentToolName = (typeof CLERK_AGENT_TOOL_NAMES)[number];
