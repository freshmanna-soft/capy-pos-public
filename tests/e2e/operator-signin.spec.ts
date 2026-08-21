import { test, expect, Page, CDPSession } from '@playwright/test';
import { loginAsAdmin } from './helpers/auth';

/**
 * Quick operator sign-in, end to end.
 *
 * The passkey half of this cannot be unit tested honestly. Every layer below has
 * its own specs — the codec against RFC vectors, the verifier against real
 * signatures, the adapter against a fake `navigator.credentials` — but none of them
 * prove that a *browser* will produce a ceremony this app accepts. Chrome's
 * WebAuthn virtual authenticator does: it is the real WebAuthn implementation
 * driving real key generation, with only the hardware replaced.
 *
 * Chromium-only, because the virtual authenticator is a CDP feature. That is a
 * genuine coverage gap for Firefox and WebKit rather than a thing to pretend about:
 * the PIN suite below runs everywhere precisely because it is the path a browser
 * without this support falls back to.
 */

/**
 * A platform authenticator with a fingerprint reader that always says yes.
 *
 * `transport: 'internal'` plus `hasUserVerification` is what makes
 * `isUserVerifyingPlatformAuthenticatorAvailable()` resolve true, which is what the
 * app checks before offering the button at all. `hasResidentKey` is required
 * because enrollment asks for a discoverable credential.
 */
async function attachVirtualAuthenticator(page: Page): Promise<CDPSession> {
  const client = await page.context().newCDPSession(page);
  await client.send('WebAuthn.enable', { enableUI: false });
  await client.send('WebAuthn.addVirtualAuthenticator', {
    options: {
      protocol: 'ctap2',
      transport: 'internal',
      hasResidentKey: true,
      hasUserVerification: true,
      isUserVerified: true,
      automaticPresenceSimulation: true,
    },
  });
  return client;
}

/** End the session the way closing a tab would: the JWT lives in sessionStorage. */
async function signOut(page: Page): Promise<void> {
  await page.evaluate(() => sessionStorage.clear());
}

/** Read the stored credential rows straight out of IndexedDB. */
async function readStoredCredentials(page: Page): Promise<Record<string, unknown>[]> {
  return page.evaluate(
    () =>
      new Promise<Record<string, unknown>[]>((resolve, reject) => {
        const request = indexedDB.open('CapyPOSDB');
        request.onerror = () => reject(request.error);
        request.onsuccess = () => {
          const db = request.result;
          if (!db.objectStoreNames.contains('operatorCredentials')) {
            resolve([]);
            return;
          }
          const all = db
            .transaction('operatorCredentials', 'readonly')
            .objectStore('operatorCredentials')
            .getAll();
          all.onerror = () => reject(all.error);
          all.onsuccess = () => resolve(all.result as Record<string, unknown>[]);
        };
      })
  );
}

test.describe('Operator sign-in with a passkey', () => {
  test.skip(
    ({ browserName }) => browserName !== 'chromium',
    'The WebAuthn virtual authenticator is a Chromium CDP feature'
  );

  test('enrolls on this device, then signs in with one gesture', async ({ page }) => {
    // The authenticator must exist before the page probes for one, or Settings will
    // correctly report that this device has no reader.
    await loginAsAdmin(page);
    await attachVirtualAuthenticator(page);

    await page.goto('/settings');
    await expect(page.locator('[data-testid="signin-settings"]')).toBeVisible({ timeout: 15000 });

    // --- Enroll -------------------------------------------------------------
    await page.fill('[data-testid="input-passkey-label"]', 'Counter till');
    await page.click('[data-testid="btn-add-passkey"]');

    await expect(page.locator('[data-testid="signin-success"]')).toBeVisible({ timeout: 15000 });
    await expect(page.locator('[data-testid="passkey-list"]')).toContainText('Counter till');

    // --- What actually got stored -------------------------------------------
    const stored = await readStoredCredentials(page);
    expect(stored).toHaveLength(1);
    const jwk = JSON.parse(stored[0]['publicKeyJwk'] as string) as Record<string, unknown>;
    // A public key has coordinates; a private one would also have `d`. Nothing here
    // is biometric, and this assertion is the end-to-end proof of that claim.
    expect(jwk['kty']).toBe('EC');
    expect(jwk['d']).toBeUndefined();
    expect(JSON.stringify(stored[0])).not.toMatch(/fingerprint|biometric|template/i);

    // --- Sign out, then back in with the passkey -----------------------------
    await signOut(page);
    await page.goto('/login');

    const passkeyButton = page.locator('[data-testid="btn-passkey"]');
    await expect(passkeyButton).toBeVisible({ timeout: 15000 });

    await passkeyButton.click();

    // Off /login is the only proof that matters: a session was really issued.
    await page.waitForURL((url) => !url.pathname.startsWith('/login'), { timeout: 15000 });
    const token = await page.evaluate(() => sessionStorage.getItem('capy_pos_access_token'));
    expect(token?.split('.')).toHaveLength(3);
  });

  test('does not offer a passkey on a device with nothing enrolled', async ({ page }) => {
    await loginAsAdmin(page);
    await attachVirtualAuthenticator(page);

    await signOut(page);
    await page.goto('/login');

    // The device can do passkeys, but this till has no credential to offer, so the
    // button must be absent rather than opening an empty OS picker.
    await expect(page.locator('[data-testid="input-email"]')).toBeVisible({ timeout: 15000 });
    await expect(page.locator('[data-testid="btn-passkey"]')).toHaveCount(0);
  });

  test('a revoked passkey stops working', async ({ page }) => {
    await loginAsAdmin(page);
    await attachVirtualAuthenticator(page);

    await page.goto('/settings');
    await page.fill('[data-testid="input-passkey-label"]', 'Counter till');
    await page.click('[data-testid="btn-add-passkey"]');
    await expect(page.locator('[data-testid="passkey-list"]')).toContainText('Counter till');

    await page.click('[data-testid="btn-remove-passkey"]');
    await expect(page.locator('[data-testid="signin-success"]')).toContainText('no longer accept');
    expect(await readStoredCredentials(page)).toHaveLength(0);

    await signOut(page);
    await page.goto('/login');

    await expect(page.locator('[data-testid="input-email"]')).toBeVisible({ timeout: 15000 });
    await expect(page.locator('[data-testid="btn-passkey"]')).toHaveCount(0);
  });
});

/**
 * The PIN fallback.
 *
 * Runs on every browser, which is the point of it existing: this is the path a till
 * takes when the device has no reader, or the browser has no WebAuthn.
 */
test.describe('Operator sign-in with a PIN', () => {
  test('sets a PIN in settings, then signs in on the keypad', async ({ page }) => {
    await loginAsAdmin(page);

    await page.goto('/settings');
    await expect(page.locator('[data-testid="signin-settings"]')).toBeVisible({ timeout: 15000 });

    await page.fill('[data-testid="input-new-pin"]', '4917');
    await page.click('[data-testid="btn-save-pin"]');
    await expect(page.locator('[data-testid="signin-success"]')).toContainText('PIN saved');

    await signOut(page);
    await page.goto('/login');

    await page.click('[data-testid="btn-use-pin"]');
    await expect(page.locator('[data-testid="pin-pad"]')).toBeVisible();

    for (const digit of '4917') {
      await page.click(`[data-testid="key-${digit}"]`);
    }
    await page.click('[data-testid="btn-pin-submit"]');

    await page.waitForURL((url) => !url.pathname.startsWith('/login'), { timeout: 15000 });
  });

  test('refuses a guessable PIN, and says which rule was broken', async ({ page }) => {
    await loginAsAdmin(page);
    await page.goto('/settings');
    await expect(page.locator('[data-testid="signin-settings"]')).toBeVisible({ timeout: 15000 });

    await page.fill('[data-testid="input-new-pin"]', '1234');
    await page.click('[data-testid="btn-save-pin"]');

    await expect(page.locator('[data-testid="signin-error"]')).toContainText('too easy to guess');
  });

  test('rejects the wrong PIN and clears the pad', async ({ page }) => {
    await loginAsAdmin(page);
    await page.goto('/settings');
    await page.fill('[data-testid="input-new-pin"]', '4917');
    await page.click('[data-testid="btn-save-pin"]');
    await expect(page.locator('[data-testid="signin-success"]')).toContainText('PIN saved');

    await signOut(page);
    await page.goto('/login');
    await page.click('[data-testid="btn-use-pin"]');

    for (const digit of '8888') {
      await page.click(`[data-testid="key-${digit}"]`);
    }
    await page.click('[data-testid="btn-pin-submit"]');

    await expect(page.locator('[data-testid="auth-error"]')).toContainText('not right');
    // Still on the login page, and the entry is cleared rather than left to be
    // guessed onward from.
    await expect(page).toHaveURL(/\/login/);
    await expect(page.locator('[data-testid="pin-display"] .pin-dot--filled')).toHaveCount(0);
  });
});
