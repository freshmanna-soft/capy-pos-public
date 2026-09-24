# Plan: Guaranteed Remote Transaction Persistence — Kiosk Terminal + Customer Phone

<!-- Session-2 fixes: FIX-A ✅  FIX-B ✅  FIX-C ✅  (committed 2025) -->

## Two Distinct Flows, One Guarantee

There are two separate runtime contexts that both need guaranteed remote persistence:

### Flow A — Physical Kiosk Terminal
A tablet/screen configured once by staff, permanently in the store.
- Dexie `settings` table has the terminal config (storeId, orgId, payment methods)
- Staff generate a **device token** once via Settings → saved to Dexie forever
- Route: `/kiosk` (existing)
- Auth for POST: device token from Dexie

### Flow B — Customer's Own Phone (Scan & Go)
A customer opens `/shop` on their phone — no QR scanning needed, no URL parameter.
- Fresh browser context — Dexie is empty, no config, no token
- **Store is resolved automatically** from geofence / fallback, not from the URL
- Phone may close the tab right after payment — no second chance
- **Cannot** use a Dexie-stored device token
- Route: `/shop` (NEW, no params)
- Auth for POST: short-lived **session token** issued automatically on page load
- Customer optionally signs in with their email; anonymous is equally valid

Both flows POST to the same `POST /api/transactions` endpoint. The difference is how
they obtain the auth token.

---

## Store Resolution for `/shop` (Flow B)

No QR scanning, no URL parameter. The store is resolved at runtime:

```
Customer opens /shop
        │
        ▼
  Load KioskSettingsService (same Dexie settings as kiosk)
        │
        ├── exactly 1 store configured ──────────────► use it directly
        │
        ├── multiple stores + geofence ──► check location
        │         │
        │         ├── inside a store polygon ──────────► use that store
        │         │
        │         └── outside / location denied ──────► show store picker
        │
        └── no settings at all ────────────────────────► use default store
                                                          ("default-org/default-store")
                                                          = main warehouse fallback
```

The `KioskSettingsService` already exposes `storeId`, `stores()`, `hasFencePolygon()`,
and the `GeofencingService` already handles location checks — these are reused
directly. No new infrastructure.

---

## Remote-First Write Guarantee (Same for Both Flows)

```
Payment confirmed
      │
      ▼
POST /api/transactions
      │
   success ──► write Dexie (cache) ──► show receipt
      │
   failure ──► retry error, cart preserved, NO receipt shown
```

If the remote POST fails, the sale does not complete. Cart is kept. Customer retries
or goes to the counter.

---

## Auth Design

### Physical terminal (Flow A)
- Staff call `POST /api/kiosk-device-token` (staff JWT required) once per terminal
- Returns a **long-lived JWT** `{ sub: terminalId, type: 'kiosk-device', tenantId }`
- Stored in Dexie `settings` table — persists across browser restarts
- Used as `Authorization: Bearer <token>` on every `POST /api/transactions`

### Customer phone (Flow B)
- On first load of `/shop`, the app resolves the store, then calls
  `POST /api/shop/session { storeId }` — **no auth required**
- Returns a **short-lived JWT** `{ sub: storeId, type: 'shop-session', tenantId, exp: +1h }`
- Stored in `sessionStorage` only — gone when the tab closes
- Used as `Authorization: Bearer <token>` on `POST /api/transactions`
- Rate-limited per IP on the server (abuse protection)
- If store resolution shows a picker, the session token is requested **after** the
  customer picks — not before

Neither token type requires a staff session, a shared secret the client must know in
advance, or any device setup by the customer.

---

## Session-2 Additions (3 focused fixes)

Three new issues identified in the current session, addressed before the larger ST-1–ST-7 work:

| # | Issue | Fix |
|---|-------|-----|
| **FIX-A** | `handlePaymentComplete` `.catch()` shows a fallback receipt even when remote POST fails — the cart is cleared regardless | Remove fallback receipt path; on any `posFacade.checkout()` rejection show inline retry error, preserve cart |
| **FIX-B** | New-user form in kiosk mode asks email only — phone field is absent from the template, but `CustomerBuilder.withPhone('')` passes an empty string which still triggered the old phone-required service validation | Confirmed already fixed: `customer.entity.ts` phone is optional, `customer.service.ts` phone required check removed. Log should be gone. Verify and add a note in the plan. |
| **FIX-C** | No Playwright e2e specs for kiosk or shop flows | Create `tests/e2e/kiosk.spec.ts` and `tests/e2e/shop.spec.ts` with BDD-structured (Cucumber-style Given/When/Then) scenarios for anonymous checkout, signed-in customer checkout, and new account creation |

---

### FIX-A — Remove fallback receipt on remote failure ✅

**Intent**
`KioskShopComponent.handlePaymentComplete()` currently has a `.catch()` block that
shows a fallback receipt even when `posFacade.checkout()` rejects. This defeats the
remote-first guarantee: a failed sale is presented as a successful one. The fix removes
the fallback path entirely — rejection must show an error and preserve the cart.

**Current state** (`kiosk-shop.component.ts:988`):
```
.catch(() => {
  // Fallback: even if persistence fails, still show the receipt...
  // cart is cleared inside this catch
  this.showReceipt.set(true);  ← BUG: receipt shown for a failed sale
});
```

**Expected Outcomes**
- `handlePaymentComplete()` `.catch()`: set a `checkoutError` signal, **do not** show receipt,
  **do not** clear the cart — cart stays full so the customer can retry
- A visible error banner appears inside `kiosk-checkout` or below the checkout button
  with message "Payment could not be saved — please try again or ask a cashier"
- `.then()` path unchanged: receipt shown on remote success
- Add `data-testid="kiosk-checkout-error"` to the error banner for test targeting

**Todo List**
1. Add `readonly checkoutError = signal<string | null>(null)` to `KioskShopComponent`
2. Replace the `.catch()` body: set `checkoutError('Payment could not be saved…')`,
   do **not** clear the cart, do **not** show receipt, set `showCheckout(false)` so
   the customer sees the error on the shop floor
3. In the `.then()` path, clear `checkoutError(null)` first
4. Add error banner to template: only shown when `checkoutError()` is non-null,
   `data-testid="kiosk-checkout-error"`, includes a "Try Again" button that sets
   `checkoutError(null)` and re-opens checkout

**Relevant Context**
- `kiosk-shop.component.ts:988–1022` — `handlePaymentComplete()` method
- `data-testid="kiosk-checkout"` at line 630 — existing checkout wrapper

**Status** — [x] done

---

### FIX-B — Confirm phone validation fix is complete ✅

**Intent**
The console log `"phone is required"` was appearing because `CustomerService.validateEntity()`
and `Customer.validate()` both had a mandatory phone check. The kiosk new-user form
(`kiosk-splash.component.ts`) only asks for email and passes `withPhone('')`.

**Current state (already applied)**
- `customer.entity.ts:198–202` — phone guard is `if (this.phone && !this.isValidPhone(...))`
- `customer.service.ts:169–177` — phone required check removed

**Expected Outcomes**
- No console warning/error about phone when kiosk creates a new customer
- New-user flow: email field only, "Create Account" succeeds with empty phone

**Todo List**
1. No code change needed — fix was already applied in Session 1
2. Add a comment in `kiosk-splash.component.ts` near `withPhone('')` to document
   why phone is intentionally blank for kiosk registrations

**Relevant Context**
- `kiosk-splash.component.ts:542–545` — `CustomerBuilder` for new accounts
- `customer.entity.ts:198–202` — phone guard
- `customer.service.ts:169–177` — service validation

**Status** — [x] done

---

### FIX-C — Playwright e2e: BDD-style kiosk + shop scenarios ✅

**Intent**
Create two Playwright spec files that use BDD-structured (Cucumber `Given/When/Then`)
comments to document and test the kiosk and shop customer checkout flows.
All remote API calls stubbed (no live backend required).
Tests run in the existing CI pipeline (no new CI config needed — `playwright.config.ts`
picks up all `*.spec.ts` files in `tests/e2e/`).

**Scenarios: `tests/e2e/kiosk.spec.ts`**
1. **Anonymous checkout** — navigate to `/kiosk/shop` with Dexie seeded (device token +
   a product), add to cart, complete checkout with cash, stub `POST /api/transactions → 201`,
   verify receipt shown
2. **Signed-in customer checkout** — same as above but customer signs in with email before
   checkout; verify receipt shows customer name; stub POST
3. **New account creation** — open "Your Account" modal, enter new email, click "Create Account",
   verify account created (no error), proceed to checkout

**Scenarios: `tests/e2e/shop.spec.ts`**
Same three scenarios but for the `/shop` route (future — currently routes to `/kiosk/shop`;
update if ST-2 adds a dedicated route). `POST /api/shop/session` stubbed to `201 { token }`.

**BDD format** (each `test()` has JSDoc `Given / When / Then` block; see existing
`pos-terminal.spec.ts` for style convention):

```ts
/**
 * Given the kiosk is running and a product is in the catalogue
 * When an anonymous customer adds a product and completes cash payment
 * Then the receipt is shown and the cart is cleared
 */
test('anonymous checkout shows receipt', async ({ page }) => { ... });
```

**Expected Outcomes**
- `tests/e2e/kiosk.spec.ts` — 3 passing tests, all remote calls stubbed
- `tests/e2e/shop.spec.ts` — 3 passing tests, `POST /api/shop/session` stubbed
- `scripts/affected-e2e.mjs` `FEATURE_MAP` updated with kiosk and shop entries
- Tests pass in `CI=true npx playwright test` (chromium only on CI)

**Todo List**
1. Create `tests/e2e/helpers/kiosk.ts` — `KioskPage` Page Object + `seedKioskDexie(page)` helper
   (seeds device token + one product into IndexedDB before navigation)
2. Create `tests/e2e/kiosk.spec.ts` — 3 BDD-documented tests using `KioskPage`
3. Create `tests/e2e/shop.spec.ts` — 3 BDD-documented tests; stub `/api/shop/session`
4. Update `scripts/affected-e2e.mjs` FEATURE_MAP:
   - `{ re: /^src\/app\/features\/kiosk\//, specs: ['kiosk.spec.ts'] }`
   - `{ re: /^src\/app\/features\/shop\//, specs: ['shop.spec.ts'] }`
5. Ensure `data-testid="kiosk-checkout-error"` from FIX-A is used in error scenario test

**Relevant Context**
- `tests/e2e/helpers/auth.ts` — `stubLiveSyncEndpoints`, `loginAsAdmin` patterns to follow
- `tests/e2e/pos-terminal.spec.ts` — Page Object Model + BDD comment convention
- `data-testid` anchors: `kiosk-shop`, `kiosk-product-grid`, `kiosk-pay-now`,
  `kiosk-receipt-wrapper`, `kiosk-auth-email`, `kiosk-sign-in-submit`, `kiosk-create-account`
- `scripts/affected-e2e.mjs:95–132` — existing `FEATURE_MAP`

**Status** — [x] done

---

## Sub-Tasks (original plan — ST-1 to ST-7)

---

### ST-1 — Add two new endpoints to `pos-api`

**Intent**
Three additions to the existing route table:
1. `POST /api/shop/session` — open, rate-limited, returns a short-lived shop JWT
2. `POST /api/kiosk-device-token` — staff JWT required, returns a long-lived device JWT
3. `POST /api/transactions` — accepts either JWT type, writes full basket to Cloudant

**Expected Outcomes**
- `POST /api/shop/session { storeId }` with no auth → `201 { token, expiresAt }`
- `POST /api/kiosk-device-token { terminalId }` with staff JWT → `201 { token }`
- `POST /api/transactions` with valid device OR session JWT → `201 { transaction }`
- Invalid/expired token → `401`; missing fields → `400`
- All existing routes unchanged
- New test cases in `api.test.mjs` for all three endpoints

**Todo List**
1. Add `KioskTransactionDocument` to `api.ts` replacing per-product `TransactionDocument`
   for kiosk/shop writes:
   ```ts
   { id, items[], subtotal, taxAmount, total, paymentMethod, terminalId,
     customerId?, customerEmail?, timestamp, operatorId, tenantId, type: 'kiosk-sale' }
   ```
2. Add `POST /api/shop/session` handler:
   - No bearer token required (outside `authorize()`)
   - Validate `storeId` exists (look up in deps or accept any non-empty string — simpler)
   - Sign `{ sub: storeId, type: 'shop-session', tenantId: storeId, exp: now + 3600 }`
     with `deps.secret`
   - Return `201 { token, expiresAt }`
   - Add simple IP-based rate limit counter in memory (max 20 sessions/IP/hour)
3. Add `POST /api/kiosk-device-token` handler:
   - Require staff JWT with `MANAGE_INVENTORY` permission (goes through `authorize()`)
   - Sign `{ sub: terminalId, type: 'kiosk-device', tenantId, exp: now + 365d }`
   - Return `201 { token }`
4. Add `POST /api/transactions` handler:
   - Extract `Authorization: Bearer <token>`
   - Verify HS256; check `payload.type === 'kiosk-device' || 'shop-session'`
   - On failure → `401`
   - Validate body; on missing fields → `400`
   - Write `KioskTransactionDocument` to `deps.transactions.create(doc)` with
     `operatorId: payload.sub`, `tenantId: payload.tenantId`
   - Return `201 { transaction }`
5. Add all four new kinds to `Route` union and `matchRoute()`
6. Update `health` response to list new routes
7. Tests in `api.test.mjs`: session creation, device token creation, transaction
   creation with each token type, expired token, wrong type, anonymous body, customer body

**Relevant Context**
- `infra/pos-api/src/api.ts` — full route table pattern
- `infra/pos-api/src/session-auth.ts` — HS256 signing/verifying helpers already exist
- `infra/pos-api/src/server.ts` — `ApiDeps` injection

**Status** — [x] done

---

### ST-2 — New `/shop` route + `ShopComponent` (customer phone flow)

**Intent**
Add a new Angular route `/shop` (no params — store resolved at runtime) dedicated to
the customer-phone scan-and-go flow. On load it resolves the store from geofence /
fallback, calls `POST /api/shop/session` to get a session token, then presents the
shopping experience. No QR scanning, no URL parameter, no device setup.

The existing `/kiosk` route is **unchanged**.

**Store resolution sequence** (mirrors the kiosk splash logic already built):
1. Call `KioskSettingsService.load()` to read Dexie settings
2. If `stores().length === 1` → use `storeId()` directly, skip fence check
3. If `stores().length > 1` and `hasFencePolygon()` → run `GeofencingService.checkFence()`
   - `inside` → `storeId()` is the resolved store
   - `outside` / `error` → show store picker (`stores()` list, same as kiosk splash)
4. If no settings / `stores().length === 0` → use `"default-org/default-store"`
   (the always-present fallback from `KioskSettingsService`)

After store is resolved, call `POST /api/shop/session { storeId }` → store token in
`sessionStorage` → render the shopping UI.

**Expected Outcomes**
- New route `/shop` loads `ShopComponent` (no auth guard — public)
- Store resolved automatically; store picker shown only when needed
- Token stored in `sessionStorage['shop-session-token']` — ephemeral
- On network failure at session creation: error screen with retry, no shopping
- Shopping UI: same products, cart, checkout, receipt as kiosk — reuses
  `CartService`, `ProductService`, `CheckoutComponent`, `ReceiptComponent`
- `KioskCustomerService` works identically — customer optionally signs in with email
- Existing `/kiosk` and `KioskSplashComponent` untouched

**Todo List**
1. Add `/shop` (no params) to `app.routes.ts` pointing to new `ShopComponent`
   (no `canActivate` — public route)
2. Create `src/app/features/shop/shop.component.ts`:
   - On init: call `kioskSettings.load()`, resolve store using the sequence above
   - If store picker needed: show inline picker (reuse the same template pattern
     from `kiosk-splash.component.ts` lines 122–147)
   - After store resolved: call `POST /api/shop/session { storeId }`
   - On success: store token in `sessionStorage`, switch to shopping view
   - On network failure: show error state with retry button
   - Shopping view: inline (same component, toggle signal) or navigate to `/shop/browse`
3. The shopping view within `ShopComponent` mirrors `KioskShopComponent`:
   - Same product grid, cart, scanner, checkout flow
   - Reads session token from `sessionStorage` instead of `KioskSettingsService.deviceToken()`
   - Passes token to `TransactionRemoteService` (ST-3) at checkout

**Relevant Context**
- `src/app/app.routes.ts` — kiosk routes as pattern
- `src/app/features/kiosk/kiosk-splash.component.ts:387` — `showStorePicker` computed,
  store picker template (lines 122–147)
- `src/app/core/application/services/kiosk-settings.service.ts` — `stores()`,
  `storeId()`, `hasFencePolygon()`, `load()`
- `src/app/core/application/services/geofencing.service.ts` — `checkFence()`
- `src/app/features/kiosk/kiosk-shop.component.ts` — shopping UI to mirror

**Status** — [ ] pending

---

### ST-3 — `TransactionRemoteService`: remote-first write for both flows

**Intent**
A single service handles the `POST /api/transactions` call for both the physical
kiosk (device token from Dexie) and the customer phone (session token from
`sessionStorage`). `PosFacade.checkout()` calls it synchronously before clearing the
cart. If it throws, checkout rejects and the cart is preserved.

`customerId` is optional — anonymous and signed-in customers are identical at this layer.

**Expected Outcomes**
- `persistTransaction(paymentResult, token, customerId?)`:
  - Builds body from `paymentResult` + `cartService.items()`
  - POSTs with `Authorization: Bearer <token>`
  - On non-2xx or network error → throws `RemoteTransactionFailedError`
- `PosFacade.checkout()` awaits this before `adjustStock`; throws → cart preserved
- `KioskShopComponent` and `ShopBrowseComponent` both handle `RemoteTransactionFailedError`:
  show retry UI, do NOT show fallback receipt
- POS terminal path: `isKiosk()` is false → service is a no-op
- `PaymentResult` gains optional `customerId?: string` for Dexie attribution

**Todo List**
1. Create `src/app/core/application/services/transaction-remote.service.ts`:
   - Method `persistTransaction(paymentResult, token, customerId?)`
   - Builds and POSTs body; throws `RemoteTransactionFailedError` on failure
   - Export `RemoteTransactionFailedError`
2. Inject into `PosFacade`; call in `checkout()` before `adjustStock`:
   - Token is passed in as a parameter from the calling component (kiosk reads from
     `KioskSettingsService.deviceToken()`; shop reads from `sessionStorage`)
   - If no token and `isKiosk()` false (POS) → skip (no-op)
   - If no token and kiosk/shop → throw `RemoteTransactionFailedError`
3. Add `customerId?: string` to `PaymentResult`
4. `KioskShopComponent.handlePaymentComplete()`:
   - Set `result.customerId` from `kioskCustomer.customer()?.id`
   - Pass device token from `kioskSettings.deviceToken()` to `posFacade.checkout()`
   - On `RemoteTransactionFailedError`: show retry UI, preserve cart
5. `ShopBrowseComponent.handlePaymentComplete()`:
   - Same pattern but reads token from `sessionStorage`

**Relevant Context**
- `PosFacade.checkout()`: `src/app/core/application/facades/pos.facade.ts:282`
- `KioskShopComponent.handlePaymentComplete()`: `kiosk-shop.component.ts:988`
- `PaymentResult`: `checkout.component.ts:24`

**Status** — [ ] pending

---

### ST-4 — Kiosk physical terminal: device token generation in Settings

**Intent**
For Flow A (physical kiosk), staff generate a device token once in Settings → Kiosk &
Terminal. The token is persisted to Dexie settings and exposed via
`KioskSettingsService.deviceToken()`. If absent, checkout is blocked with a clear message.

**Expected Outcomes**
- `POST /api/kiosk-device-token` callable from Settings UI (staff JWT auto-attached)
- Token saved to Dexie `settings` table under key `terminal-device-token:<terminalId>`
- `KioskSettingsService.deviceToken()` signal returns it
- `KioskShopComponent.openCheckout()` blocks if `deviceToken()` is empty

**Todo List**
1. Add `deviceToken?: string` to `TerminalRecord` or as a standalone `settings` row
2. Add `readonly deviceToken = computed(...)` to `KioskSettingsService`
3. Add "Generate Device Token" button to Settings → Kiosk & Terminal section
4. On click: call `POST /api/kiosk-device-token` with current `terminalId`, save token
5. Guard in `KioskShopComponent.openCheckout()`: block + show inline message if empty

**Relevant Context**
- `KioskSettingsService`: `src/app/core/application/services/kiosk-settings.service.ts`
- `settings.component.ts`: kiosk terminal section
- `kiosk-shop.component.ts:963`

**Status** — [ ] pending

---

### ST-5 — Attach kiosk customer to `PosFacade` + session cleanup

**Intent**
`KioskCustomerService` is injected in the shop but never fed to `PosFacade`.
Loyalty points are never awarded. Wire attachment around checkout for both
`KioskShopComponent` and `ShopBrowseComponent`. Anonymous sessions unchanged.

**Todo List**
1. `openCheckout()` in both components: if `kioskCustomer.customer()` non-null,
   call `posFacade.attachCustomerDirectly(customer)` after geofence/token checks
2. `closeCheckout()`: call `posFacade.detachCustomer()`
3. After payment `.then()`: call `kioskCustomer.clear()`
4. `executeBack()` / idle reset: call `posFacade.detachCustomer()` + `kioskCustomer.clear()`

**Relevant Context**
- `PosFacade.attachCustomerDirectly()`: already added to `pos.facade.ts`
- `KioskCustomerService`: `kiosk-customer.service.ts`

**Status** — [ ] pending

---

### ST-6 — Playwright e2e: three scenarios per flow (six total)

**Intent**
Two separate spec files:
- `tests/e2e/kiosk.spec.ts` — physical terminal flow (device token seeded in Dexie)
- `tests/e2e/shop.spec.ts` — customer phone flow (session token stubbed from POST /api/shop/session)

Three scenarios each: anonymous, existing customer sign-in, new account creation.
All remote `POST /api/transactions` calls stubbed to 201. `affected-e2e.mjs` updated.

**Todo List**
1. Add missing `data-testid` anchors to kiosk and shop templates
2. Create `tests/e2e/kiosk.spec.ts` (device token pre-seeded via `page.evaluate`
   into Dexie before navigation)
3. Create `tests/e2e/shop.spec.ts` (stub `POST /api/shop/session → 201 { token }`)
4. Add to `FEATURE_MAP`:
   - `{ re: /^src\/app\/features\/kiosk\//, specs: ['kiosk.spec.ts'] }`
   - `{ re: /^src\/app\/features\/shop\//, specs: ['shop.spec.ts'] }`

**Relevant Context**
- `tests/e2e/helpers/auth.ts`, `tests/e2e/pos-terminal.spec.ts`
- `data-testid="kiosk-receipt-wrapper"`: `kiosk-shop.component.ts:637`

**Status** — [x] done

---

### ST-7 — Demote sync worker stock-push log in kiosk/shop context

**Intent**
`refuseUnauthorizedPush` fires `console.warn` when kiosk stock decrements can't
be pushed (no staff JWT). This is correct behaviour at the wrong log level. Add
`kioskMode` to `SyncWorkerConfig` and a `SyncKioskModeService` watching the router.

**Todo List**
1. Add `kioskMode?: boolean` to `SyncWorkerConfig`; default `false`
2. Branch in `refuseUnauthorizedPush` on `config.kioskMode` → `console.info`
3. Create `SyncKioskModeService`: watch `NavigationEnd`, set flag for `/kiosk` and
   `/shop` routes
4. Register in `app.config.ts`

**Relevant Context**
- `sync.types.ts:92`, `sync.worker.ts:293`, `sync-session-credential.service.ts`

**Status** — [x] done
