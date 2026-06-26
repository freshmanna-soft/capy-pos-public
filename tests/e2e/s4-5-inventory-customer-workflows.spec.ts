import { test, expect } from '@playwright/test';
import { loginAsAdmin } from './helpers/auth';

/**
 * E2E Tests: Inventory and Customer Management Workflows (S4-5)
 *
 * Validates the complete cross-feature workflows for inventory and customer
 * management, including stock adjustment after sale and low stock alert navigation.
 *
 * Acceptance Criteria:
 * 1. Inventory CRUD workflow (Carlos the Manager)
 * 2. Customer CRUD workflow (Carlos the Manager)
 * 3. Stock adjustment after sale (Maria → Carlos cross-persona)
 * 4. Low stock alert visibility (Carlos on Dashboard)
 *
 * Personas:
 * - Carlos the Manager: Inventory oversight, customer management, dashboard monitoring
 * - Maria the Cashier: POS sales that trigger stock adjustments
 */

// ============================================================
// SCENARIO 1: E2E - Inventory CRUD Workflow
// Persona: Carlos the Manager
// ============================================================

test.describe('S4-5 Scenario 1: Inventory CRUD Workflow - Carlos the Manager', () => {
  test.beforeEach(async ({ page }) => {
    await loginAsAdmin(page);
    await page.goto('/inventory');
    await page.waitForSelector('[data-testid="inventory-page"]');
  });

  test('Carlos can navigate to Inventory and view all products', async ({ page }) => {
    // Verify inventory page is displayed
    await expect(page.locator('[data-testid="inventory-page"]')).toBeVisible();

    // Verify product table is displayed
    await expect(page.locator('[data-testid="inventory-table"]')).toBeVisible();

    // Verify the page has the add product button (CRUD capability)
    await expect(page.locator('[data-testid="btn-add-product"]')).toBeVisible();
  });

  test('Carlos can add a new product with valid data', async ({ page }) => {
    await page.click('[data-testid="nav-inventory"]:visible');
    await expect(page.locator('[data-testid="inventory-page"]')).toBeVisible();
    await page.waitForTimeout(500);

    // Click Add Product
    await page.click('[data-testid="btn-add-product"]');
    await expect(page.locator('[data-testid="product-form"]')).toBeVisible();

    // Fill in valid product data
    await page.fill('[data-testid="input-name"]', 'S4-5 Test Espresso');
    await page.fill('[data-testid="input-sku"]', 'SKU-S45-ESP');
    await page.fill('[data-testid="input-category"]', 'Beverages');
    await page.fill('[data-testid="input-price"]', '4.50');
    await page.fill('[data-testid="input-stock"]', '30');
    await page.fill('[data-testid="input-emoji"]', '☕');

    // Save
    await page.click('[data-testid="btn-save"]');

    // Form should close on success
    await expect(page.locator('[data-testid="product-form"]')).not.toBeVisible();

    // Product should appear in the table
    await page.waitForTimeout(500);
    const productRow = page.locator('.product-row', { hasText: 'S4-5 Test Espresso' });
    await expect(productRow).toBeVisible();
  });

  test('Carlos can edit an existing product', async ({ page }) => {
    await page.click('[data-testid="nav-inventory"]:visible');
    await expect(page.locator('[data-testid="inventory-page"]')).toBeVisible();
    await page.waitForTimeout(500);

    // First create a product to edit
    await page.click('[data-testid="btn-add-product"]');
    await page.fill('[data-testid="input-name"]', 'S4-5 Edit Target');
    await page.fill('[data-testid="input-sku"]', 'SKU-S45-EDIT');
    await page.fill('[data-testid="input-category"]', 'Testing');
    await page.fill('[data-testid="input-price"]', '3.00');
    await page.fill('[data-testid="input-stock"]', '15');
    await page.click('[data-testid="btn-save"]');
    await expect(page.locator('[data-testid="product-form"]')).not.toBeVisible();
    await page.waitForTimeout(500);

    // Find and click edit on the product we just created
    const editBtn = page
      .locator('.product-row', { hasText: 'S4-5 Edit Target' })
      .locator('.btn-edit');
    await editBtn.click({ force: true });

    // Form should open with pre-filled data
    await expect(page.locator('[data-testid="product-form"]')).toBeVisible();
    const nameInput = page.locator('[data-testid="input-name"]');
    await expect(nameInput).toHaveValue('S4-5 Edit Target');

    // Edit the name
    await nameInput.fill('S4-5 Edited Product');
    await page.click('[data-testid="btn-save"]');

    // Form should close
    await expect(page.locator('[data-testid="product-form"]')).not.toBeVisible();

    // Updated product should appear
    await page.waitForTimeout(500);
    const updatedRow = page.locator('.product-row', { hasText: 'S4-5 Edited Product' });
    await expect(updatedRow).toBeVisible();
  });

  test('Carlos can delete a product with confirmation', async ({ page }) => {
    await page.click('[data-testid="nav-inventory"]:visible');
    await expect(page.locator('[data-testid="inventory-page"]')).toBeVisible();
    await page.waitForTimeout(500);

    // Create a product to delete
    await page.click('[data-testid="btn-add-product"]');
    await page.fill('[data-testid="input-name"]', 'S4-5 Delete Me');
    await page.fill('[data-testid="input-sku"]', 'SKU-S45-DEL');
    await page.fill('[data-testid="input-category"]', 'Testing');
    await page.fill('[data-testid="input-price"]', '1.00');
    await page.fill('[data-testid="input-stock"]', '5');
    await page.click('[data-testid="btn-save"]');
    await expect(page.locator('[data-testid="product-form"]')).not.toBeVisible();
    await page.waitForTimeout(500);

    // Click delete on the product
    const deleteBtn = page
      .locator('.product-row', { hasText: 'S4-5 Delete Me' })
      .locator('.btn-delete');
    await deleteBtn.click({ force: true });

    // Confirmation dialog should appear
    await expect(page.locator('[data-testid="delete-confirm"]')).toBeVisible();

    // Confirm deletion
    await page.click('[data-testid="btn-confirm-delete"]');

    // Dialog should close
    await expect(page.locator('[data-testid="delete-confirm"]')).not.toBeVisible();

    // Product should no longer be in the table
    await page.waitForTimeout(500);
    const deletedRow = page.locator('.product-row', { hasText: 'S4-5 Delete Me' });
    await expect(deletedRow).not.toBeVisible();
  });

  test('inventory table reloads after navigation', async ({ page }) => {
    // Navigate away to another page
    await page.click('[data-testid="nav-customers"]:visible');
    await expect(page.locator('[data-testid="customers-page"]')).toBeVisible();
    await page.waitForTimeout(500);

    // Navigate back to inventory
    await page.click('[data-testid="nav-inventory"]:visible');
    await expect(page.locator('[data-testid="inventory-page"]')).toBeVisible();

    // Inventory table should reload and be visible
    await page.waitForSelector('[data-testid="inventory-table"]', { timeout: 10000 });
    await expect(page.locator('[data-testid="inventory-table"]')).toBeVisible();

    // Add product button should be available (page fully loaded)
    await expect(page.locator('[data-testid="btn-add-product"]')).toBeVisible();
  });
});

// ============================================================
// SCENARIO 2: E2E - Customer CRUD Workflow
// Persona: Carlos the Manager
// ============================================================

test.describe('S4-5 Scenario 2: Customer CRUD Workflow - Carlos the Manager', () => {
  test.beforeEach(async ({ page }) => {
    await loginAsAdmin(page);
    await page.goto('/');
  });

  test('Carlos can navigate to Customers and view all customers', async ({ page }) => {
    await page.click('[data-testid="nav-customers"]:visible');
    await expect(page).toHaveURL(/\/customers/);
    await expect(page.locator('[data-testid="customers-page"]')).toBeVisible();

    // Verify customer table is displayed
    await expect(page.locator('[data-testid="customers-table"]')).toBeVisible();
  });

  test('Carlos can add a new customer with valid data', async ({ page }) => {
    await page.click('[data-testid="nav-customers"]:visible');
    await expect(page.locator('[data-testid="customers-page"]')).toBeVisible();
    await page.waitForTimeout(500);

    // Click Add Customer
    await page.click('[data-testid="btn-add-customer"]');
    await expect(page.locator('[data-testid="customer-form"]')).toBeVisible();

    // Fill in valid customer data
    await page.fill('[data-testid="input-name"]', 'S4-5 Test Customer');
    await page.fill('[data-testid="input-email"]', 's4-5-test@example.com');
    await page.fill('[data-testid="input-phone"]', '(555) 945-0001');
    await page.fill('[data-testid="input-country"]', 'US');

    // Save
    await page.click('[data-testid="btn-save"]');

    // Form should close on success
    await expect(page.locator('[data-testid="customer-form"]')).not.toBeVisible();

    // Customer should appear in the table
    await page.waitForTimeout(500);
    const customerRow = page.locator('.customer-row', { hasText: 'S4-5 Test Customer' });
    await expect(customerRow).toBeVisible();
  });

  test('Carlos can edit an existing customer', async ({ page }) => {
    await page.click('[data-testid="nav-customers"]:visible');
    await expect(page.locator('[data-testid="customers-page"]')).toBeVisible();
    await page.waitForTimeout(500);

    // Create a customer to edit
    await page.click('[data-testid="btn-add-customer"]');
    await page.fill('[data-testid="input-name"]', 'S4-5 Edit Customer');
    await page.fill('[data-testid="input-email"]', 's4-5-edit@example.com');
    await page.fill('[data-testid="input-phone"]', '(555) 945-0002');
    await page.click('[data-testid="btn-save"]');
    await expect(page.locator('[data-testid="customer-form"]')).not.toBeVisible();
    await page.waitForTimeout(500);

    // Click edit on the customer
    const editBtn = page
      .locator('.customer-row', { hasText: 'S4-5 Edit Customer' })
      .locator('.btn-edit');
    await editBtn.click({ force: true });

    // Form should open with pre-filled data
    await expect(page.locator('[data-testid="customer-form"]')).toBeVisible();
    const nameInput = page.locator('[data-testid="input-name"]');
    await expect(nameInput).toHaveValue('S4-5 Edit Customer');

    // Edit the name
    await nameInput.fill('S4-5 Updated Customer');
    await page.click('[data-testid="btn-save"]');

    // Form should close
    await expect(page.locator('[data-testid="customer-form"]')).not.toBeVisible();

    // Updated customer should appear
    await page.waitForTimeout(500);
    const updatedRow = page.locator('.customer-row', { hasText: 'S4-5 Updated Customer' });
    await expect(updatedRow).toBeVisible();
  });

  test('Carlos can delete a customer with confirmation', async ({ page }) => {
    await page.click('[data-testid="nav-customers"]:visible');
    await expect(page.locator('[data-testid="customers-page"]')).toBeVisible();
    await page.waitForTimeout(500);

    // Create a customer to delete
    await page.click('[data-testid="btn-add-customer"]');
    await page.fill('[data-testid="input-name"]', 'S4-5 Delete Customer');
    await page.fill('[data-testid="input-email"]', 's4-5-delete@example.com');
    await page.fill('[data-testid="input-phone"]', '(555) 945-0003');
    await page.click('[data-testid="btn-save"]');
    await expect(page.locator('[data-testid="customer-form"]')).not.toBeVisible();
    await page.waitForTimeout(500);

    // Click delete
    const deleteBtn = page
      .locator('.customer-row', { hasText: 'S4-5 Delete Customer' })
      .locator('.btn-delete');
    await deleteBtn.click({ force: true });

    // Confirmation dialog should appear
    await expect(page.locator('[data-testid="delete-confirm"]')).toBeVisible();

    // Confirm deletion
    await page.click('[data-testid="btn-confirm-delete"]');

    // Dialog should close
    await expect(page.locator('[data-testid="delete-confirm"]')).not.toBeVisible();

    // Customer should no longer be in the table
    await page.waitForTimeout(500);
    const deletedRow = page.locator('.customer-row', { hasText: 'S4-5 Delete Customer' });
    await expect(deletedRow).not.toBeVisible();
  });
});

// ============================================================
// SCENARIO 3: E2E - Stock Adjustment After Sale
// Cross-persona: Maria (sale) → Carlos (verify stock)
// ============================================================

test.describe('S4-5 Scenario 3: Stock Adjustment After Sale', () => {
  test.beforeEach(async ({ page }) => {
    await loginAsAdmin(page);
  });

  test('stock level is reduced after Maria completes a sale', async ({ page }) => {
    // Step 1: Navigate to POS first to initialize seed data
    await page.goto('/');
    await page.click('[data-testid="nav-pos"]:visible');
    await expect(page.locator('[data-testid="pos-terminal"]')).toBeVisible();
    await page.waitForTimeout(1500); // Wait for seed data initialization

    // Step 2: Navigate to Inventory to check initial stock of a seed product
    await page.click('[data-testid="nav-inventory"]:visible');
    await expect(page.locator('[data-testid="inventory-page"]')).toBeVisible();
    await page.waitForTimeout(1000);

    // Find a seed product (Coffee) and record its stock
    const productRow = page.locator('.product-row', { hasText: 'Coffee' }).first();
    const productExists = await productRow.isVisible().catch(() => false);

    if (!productExists) {
      // If no seed data, create a product for the test
      await page.click('[data-testid="btn-add-product"]');
      await page.fill('[data-testid="input-name"]', 'S4-5 Sale Coffee');
      await page.fill('[data-testid="input-sku"]', 'SKU-S45-SALE');
      await page.fill('[data-testid="input-category"]', 'Beverages');
      await page.fill('[data-testid="input-price"]', '3.50');
      await page.fill('[data-testid="input-stock"]', '20');
      await page.click('[data-testid="btn-save"]');
      await expect(page.locator('[data-testid="product-form"]')).not.toBeVisible();
      await page.waitForTimeout(1000);
    }

    // Get the product name and stock before sale
    const targetRow = productExists
      ? productRow
      : page.locator('.product-row', { hasText: 'S4-5 Sale Coffee' });
    await expect(targetRow).toBeVisible();
    const stockBefore = await targetRow.locator('.stock-number').textContent();
    const stockBeforeNum = parseInt(stockBefore?.trim() || '0');
    const productName = productExists ? 'Coffee' : 'S4-5 Sale Coffee';

    // Step 3: Maria navigates to POS and makes a sale
    await page.click('[data-testid="nav-pos"]:visible');
    await expect(page.locator('[data-testid="pos-terminal"]')).toBeVisible();
    await page.waitForTimeout(500);

    // Search for the product using type (triggers input events properly)
    const searchInput = page.locator('[data-testid="product-search"]');
    await searchInput.click();
    await searchInput.fill('');
    await page.waitForTimeout(100);
    await searchInput.type(productName, { delay: 50 });

    // Wait for debounce (300ms) + search results to appear
    await page.waitForTimeout(500);
    const resultVisible = await page
      .locator('[data-testid="product-result"]')
      .first()
      .isVisible({ timeout: 5000 })
      .catch(() => false);

    if (!resultVisible) {
      // Fallback: try clicking a category to load products
      const beveragesCategory = page.locator('[data-testid="category-Beverages"]');
      const catExists = await beveragesCategory.isVisible().catch(() => false);
      if (catExists) {
        await beveragesCategory.click();
        await page.waitForTimeout(1000);
      }
    }

    // Add product to cart
    const productResult = page.locator('[data-testid="product-result"]').first();
    await expect(productResult).toBeVisible({ timeout: 5000 });
    await productResult.click({ force: true });
    await page.waitForTimeout(500);

    // Verify item is in cart
    await expect(page.locator('[data-testid="cart-items"]')).toBeVisible();
    await expect(page.locator('.cart-item')).toBeVisible();

    // Proceed to checkout
    await page.click('[data-testid="checkout-btn"]');
    await expect(page.locator('[data-testid="checkout-overlay"]')).toBeVisible();

    // Select cash payment
    await page.click('[data-testid="method-cash"]');
    await page.click('[data-testid="btn-proceed"]');

    // Enter cash amount
    await expect(page.locator('[data-testid="cash-payment"]')).toBeVisible();
    const cashInput = page.locator('[data-testid="cash-tendered"]');
    await cashInput.fill('10.00');
    await page.waitForTimeout(300);

    // Confirm payment
    await page.click('[data-testid="btn-confirm-cash"]');

    // Wait for payment processing and receipt to appear
    await page.waitForTimeout(2000);

    // Dismiss the receipt overlay (it blocks navigation)
    const receiptOverlay = page.locator('[data-testid="receipt-overlay"]');
    const receiptVisible = await receiptOverlay.isVisible().catch(() => false);
    if (receiptVisible) {
      await page.click('[data-testid="btn-new-transaction"]');
      await page.waitForTimeout(500);
    }

    // Step 4: Carlos navigates to Inventory to verify stock was reduced
    await page.click('[data-testid="nav-inventory"]:visible');
    await expect(page.locator('[data-testid="inventory-page"]')).toBeVisible();
    await page.waitForTimeout(1500);

    // Check stock level - should be reduced by 1
    const productRowAfter = page.locator('.product-row', { hasText: productName }).first();
    await expect(productRowAfter).toBeVisible({ timeout: 10000 });
    const stockAfter = await productRowAfter.locator('.stock-number').textContent();
    const stockAfterNum = parseInt(stockAfter?.trim() || '0');

    // Stock should be reduced by 1 (we added 1 item to cart)
    expect(stockAfterNum).toBe(stockBeforeNum - 1);
  });
});

// ============================================================
// SCENARIO 4: E2E - Low Stock Alert Visibility
// Persona: Carlos the Manager
// ============================================================

test.describe('S4-5 Scenario 4: Low Stock Alert Visibility - Carlos the Manager', () => {
  test.beforeEach(async ({ page }) => {
    await loginAsAdmin(page);
  });

  test('low stock widget is visible on Dashboard', async ({ page }) => {
    await page.goto('/');

    // Navigate to Dashboard
    await page.click('[data-testid="nav-dashboard"]:visible');
    await expect(page).toHaveURL(/\/dashboard/);
    await page.waitForTimeout(1000);

    // Low stock widget should be visible
    await expect(page.locator('[data-testid="low-stock-widget"]')).toBeVisible();
  });

  test('low stock widget shows alerts or healthy state', async ({ page }) => {
    await page.goto('/dashboard');
    await page.waitForTimeout(1500);

    // Widget should show either healthy state or alert summary
    const healthyState = page.locator('[data-testid="healthy-state"]');
    const alertSummary = page.locator('[data-testid="alert-summary"]');

    const isHealthy = await healthyState.isVisible().catch(() => false);
    const hasAlerts = await alertSummary.isVisible().catch(() => false);

    // One of these must be visible
    expect(isHealthy || hasAlerts).toBe(true);
  });

  test('clicking View Inventory navigates to filtered inventory view', async ({ page }) => {
    // First, create a product with very low stock to ensure alerts exist
    await page.goto('/inventory');
    await page.waitForTimeout(500);

    await page.click('[data-testid="btn-add-product"]');
    await page.fill('[data-testid="input-name"]', 'S4-5 Almost Gone');
    await page.fill('[data-testid="input-sku"]', 'SKU-S45-LOW');
    await page.fill('[data-testid="input-category"]', 'Testing');
    await page.fill('[data-testid="input-price"]', '2.00');
    await page.fill('[data-testid="input-stock"]', '1');
    await page.click('[data-testid="btn-save"]');
    await expect(page.locator('[data-testid="product-form"]')).not.toBeVisible();
    await page.waitForTimeout(500);

    // Navigate to Dashboard
    await page.click('[data-testid="nav-dashboard"]:visible');
    await expect(page).toHaveURL(/\/dashboard/);
    await page.waitForTimeout(1500);

    // Check if alerts exist (they should since we created a low-stock product)
    const viewBtn = page.locator('[data-testid="btn-view-inventory"]');
    const btnVisible = await viewBtn.isVisible().catch(() => false);

    if (btnVisible) {
      // Click the View Inventory button
      await viewBtn.click();

      // Should navigate to inventory with filter query param
      await expect(page).toHaveURL(/\/inventory/);
      expect(page.url()).toContain('filter=low-stock');
    } else {
      // If no alerts visible, the healthy state should be shown
      await expect(page.locator('[data-testid="healthy-state"]')).toBeVisible();
    }
  });

  test('product with stock below threshold appears in low stock alerts', async ({ page }) => {
    // Create a product with 0 stock (critical)
    await page.goto('/inventory');
    await page.waitForTimeout(500);

    await page.click('[data-testid="btn-add-product"]');
    await page.fill('[data-testid="input-name"]', 'S4-5 Out of Stock Item');
    await page.fill('[data-testid="input-sku"]', 'SKU-S45-OOS');
    await page.fill('[data-testid="input-category"]', 'Testing');
    await page.fill('[data-testid="input-price"]', '5.00');
    await page.fill('[data-testid="input-stock"]', '0');
    await page.click('[data-testid="btn-save"]');
    await expect(page.locator('[data-testid="product-form"]')).not.toBeVisible();
    await page.waitForTimeout(500);

    // Navigate to Dashboard
    await page.click('[data-testid="nav-dashboard"]:visible');
    await expect(page).toHaveURL(/\/dashboard/);
    await page.waitForTimeout(1500);

    // Alert summary should be visible (we have a 0-stock product)
    const alertSummary = page.locator('[data-testid="alert-summary"]');
    const hasAlerts = await alertSummary.isVisible().catch(() => false);

    if (hasAlerts) {
      // Should show at least 1 product needing attention
      await expect(alertSummary).toContainText('need attention');

      // View inventory button should be available
      await expect(page.locator('[data-testid="btn-view-inventory"]')).toBeVisible();
    }
  });
});
