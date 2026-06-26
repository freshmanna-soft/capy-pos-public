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
 * Drive a complete cash sale from the POS terminal, mirroring the proven flow in
 * s4-5-inventory-customer-workflows.spec.ts. Leaves the receipt overlay visible.
 */
async function completeCashSale(page: Page, productName = 'Coffee'): Promise<void> {
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

  // Checkout → cash → confirm.
  await page.getByTestId('checkout-btn').click();
  await expect(page.getByTestId('checkout-overlay')).toBeVisible();
  await page.getByTestId('method-cash').click();
  await page.getByTestId('btn-proceed').click();
  await expect(page.getByTestId('cash-payment')).toBeVisible();
  await page.getByTestId('cash-tendered').fill('10.00');
  await page.getByTestId('btn-confirm-cash').click();
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

  test.fixme('should handle payment failure with retry', async ({ page }) => {
    // Needs payment-error / payment-retrying UI (no failure path exists today).
    await page.goto('http://localhost:4200/pos-terminal');
    await page.fill('[data-testid="product-search"]', 'Coffee');
    await page.click('[data-testid="search-button"]');
    await page.click('[data-testid="add-to-cart"]');
    await page.click('[data-testid="checkout-button"]');
    await page.click('[data-testid="payment-method-card"]');
    await page.fill('[data-testid="card-number"]', '4000000000000002');
    await page.fill('[data-testid="card-expiry"]', '12/25');
    await page.fill('[data-testid="card-cvv"]', '123');
    await page.click('[data-testid="submit-payment"]');
    await page.waitForSelector('[data-testid="payment-retrying"]');
    await page.waitForSelector('[data-testid="payment-error"]', { timeout: 15000 });
    const errorMessage = await page.textContent('[data-testid="payment-error"]');
    expect(errorMessage).toContain('Payment failed');
  });

  test.fixme('should handle circuit breaker opening on repeated failures', async ({ page }) => {
    // Needs circuit-breaker-card / circuit-state UI.
    for (let i = 0; i < 5; i++) {
      await page.goto('http://localhost:4200/pos-terminal');
      await page.fill('[data-testid="product-search"]', 'Coffee');
      await page.click('[data-testid="search-button"]');
      await page.click('[data-testid="add-to-cart"]');
      await page.click('[data-testid="checkout-button"]');
      await page.click('[data-testid="payment-method-card"]');
      await page.fill('[data-testid="card-number"]', '4000000000000002');
      await page.fill('[data-testid="card-expiry"]', '12/25');
      await page.fill('[data-testid="card-cvv"]', '123');
      await page.click('[data-testid="submit-payment"]');
      await page.waitForSelector('[data-testid="payment-error"]');
      await page.click('[data-testid="clear-cart"]');
    }
    await page.goto('http://localhost:4200/monitor');
    await page.waitForSelector('[data-testid="circuit-breaker-card"]');
    const paymentCircuit = await page
      .locator('[data-testid="circuit-breaker-card"]')
      .filter({ hasText: 'payment-gateway' });
    const circuitState = await paymentCircuit.locator('[data-testid="circuit-state"]').textContent();
    expect(circuitState).toBe('OPEN');
  });

  test.fixme('should track audit logs for all operations', async ({ page }) => {
    // Needs per-operation audit-log-entry UI (dashboard only renders audit-trace).
    await page.goto('http://localhost:4200/pos-terminal');
    await page.fill('[data-testid="product-search"]', 'Coffee');
    await page.click('[data-testid="search-button"]');
    await page.click('[data-testid="add-to-cart"]');
    await page.click('[data-testid="checkout-button"]');
    await page.click('[data-testid="payment-method-cash"]');
    await page.fill('[data-testid="cash-amount"]', '10.00');
    await page.click('[data-testid="submit-payment"]');
    await page.waitForSelector('[data-testid="payment-success"]');
    await page.goto('http://localhost:4200/monitor');
    await page.waitForSelector('[data-testid="audit-log-entry"]');
    const auditLogs = await page.$$('[data-testid="audit-log-entry"]');
    expect(auditLogs.length).toBeGreaterThanOrEqual(4);
    const logTexts = await Promise.all(auditLogs.map((log) => log.textContent()));
    const hasPaymentLog = logTexts.some(
      (text) => text?.includes('PaymentAgent') && text?.includes('processPayment')
    );
    expect(hasPaymentLog).toBe(true);
  });

  test.fixme('should collect telemetry metrics', async ({ page }) => {
    // Needs metric-card / metric-value telemetry dashboard.
    for (let i = 0; i < 3; i++) {
      await page.goto('http://localhost:4200/pos-terminal');
      await page.fill('[data-testid="product-search"]', 'Coffee');
      await page.click('[data-testid="search-button"]');
      await page.click('[data-testid="add-to-cart"]');
      await page.click('[data-testid="checkout-button"]');
      await page.click('[data-testid="payment-method-cash"]');
      await page.fill('[data-testid="cash-amount"]', '10.00');
      await page.click('[data-testid="submit-payment"]');
      await page.waitForSelector('[data-testid="payment-success"]');
    }
    await page.goto('http://localhost:4200/monitor');
    await page.waitForSelector('[data-testid="metric-card"]');
    const metricCards = await page.$$('[data-testid="metric-card"]');
    expect(metricCards.length).toBeGreaterThan(0);
    const paymentMetric = await page
      .locator('[data-testid="metric-card"]')
      .filter({ hasText: 'payments.processed' });
    const metricValue = await paymentMetric.locator('[data-testid="metric-value"]').textContent();
    expect(parseInt(metricValue || '0')).toBeGreaterThanOrEqual(3);
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

  test.fixme('should export audit logs', async ({ page }) => {
    // Needs export-audit-logs control.
    await page.goto('http://localhost:4200/monitor');
    await page.waitForSelector('[data-testid="audit-log-entry"]');
    const downloadPromise = page.waitForEvent('download');
    await page.click('[data-testid="export-audit-logs"]');
    const download = await downloadPromise;
    expect(download.suggestedFilename()).toMatch(/audit-logs.*\.(json|csv)/);
    expect(await download.path()).toBeTruthy();
  });

  test.fixme('should handle inventory updates across agents', async ({ page }) => {
    // Depends on payment-success + stock-quantity cross-feature flow.
    await page.goto('http://localhost:4200/inventory');
    await page.fill('[data-testid="product-search"]', 'Coffee');
    await page.click('[data-testid="search-button"]');
    const initialStock = await page.textContent('[data-testid="stock-quantity"]');
    const initialQuantity = parseInt(initialStock || '0');
    await page.goto('http://localhost:4200/pos-terminal');
    await page.fill('[data-testid="product-search"]', 'Coffee');
    await page.click('[data-testid="search-button"]');
    await page.click('[data-testid="add-to-cart"]');
    await page.click('[data-testid="checkout-button"]');
    await page.click('[data-testid="payment-method-cash"]');
    await page.fill('[data-testid="cash-amount"]', '10.00');
    await page.click('[data-testid="submit-payment"]');
    await page.waitForSelector('[data-testid="payment-success"]');
    await page.goto('http://localhost:4200/inventory');
    await page.fill('[data-testid="product-search"]', 'Coffee');
    await page.click('[data-testid="search-button"]');
    const updatedStock = await page.textContent('[data-testid="stock-quantity"]');
    expect(parseInt(updatedStock || '0')).toBe(initialQuantity - 1);
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

  test.fixme('should recover from circuit breaker open state', async ({ page }) => {
    // Needs circuit-breaker-card / circuit-state UI (currently a no-op pass).
    await page.goto('http://localhost:4200/monitor');
    const openCircuit = await page
      .locator('[data-testid="circuit-breaker-card"]')
      .filter({ has: page.locator('[data-testid="circuit-state"]:has-text("OPEN")') })
      .first();
    if ((await openCircuit.count()) > 0) {
      await page.waitForTimeout(5000);
      await page.reload();
      const circuitState = await openCircuit.locator('[data-testid="circuit-state"]').textContent();
      expect(['HALF_OPEN', 'CLOSED']).toContain(circuitState || '');
    }
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
