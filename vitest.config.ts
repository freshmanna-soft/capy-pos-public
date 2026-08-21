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
        // Test-only fixtures. `fake-authenticator.fixture.ts` builds real signed
        // WebAuthn responses for the passkey specs; it is exercised by them but is
        // not app code, so measuring it would inflate the numbers either way.
        '**/*.fixture.ts',
        '**/index.ts',
        // Every repository is measured now (#110 closed): base-dexie,
        // dexie-product, dexie-customer, dexie-payment and dexie-transaction all
        // have tests covering the malformed-record negative path, so there is no
        // unmeasured data-mapping seam left. The api-product and sql.js
        // repositories that used to sit here were deleted instead of tested —
        // nothing referenced them and the app migrated off SQLite to Dexie (see
        // docs/DEXIE_MIGRATION.md), taking the whole sql.js layer with them.
        'src/app/core/infrastructure/messaging/**',
        'src/app/core/infrastructure/factories/**',
        'src/app/core/infrastructure/database/**',
        'src/app/agents/*/infrastructure/**',
        'src/app/agents/analytics/**',
        'src/app/agents/base/base-agent.ts',
        'src/app/agents/agent.registry.ts',
        // Thin wrappers over browser APIs that jsdom does not implement at all:
        // getUserMedia and the canvas pixel readback, BarcodeDetector,
        // SpeechSynthesis, and SpeechRecognition. There is no logic here to unit
        // test — every method is a permission handshake, a feature probe or an
        // event-handler hookup — and faking the APIs well enough to instrument
        // would only assert the fakes. They are covered end-to-end in
        // tests/e2e/clerk.spec.ts, which runs a real MediaStream and a stubbed
        // detector through a real browser. Every decision that sits on top of them
        // is unit tested in its own pure module: frame-gate.ts, barcode-gate.ts,
        // camera-selection.ts, candidate-ranking.ts and clerk.facade.ts.
        'src/app/core/infrastructure/media/camera.service.ts',
        'src/app/core/infrastructure/media/barcode-scanner.service.ts',
        'src/app/core/infrastructure/voice/**',
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
