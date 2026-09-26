Feature: Kiosk physical terminal checkout
  As a customer at a self-checkout kiosk terminal
  I want to buy products without needing an operator
  So that I can complete my purchase independently

  Background:
    Given the kiosk shop is open at "http://localhost:4200/kiosk/shop"
    And all remote API calls are stubbed to succeed

  # ── Scenario 1: Anonymous checkout ───────────────────────────────────────────

  Scenario: Anonymous customer completes cash purchase and sees receipt
    Given no customer is signed in
    When I add the first available product to the kiosk cart
    And I open the kiosk checkout and select cash payment
    And I enter tendered amount "10" and confirm
    Then the kiosk receipt overlay is shown
    And the checkout overlay is dismissed

  # ── Scenario 2: Signed-in customer checkout ──────────────────────────────────

  Scenario: Signed-in customer sees receipt after cash payment
    Given the customer signs in on the kiosk splash with email "admin@capy-pos.local"
    When I add the first available product to the kiosk cart
    And I open the kiosk checkout and select cash payment
    And I enter tendered amount "10" and confirm
    Then the kiosk receipt overlay is shown
    And no authentication error is displayed

  # ── Scenario 3: New account creation (email-only, no phone required) ─────────

  Scenario: New customer creates account with email only and lands on the shop
    Given the kiosk splash screen is visible
    When I open the kiosk sign-in modal
    And I enter a new unique email address in the kiosk auth form
    And I click the "Create Account" button
    Then no validation error is shown
    And the kiosk product grid is visible

  # ── Scenario 4: No "phone is required" error for kiosk registration ───────────

  Scenario: Kiosk new-account form does not require a phone number
    Given the kiosk splash screen is visible
    When I open the kiosk sign-in modal
    And I enter email "kiosk-phone-test@example.com" in the kiosk auth form
    And I click the "Create Account" button
    Then no "phone" validation error is shown in the auth modal
    And the kiosk product grid is visible

  # ── Scenario 5: Persistence failure shows error banner, preserves cart ────────

  Scenario: Remote transaction failure shows error banner and preserves cart
    Given the POST /api/transactions endpoint returns status 500
    When I add the first available product to the kiosk cart
    And I open the kiosk checkout and select cash payment
    And I enter tendered amount "10" and confirm
    Then the kiosk checkout error banner is shown
    And the kiosk receipt overlay is not shown
