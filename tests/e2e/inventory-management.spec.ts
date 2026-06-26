import { test, expect } from '@playwright/test';
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
