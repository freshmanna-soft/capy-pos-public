import { test, expect, Page } from '@playwright/test';
import { loginAsAdmin } from './helpers/auth';

/**
 * Route smoke gate — "does the real app actually render every page?"
 *
 * WHY THIS EXISTS
 * Unit tests mock everything, the production build only proves the code
 * *compiles*, and the affected-Playwright runner only executes specs impacted by
 * the changed files. So a change can be green everywhere and still ship a page
 * that throws at runtime (bad DI, template binding, guard redirect loop, a
 * signal read before init) — the "app is broken on pages" gap.
 *
 * This suite loads each top-level route in the REAL served app as a logged-in
 * admin and fails on the three unambiguous "this page is broken" signals:
 *   1. an uncaught exception (pageerror),
 *   2. the route bounced somewhere unexpected (guard/redirect break),
 *   3. the page rendered blank or showed an error banner.
 *
 * It is INTENTIONALLY always-run (never gated by affected-spec selection): a
 * page broken by a change usually isn't "affected" by that change's files,
 * which is exactly why the regression slips through. Keep it cheap so it can
 * run on every push.
 */

/** Authenticated app routes to smoke, with a landmark that proves the page painted. */
const ROUTES: { path: string; name: string; landmark: string }[] = [
  { path: '/pos', name: 'POS terminal', landmark: '[data-testid="pos-terminal"]' },
  { path: '/inventory', name: 'Inventory', landmark: 'main, [data-testid="inventory-management"]' },
  { path: '/customers', name: 'Customers', landmark: 'main, [data-testid="customers"]' },
  { path: '/reports', name: 'Reports', landmark: 'main, [data-testid="reports"]' },
  { path: '/dashboard', name: 'Agent dashboard', landmark: 'main, [data-testid="agent-monitor"]' },
  { path: '/history', name: 'Transaction history', landmark: 'main, [data-testid="transaction-history"]' },
  { path: '/settings', name: 'Settings', landmark: 'main, [data-testid="settings"]' },
  { path: '/admin', name: 'Admin', landmark: 'main, [data-testid="operator-list"]' },
];

test.describe('Route smoke — real app renders every page', () => {
  for (const route of ROUTES) {
    test(`${route.name} (${route.path}) renders without runtime errors`, async ({ page }) => {
      const pageErrors: string[] = [];
      const consoleErrors: string[] = [];
      page.on('pageerror', (err) => pageErrors.push(err.message));
      page.on('console', (msg) => {
        if (msg.type() !== 'error') return;
        const text = msg.text();
        // Code errors are NEVER ignored — masking telemetry code errors is exactly
        // how "process is not defined" reached production. Only genuinely benign
        // NETWORK/resource failures (e.g. the torn-down Grafana/API endpoints) are
        // filtered, and only when they don't also look like a thrown code error.
        const isCodeError =
          /is not defined|Can't find variable|ReferenceError|TypeError|is not a function|Cannot read propert|undefined is not/i.test(
            text
          );
        const isBenignNetwork =
          /Failed to load resource|net::ERR|ERR_|favicon|status of 4\d\d|status of 5\d\d/i.test(text);
        if (isBenignNetwork && !isCodeError) return;
        consoleErrors.push(text);
      });

      await loginAsAdmin(page);
      await page.goto(route.path);

      // 1) The router settled on the intended route (no guard/redirect bounce).
      await expect
        .poll(() => new URL(page.url()).pathname, { timeout: 15000 })
        .toContain(route.path);

      // 2) The page actually painted its content (not blank, landmark present).
      await expect(page.locator(route.landmark).first()).toBeVisible({ timeout: 15000 });

      // 3) No error banner surfaced.
      await expect(page.locator('[data-testid="error-message"]')).toHaveCount(0);

      // 4) No uncaught exception / app-level console error while loading.
      expect(pageErrors, `uncaught error(s) on ${route.path}:\n${pageErrors.join('\n')}`).toEqual(
        []
      );
      expect(
        consoleErrors,
        `console.error(s) on ${route.path}:\n${consoleErrors.join('\n')}`
      ).toEqual([]);
    });
  }

  test('login page renders for an unauthenticated visitor', async ({ page }) => {
    const pageErrors: string[] = [];
    page.on('pageerror', (err) => pageErrors.push(err.message));
    await page.goto('/login');
    await expect(page.locator('[data-testid="input-email"]')).toBeVisible({ timeout: 15000 });
    expect(pageErrors, pageErrors.join('\n')).toEqual([]);
  });
});
