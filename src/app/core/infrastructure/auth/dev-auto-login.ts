import { DexieDatabase } from '@core/infrastructure/database/dexie-database.service';
import { AuthSessionDto } from '@core/application/auth/dtos/auth-session.dto';
import { SessionIssuer } from './session-issuer';

/** The bootstrap operator created by `initializeWithSeedData` when `allowSeededAdmin` is on. */
const SEEDED_ADMIN_ID = 'operator-admin-default';

const LOCAL_HOSTNAMES = new Set(['localhost', '127.0.0.1', '[::1]']);

export interface DevAutoLoginContext {
  production: boolean;
  allowSeededAdmin: boolean;
  hostname: string;
  /** `navigator.webdriver` — true under Playwright/Selenium, which must see the real login screen. */
  automated: boolean;
}

/**
 * Whether this boot may skip the login screen.
 *
 * Every condition must hold: a non-production build, the seeded-admin bootstrap
 * enabled, a loopback hostname, and no browser automation. The hostname check
 * means a dev build deployed anywhere reachable never auto-signs-in.
 */
export function shouldDevAutoLogin(ctx: DevAutoLoginContext): boolean {
  return (
    !ctx.production && ctx.allowSeededAdmin && LOCAL_HOSTNAMES.has(ctx.hostname) && !ctx.automated
  );
}

/**
 * Mint a session for the seeded admin so local development lands straight in the app.
 * Returns null when the seeded operator is missing or inactive.
 */
export async function issueDevSession(
  db: DexieDatabase,
  issuer: SessionIssuer
): Promise<AuthSessionDto | null> {
  const operator = await db.operators.get(SEEDED_ADMIN_ID);
  if (!operator?.isActive) {
    return null;
  }
  return issuer.issueFor(operator);
}
