import { Page } from '@playwright/test';
import { SignJWT } from 'jose';

/**
 * stubLiveSyncEndpoints
 *
 * Hermetic-isolation guard for e2e. The dev build (served by `npm run start`
 * for Playwright) has `apiUrl` pointed at the LIVE AWS API, and the app is
 * offline-first: on boot it seeds local Dexie fixtures AND syncs the remote
 * catalogue. When the remote is reachable, live products (e.g. `prod-007`
 * "Latte") merge alongside the local seed (`id: '4'` "Latte"), producing
 * duplicates that break product-by-name selectors with a strict-mode violation
 * — and making the suite depend on live, drifting shared data.
 *
 * Stub the read/pull endpoints with empty payloads so sync is a no-op and the
 * app relies solely on the deterministic local Dexie seed the tests target.
 * Only GET is intercepted; mutations pass through unchanged. Must be registered
 * before the first navigation, hence it runs at the top of loginAsAdmin().
 */
export async function stubLiveSyncEndpoints(page: Page): Promise<void> {
  await page.route(
    (url) => url.pathname.endsWith('/api/products'),
    (route) =>
      route.request().method() === 'GET'
        ? route.fulfill({
            status: 200,
            contentType: 'application/json',
            body: JSON.stringify({ products: [], count: 0 }),
          })
        : route.continue(),
  );

  await page.route(
    (url) => url.pathname.endsWith('/api/transactions'),
    (route) =>
      route.request().method() === 'GET'
        ? route.fulfill({
            status: 200,
            contentType: 'application/json',
            body: JSON.stringify({ transactions: [], count: 0 }),
          })
        : route.continue(),
  );
}

/**
 * ADMIN_PERMISSIONS
 *
 * The canonical admin permission set — mirrors permission.constants.ts exactly.
 * Hard-coded here so the E2E helper has no Angular import graph dependency and
 * remains runnable in a plain Node/Playwright context. Must stay in sync with
 * ADMIN_PERMISSIONS in src/app/core/domain/auth/permission.constants.ts.
 */
const ADMIN_PERMISSIONS = [
  // Operator tier
  'sale:process',
  'sale:view_transactions',
  'inventory:view',
  'customer:view',
  'kiosk:use',
  // Manager tier
  'sale:discount',
  'sale:refund',
  'inventory:manage',
  'inventory:adjust-stock',
  'customer:manage',
  'report:view',
  'report:export',
  'kiosk:manage',
  // Admin tier
  'inventory:delete',
  'admin:manage_operators',
  'admin:manage_roles',
  'admin:settings',
];

/** Mirrors DEFAULT_TENANT_ID from dexie-database.service.ts. */
const DEFAULT_TENANT_ID = 'default-tenant';

/**
 * The local JWT secret used by SessionIssuer / LocalCredentialAuthAdapter.
 * Matches `getJwtSecret()` in session-issuer.ts. Not a production secret —
 * it exists only for the offline-first local-credential adapter used in dev/test.
 */
const LOCAL_JWT_SECRET = new TextEncoder().encode(
  'capy-pos-local-jwt-secret-change-in-production',
);

/**
 * buildAdminToken
 *
 * Mint a valid HS256 session JWT for the seeded admin operator without touching
 * the UI or any external service. The token is structurally identical to one
 * produced by SessionIssuer.issueFor() for `operator-admin-default`.
 *
 * Called by loginAsAdmin() and exported for tests that need direct token access.
 */
export async function buildAdminToken(): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  const exp = now + 8 * 60 * 60; // 8-hour TTL matches SESSION_TTL_SECONDS

  const membership = {
    tenantId: DEFAULT_TENANT_ID,
    role: 'admin',
    permissions: ADMIN_PERMISSIONS,
    level: 3,
  };

  return new SignJWT({
    sub: 'operator-admin-default',
    tenantId: DEFAULT_TENANT_ID,
    roles: ['admin'],
    permissions: ADMIN_PERMISSIONS,
    memberships: [membership],
  })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt(now)
    .setExpirationTime(exp)
    .sign(LOCAL_JWT_SECRET);
}

/**
 * loginAsAdmin
 *
 * Authenticates the E2E browser context as the seeded admin operator by
 * injecting a pre-signed HS256 JWT directly into sessionStorage — no UI form,
 * no external relay, no network dependency.
 *
 * Why injection instead of the login form:
 *   The dev/CI build may be configured with `appId.enabled: true` pointing at a
 *   local relay that isn't running. Even when it's false, the form-based path
 *   adds ~2-3 s of Angular boot + DOM interaction on every beforeEach. The
 *   injection path is ~50 ms and works regardless of which AuthGateway is wired.
 *
 * How it works:
 *  1. Register sync-endpoint stubs BEFORE any navigation (prevents live-data
 *     contamination, same as before).
 *  2. Navigate to / once so the Angular app boots and Dexie runs seedRbacDefaults().
 *     The app will redirect to /login because there's no token yet — that's fine,
 *     we wait only for the redirect to settle (networkidle), not for the form.
 *  3. Inject the pre-signed token into sessionStorage via page.evaluate().
 *  4. Navigate to / again — this time CurrentUserService.hydrate() finds the token,
 *     verifies it (HS256, same secret), builds the session, and the auth guard
 *     passes through to the protected route.
 *  5. Wait for the app navigation component to confirm we're on a protected route.
 *
 * The JWT is identical in structure to one produced by SessionIssuer.issueFor()
 * for `operator-admin-default`: same claims, same algorithm, same secret.
 * See buildAdminToken() for the payload.
 *
 * Playwright storageState does NOT persist sessionStorage; therefore this helper
 * must be called once per test (in beforeEach).
 */
export async function loginAsAdmin(page: Page): Promise<void> {
  // Step 0: Isolate from the live AWS API before any navigation triggers sync.
  // Also stub /api/shop/session: the root '/' route redirects to /shop, which
  // calls acquireSession() on boot. Without the stub it hits the live API (or a
  // local server that isn't running) and can return 429 / connection refused,
  // showing an error screen instead of the POS terminal.
  await stubLiveSyncEndpoints(page);
  await page.route(
    (url) => url.pathname.endsWith('/api/shop/session'),
    (route) =>
      route.fulfill({
        status: 201,
        contentType: 'application/json',
        body: JSON.stringify({
          token: 'e2e-shop-session-token',
          expiresAt: new Date(Date.now() + 3_600_000).toISOString(),
        }),
      }),
  );

  // Step 1: Boot the app so Dexie runs seedRbacDefaults() (APP_INITIALIZER).
  // Navigate to /login directly — this avoids the root '/' → /shop redirect
  // that would trigger acquireSession() before the token is injected.
  await page.goto('/login');
  await page.waitForLoadState('networkidle', { timeout: 20000 });

  // Step 2: Mint and inject the admin token directly into sessionStorage.
  const token = await buildAdminToken();
  await page.evaluate(
    ([key, value]) => sessionStorage.setItem(key, value),
    ['capy_pos_access_token', token],
  );

  // Step 3: Navigate to /pos — the auth guard finds the valid token and lets
  // through. Going to /pos (not '/') avoids the '/' → /shop redirect which
  // would trigger ShopComponent.acquireSession() again.
  await page.goto('/pos');
  await page.waitForURL((url) => !url.pathname.startsWith('/login'), { timeout: 15000 });

  // Step 4: Confirm the Angular router has settled on a protected route by
  // waiting for the navigation component (desktop or mobile variant).
  await Promise.race([
    page
      .locator('[data-testid="navigation-desktop"]')
      .waitFor({ state: 'visible', timeout: 15000 })
      .catch(() => null),
    page
      .locator('[data-testid="navigation"]')
      .waitFor({ state: 'visible', timeout: 15000 })
      .catch(() => null),
  ]);
}
