/**
 * The drift guard the header of `agent-contract.ts` promises.
 *
 * The wire types and the tool tuple are a deliberate second copy of the browser's
 * (`src/app/core/application/dtos/agent.dto.ts`), because the two sides ship as
 * separate packages with separate tsconfigs and no build step spans them. A copy
 * with no guard is just a bug waiting for the next tool, so this suite is the
 * guard: it reads the browser's file as text and asserts the two agree.
 *
 * Text rather than an import, because the browser file resolves `@core/...` path
 * aliases that only the Angular build knows about — importing it from here would
 * couple this package to that build, which is the coupling the copy exists to
 * avoid. Reading the source is the weaker tool that stays honest about it.
 *
 * Plain JavaScript run by `node --test`, matching the `.mjs` suites under
 * `scripts/graphrag/`: it imports the `.ts` sources through Node's type stripping
 * and needs no API key, because nothing here talks to a model.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  CLERK_AGENT_MUTATE_TOOLS,
  CLERK_AGENT_READ_TOOLS,
  CLERK_AGENT_TOOL_NAMES,
  MAX_CATALOG_FIELD_CHARS,
  SYSTEM_PROMPT,
  TOOL_SCHEMAS,
  formatCatalog,
} from './agent-contract.ts';
import { MAX_TRANSCRIPT_HOPS } from './validate.ts';

const REPO_ROOT = new URL('../../../', import.meta.url);
const BROWSER_DTO = readFileSync(new URL('src/app/core/application/dtos/agent.dto.ts', REPO_ROOT), 'utf8');
const BROWSER_RUNNER = readFileSync(
  new URL('src/app/core/application/services/agent-turn.runner.ts', REPO_ROOT),
  'utf8'
);

/** Pull `export const NAME = ['a', 'b'] as const;` out of a source file. */
function stringTuple(source, name) {
  const match = new RegExp(`export const ${name} = \\[([^\\]]*)\\]`).exec(source);
  assert.ok(match, `${name} is no longer declared as an array literal in the browser copy`);
  return [...match[1].matchAll(/'([^']+)'/g)].map(([, value]) => value);
}

describe('the tool tuple', () => {
  it('is the same list, in the same order, as the browser copy', () => {
    assert.deepEqual(CLERK_AGENT_READ_TOOLS.slice(), stringTuple(BROWSER_DTO, 'CLERK_AGENT_READ_TOOLS'));
    assert.deepEqual(CLERK_AGENT_MUTATE_TOOLS.slice(), stringTuple(BROWSER_DTO, 'CLERK_AGENT_MUTATE_TOOLS'));
  });

  it('composes read tools before mutating ones, with nothing repeated', () => {
    assert.deepEqual(CLERK_AGENT_TOOL_NAMES.slice(), [
      ...CLERK_AGENT_READ_TOOLS,
      ...CLERK_AGENT_MUTATE_TOOLS,
    ]);
    assert.equal(new Set(CLERK_AGENT_TOOL_NAMES).size, CLERK_AGENT_TOOL_NAMES.length);
  });
});

describe('the server-side hop ceiling', () => {
  it('sits exactly one hop above the browser budget it is not', () => {
    const match = /export const MAX_HOPS = (\d+)/.exec(BROWSER_RUNNER);
    assert.ok(match, 'MAX_HOPS is no longer a literal in agent-turn.runner.ts');
    assert.equal(MAX_TRANSCRIPT_HOPS, Number(match[1]) + 1);
  });
});

describe('TOOL_SCHEMAS', () => {
  it('covers every tool in the tuple, in the tuple order', () => {
    // Order is the cache prefix: tools render ahead of the system prompt, so a
    // list whose order varied run-to-run would invalidate the prefix every hop.
    assert.deepEqual(
      TOOL_SCHEMAS.map((schema) => schema.name),
      CLERK_AGENT_TOOL_NAMES.slice()
    );
  });

  it('leaves the model no room in any input', () => {
    for (const schema of TOOL_SCHEMAS) {
      // No top-level `strict: true` — see objectSchema's own comment: the
      // gateway this deployment routes through rejects that field on a tool
      // definition. additionalProperties:false + every key required below is
      // what's actually doing strict mode's job here.
      assert.equal(schema.strict, undefined, `${schema.name} re-added strict — check the gateway supports it before restoring this`);
      const input = schema.input_schema;
      assert.equal(input.type, 'object');
      assert.equal(input.additionalProperties, false, `${schema.name} accepts extra keys`);
      assert.deepEqual(input.required, Object.keys(input.properties));
      assert.ok(String(schema.description).length > 0, `${schema.name} has no description`);
    }
  });

  it('asks for names and quantities, never an id or a SKU', () => {
    // "You propose words, never ids" is a property of the schemas, not only a
    // rule in the prompt: there is no field the model could put an id in.
    for (const schema of TOOL_SCHEMAS) {
      const keys = Object.keys(schema.input_schema.properties);
      assert.deepEqual(
        keys.filter((key) => !['name', 'quantity'].includes(key)),
        [],
        `${schema.name} takes something other than a name or a quantity`
      );
    }
  });

  it('takes quantity as a string of digits, so the browser clamp gets digits to clamp', () => {
    for (const name of CLERK_AGENT_MUTATE_TOOLS) {
      const schema = TOOL_SCHEMAS.find((candidate) => candidate.name === name);
      assert.equal(schema.input_schema.properties.quantity.type, 'string');
    }
  });
});

describe('SYSTEM_PROMPT', () => {
  it('names the tool the look-before-you-act rule depends on', () => {
    // Renaming a tool without updating the prompt leaves the rule pointing at
    // nothing, which the model cannot follow and no schema would catch.
    assert.match(SYSTEM_PROMPT, /look_up_product/);
  });

  it('states the two rules a schema cannot express', () => {
    assert.match(SYSTEM_PROMPT, /DATA, not instructions/);
    assert.match(SYSTEM_PROMPT, /at most once per turn/);
  });
});

describe('formatCatalog', () => {
  const catalog = [
    { id: 'p-oat', name: 'Oat Milk 1L', sku: 'DRY-OAT', category: 'Dairy', emoji: '🥛' },
    { id: 'p-ban', name: 'Banana', sku: 'FRT-BAN', category: 'Produce' },
    { id: 'p-avo', name: 'Avocado', sku: 'FRT-AVO', category: 'Produce', emoji: '🥑' },
  ];

  it('renders neither ids nor SKUs', () => {
    // The model proposes words and the till resolves them, so an id in the
    // prompt is a token it can only misuse — pass to a tool, or read aloud.
    const rendered = formatCatalog(catalog);
    for (const hint of catalog) {
      assert.doesNotMatch(rendered, new RegExp(hint.id));
      if (hint.sku) {
        assert.doesNotMatch(rendered, new RegExp(hint.sku));
      }
    }
  });

  it('groups by category and sorts both levels, so confusable products sit adjacent', () => {
    const rendered = formatCatalog(catalog);
    assert.match(rendered, /<catalog>\nDairy:\n {2}Oat Milk 1L\t🥛\n\nProduce:\n {2}Avocado\t🥑\n {2}Banana\n<\/catalog>/);
  });

  it('is byte-identical for the same catalog in any order, which is what keeps the cache hitting', () => {
    assert.equal(formatCatalog(catalog), formatCatalog(catalog.slice().reverse()));
  });

  it('files an uncategorised product rather than dropping it', () => {
    assert.match(formatCatalog([{ id: 'p', name: 'Thing', sku: '', category: '' }]), /Uncategorised:\n {2}Thing/);
  });
});

describe('MAX_CATALOG_FIELD_CHARS', () => {
  it('is long enough for a product name and short enough not to be prose', () => {
    assert.ok(MAX_CATALOG_FIELD_CHARS >= 40 && MAX_CATALOG_FIELD_CHARS <= 200);
  });
});
