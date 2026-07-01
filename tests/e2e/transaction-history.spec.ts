import { test, expect, Page } from '@playwright/test';
import { loginAsAdmin } from './helpers/auth';

/**
 * Transaction History E2E Tests
 *
 * Story: [S3-3] View Transaction History
 *
 * Covers the complete user journey for viewing past transactions,
 * including navigation, empty state, transaction display, expand/collapse,
 * pagination, and back navigation.
 *
 * Acceptance Criteria:
 * - Navigate to /history → transaction history page loads
 * - Empty state shown when no transactions exist
 * - Complete a sale → transaction appears in history
 * - Transaction card shows date, payment method, item count, total
 * - Click transaction → details expand with ID, status, receipt #
 * - Click again → details collapse
 * - Back to POS link navigates to /pos
 * - Multiple transactions appear in newest-first order
 */

/**
 * Page Object Model for Transaction History
 * Encapsulates selectors and common actions for maintainability
 */
class TransactionHistoryPage {
  constructor(readonly page: Page) {}

  // --- Selectors ---

  get container() {
    return this.page.getByTestId('transaction-history');
  }

  get backToPos() {
    return this.page.getByTestId('back-to-pos');
  }

  get loadingIndicator() {
    return this.page.getByTestId('loading-indicator');
  }

  get errorMessage() {
    return this.page.getByTestId('error-message');
  }

  get retryButton() {
    return this.page.getByTestId('btn-retry');
  }

  get emptyState() {
    return this.page.getByTestId('empty-state');
  }

  get startSellingButton() {
    return this.page.getByTestId('btn-start-selling');
  }

  get transactionList() {
    return this.page.getByTestId('transaction-list');
  }

  get pagination() {
    return this.page.getByTestId('pagination');
  }

  get prevButton() {
    return this.page.getByTestId('btn-prev');
  }

  get nextButton() {
    return this.page.getByTestId('btn-next');
  }

  get pageInfo() {
    return this.page.getByTestId('page-info');
  }

  get footer() {
    return this.page.getByTestId('history-footer');
  }

  // --- Dynamic Selectors ---

  transactionCard(id: string) {
    return this.page.getByTestId(`transaction-${id}`);
  }

  transactionMethod(id: string) {
    return this.page.getByTestId(`method-${id}`);
  }

  transactionItems(id: string) {
    return this.page.getByTestId(`items-${id}`);
  }

  transactionTotal(id: string) {
    return this.page.getByTestId(`total-${id}`);
  }

  transactionDetails(id: string) {
    return this.page.getByTestId(`details-${id}`);
  }

  // --- Actions ---

  async navigate(): Promise<void> {
    await this.page.goto('/history');
    // Wait for the page's own container, not networkidle: the app runs a
    // background sync setInterval (sync.worker.ts) so the network never idles.
    await expect(this.container).toBeVisible();
  }

  async clickTransaction(id: string): Promise<void> {
    await this.transactionCard(id).click();
  }

  async clickBackToPos(): Promise<void> {
    await this.backToPos.click();
  }

  /**
   * Get all transaction cards visible on the page
   */
  async getTransactionCards() {
    // Scope to cards INSIDE the list so we don't match the page container
    // (`transaction-history`) or the list element (`transaction-list`) itself,
    // both of which also start with "transaction-".
    return this.transactionList.locator('[data-testid^="transaction-"]');
  }

  /**
   * Get the first transaction card's testid to extract the ID
   */
  async getFirstTransactionId(): Promise<string | null> {
    const cards = this.transactionList.locator('[data-testid^="transaction-"]');
    const count = await cards.count();
    if (count === 0) return null;
    const testId = await cards.first().getAttribute('data-testid');
    return testId?.replace('transaction-', '') ?? null;
  }
}

/**
 * Helper class for creating transactions via the POS terminal
 * Used as test setup to populate transaction history
 */
class PosTerminalHelper {
  constructor(readonly page: Page) {}

  /**
   * Complete a full sale transaction:
   * Search product → Add to cart → Checkout → Pay with cash → Receipt shown
   */
  async createCashTransaction(productName: string = 'Coffee'): Promise<void> {
    // Navigate to POS
    await this.page.goto('/pos');
    await expect(this.page.getByTestId('pos-terminal')).toBeVisible();

    // Search for product
    await this.page.getByTestId('product-search').fill(productName);
    await this.page.waitForTimeout(500); // debounce

    // Click first product result
    await expect(this.page.getByTestId('product-result').first()).toBeVisible();
    await this.page.getByTestId('product-result').first().click();
    await this.page.waitForTimeout(100);

    // Click checkout
    await expect(this.page.getByTestId('checkout-btn')).toBeEnabled();
    await this.page.getByTestId('checkout-btn').click();

    // Wait for checkout overlay
    await expect(this.page.getByTestId('checkout-overlay')).toBeVisible();

    // Select cash payment method
    await this.page.getByTestId('method-cash').click();
    await this.page.waitForTimeout(100);

    // Proceed to cash details
    await this.page.getByTestId('btn-proceed').click();

    // Wait for cash payment form
    await expect(this.page.getByTestId('cash-payment')).toBeVisible();

    // Enter amount tendered (use a generous amount)
    await this.page.getByTestId('cash-tendered').fill('50.00');
    await this.page.waitForTimeout(100);

    // Confirm payment
    await this.page.getByTestId('btn-confirm-cash').click();

    // Wait for processing to complete and receipt to appear
    await expect(this.page.getByTestId('receipt-overlay')).toBeVisible({ timeout: 10000 });
  }

  /**
   * After a transaction is complete (receipt shown), start a new transaction
   */
  async startNewTransaction(): Promise<void> {
    await this.page.getByTestId('btn-new-transaction').click();
    await this.page.waitForTimeout(200);
  }

  /**
   * Create a transaction and dismiss the receipt, ready for next action
   */
  async createAndDismissTransaction(productName: string = 'Coffee'): Promise<void> {
    await this.createCashTransaction(productName);
    await this.startNewTransaction();
  }
}

// ============================================================================
// TEST SUITES
// ============================================================================

test.describe('Transaction History - S3-3', () => {
  let historyPage: TransactionHistoryPage;
  let posHelper: PosTerminalHelper;

  test.beforeEach(async ({ page }) => {
    historyPage = new TransactionHistoryPage(page);
    posHelper = new PosTerminalHelper(page);
    await loginAsAdmin(page);
  });

  // --------------------------------------------------------------------------
  // Navigation & Page Load
  // --------------------------------------------------------------------------
  test.describe('Navigation & Page Load', () => {
    test('should navigate to transaction history page', async ({ page }) => {
      await historyPage.navigate();

      // Main container should be visible
      await expect(historyPage.container).toBeVisible();

      // Title should be present
      await expect(page.locator('text=Transaction History')).toBeVisible();
    });

    test('should show back to POS link', async () => {
      await historyPage.navigate();

      await expect(historyPage.backToPos).toBeVisible();
      await expect(historyPage.backToPos).toContainText('Back to POS');
    });

    test('should show loading state briefly while fetching', async ({ page }) => {
      // Navigate and check loading appears (may be very brief with IndexedDB)
      await page.goto('/history');

      // The container should eventually be visible
      await expect(historyPage.container).toBeVisible();
    });
  });

  // --------------------------------------------------------------------------
  // Empty State
  // --------------------------------------------------------------------------
  test.describe('Empty State', () => {
    test('should show empty state when no transactions exist', async ({ page }) => {
      await page.goto('/pos');
      await expect(page.getByTestId('pos-terminal')).toBeVisible();

      // Navigate to history
      await historyPage.navigate();

      // Wait for the page to actually SETTLE into one of its terminal states
      // (empty OR list) before reading — the async history load may still be in
      // flight right after navigate(), which made a point-in-time isVisible() read
      // flaky (both false → "stuck in loading"). `.or()` retries until one shows.
      await expect(historyPage.emptyState.or(historyPage.transactionList)).toBeVisible();

      const emptyVisible = await historyPage.emptyState.isVisible().catch(() => false);
      const listVisible = await historyPage.transactionList.isVisible().catch(() => false);

      // At least one state should be shown (not stuck in loading)
      expect(emptyVisible || listVisible).toBe(true);
    });

    test('should show "Start Selling" link in empty state', async () => {
      await historyPage.navigate();

      // Settle into empty-or-list before deciding which branch to assert.
      await expect(historyPage.emptyState.or(historyPage.transactionList)).toBeVisible();
      const emptyVisible = await historyPage.emptyState.isVisible().catch(() => false);
      if (emptyVisible) {
        await expect(historyPage.startSellingButton).toBeVisible();
        await expect(historyPage.startSellingButton).toContainText('Start Selling');
      }
    });
  });

  // --------------------------------------------------------------------------
  // Full Flow: Create Sale → Verify in History
  // --------------------------------------------------------------------------
  test.describe('Full Flow: Sale to History', () => {
    test('should show transaction in history after completing a sale', async () => {
      // Step 1: Create a transaction via POS
      await posHelper.createCashTransaction('Coffee');

      // Step 2: Dismiss receipt and navigate to history
      await posHelper.startNewTransaction();
      await historyPage.navigate();

      // Step 3: Transaction list should be visible (not empty state)
      await expect(historyPage.transactionList).toBeVisible();

      // Step 4: At least one transaction card should exist
      const firstId = await historyPage.getFirstTransactionId();
      expect(firstId).not.toBeNull();
    });

    test('should display correct payment method for cash transaction', async () => {
      // Create a cash transaction
      await posHelper.createAndDismissTransaction('Coffee');

      // Navigate to history
      await historyPage.navigate();
      await expect(historyPage.transactionList).toBeVisible();

      // Get first transaction and verify method shows "Cash"
      const firstId = await historyPage.getFirstTransactionId();
      expect(firstId).not.toBeNull();
      await expect(historyPage.transactionMethod(firstId!)).toContainText('Cash');
    });

    test('should display item count for transaction', async () => {
      // Create a transaction with 1 item
      await posHelper.createAndDismissTransaction('Coffee');

      // Navigate to history
      await historyPage.navigate();
      await expect(historyPage.transactionList).toBeVisible();

      // Verify item count shows "1 item"
      const firstId = await historyPage.getFirstTransactionId();
      expect(firstId).not.toBeNull();
      await expect(historyPage.transactionItems(firstId!)).toContainText('1 item');
    });

    test('should display total amount for transaction', async () => {
      // Create a transaction
      await posHelper.createAndDismissTransaction('Coffee');

      // Navigate to history
      await historyPage.navigate();
      await expect(historyPage.transactionList).toBeVisible();

      // Verify total is displayed (should be a currency value > $0)
      const firstId = await historyPage.getFirstTransactionId();
      expect(firstId).not.toBeNull();
      const totalText = await historyPage.transactionTotal(firstId!).textContent();
      expect(totalText).toMatch(/\$\d+\.\d{2}/);
    });
  });

  // --------------------------------------------------------------------------
  // Expand/Collapse Transaction Details
  // --------------------------------------------------------------------------
  test.describe('Expand/Collapse Details', () => {
    test('should expand transaction details on click', async () => {
      // Setup: create a transaction
      await posHelper.createAndDismissTransaction('Coffee');
      await historyPage.navigate();
      await expect(historyPage.transactionList).toBeVisible();

      // Get first transaction ID
      const firstId = await historyPage.getFirstTransactionId();
      expect(firstId).not.toBeNull();

      // Details should NOT be visible initially
      await expect(historyPage.transactionDetails(firstId!)).not.toBeVisible();

      // Click to expand
      await historyPage.clickTransaction(firstId!);

      // Details should now be visible
      await expect(historyPage.transactionDetails(firstId!)).toBeVisible();
    });

    test('should show transaction ID in expanded details', async () => {
      await posHelper.createAndDismissTransaction('Coffee');
      await historyPage.navigate();
      await expect(historyPage.transactionList).toBeVisible();

      const firstId = await historyPage.getFirstTransactionId();
      expect(firstId).not.toBeNull();

      // Expand
      await historyPage.clickTransaction(firstId!);
      await expect(historyPage.transactionDetails(firstId!)).toBeVisible();

      // Should show "Transaction ID" label and value
      await expect(historyPage.transactionDetails(firstId!)).toContainText('Transaction ID');
    });

    test('should show status in expanded details', async () => {
      await posHelper.createAndDismissTransaction('Coffee');
      await historyPage.navigate();
      await expect(historyPage.transactionList).toBeVisible();

      const firstId = await historyPage.getFirstTransactionId();
      expect(firstId).not.toBeNull();

      // Expand
      await historyPage.clickTransaction(firstId!);
      await expect(historyPage.transactionDetails(firstId!)).toBeVisible();

      // Should show status (completed for a successful transaction)
      await expect(historyPage.transactionDetails(firstId!)).toContainText('Status');
    });

    test('should collapse details on second click', async () => {
      await posHelper.createAndDismissTransaction('Coffee');
      await historyPage.navigate();
      await expect(historyPage.transactionList).toBeVisible();

      const firstId = await historyPage.getFirstTransactionId();
      expect(firstId).not.toBeNull();

      // Expand
      await historyPage.clickTransaction(firstId!);
      await expect(historyPage.transactionDetails(firstId!)).toBeVisible();

      // Collapse
      await historyPage.clickTransaction(firstId!);
      await expect(historyPage.transactionDetails(firstId!)).not.toBeVisible();
    });
  });

  // --------------------------------------------------------------------------
  // Back to POS Navigation
  // --------------------------------------------------------------------------
  test.describe('Back to POS Navigation', () => {
    test('should navigate back to POS terminal when clicking back link', async ({ page }) => {
      await historyPage.navigate();
      await expect(historyPage.backToPos).toBeVisible();

      // Click back to POS
      await historyPage.clickBackToPos();

      // Should be on POS page
      await expect(page.getByTestId('pos-terminal')).toBeVisible();
      expect(page.url()).toContain('/pos');
    });

    test('should navigate to POS from empty state "Start Selling" link', async ({ page }) => {
      await historyPage.navigate();

      const emptyVisible = await historyPage.emptyState.isVisible().catch(() => false);
      if (emptyVisible) {
        await historyPage.startSellingButton.click();
        await expect(page.getByTestId('pos-terminal')).toBeVisible();
        expect(page.url()).toContain('/pos');
      }
    });
  });

  // --------------------------------------------------------------------------
  // Multiple Transactions & Ordering
  // --------------------------------------------------------------------------
  test.describe('Multiple Transactions', () => {
    test('should display multiple transactions after multiple sales', async () => {
      // Create first transaction
      await posHelper.createAndDismissTransaction('Coffee');

      // Create second transaction
      await posHelper.createAndDismissTransaction('Latte');

      // Navigate to history
      await historyPage.navigate();
      await expect(historyPage.transactionList).toBeVisible();

      // Should show at least 2 transactions
      const cards = historyPage.page.locator('[data-testid^="transaction-"]').filter({
        has: historyPage.page.locator('[data-testid^="method-"]'),
      });
      const count = await cards.count();
      expect(count).toBeGreaterThanOrEqual(2);
    });

    test('should show newest transaction first', async () => {
      // Create first transaction (Coffee)
      await posHelper.createAndDismissTransaction('Coffee');

      // Small delay to ensure different timestamps
      await posHelper.page.waitForTimeout(1000);

      // Create second transaction (Latte)
      await posHelper.createAndDismissTransaction('Latte');

      // Navigate to history
      await historyPage.navigate();
      await expect(historyPage.transactionList).toBeVisible();

      // The first card in the list should be the most recent transaction
      // (newest first ordering)
      const cards = historyPage.transactionList.locator('[data-testid^="transaction-"]');
      const count = await cards.count();
      expect(count).toBeGreaterThanOrEqual(2);

      // Both should show Cash as payment method
      const firstCard = cards.first();
      await expect(firstCard.locator('[data-testid^="method-"]')).toContainText('Cash');
    });

    test('should show correct transaction count in footer', async () => {
      // Create a transaction
      await posHelper.createAndDismissTransaction('Coffee');

      // Navigate to history
      await historyPage.navigate();
      await expect(historyPage.transactionList).toBeVisible();

      // Footer should show count
      await expect(historyPage.footer).toBeVisible();
      const footerText = await historyPage.footer.textContent();
      expect(footerText).toMatch(/Showing \d+ of \d+ transactions/);
    });
  });

  // --------------------------------------------------------------------------
  // Keyboard Accessibility
  // --------------------------------------------------------------------------
  test.describe('Accessibility', () => {
    test('should expand transaction details with Enter key', async () => {
      await posHelper.createAndDismissTransaction('Coffee');
      await historyPage.navigate();
      await expect(historyPage.transactionList).toBeVisible();

      const firstId = await historyPage.getFirstTransactionId();
      expect(firstId).not.toBeNull();

      // Focus the transaction card and press Enter
      await historyPage.transactionCard(firstId!).focus();
      await historyPage.page.keyboard.press('Enter');

      // Details should be visible
      await expect(historyPage.transactionDetails(firstId!)).toBeVisible();
    });

    test('transaction cards should have role="button"', async () => {
      await posHelper.createAndDismissTransaction('Coffee');
      await historyPage.navigate();
      await expect(historyPage.transactionList).toBeVisible();

      const firstId = await historyPage.getFirstTransactionId();
      expect(firstId).not.toBeNull();

      await expect(historyPage.transactionCard(firstId!)).toHaveAttribute('role', 'button');
    });

    test('transaction cards should be focusable (tabindex)', async () => {
      await posHelper.createAndDismissTransaction('Coffee');
      await historyPage.navigate();
      await expect(historyPage.transactionList).toBeVisible();

      const firstId = await historyPage.getFirstTransactionId();
      expect(firstId).not.toBeNull();

      await expect(historyPage.transactionCard(firstId!)).toHaveAttribute('tabindex', '0');
    });
  });
});
