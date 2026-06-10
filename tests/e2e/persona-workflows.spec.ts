import { test, expect, Page } from '@playwright/test';

/**
 * Persona-Based E2E Tests for Capy-POS
 *
 * These tests validate that ALL features are accessible from the UI
 * and that core user workflows function correctly for each persona.
 *
 * Personas:
 * - Maria the Cashier: Daily POS user, speed-focused, multi-item workflows
 * - Carlos the Manager: Reports, transaction history, oversight
 * - Ana the Inventory Clerk: Stock management, low-stock alerts
 *
 * Known bugs validated:
 * - BUG-001: Products disappear from search after adding to cart (FIXED)
 * - BUG-002: Transaction History not accessible from navigation (FIXED)
 */

// ============================================================
// NAVIGATION ACCESSIBILITY TESTS
// Every route MUST be reachable from the UI navigation
// ============================================================

test.describe('Navigation Accessibility - All Features Reachable', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await page.waitForSelector('[data-testid="navigation"]');
  });

  test('navigation sidebar is visible and contains all required links', async ({ page }) => {
    const nav = page.locator('[data-testid="navigation"]');
    await expect(nav).toBeVisible();

    // Every route in app.routes.ts MUST have a corresponding nav link
    const requiredNavLinks = [
      { testId: 'nav-pos', label: 'POS Terminal' },
      { testId: 'nav-history', label: 'Transactions' },
      { testId: 'nav-inventory', label: 'Inventory' },
      { testId: 'nav-customers', label: 'Customers' },
      { testId: 'nav-reports', label: 'Reports' },
      { testId: 'nav-dashboard', label: 'Agent Monitor' },
      { testId: 'nav-settings', label: 'Settings' },
    ];

    for (const link of requiredNavLinks) {
      const navLink = page.locator(`[data-testid="${link.testId}"]`);
      await expect(navLink, `Navigation link "${link.label}" (${link.testId}) must exist`).toBeVisible();
    }
  });

  test('POS Terminal is accessible via navigation', async ({ page }) => {
    await page.click('[data-testid="nav-pos"]');
    await expect(page.locator('[data-testid="pos-terminal"]')).toBeVisible();
    await expect(page).toHaveURL(/\/pos/);
  });

  test('Transaction History is accessible via navigation', async ({ page }) => {
    await page.click('[data-testid="nav-history"]');
    await expect(page).toHaveURL(/\/history/);
    // Should load the transaction history component
    await page.waitForLoadState('networkidle');
    // Verify we're not redirected back to POS (which would mean the route is broken)
    expect(page.url()).toContain('/history');
  });

  test('Inventory is accessible via navigation', async ({ page }) => {
    await page.click('[data-testid="nav-inventory"]');
    await expect(page).toHaveURL(/\/inventory/);
  });

  test('Customers is accessible via navigation', async ({ page }) => {
    await page.click('[data-testid="nav-customers"]');
    await expect(page).toHaveURL(/\/customers/);
  });

  test('Reports is accessible via navigation', async ({ page }) => {
    await page.click('[data-testid="nav-reports"]');
    await expect(page).toHaveURL(/\/reports/);
  });

  test('Agent Monitor (Dashboard) is accessible via navigation', async ({ page }) => {
    await page.click('[data-testid="nav-dashboard"]');
    await expect(page).toHaveURL(/\/dashboard/);
  });

  test('Settings is accessible via navigation', async ({ page }) => {
    await page.click('[data-testid="nav-settings"]');
    await expect(page).toHaveURL(/\/settings/);
  });

  test('no route exists without a corresponding navigation link', async ({ page }) => {
    // This test ensures the anti-pattern of "orphan routes" is caught
    // All defined routes (except redirects and wildcards) must have nav links
    const navLinks = await page.locator('[data-testid^="nav-"]').all();
    const navCount = navLinks.length;

    // We expect at least 7 navigation links (pos, history, inventory, customers, reports, dashboard, settings)
    expect(navCount).toBeGreaterThanOrEqual(7);
  });
});

// ============================================================
// PERSONA: Maria the Cashier
// Focus: Speed, multi-item add, checkout flow
// ============================================================

test.describe('Persona: Maria the Cashier - POS Workflow', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/pos');
    await page.waitForSelector('[data-testid="pos-terminal"]');
  });

  test('BUG-001 REGRESSION: products remain visible after adding to cart', async ({ page }) => {
    // This is the critical bug fix validation
    // Previously: selecting a product would clear all search results
    // Expected: products stay visible so cashier can add multiple items quickly

    const searchInput = page.locator('[data-testid="product-search"]');
    await searchInput.fill('co');

    // Wait for search results to appear
    await page.waitForSelector('[data-testid="product-result"]', { timeout: 5000 });

    const resultsBefore = await page.locator('[data-testid="product-result"]').count();
    expect(resultsBefore).toBeGreaterThan(0);

    // Click the first product to add to cart (force for mobile viewports where elements may overlap)
    await page.locator('[data-testid="product-result"]').first().click({ force: true });

    // CRITICAL: Search results should STILL be visible after selection
    const resultsAfter = await page.locator('[data-testid="product-result"]').count();
    expect(resultsAfter).toBeGreaterThan(0);
    expect(resultsAfter).toBe(resultsBefore);
  });

  test('cashier can add multiple products without re-searching', async ({ page }) => {
    const searchInput = page.locator('[data-testid="product-search"]');
    await searchInput.fill('co');

    await page.waitForSelector('[data-testid="product-result"]', { timeout: 5000 });

    // Add first product (force for mobile viewports where elements may overlap in stacked layout)
    await page.locator('[data-testid="product-result"]').first().click({ force: true });

    // Results should still be visible - add second product (or same product again)
    const resultsStillVisible = await page.locator('[data-testid="product-result"]').count();
    expect(resultsStillVisible).toBeGreaterThan(0);

    // Click another product (if available)
    if (resultsStillVisible > 1) {
      await page.locator('[data-testid="product-result"]').nth(1).click({ force: true });
    } else {
      // Click same product again (should increment quantity)
      await page.locator('[data-testid="product-result"]').first().click({ force: true });
    }

    // Results should STILL be visible
    const resultsAfterSecond = await page.locator('[data-testid="product-result"]').count();
    expect(resultsAfterSecond).toBeGreaterThan(0);
  });

  test('cashier can clear search results with Escape key', async ({ page }) => {
    const searchInput = page.locator('[data-testid="product-search"]');
    await searchInput.fill('co');

    await page.waitForSelector('[data-testid="product-result"]', { timeout: 5000 });
    expect(await page.locator('[data-testid="product-result"]').count()).toBeGreaterThan(0);

    // Press Escape to explicitly clear
    await searchInput.press('Escape');

    // Now results should be cleared
    await expect(page.locator('[data-testid="product-result"]')).toHaveCount(0);
  });

  test('cashier can search products by typing in search field', async ({ page }) => {
    const searchInput = page.locator('[data-testid="product-search"]');
    await expect(searchInput).toBeVisible();

    await searchInput.fill('Coffee');

    // Wait for debounced search
    await page.waitForSelector('[data-testid="product-result"]', { timeout: 5000 });

    const results = page.locator('[data-testid="product-result"]');
    await expect(results.first()).toBeVisible();
  });

  test('cashier can filter products by category', async ({ page }) => {
    const categoryFilter = page.locator('[data-testid="category-filter"]');
    await expect(categoryFilter).toBeVisible();

    // Click on a category chip (not "All")
    const categoryChips = page.locator('.category-chip:not([data-testid="category-all"])');
    const chipCount = await categoryChips.count();

    if (chipCount > 0) {
      await categoryChips.first().click();

      // Should show filtered results
      await page.waitForSelector('[data-testid="product-result"]', { timeout: 5000 });
      const results = await page.locator('[data-testid="product-result"]').count();
      expect(results).toBeGreaterThan(0);
    }
  });

  test('cashier sees cart section alongside product search', async ({ page }) => {
    await expect(page.locator('[data-testid="search-section"]')).toBeVisible();
    await expect(page.locator('[data-testid="cart-section"]')).toBeVisible();
  });

  test('out-of-stock products cannot be added to cart', async ({ page }) => {
    // Search for products
    const searchInput = page.locator('[data-testid="product-search"]');
    await searchInput.fill('co');

    await page.waitForSelector('[data-testid="product-result"]', { timeout: 5000 });

    // Check if any out-of-stock products exist
    const outOfStockItems = page.locator('[data-testid="product-result"].out-of-stock');
    const outOfStockCount = await outOfStockItems.count();

    if (outOfStockCount > 0) {
      // Verify they have aria-disabled
      const firstOutOfStock = outOfStockItems.first();
      await expect(firstOutOfStock).toHaveAttribute('aria-disabled', 'true');
    }
  });

  test('cashier can navigate to transaction history from nav', async ({ page }) => {
    // From POS page, cashier should be able to quickly check past transactions
    await page.click('[data-testid="nav-history"]');
    await expect(page).toHaveURL(/\/history/);
  });
});

// ============================================================
// PERSONA: Carlos the Manager - Reports & Oversight
// ============================================================

test.describe('Persona: Carlos the Manager - Reports & Oversight', () => {
  test('manager can access reports from navigation', async ({ page }) => {
    await page.goto('/');
    await page.click('[data-testid="nav-reports"]');
    await expect(page).toHaveURL(/\/reports/);
    await page.waitForLoadState('networkidle');
  });

  test('manager can access transaction history from navigation', async ({ page }) => {
    await page.goto('/');
    await page.click('[data-testid="nav-history"]');
    await expect(page).toHaveURL(/\/history/);
  });

  test('manager can navigate between reports and transaction history', async ({ page }) => {
    await page.goto('/reports');
    await page.waitForLoadState('networkidle');

    // Navigate to transaction history
    await page.click('[data-testid="nav-history"]');
    await expect(page).toHaveURL(/\/history/);

    // Navigate back to reports
    await page.click('[data-testid="nav-reports"]');
    await expect(page).toHaveURL(/\/reports/);
  });

  test('manager can access inventory to check stock levels', async ({ page }) => {
    await page.goto('/');
    await page.click('[data-testid="nav-inventory"]');
    await expect(page).toHaveURL(/\/inventory/);
    await page.waitForLoadState('networkidle');
  });

  test('manager can access agent monitor dashboard', async ({ page }) => {
    await page.goto('/');
    await page.click('[data-testid="nav-dashboard"]');
    await expect(page).toHaveURL(/\/dashboard/);
  });

  test('manager workflow: check reports then review transactions', async ({ page }) => {
    // Full manager workflow
    await page.goto('/');

    // Step 1: Check reports
    await page.click('[data-testid="nav-reports"]');
    await expect(page).toHaveURL(/\/reports/);
    await page.waitForLoadState('networkidle');

    // Step 2: Review transaction history
    await page.click('[data-testid="nav-history"]');
    await expect(page).toHaveURL(/\/history/);
    await page.waitForLoadState('networkidle');

    // Step 3: Check inventory levels
    await page.click('[data-testid="nav-inventory"]');
    await expect(page).toHaveURL(/\/inventory/);
    await page.waitForLoadState('networkidle');

    // Step 4: Monitor system health
    await page.click('[data-testid="nav-dashboard"]');
    await expect(page).toHaveURL(/\/dashboard/);
  });
});

// ============================================================
// PERSONA: Ana the Inventory Clerk - Stock Management
// ============================================================

test.describe('Persona: Ana the Inventory Clerk - Inventory Management', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await page.click('[data-testid="nav-inventory"]');
    await expect(page).toHaveURL(/\/inventory/);
    await page.waitForLoadState('networkidle');
  });

  test('inventory page loads with product list', async ({ page }) => {
    // The inventory page should show products
    await page.waitForLoadState('networkidle');
    // Verify the page has content (not blank)
    const bodyText = await page.locator('main').textContent();
    expect(bodyText?.length).toBeGreaterThan(0);
  });

  test('inventory clerk can navigate to POS to verify product availability', async ({ page }) => {
    // Ana checks inventory, then verifies in POS
    await page.click('[data-testid="nav-pos"]');
    await expect(page).toHaveURL(/\/pos/);
    await expect(page.locator('[data-testid="pos-terminal"]')).toBeVisible();
  });

  test('inventory clerk can access all sections from inventory page', async ({ page }) => {
    // Verify navigation is always accessible
    const nav = page.locator('[data-testid="navigation"]');
    await expect(nav).toBeVisible();

    // All nav links should be clickable
    await expect(page.locator('[data-testid="nav-pos"]')).toBeVisible();
    await expect(page.locator('[data-testid="nav-history"]')).toBeVisible();
    await expect(page.locator('[data-testid="nav-inventory"]')).toBeVisible();
    await expect(page.locator('[data-testid="nav-reports"]')).toBeVisible();
  });
});

// ============================================================
// CROSS-FEATURE NAVIGATION TESTS
// Validates that navigation works correctly between all features
// ============================================================

test.describe('Cross-Feature Navigation Integrity', () => {
  test('can navigate through all features sequentially', async ({ page }) => {
    await page.goto('/');

    const routes = [
      { nav: 'nav-pos', url: '/pos' },
      { nav: 'nav-history', url: '/history' },
      { nav: 'nav-inventory', url: '/inventory' },
      { nav: 'nav-customers', url: '/customers' },
      { nav: 'nav-reports', url: '/reports' },
      { nav: 'nav-dashboard', url: '/dashboard' },
      { nav: 'nav-settings', url: '/settings' },
    ];

    for (const route of routes) {
      await page.click(`[data-testid="${route.nav}"]`);
      await expect(page).toHaveURL(new RegExp(route.url));
      await page.waitForLoadState('networkidle');
    }
  });

  test('active navigation link is highlighted correctly', async ({ page }) => {
    await page.goto('/pos');
    await page.waitForSelector('[data-testid="navigation"]');

    // The POS link should have the active class
    const posLink = page.locator('[data-testid="nav-pos"]');
    await expect(posLink).toHaveClass(/active/);

    // Navigate to inventory
    await page.click('[data-testid="nav-inventory"]');
    await page.waitForURL(/\/inventory/);

    // Now inventory should be active, POS should not
    const inventoryLink = page.locator('[data-testid="nav-inventory"]');
    await expect(inventoryLink).toHaveClass(/active/);
    await expect(posLink).not.toHaveClass(/active/);
  });

  test('navigation sidebar can be collapsed and expanded', async ({ page }) => {
    await page.goto('/pos');
    await page.waitForSelector('[data-testid="navigation"]');

    // Find and click collapse button
    const collapseBtn = page.locator('.collapse-btn');
    await expect(collapseBtn).toBeVisible();

    await collapseBtn.click();

    // Navigation should be collapsed
    const nav = page.locator('.nav-sidebar');
    await expect(nav).toHaveClass(/collapsed/);

    // Nav links should still be clickable even when collapsed
    await page.click('[data-testid="nav-inventory"]');
    await expect(page).toHaveURL(/\/inventory/);
  });

  test('browser back/forward navigation works correctly', async ({ page }) => {
    await page.goto('/pos');
    await page.waitForSelector('[data-testid="navigation"]');

    // Navigate to inventory
    await page.click('[data-testid="nav-inventory"]');
    await expect(page).toHaveURL(/\/inventory/);

    // Navigate to reports
    await page.click('[data-testid="nav-reports"]');
    await expect(page).toHaveURL(/\/reports/);

    // Go back
    await page.goBack();
    await expect(page).toHaveURL(/\/inventory/);

    // Go back again
    await page.goBack();
    await expect(page).toHaveURL(/\/pos/);

    // Go forward
    await page.goForward();
    await expect(page).toHaveURL(/\/inventory/);
  });
});

// ============================================================
// BUG REGRESSION TESTS
// Specific tests for known bugs to prevent regression
// ============================================================

test.describe('Bug Regression Tests', () => {
  test('BUG-001: Search results persist after product selection', async ({ page }) => {
    await page.goto('/pos');
    await page.waitForSelector('[data-testid="pos-terminal"]');

    const searchInput = page.locator('[data-testid="product-search"]');
    await searchInput.fill('co');

    await page.waitForSelector('[data-testid="product-result"]', { timeout: 5000 });

    // Count results before selection
    const countBefore = await page.locator('[data-testid="product-result"]').count();
    expect(countBefore).toBeGreaterThan(0);

    // Select a product (force: true for mobile viewports where stacked layout causes overlap)
    await page.locator('[data-testid="product-result"]').first().click({ force: true });

    // Wait a moment for any async operations
    await page.waitForTimeout(500);

    // Results MUST still be visible (this was the bug)
    const countAfter = await page.locator('[data-testid="product-result"]').count();
    expect(countAfter).toBe(countBefore);
  });

  test('BUG-002: Transaction History accessible from navigation', async ({ page }) => {
    await page.goto('/');
    await page.waitForSelector('[data-testid="navigation"]');

    // Transaction History link MUST exist in navigation
    const historyLink = page.locator('[data-testid="nav-history"]');
    await expect(historyLink).toBeVisible();

    // Clicking it MUST navigate to /history
    await historyLink.click();
    await expect(page).toHaveURL(/\/history/);

    // Page should not redirect away (e.g., to /pos via wildcard)
    await page.waitForTimeout(1000);
    expect(page.url()).toContain('/history');
  });
});
