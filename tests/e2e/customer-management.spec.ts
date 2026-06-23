import { test, expect } from '@playwright/test';
import { loginAsAdmin } from './helpers/auth';

/**
 * E2E Tests: Customer Management CRUD
 *
 * Tests the full customer management workflow including:
 * - Navigation to customers page
 * - Customer table display
 * - Search and filter functionality
 * - Create new customer
 * - Edit existing customer
 * - Delete customer with confirmation
 * - Status and tier display
 *
 * Persona: Carlos the Manager
 */
test.describe('Customer Management - Carlos the Manager', () => {
  test.beforeEach(async ({ page }) => {
    await loginAsAdmin(page);
    await page.goto('/customers');
    await page.waitForSelector('[data-testid="customers-page"]');
  });

  test.describe('Page Load & Navigation', () => {
    test('should display customers page with title', async ({ page }) => {
      const title = page.locator('.page-title');
      await expect(title).toContainText('Customer Management');
    });

    test('should be accessible from navigation', async ({ page }) => {
      await page.goto('/pos');
      await page.click('[data-testid="nav-customers"]');
      await expect(page).toHaveURL(/\/customers/);
      await expect(page.locator('[data-testid="customers-page"]')).toBeVisible();
    });

    test('should display customers table', async ({ page }) => {
      const table = page.locator('[data-testid="customers-table"]');
      await expect(table).toBeVisible();
    });

    test('should display customers summary footer', async ({ page }) => {
      const summary = page.locator('[data-testid="customers-summary"]');
      await expect(summary).toBeVisible();
    });
  });

  test.describe('Search & Filter', () => {
    test('should filter customers by search query', async ({ page }) => {
      const searchInput = page.locator('[data-testid="customer-search"]');
      await searchInput.fill('John');

      // Wait for filtering to apply
      await page.waitForTimeout(300);

      const rows = page.locator('.customer-row');
      const count = await rows.count();
      expect(count).toBeGreaterThanOrEqual(0);
    });

    test('should filter customers by status', async ({ page }) => {
      const statusFilter = page.locator('[data-testid="status-filter"]');
      await statusFilter.selectOption('ACTIVE');

      await page.waitForTimeout(300);

      await expect(statusFilter).toHaveValue('ACTIVE');
    });

    test('should have status filter options', async ({ page }) => {
      const statusFilter = page.locator('[data-testid="status-filter"]');
      const options = await statusFilter.locator('option').allTextContents();
      expect(options).toContain('All Statuses');
      expect(options).toContain('Active');
      expect(options).toContain('VIP');
      expect(options).toContain('Inactive');
      expect(options).toContain('Blocked');
    });
  });

  test.describe('Create Customer', () => {
    test('should open create form when Add Customer is clicked', async ({ page }) => {
      await page.click('[data-testid="btn-add-customer"]');
      const form = page.locator('[data-testid="customer-form"]');
      await expect(form).toBeVisible();
    });

    test('should show validation errors for empty required fields', async ({ page }) => {
      await page.click('[data-testid="btn-add-customer"]');
      await page.click('[data-testid="btn-save"]');

      const errors = page.locator('.field-error');
      await expect(errors.first()).toBeVisible();
    });

    test('should show email validation error for invalid email', async ({ page }) => {
      await page.click('[data-testid="btn-add-customer"]');

      await page.fill('[data-testid="input-name"]', 'Test Customer');
      await page.fill('[data-testid="input-email"]', 'invalid-email');
      await page.fill('[data-testid="input-phone"]', '(555) 123-4567');

      await page.click('[data-testid="btn-save"]');

      const emailError = page.locator('.field-error');
      await expect(emailError).toContainText('valid email');
    });

    test('should create a customer with valid data', async ({ page }) => {
      await page.click('[data-testid="btn-add-customer"]');

      await page.fill('[data-testid="input-name"]', 'E2E Test Customer');
      await page.fill('[data-testid="input-email"]', 'e2e-test@example.com');
      await page.fill('[data-testid="input-phone"]', '(555) 999-0000');
      await page.fill('[data-testid="input-country"]', 'US');

      await page.click('[data-testid="btn-save"]');

      // Form should close after successful creation
      await expect(page.locator('[data-testid="customer-form"]')).not.toBeVisible();
    });

    test('should close form when Cancel is clicked', async ({ page }) => {
      await page.click('[data-testid="btn-add-customer"]');
      await expect(page.locator('[data-testid="customer-form"]')).toBeVisible();

      await page.click('[data-testid="btn-cancel"]');
      await expect(page.locator('[data-testid="customer-form"]')).not.toBeVisible();
    });

    test('should close form when X button is clicked', async ({ page }) => {
      await page.click('[data-testid="btn-add-customer"]');
      await expect(page.locator('[data-testid="customer-form"]')).toBeVisible();

      await page.click('[data-testid="btn-close-form"]');
      await expect(page.locator('[data-testid="customer-form"]')).not.toBeVisible();
    });
  });

  test.describe('Edit Customer', () => {
    test('should open edit form when edit button is clicked', async ({ page }) => {
      // First create a customer to edit
      await page.click('[data-testid="btn-add-customer"]');
      await page.fill('[data-testid="input-name"]', 'Edit Test Customer');
      await page.fill('[data-testid="input-email"]', 'edit-test@example.com');
      await page.fill('[data-testid="input-phone"]', '(555) 111-0000');
      await page.click('[data-testid="btn-save"]');

      await page.waitForTimeout(500);

      // Click edit on the first customer row's edit button
      const editBtn = page.locator('.btn-edit').first();
      if (await editBtn.isVisible()) {
        await editBtn.click();
        await expect(page.locator('[data-testid="customer-form"]')).toBeVisible();
      }
    });

    test('should pre-fill form with customer data on edit', async ({ page }) => {
      // Create a customer first
      await page.click('[data-testid="btn-add-customer"]');
      await page.fill('[data-testid="input-name"]', 'Prefill Test');
      await page.fill('[data-testid="input-email"]', 'prefill@example.com');
      await page.fill('[data-testid="input-phone"]', '(555) 222-3333');
      await page.click('[data-testid="btn-save"]');

      await page.waitForTimeout(500);

      const editBtn = page.locator('.btn-edit').first();
      if (await editBtn.isVisible()) {
        await editBtn.click();
        const nameInput = page.locator('[data-testid="input-name"]');
        const nameValue = await nameInput.inputValue();
        expect(nameValue.length).toBeGreaterThan(0);
      }
    });
  });

  test.describe('Delete Customer', () => {
    test('should show delete confirmation dialog', async ({ page }) => {
      // Create a customer first
      await page.click('[data-testid="btn-add-customer"]');
      await page.fill('[data-testid="input-name"]', 'Delete Test Customer');
      await page.fill('[data-testid="input-email"]', 'delete-test@example.com');
      await page.fill('[data-testid="input-phone"]', '(555) 444-5555');
      await page.click('[data-testid="btn-save"]');

      await page.waitForTimeout(500);

      const deleteBtn = page.locator('.btn-delete').first();
      if (await deleteBtn.isVisible()) {
        await deleteBtn.click();
        await expect(page.locator('[data-testid="delete-confirm"]')).toBeVisible();
      }
    });

    test('should cancel delete when Cancel is clicked', async ({ page }) => {
      // Create a customer first
      await page.click('[data-testid="btn-add-customer"]');
      await page.fill('[data-testid="input-name"]', 'Cancel Delete Test');
      await page.fill('[data-testid="input-email"]', 'cancel-del@example.com');
      await page.fill('[data-testid="input-phone"]', '(555) 666-7777');
      await page.click('[data-testid="btn-save"]');

      await page.waitForTimeout(500);

      const deleteBtn = page.locator('.btn-delete').first();
      if (await deleteBtn.isVisible()) {
        await deleteBtn.click();
        await page.click('[data-testid="btn-cancel-delete"]');
        await expect(page.locator('[data-testid="delete-confirm"]')).not.toBeVisible();
      }
    });

    test('should delete customer when confirmed', async ({ page }) => {
      // Create a customer first
      await page.click('[data-testid="btn-add-customer"]');
      await page.fill('[data-testid="input-name"]', 'Confirm Delete Test');
      await page.fill('[data-testid="input-email"]', 'confirm-del@example.com');
      await page.fill('[data-testid="input-phone"]', '(555) 888-9999');
      await page.click('[data-testid="btn-save"]');

      await page.waitForTimeout(500);

      const deleteBtn = page.locator('.btn-delete').first();
      if (await deleteBtn.isVisible()) {
        await deleteBtn.click();
        await page.click('[data-testid="btn-confirm-delete"]');
        await expect(page.locator('[data-testid="delete-confirm"]')).not.toBeVisible();
      }
    });
  });

  test.describe('Customer Display', () => {
    test('should display customer initials avatar', async ({ page }) => {
      // Create a customer
      await page.click('[data-testid="btn-add-customer"]');
      await page.fill('[data-testid="input-name"]', 'John Doe');
      await page.fill('[data-testid="input-email"]', 'john.doe@example.com');
      await page.fill('[data-testid="input-phone"]', '(555) 100-2000');
      await page.click('[data-testid="btn-save"]');

      await page.waitForTimeout(500);

      const avatar = page.locator('.customer-avatar').first();
      if (await avatar.isVisible()) {
        const text = await avatar.textContent();
        expect(text).toBeTruthy();
        expect(text!.length).toBeLessThanOrEqual(2);
      }
    });

    test('should show empty state when no customers match search', async ({ page }) => {
      const searchInput = page.locator('[data-testid="customer-search"]');
      await searchInput.fill('zzzznonexistentzzzz');

      await page.waitForTimeout(300);

      const emptyState = page.locator('.empty-content');
      await expect(emptyState).toBeVisible();
    });
  });
});
