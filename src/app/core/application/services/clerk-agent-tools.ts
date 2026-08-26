import { AgentCartLine, AgentOfferLine, AgentToolName } from '@core/application/dtos/agent.dto';
/**
 * Type-only, and written as `import type` on purpose: the facade imports this
 * module's factory, so a value import here would close a runtime cycle between the
 * two. Restating the two outcome shapes locally would be the other way out, and
 * the wrong one — they are the facade's account of its own writes.
 */
import type { SpokenAddOutcome, SpokenRemoveOutcome } from '@core/application/facades/clerk.facade';
import { Product } from '@core/domain/entities/product.entity';

/**
 * How many entries any list a tool returns may carry.
 *
 * Small on purpose. A tool result is something the clerk may end up reading aloud,
 * and the speech budget is forty words — so a twenty-line cart handed back in full
 * is not more context, it is an answer that gets truncated mid-sentence. Anything
 * capped says so through `truncated`, because a silently shortened list is a list
 * the model will confidently describe as complete.
 */
export const MAX_TOOL_LIST = 5;

/** What `resolveSpokenName` answers, as the tool layer is allowed to see it. */
export type SpokenResolution =
  | { kind: 'none' }
  | { kind: 'one'; product: Product }
  | { kind: 'ambiguous'; products: Product[] };

/**
 * The narrow window the facade opens onto itself for the tool table.
 *
 * Every member is a closure the facade constructs, which is the whole point:
 * `addByName`, `removeByName`, `say` and `setMood` stay **private** on
 * `ClerkFacade`. The moment `addByName` is public, "every write to the cart goes
 * through one path" stops being a structure and becomes a comment — anything
 * holding the facade could ring up a sale attributed to a model.
 *
 * Deliberately absent: anything that clears the cart, takes the sale to payment,
 * chooses a candidate, toggles a device, or does arithmetic. Each omission is a
 * decision, not an oversight — see the port's notes on why a model-authored choice
 * has no actor value to be written under.
 */
export interface ClerkAgentToolDeps {
  /**
   * The one resolver over the catalogue, reached rather than reimplemented.
   *
   * A second ranking here would be a second answer to "what did she just name",
   * and the two would drift on the first tweak to either.
   */
  resolveSpokenName(query: string[]): SpokenResolution;
  cartLines(): readonly AgentCartLine[];
  totalItems(): number;
  /**
   * The cart total, already formatted for speech.
   *
   * A string, and passed through verbatim, because no arithmetic on money happens
   * anywhere in this layer: the tool reports the figure the terminal computed.
   */
  formattedTotal(): string;
  /** How many of a product are already on this sale. */
  inCart(productId: string): number;
  /** The candidate cards on screen, by the position the cashier can say. */
  offer(): readonly AgentOfferLine[];
  /** The facade's private `addByName`, already attributed to the agent. */
  addByName(query: string[], quantity: number): SpokenAddOutcome;
  /** The facade's private `removeByName`. */
  removeByName(query: string[], quantity: number): SpokenRemoveOutcome;
}

/**
 * One tool call's result, plus the accounting the caller needs and the model
 * never sees.
 *
 * `changedCart` is the honest source for the one-cart-change-per-turn budget: an
 * add that resolved to nothing, or to three equally likely products, spoke and put
 * cards up but did not touch the sale, so it must not spend the budget that
 * protects the undo window.
 */
export interface ClerkAgentToolRun {
  /** What the model is told. Counted, named, rounded facts — never a product row. */
  output: Readonly<Record<string, unknown>>;
  /** Whether this call really changed the contents of the cart. */
  changedCart?: boolean;
}

export type ClerkAgentTool = (input: Readonly<Record<string, unknown>>) => ClerkAgentToolRun;

/**
 * Every executor, keyed by the name the model asks for.
 *
 * A total map over `AgentToolName` so a name added to the shared tuples fails to
 * compile here rather than at a missing executor in front of a cashier.
 */
export type ClerkAgentTools = Readonly<Record<AgentToolName, ClerkAgentTool>>;

/**
 * Build the tool table over one facade's privates.
 *
 * A factory rather than an `@Injectable`, for the same reason `FrameGate` and
 * `LookScheduler` are plain classes: the table closes over methods DI has no way
 * to hand out, so there is nothing for an injector to give it.
 *
 * Every executor is synchronous and offline. The reads are signal reads against a
 * catalogue already loaded at `start()`, so no tool can add latency to a turn that
 * is already racing a wall-clock deadline, and none of them can fail in a way the
 * model has to be told about beyond the `found: false` it asked for.
 */
export function createClerkAgentTools(deps: ClerkAgentToolDeps): ClerkAgentTools {
  return {
    look_up_product: (input) => lookUpProduct(deps, spokenWords(input)),
    read_cart: () => readCart(deps),
    check_stock: (input) => checkStock(deps, spokenWords(input)),
    read_offer: () => readOffer(deps),
    add_by_name: (input) => {
      const outcome = deps.addByName(spokenWords(input), quantityOf(input));
      return { output: countedFact(outcome), changedCart: outcome.added > 0 };
    },
    remove_by_name: (input) => {
      const outcome = deps.removeByName(spokenWords(input), quantityOf(input));
      return { output: countedFact(outcome), changedCart: outcome.removed > 0 };
    },
  };
}

/**
 * One mutation's outcome, as the model is told it.
 *
 * The facade's own counts, under the facade's own names, so what the model reads is
 * literally what the write reported rather than a second summary of it. The only
 * edit is dropping an absent `reason`: `addByName` sets the key to `undefined` on a
 * clean write, and a key whose value is the word "undefined" is the kind of thing a
 * model will try to explain to a cashier.
 */
function countedFact(outcome: { reason?: string }): Readonly<Record<string, unknown>> {
  const fact: Record<string, unknown> = { ...outcome };
  if (!outcome.reason) {
    delete fact['reason'];
  }
  return fact;
}

/**
 * The words of a `name` argument, as the resolver wants them.
 *
 * Tolerant by necessity: `input` came off a model, so `name` may be missing, may
 * not be a string, and may carry punctuation or double spaces. An empty array is a
 * valid answer — it resolves to nothing, which is exactly what a nameless lookup
 * should report.
 */
function spokenWords(input: Readonly<Record<string, unknown>>): string[] {
  const raw = input['name'];
  if (typeof raw !== 'string') {
    return [];
  }
  return raw
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((word) => word.length > 0);
}

/**
 * The `quantity` argument as a number, before clamping.
 *
 * The clamp itself belongs to the runner, which applies `clampSpokenQuantity` to
 * the input before dispatch — so this only has to turn "missing" and "not a
 * number" into something the clamp can floor.
 */
function quantityOf(input: Readonly<Record<string, unknown>>): number {
  const raw = input['quantity'];
  return typeof raw === 'number' ? raw : 1;
}

/** Names only, capped, with the cap declared. */
function namesOf(products: readonly Product[]): { names: string[]; truncated: boolean } {
  return {
    names: products.slice(0, MAX_TOOL_LIST).map((product) => product.name),
    truncated: products.length > MAX_TOOL_LIST,
  };
}

/**
 * Is it in the catalogue, and at what price.
 *
 * The ambiguous arm hands back the tied *names* rather than picking one, so the
 * model's next move is a question to the cashier instead of a guess — the same
 * shape the spoken path already takes when it puts cards up.
 */
function lookUpProduct(deps: ClerkAgentToolDeps, query: string[]): ClerkAgentToolRun {
  const resolved = deps.resolveSpokenName(query);
  if (resolved.kind === 'none') {
    return { output: { found: false, heard: query.join(' ') } };
  }
  if (resolved.kind === 'ambiguous') {
    const { names, truncated } = namesOf(resolved.products);
    return { output: { found: false, ambiguous: true, alternatives: names, truncated } };
  }
  const product = resolved.product;
  return {
    output: {
      found: true,
      name: product.name,
      price: product.price,
      stock: product.stock,
    },
  };
}

/** What is on the sale right now, in the words the clerk would use for it. */
function readCart(deps: ClerkAgentToolDeps): ClerkAgentToolRun {
  const lines = deps.cartLines();
  return {
    output: {
      lines: lines.slice(0, MAX_TOOL_LIST),
      truncated: lines.length > MAX_TOOL_LIST,
      totalItems: deps.totalItems(),
      total: deps.formattedTotal(),
    },
  };
}

/**
 * How many can still go in.
 *
 * `canAdd` is stock less what is already on this sale, floored at zero — the same
 * subtraction `tryAddToCart` makes before it refuses, answered here so the model
 * can decline before spending a mutation on a refusal.
 */
function checkStock(deps: ClerkAgentToolDeps, query: string[]): ClerkAgentToolRun {
  const resolved = deps.resolveSpokenName(query);
  if (resolved.kind !== 'one') {
    const alternatives = resolved.kind === 'ambiguous' ? namesOf(resolved.products).names : [];
    return { output: { found: false, heard: query.join(' '), alternatives } };
  }
  const product = resolved.product;
  const inCart = deps.inCart(product.id);
  return {
    output: {
      found: true,
      name: product.name,
      onHand: product.stock,
      inCart,
      canAdd: Math.max(0, product.stock - inCart),
    },
  };
}

/**
 * What the cashier is being asked to choose between, if anything.
 *
 * Read-only, and there is no companion tool that picks one. The cards are scored
 * against the recognizer's ranking the moment a human answers them, and there is
 * no actor value under which a model may claim to be that human.
 */
function readOffer(deps: ClerkAgentToolDeps): ClerkAgentToolRun {
  const offer = deps.offer();
  return {
    output: {
      offer: offer.slice(0, MAX_TOOL_LIST),
      truncated: offer.length > MAX_TOOL_LIST,
    },
  };
}
