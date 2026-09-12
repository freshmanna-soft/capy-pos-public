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
 * This suite loads each top-level route in the REAL served app and fails on the
 * four unambiguous "this page is broken" signals:
 *   1. the route bounced somewhere unexpected (guard/redirect break),
 *   2. the page rendered blank (its landmark never appeared),
 *   3. an error banner surfaced,
 *   4. an uncaught exception (pageerror) or an app-level console.error.
 *
 * Every route gets all four checks in every session state it is smoked in — the
 * assertions live in `expectRouteRendered` rather than being written out per
 * test, because a copy that quietly drops one (an anonymous-only blank render, an
 * anonymous-only `console.error`) is green for the wrong reason.
 *
 * It is INTENTIONALLY always-run (never gated by affected-spec selection): a
 * page broken by a change usually isn't "affected" by that change's files,
 * which is exactly why the regression slips through. Keep it cheap so it can
 * run on every push.
 */

/** A route to load, with a landmark that proves the page painted. */
interface SmokeRoute {
  path: string;
  name: string;
  landmark: string;
}

/** App routes to smoke as a logged-in admin. */
const ROUTES: SmokeRoute[] = [
  { path: '/pos', name: 'POS terminal', landmark: '[data-testid="pos-terminal"]' },
  { path: '/inventory', name: 'Inventory', landmark: 'main, [data-testid="inventory-management"]' },
  { path: '/customers', name: 'Customers', landmark: 'main, [data-testid="customers"]' },
  { path: '/reports', name: 'Reports', landmark: 'main, [data-testid="reports"]' },
  { path: '/dashboard', name: 'Agent dashboard', landmark: 'main, [data-testid="agent-monitor"]' },
  {
    path: '/history',
    name: 'Transaction history',
    landmark: 'main, [data-testid="transaction-history"]',
  },
  { path: '/settings', name: 'Settings', landmark: 'main, [data-testid="settings"]' },
  // Unguarded on purpose (customer lane), but still smoked as a logged-in admin
  // like the rest — the risk being caught here is a page that throws, not a guard.
  {
    path: '/self-checkout',
    name: 'Self-checkout',
    landmark: '[data-testid="self-checkout-shell"]',
  },
  // The lane's side path (epic #261 item 16) and the interstitial it lands on.
  // Reachable without any session on purpose: registration is optional, so these
  // are smoked in both session states like the lane itself.
  {
    path: '/self-checkout/sign-up',
    name: 'Self-checkout sign-up',
    landmark: '[data-testid="self-checkout-signup"]',
  },
  {
    path: '/self-checkout/check-email',
    name: 'Self-checkout check email',
    landmark: '[data-testid="self-checkout-check-email"]',
  },
  // Also unguarded on purpose (#219) — the customer checks themselves out here.
  { path: '/clerk', name: 'Capy Clerk', landmark: '[data-testid="clerk-stage"]' },
  { path: '/admin', name: 'Admin', landmark: 'main, [data-testid="operator-list"]' },
];

/**
 * The routes a customer with no operator session has to be able to reach.
 *
 * Resolved out of ROUTES rather than listed separately so the anonymous pass
 * cannot drift from the logged-in one — same landmark, same checks, one session
 * state apart. Missing a path here is a hard error rather than a silently
 * skipped route.
 */
const ANONYMOUS_ROUTES: SmokeRoute[] = [
  '/clerk',
  '/self-checkout',
  '/self-checkout/sign-up',
  '/self-checkout/check-email',
].map((path) => {
  const route = ROUTES.find((candidate) => candidate.path === path);
  if (!route) {
    throw new Error(`${path} is smoked anonymously but is missing from ROUTES`);
  }
  return route;
});

/** The two channels a runtime failure announces itself on. */
interface ErrorLog {
  pageErrors: string[];
  consoleErrors: string[];
}

/**
 * Start collecting both error channels. Must be called before `goto`, or the
 * errors thrown during the page's own bootstrap are missed.
 */
function watchForErrors(page: Page): ErrorLog {
  const log: ErrorLog = { pageErrors: [], consoleErrors: [] };

  page.on('pageerror', (err) => log.pageErrors.push(err.message));
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
    log.consoleErrors.push(text);
  });

  return log;
}

/**
 * The full "this page is not broken" assertion set, applied identically in every
 * session state. Kept in one place on purpose: the anonymous pass once asserted a
 * subset, which made a blank render or a console error on the only state that
 * change introduced pass green.
 */
async function expectRouteRendered(page: Page, route: SmokeRoute, errors: ErrorLog): Promise<void> {
  // 1) The router settled on the intended route (no guard/redirect bounce).
  await expect.poll(() => new URL(page.url()).pathname, { timeout: 15000 }).toContain(route.path);

  // 2) The page actually painted its content (not blank, landmark present).
  await expect(page.locator(route.landmark).first()).toBeVisible({ timeout: 15000 });

  // 3) No error banner surfaced.
  await expect(page.locator('[data-testid="error-message"]')).toHaveCount(0);

  // 4) No uncaught exception / app-level console error while loading.
  expect(
    errors.pageErrors,
    `uncaught error(s) on ${route.path}:\n${errors.pageErrors.join('\n')}`
  ).toEqual([]);
  expect(
    errors.consoleErrors,
    `console.error(s) on ${route.path}:\n${errors.consoleErrors.join('\n')}`
  ).toEqual([]);
}

test.describe('Route smoke — real app renders every page', () => {
  for (const route of ROUTES) {
    test(`${route.name} (${route.path}) renders without runtime errors`, async ({ page }) => {
      const errors = watchForErrors(page);

      await loginAsAdmin(page);
      await page.goto(route.path);

      await expectRouteRendered(page, route, errors);
    });
  }

  /**
   * The point of un-gating /clerk (#219): a customer with no operator session
   * reaches the capybara instead of the staff login page. The logged-in smoke
   * above cannot see this — authGuard only redirects when there is no session —
   * so the anonymous case needs its own pass, with the same four checks.
   */
  for (const route of ANONYMOUS_ROUTES) {
    test(`${route.name} (${route.path}) renders for an anonymous visitor`, async ({ page }) => {
      const errors = watchForErrors(page);

      await page.goto(route.path);

      // Did NOT bounce to /login — the guard is genuinely off this route.
      expect(new URL(page.url()).pathname).not.toContain('/login');
      await expectRouteRendered(page, route, errors);
    });
  }

  test('login page renders for an unauthenticated visitor', async ({ page }) => {
    const errors = watchForErrors(page);
    await page.goto('/login');
    await expect(page.locator('[data-testid="input-email"]')).toBeVisible({ timeout: 15000 });
    expect(errors.pageErrors, errors.pageErrors.join('\n')).toEqual([]);
  });
});
