import { defineConfig, devices } from '@playwright/test';

/**
 * Route-smoke Playwright config — runs the smoke suite against the PRODUCTION
 * build/serve, not the dev server.
 *
 * WHY A SEPARATE CONFIG: the default config serves `npm run start` (dev), which
 * uses environment.ts. Environment-specific breakage (e.g. `process.env` in
 * environment.prod.ts, which threw "process is not defined" and broke every page
 * in the deployed app) only exists in the production configuration — so the dev
 * e2e suite can never see it. This config serves the production configuration so
 * the smoke exercises the same code the deploy ships.
 *
 * Intentionally minimal: chromium only, the route-smoke spec only, so it is cheap
 * enough to run on every push regardless of affected-spec selection.
 */
export default defineConfig({
  testDir: './tests/e2e',
  testMatch: /route-smoke\.spec\.ts$/,
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  workers: 1,
  reporter: [['list'], ['json', { outputFile: 'test-results/smoke-results.json' }]],
  use: {
    baseURL: 'http://localhost:4200',
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: {
    // Serve the PRODUCTION configuration (environment.prod.ts) at the root path so
    // the smoke hits the same bundle the deploy ships.
    command: 'npm run start:prod',
    url: 'http://localhost:4200',
    reuseExistingServer: !process.env.CI,
    timeout: 180 * 1000,
  },
});
