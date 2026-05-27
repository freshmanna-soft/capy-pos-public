import { test, expect } from '@playwright/test';

test.describe('POS Terminal', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('http://localhost:4200');
  });

  test('should load the application', async ({ page }) => {
    // Check header
    await expect(page.locator('h1')).toContainText('Capy POS');
    await expect(page.locator('.tagline')).toContainText('Point of Sale System');
  });

  test('should display products', async ({ page }) => {
    // Wait for products to load
    await expect(page.locator('.products-section h2')).toContainText('Products (12)');
    
    // Check that product cards are visible
    const productCards = page.locator('.product-card');
    await expect(productCards).toHaveCount(12);
    
    // Check first product
    const firstProduct = productCards.first();
    await expect(firstProduct).toBeVisible();
    await expect(firstProduct.locator('h3')).toContainText('Coffee');
    await expect(firstProduct.locator('.product-price')).toContainText('$4.50');
  });

  test('should search products', async ({ page }) => {
    // Type in search box
    await page.locator('.search-input').fill('coffee');
    
    // Should show only coffee
    await expect(page.locator('.products-section h2')).toContainText('Products (1)');
    await expect(page.locator('.product-card')).toHaveCount(1);
    await expect(page.locator('.product-card h3')).toContainText('Coffee');
    
    // Clear search
    await page.locator('.search-input').clear();
    await expect(page.locator('.products-section h2')).toContainText('Products (12)');
  });

  test('should add product to cart', async ({ page }) => {
    // Initially cart should be empty
    await expect(page.locator('.empty-cart')).toBeVisible();
    await expect(page.locator('.empty-cart')).toContainText('Cart is empty');
    
    // Click on Coffee product
    await page.locator('.product-card').first().click();
    
    // Cart should now have 1 item
    await expect(page.locator('.empty-cart')).not.toBeVisible();
    await expect(page.locator('.cart-item')).toHaveCount(1);
    await expect(page.locator('.cart-item .item-name')).toContainText('Coffee');
    await expect(page.locator('.cart-item .qty')).toContainText('1');
    
    // Check totals
    await expect(page.locator('.summary-row').first()).toContainText('$4.50');
  });

  test('should increase and decrease quantity', async ({ page }) => {
    // Add product
    await page.locator('.product-card').first().click();
    
    // Increase quantity
    await page.locator('.btn-qty').last().click(); // + button
    await expect(page.locator('.cart-item .qty')).toContainText('2');
    await expect(page.locator('.summary-row').first()).toContainText('$9.00');
    
    // Decrease quantity
    await page.locator('.btn-qty').first().click(); // - button
    await expect(page.locator('.cart-item .qty')).toContainText('1');
    await expect(page.locator('.summary-row').first()).toContainText('$4.50');
  });

  test('should remove item from cart', async ({ page }) => {
    // Add product
    await page.locator('.product-card').first().click();
    await expect(page.locator('.cart-item')).toHaveCount(1);
    
    // Remove item
    await page.locator('.btn-remove').click();
    
    // Cart should be empty
    await expect(page.locator('.empty-cart')).toBeVisible();
    await expect(page.locator('.cart-item')).toHaveCount(0);
  });

  test('should clear cart', async ({ page }) => {
    // Add multiple products
    await page.locator('.product-card').nth(0).click();
    await page.locator('.product-card').nth(1).click();
    await page.locator('.product-card').nth(2).click();
    
    await expect(page.locator('.cart-item')).toHaveCount(3);
    
    // Clear cart
    await page.locator('.btn-text').click();
    
    // Cart should be empty
    await expect(page.locator('.empty-cart')).toBeVisible();
    await expect(page.locator('.cart-item')).toHaveCount(0);
  });

  test('should calculate tax and total correctly', async ({ page }) => {
    // Add Coffee ($4.50)
    await page.locator('.product-card').first().click();
    
    // Check calculations
    const subtotal = page.locator('.summary-row').nth(0);
    const tax = page.locator('.summary-row').nth(1);
    const total = page.locator('.summary-row').nth(2);
    
    await expect(subtotal).toContainText('$4.50');
    await expect(tax).toContainText('$0.36'); // 8% of 4.50
    await expect(total).toContainText('$4.86');
  });

  test('should complete checkout', async ({ page }) => {
    // Add product
    await page.locator('.product-card').first().click();
    
    // Setup dialog handler
    page.on('dialog', async dialog => {
      expect(dialog.message()).toContain('Checkout Successful');
      expect(dialog.message()).toContain('Coffee');
      expect(dialog.message()).toContain('$4.86');
      await dialog.accept();
    });
    
    // Click checkout
    await page.locator('.btn-checkout').click();
    
    // Wait a bit for dialog to be handled
    await page.waitForTimeout(500);
    
    // Cart should be empty after checkout
    await expect(page.locator('.empty-cart')).toBeVisible();
  });

  test('should disable checkout when cart is empty', async ({ page }) => {
    // Checkout button should be disabled
    await expect(page.locator('.btn-checkout')).toBeDisabled();
    
    // Add product
    await page.locator('.product-card').first().click();
    
    // Checkout button should be enabled
    await expect(page.locator('.btn-checkout')).toBeEnabled();
  });

  test('should open settings dialog', async ({ page }) => {
    // Setup dialog handler
    page.on('dialog', async dialog => {
      expect(dialog.message()).toContain('Settings');
      expect(dialog.message()).toContain('Tax Rate: 8%');
      await dialog.accept();
    });
    
    // Click settings button
    await page.locator('.btn-icon').first().click();
  });

  test('should show user info dialog', async ({ page }) => {
    // Setup dialog handler
    page.on('dialog', async dialog => {
      expect(dialog.message()).toContain('User Information');
      expect(dialog.message()).toContain('Cashier');
      await dialog.accept();
    });
    
    // Click user button
    await page.locator('.btn-icon').last().click();
  });

  test('should be responsive on mobile', async ({ page }) => {
    // Set mobile viewport
    await page.setViewportSize({ width: 375, height: 667 });
    
    // Products should still be visible
    await expect(page.locator('.products-section')).toBeVisible();
    await expect(page.locator('.product-card')).toHaveCount(12);
    
    // Cart should still be visible
    await expect(page.locator('.cart-section')).toBeVisible();
  });

  test('should handle multiple items in cart', async ({ page }) => {
    // Add different products
    await page.locator('.product-card').nth(0).click(); // Coffee $4.50
    await page.locator('.product-card').nth(1).click(); // Sandwich $8.99
    await page.locator('.product-card').nth(2).click(); // Salad $7.50
    
    // Should have 3 items
    await expect(page.locator('.cart-item')).toHaveCount(3);
    
    // Check total (4.50 + 8.99 + 7.50 = 20.99, tax = 1.68, total = 22.67)
    await expect(page.locator('.summary-row').nth(0)).toContainText('$20.99');
    await expect(page.locator('.summary-row').nth(1)).toContainText('$1.68');
    await expect(page.locator('.summary-row').nth(2)).toContainText('$22.67');
  });

  test('should search by category', async ({ page }) => {
    // Search for beverages
    await page.locator('.search-input').fill('beverages');
    
    // Should show 3 beverages (Coffee, Tea, Juice)
    await expect(page.locator('.products-section h2')).toContainText('Products (3)');
    await expect(page.locator('.product-card')).toHaveCount(3);
  });

  test('should show no results message', async ({ page }) => {
    // Search for non-existent product
    await page.locator('.search-input').fill('xyz123');
    
    // Should show no results
    await expect(page.locator('.no-results')).toBeVisible();
    await expect(page.locator('.no-results')).toContainText('No products found');
    await expect(page.locator('.product-card')).toHaveCount(0);
  });
});

// Made with Bob
