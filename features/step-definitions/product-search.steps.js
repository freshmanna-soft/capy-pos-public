const { Given, When, Then, Before, After, setDefaultTimeout } = require('@cucumber/cucumber');
const { expect } = require('@playwright/test');
const { chromium } = require('playwright');

setDefaultTimeout(30000);

let browser;
let page;

Before(async function () {
  browser = await chromium.launch({ headless: false });
  page = await browser.newPage();
});

After(async function () {
  if (page) await page.close();
  if (browser) await browser.close();
});

// Background Steps

Given('the POS terminal is open at {string}', async function (url) {
  await page.goto(url);
  await page.waitForLoadState('networkidle');
});

// When Steps

When('I type {string} in the product search field', async function (searchText) {
  await page.fill('[data-testid="product-search"]', searchText);
  // Wait for debounce
  await page.waitForTimeout(350);
});

When('I click on the first search result', async function () {
  await page.click('[data-testid="product-result"]:first-of-type');
});

When('I press the {string} key', async function (key) {
  await page.keyboard.press(key);
});

// Then Steps

Then('I should see {int} product result(s)', async function (count) {
  const results = await page.locator('[data-testid="product-result"]').count();
  expect(results).toBe(count);
});

Then('the result should contain {string}', async function (text) {
  const result = page.locator('[data-testid="product-result"]').first();
  await expect(result).toContainText(text);
});

Then('I should see {string} message', async function (message) {
  const noResults = page.locator('[data-testid="no-results"]');
  await expect(noResults).toContainText(message);
});

Then('the product should be added to the cart', async function () {
  // Wait for cart to update
  await page.waitForTimeout(500);
  const cartCount = await page.locator('[data-testid="cart-count"]').textContent();
  expect(parseInt(cartCount || '0')).toBeGreaterThan(0);
});

Then('the search field should be cleared', async function () {
  const searchInput = page.locator('[data-testid="product-search"]');
  await expect(searchInput).toHaveValue('');
});

Then('the search results should be hidden', async function () {
  const results = await page.locator('[data-testid="product-result"]').count();
  expect(results).toBe(0);
});

module.exports = { page, browser };

// Made with Bob
