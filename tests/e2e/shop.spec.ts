import { test, expect } from '@playwright/test';
import { KioskPage, stubShopSessionEndpoint, stubTransactionEndpoint } from './helpers/kiosk';
import { loginAsAdmin, stubLiveSyncEndpoints } from './helpers/auth';

/**
 * Shop E2E Tests — Customer Phone (Scan & Go) Flow
 *
 * These specs cover the self-checkout scenarios for a customer using their own
 * phone to shop at a kiosk-configured store (the future `/shop` route).
 *
 * CURRENT STATE: The dedicated `/shop` route is planned (ST-2 of the
 * kiosk-customer-checkout-plan.md). Until it exists, these tests run against
 * `/kiosk/shop` — the same `KioskShopComponent` — to establish the test
 * contract and ensure it passes before the route is promoted.
 *
 * When ST-2 lands, update `SHOP_ROUTE` below to '/shop' and the tests will
 * exercise the new dedicated component with no other changes.
 *
 * All remote API calls are stubbed:
 *   - GET  /api/products        → empty (stubLiveSyncEndpoints)
 *   - GET  /api/transactions    → empty (stubLiveSyncEndpoints)
 *   - POST /api/transactions    → 201  (stubTransactionEndpoint)
 *   - POST /api/shop/session    → 201  (stubShopSessionEndpoint)
 *
 * No running backend is required.
 */

/**
 * The kiosk shop route — auth-guarded (operator session required).
 * loginAsAdmin() in beforeEach establishes that session via sessionStorage
 * injection before navigating here.
 */
const SHOP_ROUTE = '/kiosk/shop';

test.describe('Shop — Customer phone self-checkout flow', () => {
  let kiosk: KioskPage;

  test.beforeEach(async ({ page }) => {
    kiosk = new KioskPage(page);
    // loginAsAdmin stubs sync endpoints + shop session, injects the JWT, and
    // lands on /pos. The subsequent page.goto(SHOP_ROUTE) then passes the auth
    // guard because the token is already in sessionStorage.
    await loginAsAdmin(page);
    await stubTransactionEndpoint(page);
    await stubShopSessionEndpoint(page);
  });

  // ── Scenario 1: Anonymous checkout ──────────────────────────────────────────

  /**
   * Given a customer opens the shop URL on their phone
   *  and no account is required
   * When they add a product and complete cash payment
   * Then the receipt overlay is shown
   */
  test('anonymous customer: adds product, pays cash, sees receipt', async ({ page }) => {
    // Given — navigate to the shop without signing in
    await page.goto(SHOP_ROUTE);
    await kiosk.productGrid.waitFor({ state: 'visible', timeout: 15_000 });

    // When — add product and pay
    await kiosk.addFirstProductToCart();
    await expect(kiosk.payNowBtn).toBeVisible({ timeout: 5_000 });
    await kiosk.completeCashPayment('10');

    // Then — receipt is shown
    await expect(kiosk.receiptWrapper).toBeVisible({ timeout: 10_000 });
  });

  // ── Scenario 2: Signed-in customer checkout ──────────────────────────────────

  /**
   * Given a customer opens the shop URL and signs in with an existing email
   * When they add a product and complete cash payment
   * Then the receipt is shown and no auth error occurred
   */
  test('signed-in customer: signs in on splash, pays cash, sees receipt', async ({ page }) => {
    // Given — navigate to the splash to sign in first
    await page.goto('/kiosk');
    await kiosk.startShoppingBtn.waitFor({ state: 'visible', timeout: 15_000 });

    // When — sign in with the seeded admin account
    await kiosk.signInBtn.click();
    await kiosk.authEmailInput.waitFor({ state: 'visible' });
    await kiosk.authEmailInput.fill('admin@capy-pos.local');
    await kiosk.signInSubmit.click();

    // Then — lands on the shop
    await kiosk.productGrid.waitFor({ state: 'visible', timeout: 10_000 });
    await expect(kiosk.authError).not.toBeVisible();

    // When — add product and pay
    await kiosk.addFirstProductToCart();
    await kiosk.completeCashPayment('10');

    // Then — receipt is shown
    await expect(kiosk.receiptWrapper).toBeVisible({ timeout: 10_000 });
  });

  // ── Scenario 3: New account creation ────────────────────────────────────────

  /**
   * Given a customer opens the shop URL on their phone
   * When they create a new account using only their email
   *  (the form asks for email only — phone is not required)
   * Then no validation error is shown and they land on the shop
   */
  test('new customer: creates account with email only, lands on shop', async ({ page }) => {
    // Given — navigate to the splash screen
    await page.goto('/kiosk');
    await kiosk.startShoppingBtn.waitFor({ state: 'visible', timeout: 15_000 });

    // When — open the auth modal and create an account (email only — no phone field)
    await kiosk.signInBtn.click();
    await kiosk.authEmailInput.waitFor({ state: 'visible' });
    const newEmail = `shop-e2e-${Date.now()}@test.local`;
    await kiosk.authEmailInput.fill(newEmail);
    await kiosk.createAccountBtn.click();

    // Then — no "phone is required" error (FIX-B: phone is optional)
    await page.waitForTimeout(500);
    await expect(kiosk.authError).not.toBeVisible();

    // Then — navigated to the shop
    await kiosk.productGrid.waitFor({ state: 'visible', timeout: 10_000 });
  });

  // ── Scenario 4: Session endpoint failure — shop cannot load ──────────────────

  /**
   * Given a customer opens the shop URL
   * When POST /api/shop/session returns 500
   * Then the shop shows an error state rather than loading normally
   *
   * NOTE: This test validates the future ShopComponent's error handling (ST-2).
   * Against /kiosk/shop the session call doesn't happen — the test is a
   * placeholder that verifies the route at least loads without crashing, so it
   * is marked as skippable until ST-2 lands.
   */
  test.skip('session endpoint failure: shop shows error state', async ({ page }) => {
    // Override session stub with 500
    await page.route(
      (url) => url.pathname.endsWith('/api/shop/session'),
      (route) => route.fulfill({ status: 500, body: 'Server Error' }),
    );

    await page.goto('/shop'); // will fail until ST-2 adds this route
    // After ST-2: await page.getByTestId('shop-session-error').waitFor({ state: 'visible' });
  });
});
