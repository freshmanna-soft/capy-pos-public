/**
 * The suite for the two halves of `relay.ts` that decide behaviour without a
 * network: `toStep`, where every non-network failure mode is chosen, and
 * `buildMessages`, where the volatile half of the prompt is shaped.
 *
 * Neither needs an API key. The module constructs its SDK client at import, but
 * the client does not look for a key until a request is made, so importing this
 * file with no `ANTHROPIC_API_KEY` set is fine — and the suite runs in CI that way.
 *
 * `buildMessages` is asserted at all because the prompt shape is load-bearing in
 * two ways a type cannot express: everything stable must come before the cache
 * breakpoint or every hop pays full price for the catalog, and all of a hop's tool
 * results must go back in one user turn or parallel tool use degrades.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { buildMessages, toStep } from './relay.ts';
import { MAX_ASSISTANT_BLOCKS, MAX_TOOL_RESULTS } from './validate.ts';

const THINKING = { type: 'thinking', thinking: 'she said milk', signature: 'sig-abc' };

function call(id, name = 'look_up_product', input = { name: 'oat milk' }) {
  return { type: 'tool_use', id, name, input };
}

const REQUEST = {
  utterance: 'add two oat milks',
  catalog: [{ id: 'p-oat', name: 'Oat Milk 1L', sku: 'DRY-OAT', category: 'Dairy' }],
  context: {
    cartLines: [{ name: 'Banana', quantity: 2 }],
    totalItems: 2,
    total: 1.98,
    offer: [{ position: 1, label: 'Oat Milk 1L' }],
    cartChangedThisTurn: false,
  },
  memory: [],
  transcript: [],
};

describe('toStep — answering', () => {
  it('reads speech out of the text blocks, in order', () => {
    const blocks = [THINKING, { type: 'text', text: 'Two oat milks in. ' }, { type: 'text', text: 'Anything else?' }];
    assert.deepEqual(toStep(blocks), {
      kind: 'answer',
      assistant: blocks,
      speech: 'Two oat milks in. Anything else?',
    });
  });

  it('treats a turn with no tools and nothing to say as the model declining', () => {
    assert.deepEqual(toStep([THINKING]), { kind: 'declined' });
    assert.deepEqual(toStep([{ type: 'text', text: '   ' }]), { kind: 'declined' });
    assert.deepEqual(toStep([]), { kind: 'declined' });
  });

  it('ignores a text block whose text is not a string', () => {
    assert.deepEqual(toStep([{ type: 'text', text: 42 }]), { kind: 'declined' });
  });
});

describe('toStep — tool calls', () => {
  it('hands the blocks back untouched alongside the calls', () => {
    const blocks = [THINKING, call('call-1'), { type: 'text', text: 'checking' }];
    const step = toStep(blocks);
    assert.equal(step.kind, 'tools');
    // Byte-identical replay: the browser resends these on the next hop, and a
    // normalized or re-serialized thinking block loses the model its reasoning.
    assert.equal(step.assistant, blocks);
    assert.deepEqual(step.calls, [{ id: 'call-1', name: 'look_up_product', input: { name: 'oat milk' } }]);
  });

  it('keeps every parallel call the model asked for', () => {
    const step = toStep([call('call-1', 'read_cart', {}), call('call-2', 'read_offer', {})]);
    assert.deepEqual(
      step.calls.map((one) => one.id),
      ['call-1', 'call-2']
    );
  });

  it('defaults a missing or non-object input to an empty one', () => {
    // Written without the helper: passing `undefined` through it would only hit
    // the helper's own default, not the branch under test.
    assert.deepEqual(toStep([{ type: 'tool_use', id: 'call-1', name: 'read_cart' }]).calls[0].input, {});
    assert.deepEqual(toStep([call('call-1', 'read_cart', 'now')]).calls[0].input, {});
    assert.deepEqual(toStep([call('call-1', 'read_cart', null)]).calls[0].input, {});
  });

  it('prefers tools over speech when the turn carries both', () => {
    assert.equal(toStep([{ type: 'text', text: 'one moment' }, call('call-1')]).kind, 'tools');
  });
});

describe('toStep — refusing a hop the next one could not replay', () => {
  // Every ceiling here is `validate.ts`'s own, checked on the way out: a hop this
  // relay hands back is a hop the browser hands straight in again, so anything the
  // validator would refuse costs two turns instead of one if it leaves here.

  it('refuses more assistant blocks than the validator accepts', () => {
    const blocks = Array.from({ length: MAX_ASSISTANT_BLOCKS + 1 }, () => ({ type: 'text', text: 'x' }));
    assert.deepEqual(toStep(blocks), { kind: 'unavailable' });
  });

  it('refuses more tool calls than the validator accepts', () => {
    const blocks = Array.from({ length: MAX_TOOL_RESULTS + 1 }, (_, at) => call(`call-${at}`, 'read_cart', {}));
    assert.deepEqual(toStep(blocks), { kind: 'unavailable' });
  });

  it('refuses a malformed tool call', () => {
    assert.deepEqual(toStep([call(undefined)]), { kind: 'unavailable' });
    assert.deepEqual(toStep([call('')]), { kind: 'unavailable' });
    assert.deepEqual(toStep([call('call-1', 42)]), { kind: 'unavailable' });
  });

  it('refuses a call naming a tool this relay does not offer', () => {
    // `validate.ts` reads such a call as a forged turn and refuses the whole next
    // hop with a 400. Catching it here spends one turn rather than two, and says
    // which name arrived.
    assert.deepEqual(toStep([call('call-1', 'run_shell_command', {})]), { kind: 'unavailable' });
  });

  it('refuses two calls sharing one id', () => {
    // Same reason: the validator needs one id per call to match results to calls,
    // and would refuse the replay.
    assert.deepEqual(toStep([call('call-1', 'read_cart', {}), call('call-1', 'read_offer', {})]), {
      kind: 'unavailable',
    });
  });
});

describe('buildMessages', () => {
  it('opens with the till as it stands, then the phrase', () => {
    // State before question: the phrase only means something against the cart it
    // was said over.
    const [opening] = buildMessages(REQUEST);
    assert.equal(opening.role, 'user');
    const text = opening.content[0].text;
    assert.match(text, /In the cart right now:\n {2}Banana x2/);
    assert.match(text, /2 items, 1\.98 in total\./);
    assert.match(text, /On screen for her to choose from:\n {2}1\. Oat Milk 1L/);
    assert.match(text, /<utterance>\nadd two oat milks\n<\/utterance>$/);
    assert.ok(text.indexOf('In the cart right now') < text.indexOf('<utterance>'));
  });

  it('says plainly when the cart has already been changed this turn', () => {
    const changed = buildMessages({ ...REQUEST, context: { ...REQUEST.context, cartChangedThisTurn: true } });
    assert.match(changed[0].content[0].text, /ALREADY been changed this turn/);
    assert.match(buildMessages(REQUEST)[0].content[0].text, /has not been changed this turn/);
  });

  it('describes an empty till without leaving a blank line', () => {
    const empty = buildMessages({
      ...REQUEST,
      context: { cartLines: [], totalItems: 1, total: 0, offer: [], cartChangedThisTurn: false },
    });
    const text = empty[0].content[0].text;
    assert.match(text, /In the cart right now:\n {2}\(empty\)/);
    assert.match(text, /1 item, 0\.00 in total\./);
    assert.match(text, /\(nothing on screen\)/);
    assert.match(text, /\(nothing yet this session\)/);
  });

  it('renders remembered turns as phrase and tool names only', () => {
    const remembered = buildMessages({
      ...REQUEST,
      memory: [
        { phrase: 'two coffees', tools: ['add_by_name'], productIds: [] },
        { phrase: 'what is the total', tools: [], productIds: [] },
      ],
    });
    const text = remembered[0].content[0].text;
    assert.match(text, /"two coffees" -> add_by_name/);
    assert.match(text, /"what is the total" -> no tools/);
  });

  it('replays each hop as its assistant turn plus one user turn of results', () => {
    const assistant = [THINKING, call('call-1'), call('call-2', 'check_stock', { name: 'oat milk' })];
    const messages = buildMessages({
      ...REQUEST,
      transcript: [
        {
          assistant,
          results: [
            { id: 'call-1', output: { matches: ['Oat Milk 1L'] } },
            { id: 'call-2', output: { error: 'nothing by that name' }, isError: true },
          ],
        },
      ],
    });

    assert.equal(messages.length, 3);
    assert.equal(messages[1].role, 'assistant');
    // Untouched, for the same reason `toStep` hands them back untouched.
    assert.equal(messages[1].content, assistant);
    assert.equal(messages[2].role, 'user');
    // All of a hop's results in ONE turn: splitting them degrades parallel tool use.
    assert.deepEqual(messages[2].content, [
      { type: 'tool_result', tool_use_id: 'call-1', content: '{"matches":["Oat Milk 1L"]}' },
      {
        type: 'tool_result',
        tool_use_id: 'call-2',
        content: '{"error":"nothing by that name"}',
        is_error: true,
      },
    ]);
  });

  it('grows by two turns per hop, so the opening turn stays first', () => {
    const hop = { assistant: [call('call-1')], results: [{ id: 'call-1', output: {} }] };
    assert.equal(buildMessages({ ...REQUEST, transcript: [hop, hop] }).length, 5);
  });
});
