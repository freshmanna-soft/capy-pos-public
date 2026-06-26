import { defineConfig } from 'vitest/config';

// Isolated config for GraphRAG tooling under scripts/graphrag/.
// The app's vitest.config.ts is scoped to src/**/*.ts on jsdom; this tooling is
// plain Node ESM, so it gets a node environment and its own include glob.
export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['scripts/graphrag/**/*.{test,spec}.mjs'],
  },
});
