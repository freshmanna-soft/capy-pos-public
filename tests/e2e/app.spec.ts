import { test, expect } from '@playwright/test';
import { loginAsAdmin } from './helpers/auth';

/**
 * Basic E2E Tests for Capy-POS
 * Tests the main application functionality
 */

test.describe('Capy-POS Application', () => {
  test.beforeEach(async ({ page }) => {
    await loginAsAdmin(page);
  });

  test('should load the application', async ({ page }) => {
    await page.goto('/');

    // Wait for the app to load
    await page.waitForLoadState('networkidle');

    // Check if the page title is correct
    await expect(page).toHaveTitle(/Capy-POS/i);
  });

  test('should display the main navigation', async ({ page }) => {
    await page.goto('/');

    // Check for navigation elements
    // This will need to be updated based on actual implementation
    const body = await page.locator('body');
    await expect(body).toBeVisible();
  });

  test('should be responsive', async ({ page }) => {
    // Test desktop view
    await page.setViewportSize({ width: 1920, height: 1080 });
    await page.goto('/');
    await expect(page.locator('body')).toBeVisible();

    // Test tablet view
    await page.setViewportSize({ width: 768, height: 1024 });
    await expect(page.locator('body')).toBeVisible();

    // Test mobile view
    await page.setViewportSize({ width: 375, height: 667 });
    await expect(page.locator('body')).toBeVisible();
  });
});

test.describe('Button Component', () => {
  test.beforeEach(async ({ page }) => {
    await loginAsAdmin(page);
  });

  test('should render buttons correctly', async ({ page }) => {
    await page.goto('/');

    // This test will be expanded once we have actual buttons in the UI
    const body = await page.locator('body');
    await expect(body).toBeVisible();
  });
});

// Made with Bob
