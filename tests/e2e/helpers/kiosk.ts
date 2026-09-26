import { Page } from '@playwright/test';
import { stubLiveSyncEndpoints } from './auth';

// ---------------------------------------------------------------------------
// Dexie database name used by the app (matches DexieDatabase class definition)
// ---------------------------------------------------------------------------
/** The IndexedDB database name used by DexieDatabase (see super('CapyPOSDB')). */
const DB_NAME = 'CapyPOSDB';

/**
 * seedKioskDexie
 *
 * Writes the minimum IndexedDB state required for the kiosk shop to load:
 * - One active product ("Coffee", $2.50, stock 50)
 *
 * The app already seeds RBAC defaults + products in APP_INITIALIZER, so the
 * Dexie seed products (id: '1'..'8') are present on first navigation.
 * This helper is therefore only needed when the test must guarantee a clean,
 * controlled product state regardless of the live seed. Call it BEFORE
 * page.goto() so the data is in place when Angular boots.
 *
 * Products use Dexie's IndexedDB directly via `window.indexedDB`; we open
 * the DB at v1 (create-if-absent), write the products table, then close.
 * Angular's own Dexie instance will merge/upgrade on first open.
 *
 * NOTE: Because APP_INITIALIZER always runs seedDefaults() on boot the
 * seeded admin operator and all default settings rows are already present —
 * no manual RBAC seeding is needed here.
 */
export async function seedKioskDexie(page: Page): Promise<void> {
  await page.evaluate((dbName: string) => {
    return new Promise<void>((resolve, reject) => {
      // Open at version 1 — we only need the object stores that exist from v1.
      // Dexie will handle schema upgrades when the app boots.
      const req = indexedDB.open(dbName);

      req.onerror = () => reject(req.error);

      req.onsuccess = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains('products')) {
          db.close();
          resolve(); // nothing to write without the store
          return;
        }

        const tx = db.transaction('products', 'readwrite');
        const store = tx.objectStore('products');

        const product = {
          id: 'e2e-coffee',
          tenantId: 'default-tenant',
          name: 'Coffee',
          description: 'Fresh brewed coffee',
          sku: 'E2E-COF-001',
          barcode: '9999999990001',
          category: 'Beverages',
          price: 2.5,
          cost: 0.8,
          quantity: 50,
          minStockLevel: 5,
          maxStockLevel: 200,
          unit: 'cup',
          taxRate: 0.08,
          isActive: true,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        };

        const put = store.put(product);
        put.onerror = () => reject(put.error);
        tx.oncomplete = () => {
          db.close();
          resolve();
        };
        tx.onerror = () => reject(tx.error);
      };
    });
  }, DB_NAME);
}

/**
 * seedKioskDeviceToken
 *
 * Writes a fake device token into the Dexie `settings` table so that
 * KioskShopComponent.openCheckout() does not show the "no device token"
 * banner. Must be called AFTER the app has booted (APP_INITIALIZER has run
 * and created the settings table), i.e. after loginAsAdmin().
 *
 * Row schema mirrors KioskSettingsService._put():
 *   { id, key, value: JSON.stringify(terminalRecord), updatedAt }
 *
 * The key `terminal:default-org/default-store/default-terminal` matches
 * DEFAULT_TERMINAL_ID in kiosk-settings.service.ts.
 */
export async function seedKioskDeviceToken(page: Page): Promise<void> {
  await page.evaluate(() => {
    return new Promise<void>((resolve, reject) => {
      const req = indexedDB.open('CapyPOSDB');
      req.onerror = () => reject(req.error);
      req.onsuccess = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains('settings')) {
          db.close();
          resolve();
          return;
        }
        const id = 'terminal:default-org/default-store/default-terminal';
        const tx = db.transaction('settings', 'readwrite');
        const store = tx.objectStore('settings');
        const put = store.put({
          id,
          key: id,
          value: JSON.stringify({
            orgId: 'default-org',
            storeId: 'default-org/default-store',
            terminalId: 'default-org/default-store/default-terminal',
            label: 'E2E terminal',
            mode: 'kiosk',
            mercadopagoEnabled: null,
            paypalEnabled: null,
            fenceEnabled: false,
            fenceLat: null,
            fenceLng: null,
            fenceRadiusMeters: 200,
            deviceToken: 'e2e-device-token',
          }),
          updatedAt: new Date(),
        });
        put.onerror = () => reject(put.error);
        tx.oncomplete = () => { db.close(); resolve(); };
        tx.onerror = () => reject(tx.error);
      };
    });
  });
}

/**
 * stubTransactionEndpoint
 *
 * Intercepts POST /api/transactions and replies 201 so tests never need a
 * running API server. GET /api/transactions is already stubbed by
 * stubLiveSyncEndpoints (called inside loginAsAdmin) — this adds the POST.
 */
export async function stubTransactionEndpoint(page: Page): Promise<void> {
  await page.route(
    (url) => url.pathname.endsWith('/api/transactions'),
    (route) =>
      route.request().method() === 'POST'
        ? route.fulfill({
            status: 201,
            contentType: 'application/json',
            body: JSON.stringify({ id: 'e2e-tx-001', status: 'ok' }),
          })
        : route.continue(),
  );
}

/**
 * stubShopSessionEndpoint
 *
 * Intercepts POST /api/shop/session and replies 201 with a dummy token.
 * Used in shop.spec.ts where the /shop route requests a session on load.
 */
export async function stubShopSessionEndpoint(page: Page): Promise<void> {
  await page.route(
    (url) => url.pathname.endsWith('/api/shop/session'),
    (route) =>
      route.fulfill({
        status: 201,
        contentType: 'application/json',
        body: JSON.stringify({
          token: 'e2e-shop-session-token',
          expiresAt: new Date(Date.now() + 3_600_000).toISOString(),
        }),
      }),
  );
}

/**
 * KioskPage
 *
 * Page Object Model for the kiosk shop flow. Encapsulates selectors and
 * common actions so spec files stay declarative.
 */
export class KioskPage {
  constructor(readonly page: Page) {}

  // ── Splash selectors ───────────────────────────────────────────────────────
  get startShoppingBtn() { return this.page.getByTestId('kiosk-start-shopping'); }
  get signInBtn()        { return this.page.getByTestId('kiosk-sign-in'); }
  get authEmailInput()   { return this.page.getByTestId('kiosk-auth-email'); }
  get signInSubmit()     { return this.page.getByTestId('kiosk-sign-in-submit'); }
  get createAccountBtn() { return this.page.getByTestId('kiosk-create-account'); }
  get authError()        { return this.page.getByTestId('kiosk-auth-error'); }

  // ── Shop selectors ─────────────────────────────────────────────────────────
  get productGrid()      { return this.page.getByTestId('kiosk-product-grid'); }
  get payNowBtn()        { return this.page.getByTestId('kiosk-pay-now'); }
  get checkoutOverlay()  { return this.page.getByTestId('checkout-overlay'); }
  get receiptWrapper()   { return this.page.getByTestId('kiosk-receipt-wrapper'); }
  get checkoutError()    { return this.page.getByTestId('kiosk-checkout-error'); }

  // ── Checkout selectors ─────────────────────────────────────────────────────
  get methodCash()       { return this.page.getByTestId('method-cash'); }
  get proceedBtn()       { return this.page.getByTestId('btn-proceed'); }
  get cashTenderedInput(){ return this.page.getByTestId('cash-tendered'); }
  get confirmCashBtn()   { return this.page.getByTestId('btn-confirm-cash'); }

  // ── Actions ────────────────────────────────────────────────────────────────

  async setup(): Promise<void> {
    await stubLiveSyncEndpoints(this.page);
    await stubTransactionEndpoint(this.page);
  }

  async navigateToShop(): Promise<void> {
    await this.page.goto('/kiosk/shop');
    await this.productGrid.waitFor({ state: 'visible', timeout: 15_000 });
  }

  async navigateToSplash(): Promise<void> {
    await this.page.goto('/kiosk');
    await this.startShoppingBtn.waitFor({ state: 'visible', timeout: 15_000 });
  }

  async addFirstProductToCart(): Promise<void> {
    // Product id '1' (Coffee) is always seeded by APP_INITIALIZER.
    // Fall back to the first visible product button if not found.
    const coffee = this.page.getByTestId('kiosk-product-1');
    if (await coffee.count() > 0) {
      await coffee.click();
    } else {
      await this.productGrid.locator('button').first().click();
    }
  }

  async completeCashPayment(amount = '10'): Promise<void> {
    await this.payNowBtn.click();
    await this.checkoutOverlay.waitFor({ state: 'visible' });
    await this.methodCash.click();
    await this.proceedBtn.click();
    await this.cashTenderedInput.fill(amount);
    await this.confirmCashBtn.click();
  }
}
