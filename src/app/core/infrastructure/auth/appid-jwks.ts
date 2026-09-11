import { importJWK } from 'jose';

/**
 * Shared IBM App ID JWKS handling.
 *
 * Extracted from {@link AppIdAuthAdapter} when `AppIdCustomerAuthAdapter`
 * (epic #261 item 11) needed the identical key resolution: staff and customers
 * share one App ID *tenant*, so they are verified against the very same
 * `publickeys` document — only the audience they bind differs. Hand-copying
 * `resolveSigningKey` into a second adapter would mean two places to keep the
 * leading-zero fix below, and that fix is invisible to Vitest/jsdom (see its
 * own comment), so a regression in the copy would not fail a test.
 */

/** Raised for non-credential App ID failures (network, relay, service, config). */
export class AppIdAuthError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'AppIdAuthError';
  }
}

/** A JWKS entry — only the fields we consume. */
export interface Jwk {
  kid: string;
  kty: string;
  n: string;
  e: string;
  alg?: string;
  use?: string;
}

/**
 * Fetches, caches and resolves an App ID tenant's RS256 signing keys.
 *
 * Takes the JWKS URI as a supplier rather than a string because both adapters
 * derive it from injected config through a getter, and the config is only
 * guaranteed resolved once the injector has finished constructing the adapter.
 */
export class AppIdJwksKeyResolver {
  /** JWKS is immutable per tenant; cache it after the first fetch. */
  private jwksCache: Jwk[] | null = null;

  constructor(private readonly jwksUri: () => string) {}

  async resolveSigningKey(kid: string | undefined): Promise<CryptoKey> {
    if (!kid) throw new AppIdAuthError('Token has no key id (kid)');

    const jwk = await this.findJwk(kid);
    if (!jwk) throw new AppIdAuthError(`No JWKS key matches kid ${kid}`);

    // IBM App ID's real JWKS encodes the RSA modulus with a non-minimal
    // leading zero byte when its high bit is set — the ASN.1
    // "keep an integer positive" convention. RFC 7518's JWK `n` is defined as
    // the *minimal* unsigned big-endian encoding, and `jose` enforces that
    // strictly (`DataError: The JWK "n" member contained a leading zero.`) —
    // confirmed against this tenant's real, live JWKS, not a hypothetical.
    // Node's own `crypto.createPublicKey` is lenient about the identical
    // bytes (`infra/pos-api/src/session-auth.ts`'s RS256 path uses it as-is,
    // unmodified); `jose` is not, so the browser has to strip the padding
    // itself before `importJWK` ever sees it.
    const normalized = { ...jwk, n: stripLeadingZeroPadding(jwk.n) };
    return (await importJWK(normalized, jwk.alg ?? 'RS256')) as CryptoKey;
  }

  private async findJwk(kid: string): Promise<Jwk | undefined> {
    if (!this.jwksCache) {
      this.jwksCache = await this.fetchJwks();
    }
    const hit = this.jwksCache.find((k) => k.kid === kid);
    if (hit) return hit;

    // A rotated key we haven't seen — refresh the cache once and retry.
    this.jwksCache = await this.fetchJwks();
    return this.jwksCache.find((k) => k.kid === kid);
  }

  private async fetchJwks(): Promise<Jwk[]> {
    let response: Response;
    try {
      response = await fetch(this.jwksUri(), { method: 'GET' });
    } catch (err) {
      throw new AppIdAuthError(`JWKS fetch failed: ${(err as Error).message}`);
    }
    if (!response.ok) {
      throw new AppIdAuthError(`JWKS fetch returned ${response.status}`);
    }
    const data = (await response.json()) as { keys?: Jwk[] };
    return data.keys ?? [];
  }
}

// ---------------------------------------------------------------------------
// JWK normalization — see resolveSigningKey's own doc comment for why this
// exists at all. Free functions, not methods: pure byte manipulation, nothing
// here touches resolver state.
// ---------------------------------------------------------------------------

function base64UrlToBytes(value: string): Uint8Array {
  const base64 = value.replace(/-/g, '+').replace(/_/g, '/');
  const padded = base64 + '='.repeat((4 - (base64.length % 4)) % 4);
  const binary = atob(padded);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

function bytesToBase64Url(bytes: Uint8Array): string {
  let binary = '';
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/**
 * Strip non-minimal leading zero bytes from a base64url-encoded unsigned
 * big-endian integer. Keeps at least one byte — an integer whose value is
 * genuinely zero has nothing further to strip, and an RSA modulus is never
 * zero regardless.
 */
function stripLeadingZeroPadding(base64Url: string): string {
  const bytes = base64UrlToBytes(base64Url);
  let start = 0;
  while (start < bytes.length - 1 && bytes[start] === 0) {
    start++;
  }
  return start === 0 ? base64Url : bytesToBase64Url(bytes.slice(start));
}
