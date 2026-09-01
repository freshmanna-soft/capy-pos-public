/**
 * Turning a typed secret into something storable, and checking one against it.
 *
 * One module for the whole codebase, shared by the password path and the till
 * PIN. The alternative — a second PBKDF2 implementation for PINs — is how a
 * codebase ends up with two iteration counts and only one of them audited.
 *
 * WebCrypto only, so it runs in the browser with no dependency and no WASM.
 */

import { DEFAULT_ADMIN_PASSWORD_HASH } from '@core/infrastructure/database/dexie-database.service';

/**
 * PBKDF2 iterations for newly hashed secrets.
 *
 * 100 000 is the OWASP floor for PBKDF2-SHA256 and costs a few tens of
 * milliseconds here — unnoticeable on a login, and deliberately not tuned down
 * for the PIN keypad. A PIN has far less entropy than a password, which makes
 * the work factor the *only* thing standing between a stolen hash and a
 * complete four-digit search.
 */
const DEFAULT_ITERATIONS = 100_000;

/**
 * Hash a secret for storage.
 *
 * Format: `pbkdf2:<iterations>:<hex-salt>:<hex-derived-key>`. Self-describing on
 * purpose — the iteration count travels with the hash, so raising
 * {@link DEFAULT_ITERATIONS} later does not invalidate everything already stored.
 */
export async function hashSecret(plaintext: string): Promise<string> {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const derived = await pbkdf2(plaintext, salt, DEFAULT_ITERATIONS);
  return `pbkdf2:${DEFAULT_ITERATIONS}:${toHex(salt)}:${toHex(derived)}`;
}

/**
 * Check a typed secret against a stored hash.
 *
 * Returns false rather than throwing for a hash it cannot parse: an unreadable
 * stored value must fail closed, and a thrown error on a malformed record would
 * leak the difference between "wrong password" and "corrupt row" to whoever is
 * typing.
 */
export async function compareSecret(plaintext: string, storedHash: string): Promise<boolean> {
  if (storedHash.startsWith('$2b$') || storedHash.startsWith('$2a$')) {
    return compareSeededBcrypt(plaintext, storedHash);
  }

  if (!storedHash.startsWith('pbkdf2:')) {
    return false;
  }

  const parts = storedHash.split(':');
  if (parts.length !== 4) {
    return false;
  }
  const iterations = Number.parseInt(parts[1], 10);
  if (!Number.isInteger(iterations) || iterations <= 0) {
    return false;
  }

  const derived = await pbkdf2(plaintext, fromHex(parts[2]), iterations);
  return timingSafeEqual(toHex(derived), parts[3]);
}

/**
 * The one bcrypt hash this app can check: the seeded dev/test admin account.
 *
 * bcrypt is not available in WebCrypto, so a real comparison is impossible here
 * without shipping a WASM implementation. `dexie-database.service.ts` gates
 * creating this account on `!environment.production`, so this branch is only
 * ever reachable in a dev or test build — a real pilot install has no such
 * row to compare against in the first place. Its hash and plaintext are both
 * public knowledge in this repo, which is exactly why it must never exist
 * outside dev/test. Every account created through the UI is PBKDF2 and takes
 * the branch above.
 *
 * Any *other* bcrypt hash is rejected outright rather than guessed at.
 */
function compareSeededBcrypt(plaintext: string, storedHash: string): boolean {
  const SEED_PLAIN = 'admin1234';
  return storedHash === DEFAULT_ADMIN_PASSWORD_HASH && plaintext === SEED_PLAIN;
}

async function pbkdf2(secret: string, salt: Uint8Array, iterations: number): Promise<Uint8Array> {
  const keyMaterial = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    'PBKDF2',
    false,
    ['deriveBits']
  );
  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', hash: 'SHA-256', salt: salt as Uint8Array<ArrayBuffer>, iterations },
    keyMaterial,
    256
  );
  return new Uint8Array(bits);
}

function toHex(bytes: Uint8Array): string {
  return Array.from(bytes)
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');
}

function fromHex(hex: string): Uint8Array {
  const bytes = new Uint8Array(Math.floor(hex.length / 2));
  for (let i = 0; i < bytes.length; i++) {
    bytes[i] = Number.parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  }
  return bytes;
}

/**
 * Constant-time comparison, to keep the check from reporting *how much* of a
 * secret was right through how long it took to say no.
 */
function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) {
    return false;
  }
  let diff = 0;
  for (let i = 0; i < a.length; i++) {
    diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return diff === 0;
}
