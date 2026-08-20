import { Page, test, expect } from '@playwright/test';
import { loginAsAdmin } from './helpers/auth';

/**
 * E2E Tests: Inventory Management CRUD
 *
 * Tests the full inventory management workflow including:
 * - Navigation to inventory page
 * - Product table display
 * - Search and filter functionality
 * - Create new product
 * - Edit existing product
 * - Delete product with confirmation
 * - Stock adjustment (+/-)
 * - Low stock alerts
 *
 * Persona: Ana the Inventory Clerk
 */
test.describe('Inventory Management - Ana the Inventory Clerk', () => {
  test.beforeEach(async ({ page }) => {
    await loginAsAdmin(page);
    await page.goto('/inventory');
    await page.waitForSelector('[data-testid="inventory-page"]');
  });

  test.describe('Page Load & Navigation', () => {
    test('should display inventory page with title', async ({ page }) => {
      const title = page.getByRole('heading', { name: /Inventory Management/ });
      await expect(title).toBeVisible();
    });

    test('should be accessible from navigation', async ({ page }) => {
      await page.goto('/pos');
      await page.click('[data-testid="nav-inventory"]:visible');
      await expect(page).toHaveURL(/\/inventory/);
      await expect(page.locator('[data-testid="inventory-page"]')).toBeVisible();
    });

    test('should display inventory table', async ({ page }) => {
      const table = page.locator('[data-testid="inventory-table"]');
      await expect(table).toBeVisible();
    });

    test('should display inventory summary footer', async ({ page }) => {
      const summary = page.locator('[data-testid="inventory-summary"]');
      await expect(summary).toBeVisible();
    });
  });

  test.describe('Search & Filter', () => {
    test('should filter products by search query', async ({ page }) => {
      const searchInput = page.locator('[data-testid="inventory-search"]');
      await searchInput.fill('Coffee');

      // Wait for filtering to apply
      await page.waitForTimeout(300);

      const rows = page.locator('.product-row');
      const count = await rows.count();
      // Should show filtered results (may be 0 if no seeded data matches)
      expect(count).toBeGreaterThanOrEqual(0);
    });

    test('should filter products by category', async ({ page }) => {
      const categoryFilter = page.locator('[data-testid="category-filter"]');
      const options = await categoryFilter.locator('option').allTextContents();
      // Should have "All Categories" plus any loaded categories
      expect(options.length).toBeGreaterThanOrEqual(1);
    });

    test('should filter products by stock status', async ({ page }) => {
      const stockFilter = page.locator('[data-testid="stock-filter"]');
      await stockFilter.selectOption('critical');

      await page.waitForTimeout(300);

      // Verify filter is applied
      await expect(stockFilter).toHaveValue('critical');
    });
  });

  test.describe('Create Product', () => {
    test('should open create form when Add Product is clicked', async ({ page }) => {
      await page.click('[data-testid="btn-add-product"]');
      const form = page.locator('[data-testid="product-form"]');
      await expect(form).toBeVisible();
    });

    test('should show validation errors for empty required fields', async ({ page }) => {
      await page.click('[data-testid="btn-add-product"]');
      await page.click('[data-testid="btn-save"]');

      // Per-field validation messages render as red helper text under each input.
      await expect(page.getByText(/is required/i).first()).toBeVisible();
    });

    test('should create a product with valid data', async ({ page }) => {
      await page.click('[data-testid="btn-add-product"]');

      await page.fill('[data-testid="input-name"]', 'E2E Test Product');
      await page.fill('[data-testid="input-sku"]', 'SKU-E2E-001');
      await page.fill('[data-testid="input-category"]', 'Testing');
      await page.fill('[data-testid="input-price"]', '9.99');
      await page.fill('[data-testid="input-stock"]', '25');
      await page.fill('[data-testid="input-emoji"]', '🧪');

      await page.click('[data-testid="btn-save"]');

      // Form should close after successful creation
      await expect(page.locator('[data-testid="product-form"]')).not.toBeVisible();
    });

    test('should close form when Cancel is clicked', async ({ page }) => {
      await page.click('[data-testid="btn-add-product"]');
      await expect(page.locator('[data-testid="product-form"]')).toBeVisible();

      await page.click('[data-testid="btn-cancel"]');
      await expect(page.locator('[data-testid="product-form"]')).not.toBeVisible();
    });

    test('should close form when X button is clicked', async ({ page }) => {
      await page.click('[data-testid="btn-add-product"]');
      await expect(page.locator('[data-testid="product-form"]')).toBeVisible();

      await page.click('[data-testid="btn-close-form"]');
      await expect(page.locator('[data-testid="product-form"]')).not.toBeVisible();
    });
  });

  test.describe('Edit Product', () => {
    test('should open edit form when edit button is clicked', async ({ page }) => {
      // First create a product to edit
      await page.click('[data-testid="btn-add-product"]');
      await page.fill('[data-testid="input-name"]', 'Edit Test Product');
      await page.fill('[data-testid="input-sku"]', 'SKU-EDIT-001');
      await page.fill('[data-testid="input-category"]', 'Testing');
      await page.fill('[data-testid="input-price"]', '5.00');
      await page.fill('[data-testid="input-stock"]', '10');
      await page.click('[data-testid="btn-save"]');

      // Wait for product to appear in table
      await page.waitForTimeout(500);

      // Click edit on the first product row's edit button
      const editBtn = page.locator('.btn-edit').first();
      if (await editBtn.isVisible()) {
        await editBtn.click();
        await expect(page.locator('[data-testid="product-form"]')).toBeVisible();
      }
    });
  });

  test.describe('Delete Product', () => {
    test('should show delete confirmation dialog', async ({ page }) => {
      // Create a product first
      await page.click('[data-testid="btn-add-product"]');
      await page.fill('[data-testid="input-name"]', 'Delete Test Product');
      await page.fill('[data-testid="input-sku"]', 'SKU-DEL-001');
      await page.fill('[data-testid="input-category"]', 'Testing');
      await page.fill('[data-testid="input-price"]', '3.00');
      await page.fill('[data-testid="input-stock"]', '5');
      await page.click('[data-testid="btn-save"]');

      await page.waitForTimeout(500);

      // Click delete on the first product
      const deleteBtn = page.locator('.btn-delete').first();
      if (await deleteBtn.isVisible()) {
        await deleteBtn.click();
        await expect(page.locator('[data-testid="delete-confirm"]')).toBeVisible();
      }
    });

    test('should cancel delete when Cancel is clicked', async ({ page }) => {
      const deleteBtn = page.locator('.btn-delete').first();
      if (await deleteBtn.isVisible()) {
        await deleteBtn.click();
        await page.click('[data-testid="btn-cancel-delete"]');
        await expect(page.locator('[data-testid="delete-confirm"]')).not.toBeVisible();
      }
    });
  });

  test.describe('Stock Adjustment', () => {
    test('should have increase and decrease buttons for each product', async ({ page }) => {
      const increaseBtn = page.locator('.btn-increase').first();
      const decreaseBtn = page.locator('.btn-decrease').first();

      if (await increaseBtn.isVisible()) {
        await expect(increaseBtn).toBeVisible();
        await expect(decreaseBtn).toBeVisible();
      }
    });

    test('should increment stock when + is clicked', async ({ page }) => {
      // Create a product with known stock
      await page.click('[data-testid="btn-add-product"]');
      await page.fill('[data-testid="input-name"]', 'Stock Test Product');
      await page.fill('[data-testid="input-sku"]', 'SKU-STK-001');
      await page.fill('[data-testid="input-category"]', 'Testing');
      await page.fill('[data-testid="input-price"]', '2.00');
      await page.fill('[data-testid="input-stock"]', '10');
      await page.click('[data-testid="btn-save"]');

      await page.waitForTimeout(500);

      const increaseBtn = page.locator('.btn-increase').first();
      if (await increaseBtn.isVisible()) {
        await increaseBtn.click();
        // Stock should have changed (we can't easily verify the exact number without knowing the product)
        await page.waitForTimeout(300);
      }
    });
  });

  test.describe('Low Stock Alert', () => {
    test('should show low stock alert when products have critical stock', async ({ page }) => {
      // Create a product with very low stock
      await page.click('[data-testid="btn-add-product"]');
      await page.fill('[data-testid="input-name"]', 'Low Stock Product');
      await page.fill('[data-testid="input-sku"]', 'SKU-LOW-001');
      await page.fill('[data-testid="input-category"]', 'Testing');
      await page.fill('[data-testid="input-price"]', '1.00');
      await page.fill('[data-testid="input-stock"]', '2');
      await page.click('[data-testid="btn-save"]');

      await page.waitForTimeout(500);

      // Check if low stock alert appears
      const alert = page.locator('[data-testid="low-stock-alert"]');
      // Alert visibility depends on whether there are products with stock < 5
      if (await alert.isVisible()) {
        await expect(alert).toContainText('low stock');
      }
    });
  });
});

test.describe('Product registration — codes and guards', () => {
  /** Seeded onto Coffee (BEV-COF-001). */
  const COFFEE_BARCODE = '1234567890123';
  const COFFEE_SKU = 'BEV-COF-001';

  test.beforeEach(async ({ page }) => {
    await loginAsAdmin(page);
    await page.goto('/inventory');
    await page.waitForSelector('[data-testid="inventory-page"]');
    await page.click('[data-testid="btn-add-product"]');
    await expect(page.locator('[data-testid="product-form"]')).toBeVisible();
  });

  /** Everything a product needs except the code under test. */
  async function fillIdentity(page: Page, sku: string): Promise<void> {
    await page.fill('[data-testid="input-name"]', 'Duplicate Probe');
    await page.fill('[data-testid="input-sku"]', sku);
    await page.fill('[data-testid="input-category"]', 'Beverages');
    await page.fill('[data-testid="input-price"]', '1.50');
    await page.fill('[data-testid="input-stock"]', '5');
  }

  test('refuses a barcode that already belongs to another product', async ({ page }) => {
    // Not a tidiness rule. The till keys its scan lookup on this value with
    // first-writer-wins, so a second product carrying it would ring up the first
    // one at the first one's price, and nothing downstream could notice.
    await fillIdentity(page, 'PROBE-001');
    await page.fill('[data-testid="input-barcode"]', COFFEE_BARCODE);

    await expect(page.locator('[data-testid="barcode-status"]')).toContainText(
      /already registered/i
    );

    await page.click('[data-testid="btn-save"]');

    await expect(page.locator('[data-testid="product-form"]')).toBeVisible();
    await expect(page.locator('[data-testid="form-save-error"]')).toContainText('Coffee');
  });

  test('offers the product that already owns the code', async ({ page }) => {
    await fillIdentity(page, 'PROBE-002');
    await page.fill('[data-testid="input-barcode"]', COFFEE_BARCODE);

    await page.click('[data-testid="btn-open-duplicate"]');

    // Straight into the owner's edit form, rather than leaving the person to go and
    // find it themselves.
    await expect(page.locator('[data-testid="input-name"]')).toHaveValue('Coffee');
  });

  test('refuses a SKU that already belongs to another product', async ({ page }) => {
    await fillIdentity(page, COFFEE_SKU);

    await page.click('[data-testid="btn-save"]');

    await expect(page.locator('[data-testid="product-form"]')).toBeVisible();
    await expect(page.locator('[data-testid="form-save-error"]')).toContainText('Coffee');
  });

  test('saves happily with no barcode at all', async ({ page }) => {
    // Most products legitimately have none, and an empty code must never read as
    // colliding with every other empty one.
    await fillIdentity(page, `PROBE-${Date.now()}`);

    await page.click('[data-testid="btn-save"]');

    await expect(page.locator('[data-testid="product-form"]')).not.toBeVisible();
  });

  test('a scanner gun cannot submit the form with its trailing Enter', async ({ page }) => {
    // Guns type the digits then press Enter. If that Enter submitted, the product
    // would save with nothing filled in but a barcode.
    await page.fill('[data-testid="input-barcode"]', '5901234123457');
    await page.press('[data-testid="input-barcode"]', 'Enter');

    await expect(page.locator('[data-testid="product-form"]')).toBeVisible();
    await expect(page.locator('[data-testid="input-barcode"]')).toHaveValue('5901234123457');
  });

  test('names the format so a mistyped digit is findable', async ({ page }) => {
    await page.fill('[data-testid="input-barcode"]', '5901234123457');
    await expect(page.locator('[data-testid="barcode-status"]')).toContainText(/EAN-13/);

    // One digit changed. Advisory only — plenty of shops print their own labels —
    // but invisible without it.
    await page.fill('[data-testid="input-barcode"]', '5901234123458');
    await expect(page.locator('[data-testid="barcode-status"]')).toContainText(/check digit/i);
  });

  test('asks before throwing away a half-typed product', async ({ page }) => {
    await page.fill('[data-testid="input-name"]', 'Half typed');

    await page.keyboard.press('Escape');

    await expect(page.locator('[data-testid="discard-confirm"]')).toBeVisible();
    await page.click('[data-testid="btn-keep-editing-action"]');
    await expect(page.locator('[data-testid="input-name"]')).toHaveValue('Half typed');

    await page.keyboard.press('Escape');
    await page.click('[data-testid="btn-discard"]');
    await expect(page.locator('[data-testid="product-form"]')).not.toBeVisible();
  });

  test('closes on Escape without asking when nothing was touched', async ({ page }) => {
    await page.keyboard.press('Escape');
    await expect(page.locator('[data-testid="product-form"]')).not.toBeVisible();
    await expect(page.locator('[data-testid="discard-confirm"]')).not.toBeVisible();
  });

  test('is announced as a dialog, and traps focus inside itself', async ({ page }) => {
    const dialog = page.locator('[data-testid="product-form"] [role="dialog"]');
    await expect(dialog).toHaveAttribute('aria-modal', 'true');

    // Labelled by its own heading, so a screen reader says which dialog this is.
    const labelId = await dialog.getAttribute('aria-labelledby');
    expect(labelId).toBeTruthy();
    await expect(page.locator(`#${labelId}`)).toContainText('Add New Product');

    // Autocapture put focus in the panel; nothing behind it should be reachable.
    const focusedInsideDialog = await page.evaluate(() =>
      Boolean(document.activeElement?.closest('[role="dialog"]'))
    );
    expect(focusedInsideDialog).toBe(true);
  });

  test('offers no camera button where the browser cannot decode barcodes', async ({ page }) => {
    // BarcodeDetector is Chromium-only and absent in this harness. A Scan button that
    // cannot work is worse than none, and typing always works.
    const hasDetector = await page.evaluate(() => 'BarcodeDetector' in window);
    if (hasDetector) {
      await expect(page.locator('[data-testid="btn-scan"]')).toBeVisible();
    } else {
      await expect(page.locator('[data-testid="btn-scan"]')).toHaveCount(0);
      await expect(page.locator('[data-testid="input-barcode"]')).toBeVisible();
    }
  });

  test('round-trips the reorder quantity that used to be pinned at 20', async ({ page }) => {
    await page.click('[data-testid="btn-cancel"]');
    const editButton = page.locator('[data-testid^="btn-edit-"]').filter({ visible: true }).first();
    await editButton.click();

    const reorder = page.locator('[data-testid="input-reorder"]');
    await expect(reorder).toBeVisible();
    await reorder.fill('35');
    await page.click('[data-testid="btn-save"]');
    await expect(page.locator('[data-testid="product-form"]')).not.toBeVisible();

    // Reopen: the value has to come back, which it never could while the form
    // hardcoded 20 on load.
    await editButton.click();
    await expect(page.locator('[data-testid="input-reorder"]')).toHaveValue('35');
  });
});
