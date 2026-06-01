import { Given, When, Then, Before, After, setDefaultTimeout } from '@cucumber/cucumber';
import { expect } from '@playwright/test';
import { Page, Browser, chromium } from 'playwright';

setDefaultTimeout(30000);

let browser: Browser;
let page: Page;

Before(async function () {
  browser = await chromium.launch({ headless: false });
  page = await browser.newPage();
});

After(async function () {
  await page.close();
  await browser.close();
});

// Background Steps

Given('the POS terminal is open at {string}', async function (url: string) {
  await page.goto(url);
  await page.waitForLoadState('networkidle');
});

// When Steps

When('I type {string} in the product search field', async function (searchText: string) {
  await page.fill('[data-testid="product-search"]', searchText);
  // Wait for debounce
  await page.waitForTimeout(350);
});

When('I click on the first search result', async function () {
  await page.click('[data-testid="product-result"]:first-of-type');
});

When('I press the {string} key', async function (key: string) {
  await page.keyboard.press(key);
});

When('I click the search button', async function () {
  await page.click('[data-testid="search-button"]');
});

When('I clear the search field', async function () {
  await page.fill('[data-testid="product-search"]', '');
});

When('I select {string} category', async function (category: string) {
  await page.click(`[data-testid="category-${category.toLowerCase()}"]`);
});

// Then Steps

Then('I should see {int} product result(s)', async function (count: number) {
  const results = await page.locator('[data-testid="product-result"]').count();
  expect(results).toBe(count);
});

Then('the result should contain {string}', async function (text: string) {
  const result = await page.locator('[data-testid="product-result"]').first();
  await expect(result).toContainText(text);
});

Then('I should see {string} message', async function (message: string) {
  const noResults = await page.locator('[data-testid="no-results"]');
  await expect(noResults).toContainText(message);
});

Then('the product should be added to the cart', async function () {
  const cartCount = await page.locator('[data-testid="cart-count"]').textContent();
  expect(parseInt(cartCount || '0')).toBeGreaterThan(0);
});

Then('the search field should be cleared', async function () {
  const searchInput = await page.locator('[data-testid="product-search"]');
  await expect(searchInput).toHaveValue('');
});

Then('the search results should be hidden', async function () {
  const results = await page.locator('[data-testid="product-result"]').count();
  expect(results).toBe(0);
});

Then('I should see a loading indicator', async function () {
  const loader = await page.locator('[data-testid="search-loading"]');
  await expect(loader).toBeVisible();
});

Then('the result should show price {string}', async function (price: string) {
  const result = await page.locator('[data-testid="product-result"]').first();
  await expect(result).toContainText(price);
});

Then('the result should show {string} status', async function (status: string) {
  const stockStatus = await page.locator('[data-testid="stock-status"]').first();
  await expect(stockStatus).toContainText(status);
});

Then('the result should be disabled', async function () {
  const result = await page.locator('[data-testid="product-result"]').first();
  await expect(result).toHaveAttribute('disabled', '');
});

Then('the first result should be highlighted', async function () {
  const result = await page.locator('[data-testid="product-result"]').first();
  await expect(result).toHaveClass(/highlighted/);
});

Then('the search input should have role {string}', async function (role: string) {
  const input = await page.locator('[data-testid="product-search"]');
  await expect(input).toHaveAttribute('role', role);
});

Then('the search input should have aria-autocomplete {string}', async function (value: string) {
  const input = await page.locator('[data-testid="product-search"]');
  await expect(input).toHaveAttribute('aria-autocomplete', value);
});

Then('the search input should have aria-expanded {string}', async function (value: string) {
  const input = await page.locator('[data-testid="product-search"]');
  await expect(input).toHaveAttribute('aria-expanded', value);
});

export { page, browser };

// Made with Bob
