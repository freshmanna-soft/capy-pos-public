import { Injectable, inject } from '@angular/core';
import { SignJWT, jwtVerify, decodeJwt } from 'jose';
import { DexieDatabase } from '@core/infrastructure/database/dexie-database.service';
import { AuthGateway } from '@core/application/auth/ports/auth-gateway.port';
import { CredentialsDto } from '@core/application/auth/dtos/credentials.dto';
import { AuthSessionDto } from '@core/application/auth/dtos/auth-session.dto';

/**
 * Token storage abstraction
 *
 * Stores the JWT in sessionStorage so it survives page refreshes within a tab
 * but is discarded when the browser tab closes.
 *
 * Production hardening note (Story 5 concern):
 *   - Replace with httpOnly cookie + CSRF-token pattern when deploying behind a
 *     real backend (Cognito/API Gateway). The current sessionStorage approach is
 *     acceptable for an offline-first POS kiosk scenario where XSS surface is
 *     minimal, but should NOT be used for a public web SPA.
 */
const TOKEN_STORAGE_KEY = 'capy_pos_access_token';

function storeToken(token: string): void {
  try {
    sessionStorage.setItem(TOKEN_STORAGE_KEY, token);
  } catch {
    // sessionStorage unavailable (e.g. private mode with storage blocked) — continue
  }
}

function readToken(): string | null {
  try {
    return sessionStorage.getItem(TOKEN_STORAGE_KEY);
  } catch {
    return null;
  }
}

function clearToken(): void {
  try {
    sessionStorage.removeItem(TOKEN_STORAGE_KEY);
  } catch {
    // ignore
  }
}

// ---------------------------------------------------------------------------
// JWT helpers
// ---------------------------------------------------------------------------

/** 8-hour session TTL */
const SESSION_TTL_SECONDS = 8 * 60 * 60;

/** HMAC-SHA256 secret — derived from a fixed key for local-only use.
 *  Story 5: replace with a securely generated secret stored in environment config. */
function getJwtSecret(): Uint8Array {
  const secret = 'capy-pos-local-jwt-secret-change-in-production';
  return new TextEncoder().encode(secret);
}

// ---------------------------------------------------------------------------
// Domain errors
// ---------------------------------------------------------------------------

export class InvalidCredentialsError extends Error {
  constructor() {
    super('Invalid email or password');
    this.name = 'InvalidCredentialsError';
  }
}

// ---------------------------------------------------------------------------
// Password comparison
// ---------------------------------------------------------------------------

/**
 * Compares a plaintext password against a stored bcrypt hash.
 *
 * bcrypt is not natively available in the browser; we use the WebCrypto
 * PBKDF2-based fallback described below.
 *
 * IMPLEMENTATION NOTE (Story 5):
 *   For the local offline POS kiosk we accept the security trade-off of using
 *   a browser-safe hash comparison. The seeded admin hash was pre-generated
 *   with bcrypt cost=10 off-device.  For new accounts created through the UI
 *   we use PBKDF2-SHA256 (100 000 iterations) which is strong enough for
 *   the kiosk threat model.
 *
 *   When the Cognito adapter lands (#42) this file is bypassed entirely and
 *   credentials are validated server-side.
 *
 * The seed admin account uses a well-known bcrypt hash.  We detect bcrypt
 * format (`$2b$`) and fall back to a simple constant-time comparison of the
 * known test hash to make the default admin account work out-of-the-box.
 */
async function comparePassword(plaintext: string, storedHash: string): Promise<boolean> {
  // Bcrypt hash detection — used only for the seeded admin account
  if (storedHash.startsWith('$2b$') || storedHash.startsWith('$2a$')) {
    // bcrypt is not available in pure WebCrypto. For the seeded default admin
    // we store the hash of "admin1234" and do a direct equality check for
    // demonstration purposes only.
    // Story 5: integrate a WASM bcrypt or enforce password reset on first login.
    const SEED_HASH = '$2b$10$EixZaYVK1fsbw1ZfbX3OXePaWxn96p36WQoeG6Lruj3vjPGga31lW';
    const SEED_PLAIN = 'admin1234';
    if (storedHash === SEED_HASH) {
      return plaintext === SEED_PLAIN;
    }
    // Unknown bcrypt hash — reject (cannot verify without bcrypt WASM)
    return false;
  }

  // PBKDF2-SHA256 format: "pbkdf2:<iterations>:<hex-salt>:<hex-dk>"
  if (storedHash.startsWith('pbkdf2:')) {
    const parts = storedHash.split(':');
    if (parts.length !== 4) return false;
    const iterations = parseInt(parts[1], 10);
    const saltHex = parts[2];
    const storedDkHex = parts[3];

    const saltBytes = hexToUint8Array(saltHex);
    const dk = await pbkdf2Hash(plaintext, saltBytes, iterations);
    const candidateDkHex = uint8ArrayToHex(dk);
    return timingSafeEqual(candidateDkHex, storedDkHex);
  }

  return false;
}

async function pbkdf2Hash(
  password: string,
  salt: Uint8Array,
  iterations: number
): Promise<Uint8Array> {
  const keyMaterial = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(password),
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

function hexToUint8Array(hex: string): Uint8Array {
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < bytes.length; i++) {
    bytes[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  }
  return bytes;
}

function uint8ArrayToHex(bytes: Uint8Array): string {
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

/** Constant-time string comparison to mitigate timing attacks */
function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let result = 0;
  for (let i = 0; i < a.length; i++) {
    result |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return result === 0;
}

/**
 * Hash a plaintext password with PBKDF2-SHA256 for newly created accounts.
 * Returns a string in the format: "pbkdf2:<iterations>:<hex-salt>:<hex-dk>"
 */
export async function hashPassword(plaintext: string): Promise<string> {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const iterations = 100_000;
  const dk = await pbkdf2Hash(plaintext, salt, iterations);
  return `pbkdf2:${iterations}:${uint8ArrayToHex(salt)}:${uint8ArrayToHex(dk)}`;
}

// ---------------------------------------------------------------------------
// Adapter
// ---------------------------------------------------------------------------

@Injectable()
export class LocalCredentialAuthAdapter implements AuthGateway {
  private readonly db = inject(DexieDatabase);

  async authenticate(creds: CredentialsDto): Promise<AuthSessionDto> {
    const email = creds.email.trim().toLowerCase();

    const operator = await this.db.operators.where('email').equals(email).first();

    if (!operator || !operator.isActive) {
      throw new InvalidCredentialsError();
    }

    const passwordMatch = await comparePassword(creds.password, operator.passwordHash);
    if (!passwordMatch) {
      throw new InvalidCredentialsError();
    }

    const roleRecord = await this.db.roles.get(operator.roleId);
    const permissions: string[] = roleRecord
      ? (JSON.parse(roleRecord.permissions) as string[])
      : [];

    const roleName = roleRecord?.name ?? operator.roleId;
    const now = Math.floor(Date.now() / 1000);
    const exp = now + SESSION_TTL_SECONDS;

    const accessToken = await new SignJWT({
      sub: operator.id,
      tenantId: operator.tenantId,
      roles: [roleName],
      permissions,
    })
      .setProtectedHeader({ alg: 'HS256' })
      .setIssuedAt(now)
      .setExpirationTime(exp)
      .sign(getJwtSecret());

    const session: AuthSessionDto = {
      operatorId: operator.id,
      tenantId: operator.tenantId,
      roles: [roleName],
      permissions,
      accessToken,
      expiresAt: new Date(exp * 1000).toISOString(),
    };

    storeToken(accessToken);
    return session;
  }

  async getActiveSession(): Promise<AuthSessionDto | null> {
    const token = readToken();
    if (!token) return null;

    try {
      const { payload } = await jwtVerify(token, getJwtSecret());

      return {
        operatorId: payload['sub'] as string,
        tenantId: payload['tenantId'] as string,
        roles: payload['roles'] as string[],
        permissions: payload['permissions'] as string[],
        accessToken: token,
        expiresAt: new Date((payload['exp'] as number) * 1000).toISOString(),
      };
    } catch {
      // Token expired or tampered — clear it
      clearToken();
      return null;
    }
  }

  async refresh(): Promise<AuthSessionDto> {
    const current = await this.getActiveSession();
    if (!current) {
      throw new Error('No active session to refresh');
    }

    // Decode existing claims without re-verifying (already verified above)
    const claims = decodeJwt(current.accessToken);

    const now = Math.floor(Date.now() / 1000);
    const exp = now + SESSION_TTL_SECONDS;

    const accessToken = await new SignJWT({
      sub: claims['sub'],
      tenantId: claims['tenantId'],
      roles: claims['roles'],
      permissions: claims['permissions'],
    })
      .setProtectedHeader({ alg: 'HS256' })
      .setIssuedAt(now)
      .setExpirationTime(exp)
      .sign(getJwtSecret());

    const session: AuthSessionDto = {
      ...current,
      accessToken,
      expiresAt: new Date(exp * 1000).toISOString(),
    };

    storeToken(accessToken);
    return session;
  }

  async signOut(): Promise<void> {
    clearToken();
  }

  getAccessToken(): string | null {
    return readToken();
  }
}
