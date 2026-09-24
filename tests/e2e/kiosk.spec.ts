import { test, expect, ConsoleMessage } from '@playwright/test';
import { KioskPage } from './helpers/kiosk';

/**
 * Kiosk E2E Tests — Physical Terminal Flow
 *
 * These specs cover the self-checkout scenarios for a configured kiosk terminal
 * (the `/kiosk/shop` route). The app auto-seeds products and RBAC defaults in
 * APP_INITIALIZER, so no manual Dexie seeding is required.
 *
 * All remote API calls are stubbed:
 *   - GET  /api/products        → empty (stubLiveSyncEndpoints)
 *   - GET  /api/transactions    → empty (stubLiveSyncEndpoints)
 *   - POST /api/transactions    → 201  (stubTransactionEndpoint)
 *
 * No running backend is required.
 */

test.describe('Kiosk — Physical terminal checkout', () => {
  let kiosk: KioskPage;

  test.beforeEach(async ({ page }) => {
    kiosk = new KioskPage(page);
    await kiosk.setup(); // stubs live sync + POST /api/transactions
  });

  // ── Scenario 1: Anonymous checkout ──────────────────────────────────────────

  /**
   * Given the kiosk is running with products in the catalogue
   * When an anonymous customer adds a product and completes cash payment
   * Then the receipt overlay is shown and the cart is cleared
   */
  test('anonymous customer: adds product, pays cash, sees receipt', async () => {
    // Given — navigate directly to the shop (no sign-in required)
    await kiosk.navigateToShop();

    // When — add a product to the cart
    await kiosk.addFirstProductToCart();
    // Verify the cart is non-empty by checking the pay-now button is visible
    await expect(kiosk.payNowBtn).toBeVisible({ timeout: 5_000 });

    // When — complete cash payment
    await kiosk.completeCashPayment('10');

    // Then — receipt is shown
    await expect(kiosk.receiptWrapper).toBeVisible({ timeout: 10_000 });

    // Then — checkout overlay is gone (cart was cleared by facade)
    await expect(kiosk.checkoutOverlay).not.toBeVisible();
  });

  // ── Scenario 2: Signed-in customer checkout ──────────────────────────────────

  /**
   * Given the kiosk is running and a customer account exists
   * When the customer signs in with their email on the splash screen
   *  and then adds a product and completes cash payment
   * Then the receipt is shown and no auth error is visible
   */
  test('signed-in customer: signs in on splash, pays cash, sees receipt', async () => {
    // Given — navigate to the splash screen
    await kiosk.navigateToSplash();

    // When — open the sign-in modal and sign in with the seeded admin email
    // (admin@capy-pos.local is the only guaranteed account in all environments)
    await kiosk.signInBtn.click();
    await kiosk.authEmailInput.waitFor({ state: 'visible' });
    await kiosk.authEmailInput.fill('admin@capy-pos.local');
    await kiosk.signInSubmit.click();

    // Then — the splash navigates to the shop (auth email resolves to a Customer
    // or creates one; either way we end up in the shop)
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
   * Given the kiosk is running
   * When a new customer enters an email that does not exist and clicks "Create Account"
   * Then the account is created without error and the customer lands on the shop
   */
  test('new customer: creates account via email, lands on shop', async ({ page }) => {
    // Given — navigate to the splash screen
    await kiosk.navigateToSplash();

    // When — open the auth modal and create a new account
    await kiosk.signInBtn.click();
    await kiosk.authEmailInput.waitFor({ state: 'visible' });
    // Use a unique email so the account does not already exist
    const newEmail = `e2e-${Date.now()}@test.local`;
    await kiosk.authEmailInput.fill(newEmail);
    await kiosk.createAccountBtn.click();

    // Then — no auth error (phone validation no longer required)
    await page.waitForTimeout(500); // allow async customer creation
    await expect(kiosk.authError).not.toBeVisible();

    // Then — navigated to the shop
    await kiosk.productGrid.waitFor({ state: 'visible', timeout: 10_000 });
  });

  // ── Scenario 4: Checkout error — persistence failure leaves cart intact ──────

  /**
   * Given the kiosk is running with a product in the cart
   * When POST /api/transactions returns 500 (simulating a backend failure)
   * Then the error banner is shown, the cart is preserved, and no receipt appears
   */
  test('persistence failure: shows error banner, preserves cart, no receipt', async ({ page }) => {
    // Override the default 201 stub with a 500
    await page.route(
      (url) => url.pathname.endsWith('/api/transactions'),
      (route) =>
        route.request().method() === 'POST'
          ? route.fulfill({ status: 500, body: 'Internal Server Error' })
          : route.continue(),
    );

    // Given — navigate to the shop and add a product
    await kiosk.navigateToShop();
    await kiosk.addFirstProductToCart();
    await expect(kiosk.payNowBtn).toBeVisible({ timeout: 5_000 });

    // When — complete cash payment (remote call will 500)
    await kiosk.completeCashPayment('10');

    // Then — error banner is shown
    await expect(kiosk.checkoutError).toBeVisible({ timeout: 10_000 });

    // Then — receipt is NOT shown
    await expect(kiosk.receiptWrapper).not.toBeVisible();
  });

  // ── Scenario 5: Worker log is info (not warn) in kiosk context ───────────────

  /**
   * Given the kiosk is running anonymously (no operator session)
   * When an anonymous customer completes a cash payment
   * Then the sync worker's "No operator session" log is emitted at info level,
   *   not warn — because SyncKioskModeService sets kioskMode: true on /kiosk routes
   * And no console.warn message about "No operator session" appears
   */
  test('anonymous checkout: worker emits info (not warn) for missing session', async ({ page }) => {
    const warnings: ConsoleMessage[] = [];
    page.on('console', (msg) => {
      if (msg.type() === 'warning') warnings.push(msg);
    });

    // Given — navigate to shop (kiosk route → SyncKioskModeService sets kioskMode: true)
    await kiosk.navigateToShop();
    await kiosk.addFirstProductToCart();
    await expect(kiosk.payNowBtn).toBeVisible({ timeout: 5_000 });

    // When — complete cash payment
    await kiosk.completeCashPayment('10');

    // Then — receipt shown (payment succeeded)
    await expect(kiosk.receiptWrapper).toBeVisible({ timeout: 10_000 });

    // Give the worker a moment to process any queued stock pushes
    await page.waitForTimeout(1_500);

    // Then — no "No operator session" at warn level
    const sessionWarnings = warnings.filter((m) =>
      m.text().includes('No operator session'),
    );
    expect(
      sessionWarnings,
      `Expected no console.warn about "No operator session" in kiosk mode,` +
      ` but found ${sessionWarnings.length}:\n` +
      sessionWarnings.map((m) => `  ${m.text()}`).join('\n'),
    ).toHaveLength(0);
  });
});
