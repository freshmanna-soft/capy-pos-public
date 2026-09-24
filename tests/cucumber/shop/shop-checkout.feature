Feature: Shop customer-phone self-checkout flow
  As a customer using my own phone to shop at a store
  I want to browse products and check out without an operator present
  So that I can shop at my own pace using Scan & Go

  Background:
    Given the kiosk splash is open at "http://localhost:4200/kiosk"
    And all remote API calls are stubbed to succeed
    And the POST /api/shop/session endpoint is stubbed to return a valid token

  # ── Scenario 1: Anonymous checkout ───────────────────────────────────────────

  Scenario: Anonymous customer adds product, pays cash, sees receipt
    Given no customer is signed in
    And I navigate directly to the shop at "http://localhost:4200/kiosk/shop"
    When I add the first available product to the kiosk cart
    And I open the kiosk checkout and select cash payment
    And I enter tendered amount "10" and confirm
    Then the kiosk receipt overlay is shown

  # ── Scenario 2: Signed-in customer checkout ──────────────────────────────────

  Scenario: Signed-in customer sees receipt after cash payment
    Given the customer signs in on the kiosk splash with email "admin@capy-pos.local"
    When I add the first available product to the kiosk cart
    And I open the kiosk checkout and select cash payment
    And I enter tendered amount "10" and confirm
    Then the kiosk receipt overlay is shown
    And no authentication error is displayed

  # ── Scenario 3: New account — email only, no phone required ──────────────────

  Scenario: New customer registers with email only on the shop splash
    Given the kiosk splash screen is visible
    When I open the kiosk sign-in modal
    And I enter a new unique email address in the kiosk auth form
    And I click the "Create Account" button
    Then no validation error is shown
    And the kiosk product grid is visible

  # ── Scenario 4: No phone field in the kiosk/shop registration form ───────────

  Scenario: Registration form asks for email only — phone field is absent
    Given the kiosk splash screen is visible
    When I open the kiosk sign-in modal
    Then no phone input field is visible in the kiosk auth modal

  # ── Scenario 5: Worker does not emit a warning log for kiosk stock push ───────

  Scenario: Anonymous kiosk checkout emits no console warning for missing session
    Given no customer is signed in
    And I navigate directly to the shop at "http://localhost:4200/kiosk/shop"
    And I capture browser console messages
    When I add the first available product to the kiosk cart
    And I open the kiosk checkout and select cash payment
    And I enter tendered amount "10" and confirm
    Then no console message at level "warning" contains "No operator session"
