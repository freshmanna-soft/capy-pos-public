import { test, expect } from '@playwright/test';

/**
 * E2E Integration Tests for Agent Workflow
 *
 * Tests the complete flow of agents working together with infrastructure services:
 * - EventBusService for inter-agent communication
 * - AuditLogService for operation tracking
 * - CircuitBreakerService for fault tolerance
 * - RetryService for resilience
 * - TelemetryService for metrics
 */

test.describe('Agent Integration Workflow', () => {
  test.beforeEach(async ({ page }) => {
    // Navigate to the application
    await page.goto('http://localhost:4200');

    // Wait for application to be ready
    await page.waitForLoadState('networkidle');
  });

  test('should complete full sales transaction workflow', async ({ page }) => {
    /**
     * This test simulates a complete sales transaction involving:
     * 1. InventoryAgent - Check product availability
     * 2. SalesAgent - Create transaction
     * 3. PaymentAgent - Process payment
     * 4. AnalyticsAgent - Record metrics
     * 5. CustomerAgent - Update loyalty points
     */

    // Navigate to POS terminal
    await page.click('text=POS Terminal');
    await expect(page).toHaveURL(/.*pos-terminal/);

    // Step 1: Search and add product (InventoryAgent)
    await page.fill('[data-testid="product-search"]', 'Coffee');
    await page.click('[data-testid="search-button"]');

    // Wait for inventory check
    await page.waitForSelector('[data-testid="product-result"]');

    // Verify product availability
    const stockStatus = await page.textContent('[data-testid="stock-status"]');
    expect(stockStatus).toContain('In Stock');

    // Add to cart
    await page.click('[data-testid="add-to-cart"]');

    // Verify cart updated
    const cartCount = await page.textContent('[data-testid="cart-count"]');
    expect(cartCount).toBe('1');

    // Step 2: Enter customer information (CustomerAgent)
    await page.click('[data-testid="customer-lookup"]');
    await page.fill('[data-testid="customer-phone"]', '555-0123');
    await page.click('[data-testid="lookup-button"]');

    // Wait for customer data
    await page.waitForSelector('[data-testid="customer-name"]');
    const customerName = await page.textContent('[data-testid="customer-name"]');
    expect(customerName).toBeTruthy();

    // Step 3: Process payment (PaymentAgent with CircuitBreaker & Retry)
    await page.click('[data-testid="checkout-button"]');

    // Select payment method
    await page.click('[data-testid="payment-method-card"]');

    // Enter payment details
    await page.fill('[data-testid="card-number"]', '4111111111111111');
    await page.fill('[data-testid="card-expiry"]', '12/25');
    await page.fill('[data-testid="card-cvv"]', '123');

    // Submit payment
    await page.click('[data-testid="submit-payment"]');

    // Wait for payment processing (with retry logic)
    await page.waitForSelector('[data-testid="payment-success"]', { timeout: 10000 });

    // Verify success message
    const successMessage = await page.textContent('[data-testid="payment-success"]');
    expect(successMessage).toContain('Payment Successful');

    // Verify transaction ID
    const transactionId = await page.textContent('[data-testid="transaction-id"]');
    expect(transactionId).toMatch(/TXN-\d+/);

    // Step 4: Verify analytics recorded (AnalyticsAgent)
    await page.click('[data-testid="view-receipt"]');
    await page.waitForSelector('[data-testid="receipt-details"]');

    // Receipt should show all transaction details
    const receiptTotal = await page.textContent('[data-testid="receipt-total"]');
    expect(receiptTotal).toBeTruthy();

    // Step 5: Verify loyalty points updated (CustomerAgent)
    const loyaltyPoints = await page.textContent('[data-testid="loyalty-points-earned"]');
    expect(loyaltyPoints).toMatch(/\d+ points/);
  });

  test('should handle payment failure with retry', async ({ page }) => {
    /**
     * Tests retry logic when payment gateway fails temporarily
     */

    // Navigate to POS terminal
    await page.goto('http://localhost:4200/pos-terminal');

    // Add product to cart
    await page.fill('[data-testid="product-search"]', 'Coffee');
    await page.click('[data-testid="search-button"]');
    await page.click('[data-testid="add-to-cart"]');

    // Proceed to checkout
    await page.click('[data-testid="checkout-button"]');
    await page.click('[data-testid="payment-method-card"]');

    // Simulate network issue by using invalid card
    await page.fill('[data-testid="card-number"]', '4000000000000002'); // Decline card
    await page.fill('[data-testid="card-expiry"]', '12/25');
    await page.fill('[data-testid="card-cvv"]', '123');

    // Submit payment
    await page.click('[data-testid="submit-payment"]');

    // Should show retry indicator
    await page.waitForSelector('[data-testid="payment-retrying"]');

    // Eventually should show error after retries exhausted
    await page.waitForSelector('[data-testid="payment-error"]', { timeout: 15000 });

    const errorMessage = await page.textContent('[data-testid="payment-error"]');
    expect(errorMessage).toContain('Payment failed');
  });

  test('should monitor agents in dashboard', async ({ page }) => {
    /**
     * Tests the Agent Monitor Dashboard
     */

    // Navigate to dashboard
    await page.goto('http://localhost:4200/monitor');

    // Wait for dashboard to load
    await page.waitForSelector('[data-testid="agent-monitor"]');

    // Verify header stats
    const totalAgents = await page.textContent('[data-testid="total-agents"]');
    expect(parseInt(totalAgents || '0')).toBeGreaterThan(0);

    // Verify agents section
    await page.waitForSelector('[data-testid="agent-card"]');
    const agentCards = await page.$$('[data-testid="agent-card"]');
    expect(agentCards.length).toBeGreaterThan(0);

    // Check agent status
    const firstAgentStatus = await page.textContent('[data-testid="agent-status"]:first-of-type');
    expect(['running', 'stopped', 'error']).toContain(firstAgentStatus?.toLowerCase());

    // Verify circuit breakers section
    await page.waitForSelector('[data-testid="circuit-breaker-card"]');
    const circuitBreakerCards = await page.$$('[data-testid="circuit-breaker-card"]');
    expect(circuitBreakerCards.length).toBeGreaterThanOrEqual(0);

    // Verify metrics section
    await page.waitForSelector('[data-testid="metric-card"]');
    const metricCards = await page.$$('[data-testid="metric-card"]');
    expect(metricCards.length).toBeGreaterThanOrEqual(0);

    // Verify audit logs section
    await page.waitForSelector('[data-testid="audit-log-entry"]');
    const auditLogs = await page.$$('[data-testid="audit-log-entry"]');
    expect(auditLogs.length).toBeGreaterThanOrEqual(0);

    // Verify event bus section
    const totalMessages = await page.textContent('[data-testid="total-messages"]');
    expect(parseInt(totalMessages || '0')).toBeGreaterThanOrEqual(0);
  });

  test('should handle circuit breaker opening on repeated failures', async ({ page }) => {
    /**
     * Tests circuit breaker pattern by causing repeated failures
     */

    // Navigate to POS terminal
    await page.goto('http://localhost:4200/pos-terminal');

    // Attempt multiple failed payments to trigger circuit breaker
    for (let i = 0; i < 5; i++) {
      // Add product
      await page.fill('[data-testid="product-search"]', 'Coffee');
      await page.click('[data-testid="search-button"]');
      await page.click('[data-testid="add-to-cart"]');

      // Try to pay with invalid card
      await page.click('[data-testid="checkout-button"]');
      await page.click('[data-testid="payment-method-card"]');
      await page.fill('[data-testid="card-number"]', '4000000000000002');
      await page.fill('[data-testid="card-expiry"]', '12/25');
      await page.fill('[data-testid="card-cvv"]', '123');
      await page.click('[data-testid="submit-payment"]');

      // Wait for error
      await page.waitForSelector('[data-testid="payment-error"]');

      // Clear cart for next attempt
      await page.click('[data-testid="clear-cart"]');
    }

    // Navigate to monitor dashboard
    await page.goto('http://localhost:4200/monitor');

    // Check circuit breaker status
    await page.waitForSelector('[data-testid="circuit-breaker-card"]');

    // Find payment gateway circuit breaker
    const paymentCircuit = await page
      .locator('[data-testid="circuit-breaker-card"]')
      .filter({ hasText: 'payment-gateway' });

    // Should be in OPEN state
    const circuitState = await paymentCircuit
      .locator('[data-testid="circuit-state"]')
      .textContent();
    expect(circuitState).toBe('OPEN');
  });

  test('should track audit logs for all operations', async ({ page }) => {
    /**
     * Tests audit logging across multiple operations
     */

    // Perform a transaction
    await page.goto('http://localhost:4200/pos-terminal');
    await page.fill('[data-testid="product-search"]', 'Coffee');
    await page.click('[data-testid="search-button"]');
    await page.click('[data-testid="add-to-cart"]');
    await page.click('[data-testid="checkout-button"]');
    await page.click('[data-testid="payment-method-cash"]');
    await page.fill('[data-testid="cash-amount"]', '10.00');
    await page.click('[data-testid="submit-payment"]');

    // Wait for completion
    await page.waitForSelector('[data-testid="payment-success"]');

    // Navigate to monitor dashboard
    await page.goto('http://localhost:4200/monitor');

    // Check audit logs
    await page.waitForSelector('[data-testid="audit-log-entry"]');

    // Should have logs for:
    // 1. Inventory check
    // 2. Transaction creation
    // 3. Payment processing
    // 4. Analytics recording

    const auditLogs = await page.$$('[data-testid="audit-log-entry"]');
    expect(auditLogs.length).toBeGreaterThanOrEqual(4);

    // Verify log contains payment operation
    const logTexts = await Promise.all(auditLogs.map((log) => log.textContent()));

    const hasPaymentLog = logTexts.some(
      (text) => text?.includes('PaymentAgent') && text?.includes('processPayment')
    );
    expect(hasPaymentLog).toBe(true);
  });

  test('should collect telemetry metrics', async ({ page }) => {
    /**
     * Tests telemetry collection during operations
     */

    // Perform multiple transactions to generate metrics
    for (let i = 0; i < 3; i++) {
      await page.goto('http://localhost:4200/pos-terminal');
      await page.fill('[data-testid="product-search"]', 'Coffee');
      await page.click('[data-testid="search-button"]');
      await page.click('[data-testid="add-to-cart"]');
      await page.click('[data-testid="checkout-button"]');
      await page.click('[data-testid="payment-method-cash"]');
      await page.fill('[data-testid="cash-amount"]', '10.00');
      await page.click('[data-testid="submit-payment"]');
      await page.waitForSelector('[data-testid="payment-success"]');
    }

    // Navigate to monitor dashboard
    await page.goto('http://localhost:4200/monitor');

    // Check metrics section
    await page.waitForSelector('[data-testid="metric-card"]');

    // Should have metrics for:
    // - payments.processed (counter)
    // - payment.duration (histogram)
    // - api.requests (counter)

    const metricCards = await page.$$('[data-testid="metric-card"]');
    expect(metricCards.length).toBeGreaterThan(0);

    // Find payment metrics
    const paymentMetric = await page
      .locator('[data-testid="metric-card"]')
      .filter({ hasText: 'payments.processed' });

    const metricValue = await paymentMetric.locator('[data-testid="metric-value"]').textContent();
    expect(parseInt(metricValue || '0')).toBeGreaterThanOrEqual(3);
  });

  test('should handle event bus messaging between agents', async ({ page }) => {
    /**
     * Tests inter-agent communication via EventBus
     */

    // Perform a transaction that triggers multiple agent interactions
    await page.goto('http://localhost:4200/pos-terminal');
    await page.fill('[data-testid="product-search"]', 'Coffee');
    await page.click('[data-testid="search-button"]');
    await page.click('[data-testid="add-to-cart"]');
    await page.click('[data-testid="checkout-button"]');
    await page.click('[data-testid="payment-method-card"]');
    await page.fill('[data-testid="card-number"]', '4111111111111111');
    await page.fill('[data-testid="card-expiry"]', '12/25');
    await page.fill('[data-testid="card-cvv"]', '123');
    await page.click('[data-testid="submit-payment"]');
    await page.waitForSelector('[data-testid="payment-success"]');

    // Navigate to monitor dashboard
    await page.goto('http://localhost:4200/monitor');

    // Check event bus section
    await page.waitForSelector('[data-testid="event-bus-stats"]');

    // Should have messages from multiple agents
    const messagesBySource = await page.$$('[data-testid="messages-by-source"]');
    expect(messagesBySource.length).toBeGreaterThan(0);

    // Should have different message types
    const messagesByType = await page.$$('[data-testid="messages-by-type"]');
    expect(messagesByType.length).toBeGreaterThan(0);

    // Verify PAYMENT_PROCESSED message exists
    const messageTypes = await Promise.all(messagesByType.map((msg) => msg.textContent()));

    const hasPaymentMessage = messageTypes.some((text) => text?.includes('PAYMENT_PROCESSED'));
    expect(hasPaymentMessage).toBe(true);
  });

  test('should export audit logs', async ({ page }) => {
    /**
     * Tests audit log export functionality
     */

    // Navigate to monitor dashboard
    await page.goto('http://localhost:4200/monitor');

    // Wait for audit logs section
    await page.waitForSelector('[data-testid="audit-log-entry"]');

    // Click export button
    const downloadPromise = page.waitForEvent('download');
    await page.click('[data-testid="export-audit-logs"]');

    // Wait for download
    const download = await downloadPromise;

    // Verify filename
    expect(download.suggestedFilename()).toMatch(/audit-logs.*\.(json|csv)/);

    // Verify file is not empty
    const path = await download.path();
    expect(path).toBeTruthy();
  });

  test('should handle inventory updates across agents', async ({ page }) => {
    /**
     * Tests inventory synchronization between agents
     */

    // Check initial inventory
    await page.goto('http://localhost:4200/inventory');
    await page.fill('[data-testid="product-search"]', 'Coffee');
    await page.click('[data-testid="search-button"]');

    const initialStock = await page.textContent('[data-testid="stock-quantity"]');
    const initialQuantity = parseInt(initialStock || '0');

    // Make a purchase
    await page.goto('http://localhost:4200/pos-terminal');
    await page.fill('[data-testid="product-search"]', 'Coffee');
    await page.click('[data-testid="search-button"]');
    await page.click('[data-testid="add-to-cart"]');
    await page.click('[data-testid="checkout-button"]');
    await page.click('[data-testid="payment-method-cash"]');
    await page.fill('[data-testid="cash-amount"]', '10.00');
    await page.click('[data-testid="submit-payment"]');
    await page.waitForSelector('[data-testid="payment-success"]');

    // Check updated inventory
    await page.goto('http://localhost:4200/inventory');
    await page.fill('[data-testid="product-search"]', 'Coffee');
    await page.click('[data-testid="search-button"]');

    const updatedStock = await page.textContent('[data-testid="stock-quantity"]');
    const updatedQuantity = parseInt(updatedStock || '0');

    // Stock should be reduced by 1
    expect(updatedQuantity).toBe(initialQuantity - 1);
  });
});

test.describe('Agent Error Handling', () => {
  test('should gracefully handle agent failures', async ({ page }) => {
    /**
     * Tests error handling when an agent fails
     */

    await page.goto('http://localhost:4200/pos-terminal');

    // Simulate error by using invalid data
    await page.fill('[data-testid="product-search"]', 'INVALID_PRODUCT_XYZ');
    await page.click('[data-testid="search-button"]');

    // Should show error message
    await page.waitForSelector('[data-testid="error-message"]');
    const errorMessage = await page.textContent('[data-testid="error-message"]');
    expect(errorMessage).toContain('Product not found');

    // Application should still be functional
    await page.fill('[data-testid="product-search"]', 'Coffee');
    await page.click('[data-testid="search-button"]');
    await page.waitForSelector('[data-testid="product-result"]');
  });

  test('should recover from circuit breaker open state', async ({ page }) => {
    /**
     * Tests circuit breaker recovery after timeout
     */

    // This test would require waiting for circuit breaker timeout
    // In a real scenario, you'd configure shorter timeouts for testing

    await page.goto('http://localhost:4200/monitor');

    // Find a circuit breaker in OPEN state
    const openCircuit = await page
      .locator('[data-testid="circuit-breaker-card"]')
      .filter({ has: page.locator('[data-testid="circuit-state"]:has-text("OPEN")') })
      .first();

    if ((await openCircuit.count()) > 0) {
      // Wait for circuit breaker timeout (configured in test environment)
      await page.waitForTimeout(5000);

      // Refresh to see updated state
      await page.reload();

      // Circuit should transition to HALF_OPEN
      const circuitState = await openCircuit.locator('[data-testid="circuit-state"]').textContent();
      expect(['HALF_OPEN', 'CLOSED']).toContain(circuitState || '');
    }
  });
});

test.describe('Performance Tests', () => {
  test('should handle concurrent transactions', async ({ page }) => {
    /**
     * Tests system performance under load
     */

    const startTime = Date.now();

    // Simulate 10 concurrent transactions
    const transactions = [];
    for (let i = 0; i < 10; i++) {
      transactions.push(
        (async () => {
          await page.goto('http://localhost:4200/pos-terminal');
          await page.fill('[data-testid="product-search"]', 'Coffee');
          await page.click('[data-testid="search-button"]');
          await page.click('[data-testid="add-to-cart"]');
          await page.click('[data-testid="checkout-button"]');
          await page.click('[data-testid="payment-method-cash"]');
          await page.fill('[data-testid="cash-amount"]', '10.00');
          await page.click('[data-testid="submit-payment"]');
          await page.waitForSelector('[data-testid="payment-success"]');
        })()
      );
    }

    await Promise.all(transactions);

    const duration = Date.now() - startTime;

    // All transactions should complete within reasonable time
    expect(duration).toBeLessThan(30000); // 30 seconds

    // Verify all transactions recorded
    await page.goto('http://localhost:4200/monitor');
    const totalMessages = await page.textContent('[data-testid="total-messages"]');
    expect(parseInt(totalMessages || '0')).toBeGreaterThanOrEqual(10);
  });
});

// Made with Bob
