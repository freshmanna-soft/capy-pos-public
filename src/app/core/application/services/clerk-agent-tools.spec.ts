import {
  AgentCartLine,
  AgentOfferLine,
  CLERK_AGENT_TOOL_NAMES,
} from '@core/application/dtos/agent.dto';
import { Product } from '@core/domain/entities/product.entity';
import {
  ClerkAgentToolDeps,
  MAX_TOOL_LIST,
  SpokenResolution,
  createClerkAgentTools,
} from './clerk-agent-tools';

function product(id: string, name: string, price = 3, stock = 10): Product {
  return new Product(id, name, price, `${id.toUpperCase()}-SKU`, 'Produce', stock);
}

const AVOCADO = product('p1', 'Avocado', 1.2, 7);
const OAT_MILK = product('p2', 'Oat Milk', 2.4, 4);

function lines(count: number): AgentCartLine[] {
  return Array.from({ length: count }, (_unused, index) => ({
    name: `Item ${index + 1}`,
    quantity: 1,
  }));
}

function offerLines(count: number): AgentOfferLine[] {
  return Array.from({ length: count }, (_unused, index) => ({
    position: index + 1,
    label: `Option ${index + 1}`,
  }));
}

/**
 * The facade window, with every member answering harmlessly by default.
 *
 * Written as spies rather than plain closures because half of what these tools owe
 * the facade is *what they passed it* — the words the resolver was given and the
 * quantity a write was asked for.
 */
function depsOf(overrides: Partial<ClerkAgentToolDeps> = {}): ClerkAgentToolDeps {
  return {
    resolveSpokenName: vi.fn<(query: string[]) => SpokenResolution>(() => ({ kind: 'none' })),
    cartLines: vi.fn(() => [] as readonly AgentCartLine[]),
    totalItems: vi.fn(() => 0),
    formattedTotal: vi.fn(() => '£0.00'),
    inCart: vi.fn(() => 0),
    offer: vi.fn(() => [] as readonly AgentOfferLine[]),
    addByName: vi.fn(() => ({ added: 1, wanted: 1, name: 'Avocado' })),
    removeByName: vi.fn(() => ({ removed: 1, wanted: 1, name: 'Avocado' })),
    ...overrides,
  };
}

describe('createClerkAgentTools', () => {
  it('is a total map over the shared tool names', () => {
    const tools = createClerkAgentTools(depsOf());

    // A name added to the tuples and not to this table would fail in front of a
    // cashier rather than in a compiler, so the tuple is the assertion.
    expect(Object.keys(tools).sort()).toEqual([...CLERK_AGENT_TOOL_NAMES].sort());
  });

  it('inherits nothing, so a model-chosen name cannot reach Object.prototype', () => {
    const tools = createClerkAgentTools(depsOf());
    const indexed = tools as unknown as Record<string, unknown>;

    expect(Object.getPrototypeOf(tools)).toBeNull();
    for (const name of ['__proto__', 'constructor', 'toString', 'valueOf', 'hasOwnProperty']) {
      expect(indexed[name]).toBeUndefined();
    }
  });

  describe('look_up_product', () => {
    it('reports a hit as counted facts, never as a product row', () => {
      const tools = createClerkAgentTools(
        depsOf({ resolveSpokenName: () => ({ kind: 'one', product: AVOCADO }) })
      );

      const run = tools.look_up_product({ name: 'avocado' });

      // Exactly these keys: a tool that hands back a record makes the clerk read a
      // record aloud, and an id or a SKU is a minute of hexadecimal in a shop.
      expect(run.output).toEqual({ found: true, name: 'Avocado', price: 1.2, stock: 7 });
      expect(run.changedCart).toBeUndefined();
    });

    it('reports a miss with what it heard, so the model can ask again', () => {
      const tools = createClerkAgentTools(depsOf());

      expect(tools.look_up_product({ name: 'Oat milk!' }).output).toEqual({
        found: false,
        heard: 'oat milk',
      });
    });

    it('hands back the tied names rather than picking one', () => {
      const tools = createClerkAgentTools(
        depsOf({
          resolveSpokenName: () => ({ kind: 'ambiguous', products: [AVOCADO, OAT_MILK] }),
        })
      );

      expect(tools.look_up_product({ name: 'milk' }).output).toEqual({
        found: false,
        ambiguous: true,
        alternatives: ['Avocado', 'Oat Milk'],
        truncated: false,
      });
    });

    it('caps the alternatives and says that it did', () => {
      const many = Array.from({ length: MAX_TOOL_LIST + 2 }, (_unused, index) =>
        product(`p${index}`, `Milk ${index}`)
      );
      const tools = createClerkAgentTools(
        depsOf({ resolveSpokenName: () => ({ kind: 'ambiguous', products: many }) })
      );

      const output = tools.look_up_product({ name: 'milk' }).output;

      // A silently shortened list is a list the model will describe as complete.
      expect(output['alternatives']).toHaveLength(MAX_TOOL_LIST);
      expect(output['truncated']).toBe(true);
    });
  });

  describe('the name argument', () => {
    it.each([
      ['Oat  Milk', ['oat', 'milk']],
      ["Grandma's Jam!", ['grandma', 's', 'jam']],
      ['SKU-8891', ['sku', '8891']],
    ])('reads %p as %j', (name, words) => {
      const resolveSpokenName = vi.fn<(query: string[]) => SpokenResolution>(() => ({
        kind: 'none',
      }));
      const tools = createClerkAgentTools(depsOf({ resolveSpokenName }));

      tools.look_up_product({ name });

      expect(resolveSpokenName).toHaveBeenCalledWith(words);
    });

    it.each([
      ['missing', {}],
      ['not a string', { name: 42 }],
      ['null', { name: null }],
    ])('resolves a %s name to nothing rather than throwing', (_label, input) => {
      const resolveSpokenName = vi.fn<(query: string[]) => SpokenResolution>(() => ({
        kind: 'none',
      }));
      const tools = createClerkAgentTools(depsOf({ resolveSpokenName }));

      // `input` came off a model: a nameless lookup is a lookup that found nothing.
      expect(tools.look_up_product(input).output).toEqual({ found: false, heard: '' });
      expect(resolveSpokenName).toHaveBeenCalledWith([]);
    });
  });

  describe('read_cart', () => {
    it('reports the sale in the words the clerk would use for it', () => {
      const tools = createClerkAgentTools(
        depsOf({
          cartLines: () => lines(2),
          totalItems: () => 2,
          // A string, passed through verbatim: no arithmetic on money happens here.
          formattedTotal: () => '£4.80',
        })
      );

      expect(tools.read_cart({}).output).toEqual({
        lines: lines(2),
        truncated: false,
        totalItems: 2,
        total: '£4.80',
      });
    });

    it('caps a long cart and says that it did', () => {
      const tools = createClerkAgentTools(
        depsOf({ cartLines: () => lines(MAX_TOOL_LIST + 3), totalItems: () => MAX_TOOL_LIST + 3 })
      );

      const output = tools.read_cart({}).output;

      expect(output['lines']).toHaveLength(MAX_TOOL_LIST);
      expect(output['truncated']).toBe(true);
      // The count is still the true one — the cap shortens the reading, not the sale.
      expect(output['totalItems']).toBe(MAX_TOOL_LIST + 3);
    });
  });

  describe('check_stock', () => {
    it('answers how many can still go in', () => {
      const tools = createClerkAgentTools(
        depsOf({
          resolveSpokenName: () => ({ kind: 'one', product: AVOCADO }),
          inCart: () => 2,
        })
      );

      expect(tools.check_stock({ name: 'avocado' }).output).toEqual({
        found: true,
        name: 'Avocado',
        onHand: 7,
        inCart: 2,
        canAdd: 5,
      });
    });

    it('floors what can still go in at zero rather than going negative', () => {
      // The same subtraction `tryAddToCart` makes before it refuses, answered here
      // so the model can decline without spending a mutation on a refusal.
      const tools = createClerkAgentTools(
        depsOf({
          resolveSpokenName: () => ({ kind: 'one', product: product('p3', 'Sourdough', 3, 2) }),
          inCart: () => 5,
        })
      );

      expect(tools.check_stock({ name: 'sourdough' }).output['canAdd']).toBe(0);
    });

    it('reports a miss with no alternatives to offer', () => {
      const tools = createClerkAgentTools(depsOf());

      expect(tools.check_stock({ name: 'quinoa' }).output).toEqual({
        found: false,
        heard: 'quinoa',
        alternatives: [],
      });
    });

    it('reports a tie by name, so the model asks instead of guessing', () => {
      const tools = createClerkAgentTools(
        depsOf({
          resolveSpokenName: () => ({ kind: 'ambiguous', products: [AVOCADO, OAT_MILK] }),
        })
      );

      expect(tools.check_stock({ name: 'milk' }).output).toEqual({
        found: false,
        heard: 'milk',
        alternatives: ['Avocado', 'Oat Milk'],
      });
    });
  });

  describe('read_offer', () => {
    it('reports the cards by the position the cashier can say', () => {
      const tools = createClerkAgentTools(depsOf({ offer: () => offerLines(2) }));

      expect(tools.read_offer({}).output).toEqual({ offer: offerLines(2), truncated: false });
    });

    it('caps the cards and says that it did', () => {
      const tools = createClerkAgentTools(depsOf({ offer: () => offerLines(MAX_TOOL_LIST + 1) }));

      const output = tools.read_offer({}).output;

      expect(output['offer']).toHaveLength(MAX_TOOL_LIST);
      expect(output['truncated']).toBe(true);
    });
  });

  describe('add_by_name', () => {
    it('reports the counts the facade reported, under the names it used', () => {
      const addByName = vi.fn(() => ({ added: 2, wanted: 2, name: 'Avocado' }));
      const tools = createClerkAgentTools(depsOf({ addByName }));

      const run = tools.add_by_name({ name: 'avocado', quantity: 2 });

      expect(addByName).toHaveBeenCalledWith(['avocado'], 2);
      expect(run.output).toEqual({ added: 2, wanted: 2, name: 'Avocado' });
      expect(run.changedCart).toBe(true);
    });

    it('drops a reason the facade left undefined', () => {
      // `addByName` sets the key to `undefined` on a clean write, and a key whose
      // value is the word "undefined" is something a model will try to explain.
      const tools = createClerkAgentTools(
        depsOf({ addByName: () => ({ added: 1, wanted: 1, name: 'Avocado', reason: undefined }) })
      );

      expect(Object.keys(tools.add_by_name({ name: 'avocado' }).output)).toEqual([
        'added',
        'wanted',
        'name',
      ]);
    });

    it('keeps a reason the facade did give', () => {
      const tools = createClerkAgentTools(
        depsOf({
          addByName: () => ({ added: 0, wanted: 1, name: '', reason: 'out-of-stock' as const }),
        })
      );

      const run = tools.add_by_name({ name: 'sourdough' });

      expect(run.output['reason']).toBe('out-of-stock');
      // Nothing reached the sale, so nothing may spend the one-cart-change budget.
      expect(run.changedCart).toBe(false);
    });

    it.each([
      ['a missing quantity', {}, 1],
      ['a quantity that is not a number', { quantity: 'two' }, 1],
    ])('reads %s as one', (_label, extra, expected) => {
      const addByName = vi.fn(() => ({ added: 1, wanted: 1, name: 'Avocado' }));
      const tools = createClerkAgentTools(depsOf({ addByName }));

      tools.add_by_name({ name: 'avocado', ...extra });

      expect(addByName).toHaveBeenCalledWith(['avocado'], expected);
    });

    it('passes an out-of-range quantity on unclamped, because the runner clamps', () => {
      // The clamp lives one layer up, applied to the input before dispatch. Doing it
      // twice would make two places responsible for the same bound.
      const addByName = vi.fn(() => ({ added: 5, wanted: 5, name: 'Avocado' }));
      const tools = createClerkAgentTools(depsOf({ addByName }));

      tools.add_by_name({ name: 'avocado', quantity: 99 });

      expect(addByName).toHaveBeenCalledWith(['avocado'], 99);
    });
  });

  describe('remove_by_name', () => {
    it('reports the counts the facade reported', () => {
      const removeByName = vi.fn(() => ({ removed: 1, wanted: 1, name: 'Oat Milk' }));
      const tools = createClerkAgentTools(depsOf({ removeByName }));

      const run = tools.remove_by_name({ name: 'oat milk' });

      expect(removeByName).toHaveBeenCalledWith(['oat', 'milk'], 1);
      expect(run.output).toEqual({ removed: 1, wanted: 1, name: 'Oat Milk' });
      expect(run.changedCart).toBe(true);
    });

    it('spends no budget when nothing came off the sale', () => {
      const tools = createClerkAgentTools(
        depsOf({
          removeByName: () => ({ removed: 0, wanted: 1, name: '', reason: 'not-in-cart' as const }),
        })
      );

      const run = tools.remove_by_name({ name: 'quinoa' });

      expect(run.changedCart).toBe(false);
      expect(run.output['reason']).toBe('not-in-cart');
    });
  });

  it('is offline and synchronous, so no tool can add latency to a turn', () => {
    const tools = createClerkAgentTools(depsOf({ cartLines: () => lines(1), totalItems: () => 1 }));

    for (const name of CLERK_AGENT_TOOL_NAMES) {
      const run = tools[name]({ name: 'avocado' });
      expect(run.output).toBeTypeOf('object');
      expect(run.output).not.toBeInstanceOf(Promise);
    }
  });
});
