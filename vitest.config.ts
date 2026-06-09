import { defineConfig } from 'vitest/config';
import { resolve } from 'path';

export default defineConfig({
  resolve: {
    alias: [
      { find: '@app', replacement: resolve(__dirname, 'src/app') },
      { find: '@core', replacement: resolve(__dirname, 'src/app/core') },
      { find: '@features', replacement: resolve(__dirname, 'src/app/features') },
      { find: '@shared', replacement: resolve(__dirname, 'src/app/shared') },
      { find: '@environments', replacement: resolve(__dirname, 'src/app/environments') }
    ]
  },
  test: {
    globals: true,
    environment: 'jsdom',
    setupFiles: ['./vitest.setup.ts'],
    include: ['src/**/*.{test,spec}.ts'],
    exclude: ['tests/e2e/**', 'node_modules/**', 'dist/**', 'src/environments/**'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html'],
      exclude: [
        'node_modules/',
        'tests/',
        '**/*.spec.ts',
        '**/*.test.ts',
        '**/*.stories.ts',
      ],
    },
  },
});

// Made with Bob
