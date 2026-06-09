# TDD with Cucumber & Playwright Guide

## Overview

This guide demonstrates Test-Driven Development (TDD) using Cucumber for BDD (Behavior-Driven Development) with Playwright for E2E testing.

## TDD Cycle: Red-Green-Refactor

### 🔴 RED Phase (Current)
Write failing tests that define the desired behavior.

### 🟢 GREEN Phase (Next)
Write minimal code to make tests pass.

### 🔵 REFACTOR Phase (Final)
Improve code quality while keeping tests green.

---

## Current Status: 🔴 RED Phase

We have created:

1. **Cucumber Feature File** - [`features/pos-terminal/product-search.feature`](features/pos-terminal/product-search.feature:1)
   - Defines user stories in Gherkin syntax
   - 5 scenarios covering core functionality
   - Human-readable specifications

2. **Playwright Step Definitions** - [`features/step-definitions/product-search.steps.ts`](features/step-definitions/product-search.steps.ts:1)
   - Implements Given/When/Then steps
   - Uses Playwright for browser automation
   - Targets `data-testid` attributes for reliability

3. **Cucumber Configuration** - [`cucumber.config.ts`](cucumber.config.ts:1)
   - Test runner configuration
   - HTML and JSON reporting
   - TypeScript support

---

## Running the Tests (RED Phase)

### Run Cucumber Tests
```bash
npm run test:cucumber
```

**Expected Result:** ❌ All tests should FAIL because the UI components don't exist yet.

### Example Failure Output
```
Feature: Product Search

  Scenario: Search for products by name
    Given the POS terminal is open at "http://localhost:4200/pos-terminal"
    When I type "Coffee" in the product search field
    ✗ Error: Timeout waiting for selector '[data-testid="product-search"]'
    
  Scenario: Search with no results
    ✗ Error: Timeout waiting for selector '[data-testid="product-search"]'
```

---

## Test Scenarios Defined

### 1. Search for products by name
```gherkin
When I type "Coffee" in the product search field
Then I should see 1 product result
And the result should contain "Coffee"
```

**What needs to be built:**
- Input field with `data-testid="product-search"`
- Search results container
- Product result items with `data-testid="product-result"`

### 2. Search with no results
```gherkin
When I type "INVALID_PRODUCT_XYZ" in the product search field
Then I should see "No products found" message
```

**What needs to be built:**
- Empty state message with `data-testid="no-results"`
- Error handling for no results

### 3. Select product from search results
```gherkin
When I type "Coffee" in the product search field
And I click on the first search result
Then the product should be added to the cart
And the search field should be cleared
```

**What needs to be built:**
- Clickable product results
- Cart integration with `data-testid="cart-count"`
- Clear search functionality

### 4. Keyboard navigation with Enter key
```gherkin
When I type "Coffee" in the product search field
And I press the "ArrowDown" key
And I press the "Enter" key
Then the product should be added to the cart
```

**What needs to be built:**
- Keyboard event handlers
- Highlight state for navigation
- Enter key to select

### 5. Clear search with Escape key
```gherkin
When I type "Coffee" in the product search field
And I press the "Escape" key
Then the search field should be cleared
And the search results should be hidden
```

**What needs to be built:**
- Escape key handler
- Clear search state

---

## Required UI Components (To Be Built)

### ProductSearchComponent

**Location:** `src/app/features/pos-terminal/components/product-search/`

**Required Elements:**
```html
<!-- Search Input -->
<input 
  data-testid="product-search"
  type="text"
  placeholder="Search products..."
  role="combobox"
  aria-autocomplete="list"
  aria-expanded="false"
/>

<!-- Search Button -->
<button data-testid="search-button">
  Search
</button>

<!-- Loading Indicator -->
<div data-testid="search-loading" *ngIf="isLoading">
  Searching...
</div>

<!-- Error Message -->
<div data-testid="search-error" *ngIf="error">
  {{ error }}
</div>

<!-- No Results -->
<div data-testid="no-results" *ngIf="!isLoading && searchResults.length === 0">
  No products found
</div>

<!-- Search Results -->
<div data-testid="product-result" 
     *ngFor="let product of searchResults"
     [class.highlighted]="isHighlighted(product)"
     (click)="selectProduct(product)">
  {{ product.name }} - ${{ product.price }}
  <span data-testid="stock-status">
    {{ product.stock > 0 ? 'In Stock' : 'Out of Stock' }}
  </span>
</div>
```

**Required Functionality:**
- Search input with debounce (300ms)
- Minimum 2 characters to trigger search
- Keyboard navigation (ArrowUp, ArrowDown, Enter, Escape)
- Product selection emits event
- Clear search on selection or Escape
- Loading and error states
- Accessibility (ARIA attributes)

**Required Signals:**
```typescript
searchQuery = signal<string>('');
searchResults = signal<ProductDTO[]>([]);
isLoading = signal<boolean>(false);
error = signal<string | null>(null);
highlightedIndex = signal<number>(-1);
selectedCategory = signal<string | null>(null);
```

**Required Methods:**
```typescript
onSearchInput(query: string): void
selectProduct(product: ProductDTO): void
onKeyDown(event: KeyboardEvent): void
onCategorySelect(category: string | null): void
```

---

## Next Steps: 🟢 GREEN Phase

1. **Create ProductSearchComponent**
   ```bash
   ng generate component features/pos-terminal/components/product-search
   ```

2. **Implement minimal functionality**
   - Add required `data-testid` attributes
   - Implement search logic
   - Add keyboard navigation
   - Connect to ProductService

3. **Run tests again**
   ```bash
   npm run test:cucumber
   ```

4. **Iterate until all tests pass** ✅

---

## Benefits of This Approach

### 1. **Clear Requirements**
- Feature files serve as living documentation
- Non-technical stakeholders can understand tests
- Acceptance criteria are explicit

### 2. **Confidence in Changes**
- Tests define expected behavior
- Refactoring is safe with passing tests
- Regression detection is automatic

### 3. **Better Design**
- Writing tests first leads to better API design
- Forces thinking about user experience
- Encourages testable code

### 4. **Faster Development**
- Less debugging time
- Immediate feedback on changes
- Prevents over-engineering

---

## Integration with Existing Tests

### Unit Tests (Jasmine/Karma)
- Test individual components in isolation
- Mock dependencies
- Fast execution

### E2E Tests (Playwright)
- Test complete user workflows
- Real browser interaction
- Slower but comprehensive

### Cucumber Tests (BDD)
- Bridge between business and technical
- Human-readable specifications
- Combines with Playwright for E2E

---

## Running All Tests

```bash
# Unit tests
npm run test:unit

# E2E tests (Playwright)
npm run test:e2e

# Cucumber tests (BDD)
npm run test:cucumber

# All tests
npm run test:all
```

---

## Cucumber Reports

After running tests, view the HTML report:
```bash
open cucumber-report.html
```

The report shows:
- ✅ Passed scenarios (green)
- ❌ Failed scenarios (red)
- ⏭️ Skipped scenarios (yellow)
- 📊 Execution time
- 📸 Screenshots on failure

---

## Best Practices

### 1. Write Tests First
Always write the test before the implementation.

### 2. Keep Tests Simple
One scenario should test one behavior.

### 3. Use Descriptive Names
Scenario names should clearly describe what's being tested.

### 4. Maintain Test Data
Use Background steps for common setup.

### 5. Keep Tests Independent
Each scenario should be able to run in isolation.

### 6. Use data-testid
Prefer `data-testid` over CSS classes or IDs for stability.

### 7. Avoid Implementation Details
Test behavior, not implementation.

---

## Common Patterns

### Waiting for Elements
```typescript
await page.waitForSelector('[data-testid="product-result"]');
```

### Checking Visibility
```typescript
await expect(page.locator('[data-testid="loading"]')).toBeVisible();
```

### Counting Elements
```typescript
const count = await page.locator('[data-testid="item"]').count();
expect(count).toBe(3);
```

### Checking Text Content
```typescript
await expect(page.locator('[data-testid="title"]')).toContainText('Coffee');
```

### Keyboard Interaction
```typescript
await page.keyboard.press('Enter');
await page.keyboard.type('Coffee');
```

---

## Troubleshooting

### Tests Timeout
- Increase timeout in cucumber.config.ts
- Check if application is running
- Verify selectors are correct

### Element Not Found
- Check `data-testid` attribute exists
- Wait for element to be visible
- Check if element is in correct state

### Flaky Tests
- Add explicit waits
- Use `waitForLoadState('networkidle')`
- Avoid hardcoded timeouts

---

## Summary

We are currently in the **🔴 RED phase** of TDD:

✅ **Completed:**
- Cucumber feature file with 5 scenarios
- Playwright step definitions
- Cucumber configuration
- TDD documentation

❌ **Next (GREEN phase):**
- Implement ProductSearchComponent
- Make all tests pass
- Verify functionality

🔵 **Future (REFACTOR phase):**
- Optimize performance
- Improve code quality
- Add more test scenarios

**Current Test Status:** 0/5 passing (Expected - RED phase)

Run `npm run test:cucumber` to see the failing tests and start the GREEN phase!