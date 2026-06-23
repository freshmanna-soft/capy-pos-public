import { Page } from '@playwright/test';

/**
 * loginAsAdmin
 *
 * Performs a full UI login as the seeded admin operator.
 *
 * The DexieDatabase.seedRbacDefaults() method is called inside an awaited
 * APP_INITIALIZER on every boot, so by the time the /login page renders the
 * admin operator (admin@capy-pos.local / admin1234) is guaranteed to exist in
 * IndexedDB. No manual seeding workaround is needed.
 *
 * Steps:
 *  1. Navigate to /login and wait for Angular + Dexie to finish initialising
 *     (APP_INITIALIZER runs before routing, so the login form only appears
 *     after seedRbacDefaults() has completed).
 *  2. Fill email + password and submit the form.
 *  3. Wait until the router redirects away from /login to confirm success.
 *
 * The JWT is stored in sessionStorage by LocalCredentialAuthAdapter, so it
 * persists for all subsequent page.goto() calls within the same browser context.
 * Playwright storageState does NOT persist sessionStorage; therefore this helper
 * must be called once per test (in beforeEach).
 *
 * Selectors used (verbatim from LoginComponent template):
 *   data-testid="input-email"    — email <input>
 *   data-testid="input-password" — password <input>
 *   data-testid="btn-login"      — submit <button>
 */
export async function loginAsAdmin(page: Page): Promise<void> {
  // Step 1: Navigate to /login and wait for Angular + Dexie to initialise.
  // APP_INITIALIZER (including seedRbacDefaults) completes before routing, so
  // the login form being visible means the seed has already run.
  await page.goto('/login');
  await page.waitForSelector('[data-testid="input-email"]', { state: 'visible', timeout: 15000 });

  // Step 2: Fill credentials and submit.
  await page.fill('[data-testid="input-email"]', 'admin@capy-pos.local');
  await page.fill('[data-testid="input-password"]', 'admin1234');
  await page.click('[data-testid="btn-login"]');

  // Step 3: Wait for the Angular router to redirect off /login.
  await page.waitForURL((url) => !url.pathname.startsWith('/login'), { timeout: 15000 });

  // Belt-and-suspenders: wait for the app navigation to render, confirming
  // the Angular router has settled on a protected route.
  await Promise.race([
    page
      .locator('[data-testid="navigation-desktop"]')
      .waitFor({ state: 'visible', timeout: 15000 })
      .catch(() => null),
    page
      .locator('[data-testid="navigation"]')
      .waitFor({ state: 'visible', timeout: 15000 })
      .catch(() => null),
  ]);
}
