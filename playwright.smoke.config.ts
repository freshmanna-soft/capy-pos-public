import { defineConfig, devices } from '@playwright/test';

/**
 * Route-smoke Playwright config — runs the smoke suite against a real
 * production build/serve, not the dev server.
 *
 * WHY A SEPARATE CONFIG: the default config serves `npm run start` (dev), which
 * uses environment.ts. Environment-specific breakage (e.g. `process.env` in
 * environment.prod.ts, which threw "process is not defined" and broke every page
 * in the deployed app) only exists in a production build configuration — so the
 * dev e2e suite can never see it. This config serves `start:smoke`
 * (environment.smoke.ts) so the smoke exercises the same optimization/bundling
 * the deploy ships.
 *
 * NOT `start:prod` (environment.prod.ts) — deliberately. `environment.prod.ts`
 * has no account this suite could ever sign in with (see
 * `environment.allowSeededAdmin` in `environment.ts`'s doc comment): neither
 * Cognito nor App ID is live yet, so the only credential available anywhere is
 * the seeded admin@capy-pos.local account, and the file that actually ships must
 * never have it. `environment.smoke.ts` is identical to `environment.prod.ts` in
 * every optimization/bundling respect and every other config value — it exists
 * solely to flip that one flag back on for this CI-only build.
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
    // Serve the smoke configuration (environment.smoke.ts) at the root path —
    // see the file header for why this isn't `start:prod`.
    command: 'npm run start:smoke',
    url: 'http://localhost:4200',
    reuseExistingServer: !process.env.CI,
    timeout: 180 * 1000,
  },
});
