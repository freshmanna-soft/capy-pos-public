/**
 * Kiosk & Shop Checkout Step Definitions
 *
 * Covers the BDD scenarios in:
 *   tests/cucumber/kiosk/kiosk-checkout.feature
 *   tests/cucumber/shop/shop-checkout.feature
 *
 * Uses raw Playwright (chromium) — no Angular-specific test runner is needed
 * because the app is already running (start-server-and-test handles that in CI).
 *
 * Console message capture is done via page.on('console', …) so the worker-log
 * scenario can assert that refuseUnauthorizedPush fires at info, not warn.
 */

import {
  Given,
  When,
  Then,
  Before,
  After,
  setDefaultTimeout,
} from '@cucumber/cucumber';
import { expect } from '@playwright/test';
import { Page, Browser, chromium, ConsoleMessage } from 'playwright';

// Allow each scenario up to 45 s (covers slow CI boot + Angular initialisation).
setDefaultTimeout(45_000);

// ─── World state ─────────────────────────────────────────────────────────────

let browser: Browser;
let page: Page;
const consoleMessages: ConsoleMessage[] = [];

// ─── Lifecycle ───────────────────────────────────────────────────────────────

Before(async function () {
  browser = await chromium.launch({ headless: true });
  page = await browser.newPage();
  consoleMessages.length = 0;
  page.on('console', (msg) => consoleMessages.push(msg));
});

After(async function () {
  await page.close();
  await browser.close();
});

// ─── Shared stub helpers ─────────────────────────────────────────────────────

/**
 * Stubs GET /api/products and GET /api/transactions to return empty lists so
 * the sync worker does not retry indefinitely in the background.
 */
async function stubLiveSyncEndpoints(p: Page): Promise<void> {
  await p.route(
    (url) =>
      url.pathname.endsWith('/api/products') ||
      url.pathname.endsWith('/api/transactions'),
    (route) =>
      route.request().method() === 'GET'
        ? route.fulfill({
            status: 200,
            contentType: 'application/json',
            body: JSON.stringify([]),
          })
        : route.continue(),
  );
}

async function stubTransactionEndpoint(p: Page): Promise<void> {
  await p.route(
    (url) => url.pathname.endsWith('/api/transactions'),
    (route) =>
      route.request().method() === 'POST'
        ? route.fulfill({
            status: 201,
            contentType: 'application/json',
            body: JSON.stringify({ id: 'e2e-tx-cucumber', status: 'ok' }),
          })
        : route.continue(),
  );
}

async function stubShopSessionEndpoint(p: Page): Promise<void> {
  await p.route(
    (url) => url.pathname.endsWith('/api/shop/session'),
    (route) =>
      route.fulfill({
        status: 201,
        contentType: 'application/json',
        body: JSON.stringify({
          token: 'cucumber-shop-session-token',
          expiresAt: new Date(Date.now() + 3_600_000).toISOString(),
        }),
      }),
  );
}

// ─── Given ───────────────────────────────────────────────────────────────────

Given('the kiosk shop is open at {string}', async function (url: string) {
  await stubLiveSyncEndpoints(page);
  await stubTransactionEndpoint(page);
  await page.goto(url);
  await page.waitForSelector('[data-testid="kiosk-product-grid"]', {
    state: 'visible',
    timeout: 20_000,
  });
});

const KIOSK_SPLASH_URL = 'http://localhost:4200/kiosk';
const SELECTOR_SPLASH = '[data-testid="kiosk-start-shopping"]';
const SELECTOR_PRODUCT_GRID = '[data-testid="kiosk-product-grid"]';
const SELECTOR_AUTH_EMAIL = '[data-testid="kiosk-auth-email"]';

async function waitForSplash(p: Page): Promise<void> {
  await p.waitForSelector(SELECTOR_SPLASH, { state: 'visible', timeout: 20_000 });
}

async function waitForShop(p: Page): Promise<void> {
  await p.waitForSelector(SELECTOR_PRODUCT_GRID, { state: 'visible', timeout: 20_000 });
}

Given('the kiosk splash is open at {string}', async function (url: string) {
  await stubLiveSyncEndpoints(page);
  await stubTransactionEndpoint(page);
  await page.goto(url);
  await waitForSplash(page);
});

Given('all remote API calls are stubbed to succeed', async function () {
  // Already set up in the "kiosk shop is open" / "kiosk splash is open" step.
  // This step exists for readability in scenarios that call a different Given.
});

Given(
  'the POST /api/shop/session endpoint is stubbed to return a valid token',
  async function () {
    await stubShopSessionEndpoint(page);
  },
);

Given('no customer is signed in', async function () {
  // Nothing to do — the kiosk boots in anonymous mode by default.
});

Given(
  'the customer signs in on the kiosk splash with email {string}',
  async function (email: string) {
    await page.goto(KIOSK_SPLASH_URL);
    await waitForSplash(page);
    await page.click('[data-testid="kiosk-sign-in"]');
    await page.waitForSelector(SELECTOR_AUTH_EMAIL, { state: 'visible' });
    await page.fill(SELECTOR_AUTH_EMAIL, email);
    await page.click('[data-testid="kiosk-sign-in-submit"]');
    await waitForShop(page);
  },
);

Given('the kiosk splash screen is visible', async function () {
  await page.goto(KIOSK_SPLASH_URL);
  await waitForSplash(page);
});

Given(
  'the POST /api/transactions endpoint returns status 500',
  async function () {
    await page.route(
      (url) => url.pathname.endsWith('/api/transactions'),
      (route) =>
        route.request().method() === 'POST'
          ? route.fulfill({ status: 500, body: 'Internal Server Error' })
          : route.continue(),
    );
  },
);

Given('I capture browser console messages', async function () {
  // Already capturing in Before() — this step is a readable no-op.
});

Given(
  'I navigate directly to the shop at {string}',
  async function (url: string) {
    await page.goto(url);
    await waitForShop(page);
  },
);

// ─── When ────────────────────────────────────────────────────────────────────

When('I add the first available product to the kiosk cart', async function () {
  // Product id '1' is always seeded by APP_INITIALIZER.
  const specific = page.locator('[data-testid="kiosk-product-1"]');
  if ((await specific.count()) > 0) {
    await specific.click();
  } else {
    await page
      .locator('[data-testid="kiosk-product-grid"] button')
      .first()
      .click();
  }
  await page.waitForSelector('[data-testid="kiosk-pay-now"]', {
    state: 'visible',
    timeout: 5_000,
  });
});

When(
  'I open the kiosk checkout and select cash payment',
  async function () {
    await page.click('[data-testid="kiosk-pay-now"]');
    await page.waitForSelector('[data-testid="checkout-overlay"]', {
      state: 'visible',
    });
    await page.click('[data-testid="method-cash"]');
    await page.click('[data-testid="btn-proceed"]');
  },
);

When(
  'I enter tendered amount {string} and confirm',
  async function (amount: string) {
    await page.fill('[data-testid="cash-tendered"]', amount);
    await page.click('[data-testid="btn-confirm-cash"]');
  },
);

When('I open the kiosk sign-in modal', async function () {
  await page.click('[data-testid="kiosk-sign-in"]');
  await page.waitForSelector('[data-testid="kiosk-auth-email"]', {
    state: 'visible',
  });
});

When(
  'I enter a new unique email address in the kiosk auth form',
  async function () {
    const unique = `cucumber-${Date.now()}@test.local`;
    await page.fill('[data-testid="kiosk-auth-email"]', unique);
  },
);

When(
  'I enter email {string} in the kiosk auth form',
  async function (email: string) {
    await page.fill('[data-testid="kiosk-auth-email"]', email);
  },
);

When('I click the {string} button', async function (label: string) {
  const testId =
    label === 'Create Account'
      ? 'kiosk-create-account'
      : label === 'Sign In'
        ? 'kiosk-sign-in-submit'
        : label === 'Forgot Password'
          ? 'kiosk-forgot-password-link'
          : label.toLowerCase().replace(/ /g, '-');
  await page.click(`[data-testid="${testId}"]`);
});

// ─── Then ────────────────────────────────────────────────────────────────────

Then('the kiosk receipt overlay is shown', async function () {
  await expect(
    page.locator('[data-testid="kiosk-receipt-wrapper"]'),
  ).toBeVisible({ timeout: 15_000 });
});

Then('the checkout overlay is dismissed', async function () {
  await expect(
    page.locator('[data-testid="checkout-overlay"]'),
  ).not.toBeVisible({ timeout: 5_000 });
});

Then('no authentication error is displayed', async function () {
  await expect(page.locator('[data-testid="kiosk-auth-error"]')).not.toBeVisible();
});

Then('no validation error is shown', async function () {
  // Allow time for async customer creation
  await page.waitForTimeout(600);
  await expect(page.locator('[data-testid="kiosk-auth-error"]')).not.toBeVisible();
});

Then('the kiosk product grid is visible', async function () {
  await expect(
    page.locator('[data-testid="kiosk-product-grid"]'),
  ).toBeVisible({ timeout: 15_000 });
});

Then(
  'no {string} validation error is shown in the auth modal',
  async function (field: string) {
    // Allow time for async customer creation
    await page.waitForTimeout(600);
    const errorEl = page.locator('[data-testid="kiosk-auth-error"]');
    const visible = await errorEl.isVisible();
    if (visible) {
      const text = await errorEl.textContent();
      expect(text?.toLowerCase()).not.toContain(field.toLowerCase());
    }
  },
);

Then('no phone input field is visible in the kiosk auth modal', async function () {
  // The kiosk auth modal asks for email only. There must be no phone input.
  const phoneInputs = page.locator(
    '[data-testid="kiosk-auth-email"] ~ input[type="tel"], input[type="tel"], input[name="phone"]',
  );
  expect(await phoneInputs.count()).toBe(0);
});

Then('the kiosk checkout error banner is shown', async function () {
  await expect(
    page.locator('[data-testid="kiosk-checkout-error"]'),
  ).toBeVisible({ timeout: 15_000 });
});

Then('the kiosk receipt overlay is not shown', async function () {
  await expect(
    page.locator('[data-testid="kiosk-receipt-wrapper"]'),
  ).not.toBeVisible({ timeout: 5_000 });
});

Then(
  'no console message at level {string} contains {string}',
  async function (level: string, text: string) {
    // Give the payment flow a moment to settle before checking logs.
    await page.waitForTimeout(1_000);

    const matchingWarnings = consoleMessages.filter(
      (msg) =>
        msg.type() === level.toLowerCase() &&
        msg.text().includes(text),
    );
    expect(
      matchingWarnings,
      `Expected no "${level}" console message containing "${text}", but found:\n` +
        matchingWarnings.map((m) => `  [${m.type()}] ${m.text()}`).join('\n'),
    ).toHaveLength(0);
  },
);

export { page, browser };
