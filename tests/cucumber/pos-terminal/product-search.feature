Feature: Product Search
  As a cashier
  I want to search for products
  So that I can quickly add items to a customer's cart

  Background:
    Given the POS terminal is open at "http://localhost:4200/pos-terminal"

  Scenario: Search for products by name
    When I type "Coffee" in the product search field
    Then I should see 1 product result
    And the result should contain "Coffee"

  Scenario: Search with no results
    When I type "INVALID_PRODUCT_XYZ" in the product search field
    Then I should see "No products found" message

  Scenario: Select product from search results
    When I type "Coffee" in the product search field
    And I click on the first search result
    Then the product should be added to the cart
    # Search query intentionally persists after selection so cashiers can add
    # multiple items quickly; only Escape clears it (see "Clear search" scenario).
    And the search results should remain visible

  Scenario: Keyboard navigation with Enter key
    When I type "Coffee" in the product search field
    And I press the "ArrowDown" key
    And I press the "Enter" key
    Then the product should be added to the cart

  Scenario: Clear search with Escape key
    When I type "Coffee" in the product search field
    And I press the "Escape" key
    Then the search field should be cleared
    And the search results should be hidden