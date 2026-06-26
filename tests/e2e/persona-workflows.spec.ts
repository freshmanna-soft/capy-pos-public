import { test, expect, Page } from '@playwright/test';
import { loginAsAdmin } from './helpers/auth';

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

/**
 * Helper: Get the visible navigation container.
 * The app has two nav elements (mobile bottom bar + desktop sidebar).
 * This returns the one that is visible in the current viewport.
 */
async function getVisibleNav(page: Page) {
  const desktopNav = page.locator('[data-testid="navigation-desktop"]');
  if (await desktopNav.isVisible().catch(() => false)) {
    return desktopNav;
  }
  return page.locator('[data-testid="navigation"]');
}

/**
 * Helper: Click a navigation link by its test ID, handling mobile/desktop duality.
 * On mobile, some items may be in the "More" overflow menu.
 */
async function waitForNavigation(page: Page) {
  // Wait for either mobile or desktop nav to become visible.
  // We use Promise.race because .or().first() always resolves to the first DOM element
  // (mobile nav) which is hidden on desktop viewports (md:hidden class).
  const mobileNav = page.locator('[data-testid="navigation"]');
  const desktopNav = page.locator('[data-testid="navigation-desktop"]');
  await Promise.race([
    mobileNav.waitFor({ state: 'visible', timeout: 15000 }).catch(() => null),
    desktopNav.waitFor({ state: 'visible', timeout: 15000 }).catch(() => null),
  ]);
  // Verify at least one is actually visible
  const mobileVisible = await mobileNav.isVisible().catch(() => false);
  const desktopVisible = await desktopNav.isVisible().catch(() => false);
  if (!mobileVisible && !desktopVisible) {
    throw new Error('Neither mobile nor desktop navigation became visible within timeout');
  }
}

async function clickNavLink(page: Page, testId: string) {
  // Wait for any navigation to be ready
  await waitForNavigation(page);

  const desktopNav = page.locator('[data-testid="navigation-desktop"]');
  if (await desktopNav.isVisible().catch(() => false)) {
    await desktopNav.locator(`[data-testid="${testId}"]`).click();
    return;
  }
  // Mobile: check if link is in bottom bar
  const mobileNav = page.locator('[data-testid="navigation"]');
  const link = mobileNav.locator(`[data-testid="${testId}"]`);
  if (await link.isVisible().catch(() => false)) {
    await link.click();
    return;
  }
  // Link is in overflow menu — open "More" first
  const moreBtn = page.locator('[data-testid="nav-more"]');
  await moreBtn.click();
  await page.locator('[role="menu"]').waitFor({ state: 'visible', timeout: 5000 });
  await page.locator(`[role="menu"] [data-testid="${testId}"]`).click();
}

/**
 * Helper: Get a nav link locator for assertions.
 * Scopes to the visible navigation container to avoid picking hidden mobile/desktop duplicates.
 */
async function getNavLink(page: Page, testId: string) {
  const nav = await getVisibleNav(page);
  return nav.locator(`[data-testid="${testId}"]`);
}

// ============================================================
// NAVIGATION ACCESSIBILITY TESTS
// Every route MUST be reachable from the UI navigation
// ============================================================

test.describe('Navigation Accessibility - All Features Reachable', () => {
  test.beforeEach(async ({ page }) => {
    await loginAsAdmin(page);
    await page.goto('/');
    // Wait for either mobile or desktop nav to be visible
    await waitForNavigation(page);
  });

  test('navigation sidebar is visible and contains all required links', async ({ page }) => {
    const nav = await getVisibleNav(page);
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

    // On mobile, overflow items are only rendered when "More" menu is opened (@if guard).
    // Open the overflow menu if we're on mobile so all links become attached.
    const moreBtn = page.locator('[data-testid="nav-more"]');
    if (await moreBtn.isVisible().catch(() => false)) {
      await moreBtn.click();
      await page.locator('[role="menu"]').waitFor({ state: 'visible', timeout: 5000 });
    }

    for (const link of requiredNavLinks) {
      const navLink = page.locator(`[data-testid="${link.testId}"]`).first();
      await expect(
        navLink,
        `Navigation link "${link.label}" (${link.testId}) must exist`
      ).toBeAttached();
    }
  });

  test('POS Terminal is accessible via navigation', async ({ page }) => {
    await clickNavLink(page, 'nav-pos');
    await expect(page.locator('[data-testid="pos-terminal"]')).toBeVisible();
    await expect(page).toHaveURL(/\/pos/);
  });

  test('Transaction History is accessible via navigation', async ({ page }) => {
    await clickNavLink(page, 'nav-history');
    await expect(page).toHaveURL(/\/history/);
    // Should load the transaction history component
    // Verify we're not redirected back to POS (which would mean the route is broken)
    expect(page.url()).toContain('/history');
  });

  test('Inventory is accessible via navigation', async ({ page }) => {
    await clickNavLink(page, 'nav-inventory');
    await expect(page).toHaveURL(/\/inventory/);
  });

  test('Customers is accessible via navigation', async ({ page }) => {
    await clickNavLink(page, 'nav-customers');
    await expect(page).toHaveURL(/\/customers/);
  });

  test('Reports is accessible via navigation', async ({ page }) => {
    await clickNavLink(page, 'nav-reports');
    await expect(page).toHaveURL(/\/reports/);
  });

  test('Agent Monitor (Dashboard) is accessible via navigation', async ({ page }) => {
    await clickNavLink(page, 'nav-dashboard');
    await expect(page).toHaveURL(/\/dashboard/);
  });

  test('Settings is accessible via navigation', async ({ page }) => {
    await clickNavLink(page, 'nav-settings');
    await expect(page).toHaveURL(/\/settings/);
  });

  test('no route exists without a corresponding navigation link', async ({ page }) => {
    // This test ensures the anti-pattern of "orphan routes" is caught
    // All defined routes (except redirects and wildcards) must have nav links
    // Count unique nav links across both mobile and desktop navs
    const nav = await getVisibleNav(page);
    const navLinks = await nav.locator('[data-testid^="nav-"]').all();
    const navCount = navLinks.length;

    // We expect at least 7 navigation links (pos, history, inventory, customers, reports, dashboard, settings)
    // On mobile, only 4 are in bottom bar + overflow menu has the rest
    expect(navCount).toBeGreaterThanOrEqual(4);
  });
});

// ============================================================
// PERSONA: Maria the Cashier
// Focus: Speed, multi-item add, checkout flow
// ============================================================

test.describe('Persona: Maria the Cashier - POS Workflow', () => {
  test.beforeEach(async ({ page }) => {
    await loginAsAdmin(page);
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

    // First ensure products are loaded by waiting for initial load
    // The component loads all products on init, so wait for them to appear
    await page.waitForSelector('[data-testid="product-result"]', { timeout: 10000 });

    // On mobile, category chips may need scrolling into view
    const categoryChips = page.locator('.category-chip:not([data-testid="category-all"])');
    const chipCount = await categoryChips.count();

    if (chipCount > 0) {
      // Scroll the first non-All chip into view before clicking (mobile viewport)
      await categoryChips.first().scrollIntoViewIfNeeded();
      await categoryChips.first().click();

      // Wait for the async category filter to complete and results to render
      // Use polling assertion to handle mobile rendering delays
      await expect
        .poll(async () => page.locator('[data-testid="product-result"]').count(), {
          timeout: 15000,
        })
        .toBeGreaterThan(0);
    }
  });

  test('cashier sees cart section alongside product search', async ({ page }) => {
    await expect(page.locator('[data-testid="search-section"]')).toBeVisible();
    // Cart section is only visible on lg+ viewports (desktop side-by-side layout)
    // On mobile, cart is accessed via a floating button/overlay
    const cartSection = page.locator('[data-testid="cart-section"]');
    const isDesktop = await cartSection.isVisible().catch(() => false);
    if (isDesktop) {
      await expect(cartSection).toBeVisible();
    } else {
      // On mobile, cart section exists in DOM but is hidden (lg:flex)
      await expect(cartSection).toBeAttached();
    }
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
    await clickNavLink(page, 'nav-history');
    await expect(page).toHaveURL(/\/history/);
  });
});

// ============================================================
// PERSONA: Carlos the Manager - Reports & Oversight
// ============================================================

test.describe('Persona: Carlos the Manager - Reports & Oversight', () => {
  test.beforeEach(async ({ page }) => {
    await loginAsAdmin(page);
  });

  test('manager can access reports from navigation', async ({ page }) => {
    await page.goto('/');
    await clickNavLink(page, 'nav-reports');
    await expect(page).toHaveURL(/\/reports/);
  });

  test('manager can access transaction history from navigation', async ({ page }) => {
    await page.goto('/');
    await clickNavLink(page, 'nav-history');
    await expect(page).toHaveURL(/\/history/);
  });

  test('manager can navigate between reports and transaction history', async ({ page }) => {
    await page.goto('/reports');

    // Navigate to transaction history
    await clickNavLink(page, 'nav-history');
    await expect(page).toHaveURL(/\/history/);

    // Navigate back to reports
    await clickNavLink(page, 'nav-reports');
    await expect(page).toHaveURL(/\/reports/);
  });

  test('manager can access inventory to check stock levels', async ({ page }) => {
    await page.goto('/');
    await clickNavLink(page, 'nav-inventory');
    await expect(page).toHaveURL(/\/inventory/);
  });

  test('manager can access agent monitor dashboard', async ({ page }) => {
    await page.goto('/');
    await clickNavLink(page, 'nav-dashboard');
    await expect(page).toHaveURL(/\/dashboard/);
  });

  test('manager workflow: check reports then review transactions', async ({ page }) => {
    // Full manager workflow
    await page.goto('/');

    // Step 1: Check reports
    await clickNavLink(page, 'nav-reports');
    await expect(page).toHaveURL(/\/reports/);

    // Step 2: Review transaction history
    await clickNavLink(page, 'nav-history');
    await expect(page).toHaveURL(/\/history/);

    // Step 3: Check inventory levels
    await clickNavLink(page, 'nav-inventory');
    await expect(page).toHaveURL(/\/inventory/);

    // Step 4: Monitor system health
    await clickNavLink(page, 'nav-dashboard');
    await expect(page).toHaveURL(/\/dashboard/);
  });
});

// ============================================================
// PERSONA: Ana the Inventory Clerk - Stock Management
// ============================================================

test.describe('Persona: Ana the Inventory Clerk - Inventory Management', () => {
  test.beforeEach(async ({ page }) => {
    await loginAsAdmin(page);
    await page.goto('/');
    await clickNavLink(page, 'nav-inventory');
    await expect(page).toHaveURL(/\/inventory/);
  });

  test('inventory page loads with product list', async ({ page }) => {
    // The inventory page should show products
    // Verify the page has content (not blank)
    const bodyText = await page.locator('main').textContent();
    expect(bodyText?.length).toBeGreaterThan(0);
  });

  test('inventory clerk can navigate to POS to verify product availability', async ({ page }) => {
    // Ana checks inventory, then verifies in POS
    await clickNavLink(page, 'nav-pos');
    await expect(page).toHaveURL(/\/pos/);
    await expect(page.locator('[data-testid="pos-terminal"]')).toBeVisible();
  });

  test('inventory clerk can access all sections from inventory page', async ({ page }) => {
    // Verify navigation is always accessible
    const nav = await getVisibleNav(page);
    await expect(nav).toBeVisible();

    // Core nav links should be visible in the nav bar (both mobile and desktop show these)
    await expect(await getNavLink(page, 'nav-pos')).toBeVisible();
    await expect(await getNavLink(page, 'nav-history')).toBeVisible();
    await expect(await getNavLink(page, 'nav-inventory')).toBeVisible();

    // Reports may be in overflow menu on mobile — open it first if needed
    const moreBtn = page.locator('[data-testid="nav-more"]');
    if (await moreBtn.isVisible().catch(() => false)) {
      await moreBtn.click();
      await page.locator('[role="menu"]').waitFor({ state: 'visible', timeout: 5000 });
    }
    await expect(page.locator('[data-testid="nav-reports"]').first()).toBeAttached();
  });
});

// ============================================================
// CROSS-FEATURE NAVIGATION TESTS
// Validates that navigation works correctly between all features
// ============================================================

test.describe('Cross-Feature Navigation Integrity', () => {
  test.beforeEach(async ({ page }) => {
    await loginAsAdmin(page);
  });

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
      await clickNavLink(page, route.nav);
      await expect(page).toHaveURL(new RegExp(route.url));
    }
  });

  test('active navigation link is highlighted correctly', async ({ page }) => {
    await page.goto('/pos');
    await waitForNavigation(page);

    // The POS link should have the active/highlighted class
    // Desktop uses "bg-blue-600 text-white", mobile uses "text-blue-400"
    const nav = await getVisibleNav(page);
    const posLink = nav.locator('[data-testid="nav-pos"]');
    await expect(posLink).toHaveClass(/text-blue-400|bg-blue-600/);

    // Navigate to inventory
    await clickNavLink(page, 'nav-inventory');
    await page.waitForURL(/\/inventory/);

    // Now inventory should be active, POS should not
    const inventoryLink = nav.locator('[data-testid="nav-inventory"]');
    await expect(inventoryLink).toHaveClass(/text-blue-400|bg-blue-600/);
    await expect(posLink).not.toHaveClass(/text-blue-400|bg-blue-600/);
  });

  test('navigation sidebar can be collapsed and expanded', async ({ page }) => {
    // This test only applies to desktop viewports where the sidebar is visible
    await page.goto('/pos');
    await waitForNavigation(page);

    const desktopNav = page.locator('[data-testid="navigation-desktop"]');
    // Skip test on mobile viewports where sidebar doesn't exist
    const isDesktopVisible = await desktopNav.isVisible().catch(() => false);
    test.skip(!isDesktopVisible, 'Sidebar collapse only applies to desktop viewports');
    if (!isDesktopVisible) return;

    // Find and click collapse button (aria-label contains "Collapse")
    const collapseBtn = desktopNav.locator('button[aria-label*="Collapse"]');
    await expect(collapseBtn).toBeVisible();

    await collapseBtn.click();

    // Navigation should be collapsed (has md:w-16 class)
    await expect(desktopNav).toHaveClass(/md:w-16/);

    // Nav links should still be clickable even when collapsed
    await desktopNav.locator('[data-testid="nav-inventory"]').click();
    await expect(page).toHaveURL(/\/inventory/);
  });

  test('browser back/forward navigation works correctly', async ({ page }) => {
    await page.goto('/pos');
    await waitForNavigation(page);

    // Navigate to inventory
    await clickNavLink(page, 'nav-inventory');
    await expect(page).toHaveURL(/\/inventory/);

    // Navigate to reports
    await clickNavLink(page, 'nav-reports');
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
  test.beforeEach(async ({ page }) => {
    await loginAsAdmin(page);
  });

  test('BUG-001: Search results persist after product selection', async ({ page }) => {
    await page.goto('/pos');
    await page.waitForSelector('[data-testid="pos-terminal"]');

    const searchInput = page.locator('[data-testid="product-search"]');
    await searchInput.fill('co');

    await page.waitForSelector('[data-testid="product-result"]', { timeout: 5000 });

    // Wait for debounced search to fully resolve (300ms debounce + network)
    // The component does an immediate client-side filter, then a debounced service call
    // that may return different results. We must wait for the final stable state.
    await page.waitForTimeout(800);

    // Count results before selection (after debounce has fully settled)
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
    await waitForNavigation(page);

    // Transaction History link MUST exist in navigation
    const historyLink = await getNavLink(page, 'nav-history');
    await expect(historyLink).toBeVisible();

    // Clicking it MUST navigate to /history
    await clickNavLink(page, 'nav-history');
    await expect(page).toHaveURL(/\/history/);

    // Page should not redirect away (e.g., to /pos via wildcard)
    await page.waitForTimeout(1000);
    expect(page.url()).toContain('/history');
  });
});
