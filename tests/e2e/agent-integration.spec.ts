import { test, expect, type Page } from '@playwright/test';
import { loginAsAdmin } from './helpers/auth';

/**
 * E2E tests around the POS sales flow and the agent-monitor dashboard.
 *
 * NOTE: this spec was originally written spec-first against a planned
 * agent-observability UI (agent cards, circuit-breaker cards, telemetry metric
 * cards, per-operation audit-log entries, payment-result banners, loyalty
 * points) and routes (/pos-terminal, /monitor) that were never built. The
 * salvageable tests below are rewritten against the REAL app (routes /pos and
 * /dashboard, reactive product search, click-to-add product results, the
 * cash-payment → receipt overlay flow). The remaining tests assert UI that does
 * not exist yet and are quarantined with test.fixme() — tracked in issue #67.
 */

/**
 * Navigate to the POS terminal and add a product to the cart via the reactive
 * search (with a Beverages-category fallback). Leaves the cart populated and the
 * terminal ready for checkout.
 */
async function addProductToCart(page: Page, productName = 'Coffee'): Promise<void> {
  await page.goto('/pos');
  await expect(page.getByTestId('pos-terminal')).toBeVisible();

  // Reactive search (300ms debounce) — no search button needed.
  const searchInput = page.getByTestId('product-search');
  await searchInput.click();
  await searchInput.fill('');
  await searchInput.type(productName, { delay: 50 });
  await page.waitForTimeout(500);

  // Fallback to the Beverages category if the search didn't surface a result.
  const firstResult = page.getByTestId('product-result').first();
  if (!(await firstResult.isVisible({ timeout: 5000 }).catch(() => false))) {
    const beverages = page.getByTestId('category-Beverages');
    if (await beverages.isVisible().catch(() => false)) {
      await beverages.click();
      await page.waitForTimeout(1000);
    }
  }

  // Clicking a product result adds it to the cart.
  await expect(firstResult).toBeVisible({ timeout: 5000 });
  await firstResult.click({ force: true });
  await expect(page.getByTestId('cart-items')).toBeVisible();
}

/**
 * Drive a complete cash sale from the POS terminal, mirroring the proven flow in
 * s4-5-inventory-customer-workflows.spec.ts. Leaves the receipt overlay visible.
 */
async function completeCashSale(page: Page, productName = 'Coffee'): Promise<void> {
  await addProductToCart(page, productName);

  // Checkout → cash → confirm.
  await page.getByTestId('checkout-btn').click();
  await expect(page.getByTestId('checkout-overlay')).toBeVisible();
  await page.getByTestId('method-cash').click();
  await page.getByTestId('btn-proceed').click();
  await expect(page.getByTestId('cash-payment')).toBeVisible();
  await page.getByTestId('cash-tendered').fill('10.00');
  await page.getByTestId('btn-confirm-cash').click();
}

/** The simulated payment gateway always declines this PAN (see CheckoutComponent). */
const DECLINED_CARD = '4000000000000002';

/**
 * From a POS terminal with a populated cart (and no intervening page reload —
 * the circuit-breaker state is held in an in-memory singleton), open checkout
 * and fill the card form with the always-declined test card.
 */
async function openDeclinedCardForm(page: Page): Promise<void> {
  await page.getByTestId('checkout-btn').click();
  await expect(page.getByTestId('checkout-overlay')).toBeVisible();
  await page.getByTestId('method-card').click();
  await page.getByTestId('btn-proceed').click();
  await expect(page.getByTestId('card-payment')).toBeVisible();
  await page.getByTestId('card-number').fill(DECLINED_CARD);
  await page.getByTestId('card-expiry').fill('12/30');
  await page.getByTestId('card-cvv').fill('123');
}

test.describe('Agent Integration Workflow', () => {
  test.beforeEach(async ({ page }) => {
    await loginAsAdmin(page);
  });

  test('should complete full sales transaction workflow', async ({ page }) => {
    // Real end-to-end purchase: search → add → checkout → cash → receipt.
    // (pos-terminal.spec.ts stops at checkout, so this adds payment+receipt coverage.)
    await completeCashSale(page, 'Coffee');

    const receipt = page.getByTestId('receipt-overlay');
    await expect(receipt).toBeVisible({ timeout: 10000 });
    await expect(page.getByTestId('transaction-id')).toBeVisible();
    await expect(page.getByTestId('receipt-total')).toBeVisible();

    // Start a fresh transaction to confirm the flow resets cleanly.
    await page.getByTestId('btn-new-transaction').click();
    await expect(page.getByTestId('receipt-overlay')).toBeHidden();
  });

  test('should monitor agents in dashboard', async ({ page }) => {
    // Real dashboard smoke test: the agent-monitor route loads and renders its
    // widgets container. (audit-trace is conditional on existing audit logs, so
    // it is not asserted here — see #67 for the full observability coverage.)
    await page.goto('/dashboard');
    await expect(page).toHaveURL(/.*dashboard/);
    await expect(page.getByTestId('dashboard-widgets')).toBeVisible({ timeout: 10000 });
  });

  // ── Quarantined: assert agent-observability / payment-result UI not yet built (#67) ──

  test('should handle payment failure with retry', async ({ page }) => {
    // The simulated gateway declines the well-known test card; the checkout
    // retries (payment-retrying) before surfacing the failure (payment-error).
    await addProductToCart(page, 'Coffee');
    await openDeclinedCardForm(page);
    await page.getByTestId('btn-confirm-card').click();

    // Retry banner appears between gateway attempts, then the terminal error.
    await expect(page.getByTestId('payment-retrying')).toBeVisible({ timeout: 10000 });
    const error = page.getByTestId('payment-error');
    await expect(error).toBeVisible({ timeout: 15000 });
    await expect(error).toContainText('Payment failed');
  });

  test('should handle circuit breaker opening on repeated failures', async ({ page }) => {
    // Five consecutive declines trip the 'payment-gateway' breaker. Stay in the
    // same SPA session (no reload) so the in-memory breaker accumulates failures:
    // add the product once, then re-confirm from the error state each time.
    await addProductToCart(page, 'Coffee');
    await openDeclinedCardForm(page);

    for (let i = 0; i < 5; i++) {
      await page.getByTestId('btn-confirm-card').click();
      await expect(page.getByTestId('payment-error')).toBeVisible({ timeout: 15000 });
      if (i < 4) {
        // Back to the card form (fields retained) for the next attempt.
        await page.getByTestId('btn-retry-payment').click();
        await expect(page.getByTestId('card-payment')).toBeVisible();
      }
    }

    // In-app nav (NOT goto, which would reload and reset the breaker singleton).
    await page.getByTestId('btn-cancel-payment').click();
    await page.locator('[data-testid="nav-dashboard"]:visible').click();
    await expect(page).toHaveURL(/.*dashboard/);

    const paymentCircuit = page
      .locator('[data-testid="circuit-breaker-card"]')
      .filter({ hasText: 'payment-gateway' });
    await expect(paymentCircuit).toBeVisible({ timeout: 10000 });
    await expect(paymentCircuit.getByTestId('circuit-state')).toHaveText('OPEN');
  });

  test('should record an audit-log entry for a sale', async ({ page }) => {
    // The checkout flow writes an audit entry (PosFacade → AuditLogService).
    // Navigate IN-APP to /dashboard (keeps the in-memory log) and assert the
    // Recent Audit Logs panel shows the PaymentAgent/processPayment entry. (#96)
    await completeCashSale(page, 'Coffee');
    await expect(page.getByTestId('receipt-overlay')).toBeVisible({ timeout: 10000 });
    await page.getByTestId('btn-new-transaction').click();

    await page.locator('[data-testid="nav-dashboard"]:visible').click();
    await expect(page).toHaveURL(/.*dashboard/);

    const entry = page.getByTestId('audit-log-entry').filter({ hasText: 'processPayment' });
    await expect(entry.first()).toBeVisible({ timeout: 10000 });
  });

  test('should record telemetry metrics for a sale', async ({ page }) => {
    // The checkout flow records a payments.processed counter (PosFacade →
    // TelemetryService); the dashboard's Metrics panel reflects it. (#98)
    await completeCashSale(page, 'Coffee');
    await expect(page.getByTestId('receipt-overlay')).toBeVisible({ timeout: 10000 });
    await page.getByTestId('btn-new-transaction').click();

    await page.locator('[data-testid="nav-dashboard"]:visible').click();
    await expect(page).toHaveURL(/.*dashboard/);

    const paymentMetric = page.getByTestId('metric-card').filter({ hasText: 'payments.processed' });
    await expect(paymentMetric).toBeVisible({ timeout: 10000 });
    await expect(paymentMetric.getByTestId('metric-value')).not.toHaveText('0');
  });

  test('should surface event-bus activity on the dashboard after a sale', async ({ page }) => {
    // A real cash sale publishes events; navigate IN-APP (not goto, which would
    // reload and reset the in-memory bus) to the dashboard and assert the
    // Event Bus Activity panel reflects them. (#97)
    await completeCashSale(page, 'Coffee');
    await expect(page.getByTestId('receipt-overlay')).toBeVisible({ timeout: 10000 });
    await page.getByTestId('btn-new-transaction').click();

    await page.locator('[data-testid="nav-dashboard"]:visible').click();
    await expect(page).toHaveURL(/.*dashboard/);

    await expect(page.getByTestId('event-bus-stats')).toBeVisible();
    // The cart/checkout published events, so the message counter is non-zero.
    await expect(page.getByTestId('total-messages')).not.toHaveText('0');
    await expect(page.getByTestId('messages-by-type').first()).toBeVisible();
  });

  test('should export audit logs as a download', async ({ page }) => {
    // A sale writes an audit entry; the dashboard's Export button downloads the log. (#96)
    await completeCashSale(page, 'Coffee');
    await expect(page.getByTestId('receipt-overlay')).toBeVisible({ timeout: 10000 });
    await page.getByTestId('btn-new-transaction').click();

    await page.locator('[data-testid="nav-dashboard"]:visible').click();
    await expect(page).toHaveURL(/.*dashboard/);
    await expect(page.getByTestId('audit-log-entry').first()).toBeVisible({ timeout: 10000 });

    const downloadPromise = page.waitForEvent('download');
    await page.getByTestId('export-audit-logs').click();
    const download = await downloadPromise;
    expect(download.suggestedFilename()).toMatch(/audit-logs.*\.(json|csv)/);
  });

  test('should reduce inventory stock after a sale', async ({ page }) => {
    // Cross-feature: a sale reduces the product's stock (AdjustStockOnSaleUseCase,
    // persisted to IndexedDB). Read stock on /inventory before + after one sale.
    const readCoffeeStock = async (): Promise<number> => {
      await page.goto('/inventory');
      await expect(page.getByTestId('inventory-page')).toBeVisible();
      const row = page
        .locator('[data-testid^="product-row-"]')
        .filter({ hasText: 'Coffee' })
        .filter({ visible: true });
      await expect(row).toBeVisible({ timeout: 5000 });
      const text = (await row.textContent()) ?? '';
      return parseInt(text.match(/(\d+)\s*units/)?.[1] ?? '0');
    };

    const before = await readCoffeeStock();
    await completeCashSale(page, 'Coffee');
    await expect(page.getByTestId('receipt-overlay')).toBeVisible({ timeout: 10000 });
    await page.getByTestId('btn-new-transaction').click();
    const after = await readCoffeeStock();
    expect(after).toBe(before - 1);
  });
});

test.describe('Agent Error Handling', () => {
  test.beforeEach(async ({ page }) => {
    await loginAsAdmin(page);
  });

  test('should gracefully handle search with no results and recover', async ({ page }) => {
    // Real behaviour: an unknown product shows the no-results state, and the app
    // stays usable for a subsequent valid search.
    await page.goto('/pos');
    await expect(page.getByTestId('pos-terminal')).toBeVisible();

    const searchInput = page.getByTestId('product-search');
    await searchInput.click();
    await searchInput.type('INVALID_PRODUCT_XYZ', { delay: 30 });
    await page.waitForTimeout(500);
    await expect(page.getByTestId('no-results')).toBeVisible();

    // App recovers: a valid search still returns results.
    await searchInput.fill('');
    await searchInput.type('Coffee', { delay: 30 });
    await page.waitForTimeout(500);
    await expect(page.getByTestId('product-result').first()).toBeVisible({ timeout: 5000 });
  });

  test('should recover from circuit breaker open state', async ({ page }) => {
    // Self-contained recovery, all in ONE SPA session (the breaker is an
    // in-memory singleton; a reload would reset it). Trip it with 5 declines,
    // wait past its 5s open window, then a successful card sale moves it out of
    // OPEN (HALF_OPEN on the first recovery probe).
    test.setTimeout(60000);

    await addProductToCart(page, 'Coffee');
    await openDeclinedCardForm(page);
    for (let i = 0; i < 5; i++) {
      await page.getByTestId('btn-confirm-card').click();
      await expect(page.getByTestId('payment-error')).toBeVisible({ timeout: 15000 });
      if (i < 4) {
        await page.getByTestId('btn-retry-payment').click();
        await expect(page.getByTestId('card-payment')).toBeVisible();
      }
    }
    await page.getByTestId('btn-cancel-payment').click();

    // Confirm the breaker is OPEN.
    await page.locator('[data-testid="nav-dashboard"]:visible').click();
    await expect(page).toHaveURL(/.*dashboard/);
    const paymentCircuit = page
      .locator('[data-testid="circuit-breaker-card"]')
      .filter({ hasText: 'payment-gateway' });
    await expect(paymentCircuit.getByTestId('circuit-state')).toHaveText('OPEN', { timeout: 10000 });

    // Wait past the breaker's open window (5s timeout) so it can probe.
    await page.waitForTimeout(6000);

    // A successful card sale (good test card) probes the gateway → HALF_OPEN.
    // In-app nav back to POS keeps the breaker singleton alive; the cart still
    // holds the item from the declined attempts.
    await page.locator('[data-testid="nav-pos"]:visible').click();
    await expect(page.getByTestId('pos-terminal')).toBeVisible();
    await page.getByTestId('checkout-btn').click();
    await expect(page.getByTestId('checkout-overlay')).toBeVisible();
    await page.getByTestId('method-card').click();
    await page.getByTestId('btn-proceed').click();
    await page.getByTestId('card-number').fill('4242424242424242');
    await page.getByTestId('card-expiry').fill('12/30');
    await page.getByTestId('card-cvv').fill('123');
    await page.getByTestId('btn-confirm-card').click();
    await expect(page.getByTestId('receipt-overlay')).toBeVisible({ timeout: 15000 });
    await page.getByTestId('btn-new-transaction').click();

    // The breaker has left the OPEN state.
    await page.locator('[data-testid="nav-dashboard"]:visible').click();
    await expect(page).toHaveURL(/.*dashboard/);
    await expect(async () => {
      const state = await paymentCircuit.getByTestId('circuit-state').textContent();
      expect(['HALF_OPEN', 'CLOSED']).toContain((state ?? '').trim());
    }).toPass({ timeout: 10000 });
  });
});

test.describe('Performance Tests', () => {
  test.beforeEach(async ({ page }) => {
    await loginAsAdmin(page);
  });

  test.fixme('should handle concurrent transactions', async ({ page }) => {
    // Needs total-messages metrics dashboard; also drives the non-existent flow.
    const startTime = Date.now();
    const transactions = [];
    for (let i = 0; i < 10; i++) {
      transactions.push(
        (async () => {
          await page.goto('http://localhost:4200/pos-terminal');
          await page.fill('[data-testid="product-search"]', 'Coffee');
          await page.click('[data-testid="search-button"]');
          await page.click('[data-testid="add-to-cart"]');
          await page.click('[data-testid="checkout-button"]');
          await page.click('[data-testid="payment-method-cash"]');
          await page.fill('[data-testid="cash-amount"]', '10.00');
          await page.click('[data-testid="submit-payment"]');
          await page.waitForSelector('[data-testid="payment-success"]');
        })()
      );
    }
    await Promise.all(transactions);
    expect(Date.now() - startTime).toBeLessThan(30000);
    await page.goto('http://localhost:4200/monitor');
    const totalMessages = await page.textContent('[data-testid="total-messages"]');
    expect(parseInt(totalMessages || '0')).toBeGreaterThanOrEqual(10);
  });
});

// Made with Bob
