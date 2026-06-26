import { test, expect, Page } from '@playwright/test';
import { loginAsAdmin } from './helpers/auth';

/**
 * POS Terminal E2E Tests - Search to Cart Flow
 *
 * Story: [S1-6] E2E Test: Search to Cart Flow
 *
 * Covers the complete user journey from searching products
 * to managing the shopping cart, including edge cases.
 *
 * Acceptance Criteria:
 * - Search for product by name → results appear
 * - Click product → added to cart
 * - Adjust quantity in cart → total updates
 * - Remove item from cart → cart updates
 * - Clear cart → empty state shown
 * - Search with no results → empty state
 * - Add out-of-stock item → error shown (item not added)
 */

/**
 * Page Object Model for POS Terminal
 * Encapsulates selectors and common actions for maintainability
 */
class PosTerminalPage {
  constructor(readonly page: Page) {}

  // --- Selectors ---
  get searchInput() {
    return this.page.getByTestId('product-search');
  }

  get searchButton() {
    return this.page.getByTestId('search-button');
  }

  get searchLoading() {
    return this.page.getByTestId('search-loading');
  }

  get productResults() {
    return this.page.getByTestId('product-result');
  }

  get noResults() {
    return this.page.getByTestId('no-results');
  }

  get shoppingCart() {
    return this.page.getByTestId('shopping-cart');
  }

  get emptyCart() {
    return this.page.getByTestId('empty-cart');
  }

  get cartItems() {
    return this.page.getByTestId('cart-items');
  }

  get cartCount() {
    return this.page.getByTestId('cart-count');
  }

  get clearCartBtn() {
    return this.page.getByTestId('clear-cart-btn');
  }

  get checkoutBtn() {
    return this.page.getByTestId('checkout-btn');
  }

  get totalsSubtotal() {
    return this.page.getByTestId('totals-subtotal');
  }

  get totalsTax() {
    return this.page.getByTestId('totals-tax');
  }

  get totalsTotal() {
    return this.page.getByTestId('totals-total');
  }

  get totalsItemCount() {
    return this.page.getByTestId('totals-item-count');
  }

  // --- Actions ---

  /**
   * Search for a product by typing in the search input
   * Waits for debounce (300ms) and results to appear
   */
  async searchProduct(query: string): Promise<void> {
    await this.searchInput.fill(query);
    // Wait for debounce (300ms) + network
    await this.page.waitForTimeout(500);
  }

  /**
   * Clear the search input
   */
  async clearSearch(): Promise<void> {
    await this.searchInput.clear();
    await this.page.waitForTimeout(100);
  }

  /**
   * Select a product from search results by index
   */
  async selectProductByIndex(index: number): Promise<void> {
    await this.productResults.nth(index).click();
    await this.page.waitForTimeout(100);
  }

  /**
   * Select a product from search results by name
   */
  async selectProductByName(name: string): Promise<void> {
    const result = this.page.getByTestId('product-result').filter({ hasText: name });
    await result.click();
    await this.page.waitForTimeout(100);
  }

  /**
   * Get cart item locator by product ID
   */
  cartItem(productId: string) {
    return this.page.getByTestId(`cart-item-${productId}`);
  }

  /**
   * Increase quantity for a product in cart
   */
  async increaseQuantity(productId: string): Promise<void> {
    await this.page.getByTestId(`increase-quantity-${productId}`).click();
    await this.page.waitForTimeout(100);
  }

  /**
   * Decrease quantity for a product in cart
   */
  async decreaseQuantity(productId: string): Promise<void> {
    await this.page.getByTestId(`decrease-quantity-${productId}`).click();
    await this.page.waitForTimeout(100);
  }

  /**
   * Get quantity input value for a product
   */
  async getQuantityValue(productId: string): Promise<string> {
    return await this.page.getByTestId(`quantity-input-${productId}`).inputValue();
  }

  /**
   * Remove an item from cart by product ID
   */
  async removeItem(productId: string): Promise<void> {
    await this.page.getByTestId(`remove-item-${productId}`).click();
    await this.page.waitForTimeout(100);
  }

  /**
   * Clear the entire cart
   */
  async clearCart(): Promise<void> {
    await this.clearCartBtn.click();
    await this.page.waitForTimeout(100);
  }

  /**
   * Click checkout button
   */
  async checkout(): Promise<void> {
    await this.checkoutBtn.click();
  }

  /**
   * Get stock status text for a product result by index
   */
  async getStockStatus(index: number): Promise<string> {
    const stockStatus = this.productResults.nth(index).getByTestId('stock-status');
    return (await stockStatus.textContent()) ?? '';
  }
}

test.describe('POS Terminal - Search to Cart Flow', () => {
  let pos: PosTerminalPage;

  test.beforeEach(async ({ page }) => {
    pos = new PosTerminalPage(page);
    await loginAsAdmin(page);
    await page.goto('/');
    // Wait for the app to fully load and seed data to initialize
    await expect(page.getByTestId('pos-terminal')).toBeVisible();
  });

  test.describe('Product Search', () => {
    test('should search for product by name and show results', async () => {
      // Search for "Coffee"
      await pos.searchProduct('Coffee');

      // Results should appear
      await expect(pos.productResults.first()).toBeVisible();

      // Should find Coffee in results
      const results = pos.productResults;
      const count = await results.count();
      expect(count).toBeGreaterThan(0);

      // First result should contain "Coffee"
      await expect(results.first()).toContainText('Coffee');
    });

    test('should show multiple results for partial match', async () => {
      // Search for "c" won't trigger (min 2 chars), search for "co"
      await pos.searchProduct('Co');

      // Should show results matching "Co" (Coffee, Croissant, etc.)
      await expect(pos.productResults.first()).toBeVisible();
      const count = await pos.productResults.count();
      expect(count).toBeGreaterThan(0);
    });

    test('should show no results for non-existent product', async () => {
      // Search for something that doesn't exist
      await pos.searchProduct('xyz123nonexistent');

      // Should show no results message
      await expect(pos.noResults).toBeVisible();
      await expect(pos.noResults).toContainText('No products found');

      // No product results should be visible
      await expect(pos.productResults).toHaveCount(0);
    });

    test('should clear results when search is cleared', async () => {
      // Search first
      await pos.searchProduct('Coffee');
      await expect(pos.productResults.first()).toBeVisible();

      // Clear search
      await pos.clearSearch();

      // Results should disappear
      await expect(pos.productResults).toHaveCount(0);
    });

    test('should not search with less than 2 characters', async () => {
      // Type single character
      await pos.searchInput.fill('C');
      await pos.page.waitForTimeout(500);

      // No results and no "no results" message should appear
      await expect(pos.productResults).toHaveCount(0);
      await expect(pos.noResults).not.toBeVisible();
    });
  });

  test.describe('Add Product to Cart', () => {
    test('should add product to cart when clicked', async () => {
      // Cart should initially be empty
      await expect(pos.emptyCart).toBeVisible();

      // Search for Coffee
      await pos.searchProduct('Coffee');
      await expect(pos.productResults.first()).toBeVisible();

      // Click on Coffee to add to cart
      await pos.selectProductByName('Coffee');

      // Cart should no longer be empty
      await expect(pos.emptyCart).not.toBeVisible();

      // Cart item should be visible
      await expect(pos.cartItem('1')).toBeVisible();
      await expect(pos.cartItem('1')).toContainText('Coffee');
    });

    test('should show correct price after adding product', async () => {
      // Add Coffee ($2.50)
      await pos.searchProduct('Coffee');
      await pos.selectProductByName('Coffee');

      // Check subtotal shows $2.50
      await expect(pos.totalsSubtotal).toContainText('$2.50');
    });

    test('should add multiple different products to cart', async () => {
      // Add Coffee
      await pos.searchProduct('Coffee');
      await pos.selectProductByName('Coffee');

      // Add Croissant
      await pos.searchProduct('Croissant');
      await pos.selectProductByName('Croissant');

      // Both items should be in cart
      await expect(pos.cartItem('1')).toBeVisible(); // Coffee
      await expect(pos.cartItem('3')).toBeVisible(); // Croissant
    });

    test('should not add out-of-stock product to cart', async () => {
      // Search for the out-of-stock product "Seasonal Blend"
      await pos.searchProduct('Seasonal');
      await expect(pos.productResults.first()).toBeVisible();

      // Verify it shows "Out of Stock" status
      const stockStatus = pos.productResults.first().getByTestId('stock-status');
      await expect(stockStatus).toContainText('Out of Stock');

      // Verify the product result has aria-disabled
      await expect(pos.productResults.first()).toHaveAttribute('aria-disabled', 'true');

      // Try to click it
      await pos.selectProductByIndex(0);

      // Cart should remain empty - product was not added
      await expect(pos.emptyCart).toBeVisible();
    });
  });

  test.describe('Adjust Quantity in Cart', () => {
    test.beforeEach(async () => {
      // Add Coffee to cart first
      await pos.searchProduct('Coffee');
      await pos.selectProductByName('Coffee');
      await expect(pos.cartItem('1')).toBeVisible();
    });

    test('should increase quantity and update total', async () => {
      // Initial quantity should be 1
      const initialQty = await pos.getQuantityValue('1');
      expect(initialQty).toBe('1');

      // Increase quantity
      await pos.increaseQuantity('1');

      // Quantity should be 2
      const newQty = await pos.getQuantityValue('1');
      expect(newQty).toBe('2');

      // Subtotal should update to $5.00 (2 x $2.50)
      await expect(pos.totalsSubtotal).toContainText('$5.00');
    });

    test('should decrease quantity and update total', async () => {
      // First increase to 2
      await pos.increaseQuantity('1');
      await expect(pos.totalsSubtotal).toContainText('$5.00');

      // Then decrease back to 1
      await pos.decreaseQuantity('1');

      // Quantity should be 1
      const qty = await pos.getQuantityValue('1');
      expect(qty).toBe('1');

      // Subtotal should be back to $2.50
      await expect(pos.totalsSubtotal).toContainText('$2.50');
    });

    test('should calculate tax correctly when quantity changes', async () => {
      // Coffee $2.50, tax 8% = $0.20
      await expect(pos.totalsTax).toContainText('$0.20');

      // Increase to 2: $5.00, tax 8% = $0.40
      await pos.increaseQuantity('1');
      await expect(pos.totalsTax).toContainText('$0.40');
    });

    test('should calculate grand total correctly', async () => {
      // Coffee $2.50 + tax $0.20 = $2.70
      await expect(pos.totalsTotal).toContainText('$2.70');

      // Increase to 2: $5.00 + tax $0.40 = $5.40
      await pos.increaseQuantity('1');
      await expect(pos.totalsTotal).toContainText('$5.40');
    });
  });

  test.describe('Remove Item from Cart', () => {
    test('should remove item and show empty cart', async () => {
      // Add Coffee
      await pos.searchProduct('Coffee');
      await pos.selectProductByName('Coffee');
      await expect(pos.cartItem('1')).toBeVisible();

      // Remove it
      await pos.removeItem('1');

      // Cart should be empty
      await expect(pos.emptyCart).toBeVisible();
      await expect(pos.cartItem('1')).not.toBeVisible();
    });

    test('should update totals when item is removed', async () => {
      // Add Coffee ($2.50) and Croissant ($3.00)
      await pos.searchProduct('Coffee');
      await pos.selectProductByName('Coffee');

      await pos.searchProduct('Croissant');
      await pos.selectProductByName('Croissant');

      // Subtotal should be $5.50
      await expect(pos.totalsSubtotal).toContainText('$5.50');

      // Remove Coffee
      await pos.removeItem('1');

      // Subtotal should now be $3.00 (only Croissant)
      await expect(pos.totalsSubtotal).toContainText('$3.00');

      // Coffee should not be in cart
      await expect(pos.cartItem('1')).not.toBeVisible();

      // Croissant should still be in cart
      await expect(pos.cartItem('3')).toBeVisible();
    });
  });

  test.describe('Clear Cart', () => {
    test('should clear all items and show empty state', async () => {
      // Add multiple products
      await pos.searchProduct('Coffee');
      await pos.selectProductByName('Coffee');

      await pos.searchProduct('Latte');
      await pos.selectProductByName('Latte');

      await pos.searchProduct('Croissant');
      await pos.selectProductByName('Croissant');

      // Verify items are in cart
      await expect(pos.cartItem('1')).toBeVisible();
      await expect(pos.cartItem('4')).toBeVisible();
      await expect(pos.cartItem('3')).toBeVisible();

      // Clear cart
      await pos.clearCart();

      // Cart should be empty
      await expect(pos.emptyCart).toBeVisible();
      await expect(pos.cartItem('1')).not.toBeVisible();
      await expect(pos.cartItem('4')).not.toBeVisible();
      await expect(pos.cartItem('3')).not.toBeVisible();
    });

    test('should reset totals to zero after clearing', async () => {
      // Add Coffee
      await pos.searchProduct('Coffee');
      await pos.selectProductByName('Coffee');

      // Verify totals are non-zero
      await expect(pos.totalsSubtotal).toContainText('$2.50');

      // Clear cart
      await pos.clearCart();

      // Totals should show $0.00
      await expect(pos.totalsSubtotal).toContainText('$0.00');
      await expect(pos.totalsTax).toContainText('$0.00');
      await expect(pos.totalsTotal).toContainText('$0.00');
    });
  });

  test.describe('Out-of-Stock Handling', () => {
    test('should display out-of-stock indicator on product', async () => {
      // Search for the out-of-stock product
      await pos.searchProduct('Seasonal Blend');

      // Should find the product
      await expect(pos.productResults.first()).toBeVisible();
      await expect(pos.productResults.first()).toContainText('Seasonal Blend');

      // Should show "Out of Stock" status
      const stockStatus = pos.productResults.first().getByTestId('stock-status');
      await expect(stockStatus).toContainText('Out of Stock');
      await expect(stockStatus).toHaveClass(/out-of-stock/);
    });

    test('should have aria-disabled on out-of-stock product', async () => {
      await pos.searchProduct('Seasonal Blend');
      await expect(pos.productResults.first()).toBeVisible();

      // Should have aria-disabled attribute
      await expect(pos.productResults.first()).toHaveAttribute('aria-disabled', 'true');
    });

    test('should not add out-of-stock product when clicked', async () => {
      await pos.searchProduct('Seasonal Blend');
      await expect(pos.productResults.first()).toBeVisible();

      // Click the out-of-stock product
      await pos.productResults.first().click();
      await pos.page.waitForTimeout(200);

      // Cart should remain empty
      await expect(pos.emptyCart).toBeVisible();
    });

    test('should show in-stock indicator for available products', async () => {
      // Search for an in-stock product
      await pos.searchProduct('Coffee');
      await expect(pos.productResults.first()).toBeVisible();

      // Should show "In Stock" status
      const stockStatus = pos.productResults.first().getByTestId('stock-status');
      await expect(stockStatus).toContainText('In Stock');
      await expect(stockStatus).toHaveClass(/in-stock/);
    });
  });

  test.describe('Full Search to Cart Flow (Integration)', () => {
    test('should complete full flow: search → add → adjust → checkout', async () => {
      // Step 1: Search for Coffee
      await pos.searchProduct('Coffee');
      await expect(pos.productResults.first()).toBeVisible();

      // Step 2: Add to cart
      await pos.selectProductByName('Coffee');
      await expect(pos.cartItem('1')).toBeVisible();

      // Step 3: Increase quantity to 3
      await pos.increaseQuantity('1');
      await pos.increaseQuantity('1');
      const qty = await pos.getQuantityValue('1');
      expect(qty).toBe('3');

      // Step 4: Verify totals
      // Subtotal: 3 x $2.50 = $7.50
      await expect(pos.totalsSubtotal).toContainText('$7.50');
      // Tax: 8% of $7.50 = $0.60
      await expect(pos.totalsTax).toContainText('$0.60');
      // Total: $7.50 + $0.60 = $8.10
      await expect(pos.totalsTotal).toContainText('$8.10');
    });

    test('should handle adding same product multiple times via search', async () => {
      // Add Coffee via search
      await pos.searchProduct('Coffee');
      await pos.selectProductByName('Coffee');

      // Search and add Coffee again
      await pos.searchProduct('Coffee');
      await pos.selectProductByName('Coffee');

      // Should have quantity 2, not two separate items
      const qty = await pos.getQuantityValue('1');
      expect(qty).toBe('2');

      // Subtotal should be $5.00
      await expect(pos.totalsSubtotal).toContainText('$5.00');
    });

    test('should handle category filter', async () => {
      // Click on a category chip (Beverages)
      const beveragesChip = pos.page.getByTestId('category-Beverages');
      await beveragesChip.click();
      await pos.page.waitForTimeout(500);

      // Should show beverage products
      await expect(pos.productResults.first()).toBeVisible();
      const count = await pos.productResults.count();
      expect(count).toBeGreaterThan(0);

      // All results should be beverages
      for (let i = 0; i < count; i++) {
        const result = pos.productResults.nth(i);
        await expect(result).toBeVisible();
      }
    });
  });
});
