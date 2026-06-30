import { defineConfig } from 'vitest/config';
import angular from '@analogjs/vite-plugin-angular';
import { resolve } from 'node:path';

export default defineConfig({
  plugins: [angular()],
  resolve: {
    alias: [
      { find: '@app', replacement: resolve(__dirname, 'src/app') },
      { find: '@core', replacement: resolve(__dirname, 'src/app/core') },
      { find: '@features', replacement: resolve(__dirname, 'src/app/features') },
      { find: '@shared', replacement: resolve(__dirname, 'src/app/shared') },
      { find: '@environments', replacement: resolve(__dirname, 'src/app/environments') },
    ],
  },
  test: {
    globals: true,
    environment: 'jsdom',
    setupFiles: ['./vitest.setup.ts'],
    // Write console output straight to stdout instead of routing it through the
    // worker RPC. Fire-and-forget async logs (e.g. a component's `.then()` that
    // logs after its test/fixture is torn down) otherwise race worker shutdown
    // and raise "Closing rpc while onUserConsoleLog was pending" — an
    // EnvironmentTeardownError that fails the run. Disabling the intercept
    // removes that RPC entirely, so the race cannot occur.
    disableConsoleIntercept: true,
    include: ['src/**/*.{test,spec}.ts'],
    exclude: ['tests/e2e/**', 'node_modules/**', 'dist/**', 'src/environments/**'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html', 'lcov'],
      exclude: [
        'node_modules/',
        'tests/',
        '**/*.spec.ts',
        '**/*.test.ts',
        '**/*.stories.ts',
        '**/index.ts',
        // Repositories are measured now that they have tests. The two below are
        // covered (base-dexie + dexie-product); the rest stay excluded until
        // they get their own tests (tracked in #110).
        'src/app/core/infrastructure/repositories/dexie-customer.repository.ts',
        'src/app/core/infrastructure/repositories/dexie-transaction.repository.ts',
        'src/app/core/infrastructure/repositories/dexie-payment.repository.ts',
        'src/app/core/infrastructure/repositories/api-product.repository.ts',
        'src/app/core/infrastructure/repositories/sqlite-product.repository.ts',
        'src/app/core/infrastructure/repositories/base-sqlite.repository.ts',
        'src/app/core/infrastructure/sqlite/**',
        'src/app/core/infrastructure/messaging/**',
        'src/app/core/infrastructure/factories/**',
        'src/app/core/infrastructure/database/**',
        'src/app/agents/*/infrastructure/**',
        'src/app/agents/analytics/**',
        'src/app/agents/base/base-agent.ts',
        'src/app/agents/agent.registry.ts',
        'src/app/core/application/dtos/**',
        'src/app/core/application/services/base-application.service.ts',
        'src/app/core/application/services/product.service.ts',
        'src/app/core/application/services/customer.service.ts',
        'src/app/core/application/mappers/base.mapper.ts',
        'src/app/core/application/exceptions/**',
        '**/*.scss',
      ],
      thresholds: {
        statements: 90,
        branches: 90,
        functions: 90,
        lines: 90,
      },
    },
  },
});
