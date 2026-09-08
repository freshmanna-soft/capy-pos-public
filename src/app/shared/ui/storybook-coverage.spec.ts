import { readdirSync, existsSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';

/**
 * Storybook coverage guard for the shared UI layer.
 *
 * Every reusable presentational component under `shared/ui/` is expected to ship
 * a sibling `*.stories.ts` — the design system is the one place where "how does
 * this look in every state" is documented, and a component with no story is a
 * component nobody can review without booting the whole till.
 *
 * This is a convention gate, not a rendering test: it asserts the file exists so
 * the next component added here cannot silently skip its story (which is exactly
 * how the backfill this replaces became necessary in the first place).
 */
describe('shared/ui Storybook coverage', () => {
  const uiRoot = resolve(__dirname);

  /** Component files only — directives and services are not storyable on their own. */
  const componentFiles = (dir: string): string[] =>
    readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
      const full = join(dir, entry.name);
      if (entry.isDirectory()) {
        return componentFiles(full);
      }
      const isComponent =
        entry.name.endsWith('.component.ts') &&
        !entry.name.endsWith('.spec.ts') &&
        !entry.name.endsWith('.stories.ts');
      return isComponent ? [full] : [];
    });

  const components = componentFiles(uiRoot);

  it('finds the shared UI components to check', () => {
    expect(components.length).toBeGreaterThan(0);
  });

  it.each(components.map((file) => [relative(uiRoot, file), file]))(
    '%s has a sibling stories file',
    (_label, file) => {
      const storiesFile = file.replace(/\.ts$/, '.stories.ts');
      expect(existsSync(storiesFile), `missing story: ${relative(uiRoot, storiesFile)}`).toBe(true);
    }
  );
});
