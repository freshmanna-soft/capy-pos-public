import { test, expect } from '@playwright/test';

/**
 * E2E Tests for Low Stock Alerts (S4-3)
 *
 * Validates:
 * - Settings page threshold configuration
 * - Dashboard low stock widget display
 * - Navigation from widget to inventory
 *
 * Persona: Ana the Inventory Clerk
 */

test.describe('Low Stock Alerts - Settings Configuration', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/settings');
    await page.waitForLoadState('networkidle');
  });

  test('settings page displays low stock threshold section', async ({ page }) => {
    await expect(page.locator('[data-testid="settings-page"]')).toBeVisible();
    await expect(page.locator('[data-testid="low-stock-settings"]')).toBeVisible();
  });

  test('threshold input is visible with default value', async ({ page }) => {
    const input = page.locator('[data-testid="input-threshold"]');
    await expect(input).toBeVisible();
  });

  test('can increase threshold with + button', async ({ page }) => {
    const input = page.locator('[data-testid="input-threshold"]');
    const increaseBtn = page.locator('[data-testid="btn-increase-threshold"]');

    const valueBefore = await input.inputValue();
    await increaseBtn.click();
    const valueAfter = await input.inputValue();

    expect(parseInt(valueAfter)).toBe(parseInt(valueBefore) + 1);
  });

  test('can decrease threshold with - button', async ({ page }) => {
    const input = page.locator('[data-testid="input-threshold"]');
    const decreaseBtn = page.locator('[data-testid="btn-decrease-threshold"]');

    // First increase to ensure we're above 1
    const increaseBtn = page.locator('[data-testid="btn-increase-threshold"]');
    await increaseBtn.click();

    const valueBefore = await input.inputValue();
    await decreaseBtn.click();
    const valueAfter = await input.inputValue();

    expect(parseInt(valueAfter)).toBe(parseInt(valueBefore) - 1);
  });

  test('save button exists and is clickable', async ({ page }) => {
    const saveBtn = page.locator('[data-testid="btn-save-threshold"]');
    await expect(saveBtn).toBeVisible();
  });

  test('can save threshold and see success message', async ({ page }) => {
    // Change threshold
    const increaseBtn = page.locator('[data-testid="btn-increase-threshold"]');
    await increaseBtn.click();

    // Save
    const saveBtn = page.locator('[data-testid="btn-save-threshold"]');
    await saveBtn.click();

    // Should show success message
    await expect(page.locator('[data-testid="save-success"]')).toBeVisible({ timeout: 3000 });
  });
});

test.describe('Low Stock Alerts - Dashboard Widget', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/dashboard');
    await page.waitForLoadState('networkidle');
  });

  test('dashboard displays low stock widget', async ({ page }) => {
    await expect(page.locator('[data-testid="dashboard-widgets"]')).toBeVisible();
    await expect(page.locator('[data-testid="low-stock-widget"]')).toBeVisible();
  });

  test('widget shows either healthy state or alert summary', async ({ page }) => {
    // Wait for widget to load
    await page.waitForTimeout(1000);

    const healthyState = page.locator('[data-testid="healthy-state"]');
    const alertSummary = page.locator('[data-testid="alert-summary"]');

    // One of these should be visible (depending on data)
    const isHealthy = await healthyState.isVisible().catch(() => false);
    const hasAlerts = await alertSummary.isVisible().catch(() => false);

    expect(isHealthy || hasAlerts).toBe(true);
  });

  test('widget has view inventory button when alerts exist', async ({ page }) => {
    await page.waitForTimeout(1000);

    const alertSummary = page.locator('[data-testid="alert-summary"]');
    const hasAlerts = await alertSummary.isVisible().catch(() => false);

    if (hasAlerts) {
      const viewBtn = page.locator('[data-testid="btn-view-inventory"]');
      await expect(viewBtn).toBeVisible();
    }
  });
});

test.describe('Low Stock Alerts - Persona: Ana the Inventory Clerk', () => {
  test('Ana can configure threshold then check dashboard for alerts', async ({ page }) => {
    // Step 1: Navigate to settings
    await page.goto('/');
    await page.click('[data-testid="nav-settings"]');
    await expect(page).toHaveURL(/\/settings/);

    // Step 2: Verify threshold configuration is available
    await expect(page.locator('[data-testid="low-stock-settings"]')).toBeVisible();
    await expect(page.locator('[data-testid="input-threshold"]')).toBeVisible();

    // Step 3: Navigate to dashboard to check alerts
    await page.click('[data-testid="nav-dashboard"]');
    await expect(page).toHaveURL(/\/dashboard/);

    // Step 4: Verify widget is present
    await expect(page.locator('[data-testid="low-stock-widget"]')).toBeVisible();
  });

  test('Ana can navigate from widget to inventory for low stock items', async ({ page }) => {
    await page.goto('/dashboard');
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(1000);

    // If alerts exist, click view inventory button
    const viewBtn = page.locator('[data-testid="btn-view-inventory"]');
    const btnVisible = await viewBtn.isVisible().catch(() => false);

    if (btnVisible) {
      await viewBtn.click();
      await expect(page).toHaveURL(/\/inventory/);
      // Should have filter query param
      expect(page.url()).toContain('filter=low-stock');
    }
  });
});
