import { COSE_ES256, COSE_RS256, base64UrlToBytes } from './webauthn-codec';

/**
 * A fake authenticator, for tests.
 *
 * Builds the byte-for-byte responses real hardware produces and signs with a real
 * WebCrypto key pair. Both halves of that matter. A fixture that returns a
 * hard-coded signature cannot tell a working signature check from a missing one —
 * it would pass against a verifier with the check deleted. And a fixture that
 * handed back WebCrypto's raw ECDSA output would hide the DER unwrapping that
 * every real ES256 assertion needs, which is the single most common way a
 * hand-rolled WebAuthn verifier ends up rejecting everybody.
 *
 * Shared by `ceremony-verifier.spec.ts` (which feeds it to the rules directly) and
 * `webauthn-auth.adapter.spec.ts` (which wraps it in a fake `navigator.credentials`).
 * Excluded from coverage as a `.fixture.ts` — see vitest.config.ts.
 */

export const RP_ID = 'till.capy.shop';
export const ORIGIN = 'https://till.capy.shop';

export function concat(...parts: Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((sum, part) => sum + part.length, 0));
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.length;
  }
  return out;
}

export async function sha256(data: Uint8Array): Promise<Uint8Array> {
  return new Uint8Array(await crypto.subtle.digest('SHA-256', data as Uint8Array<ArrayBuffer>));
}

// --- CBOR encoding, enough to build a COSE key and an attestation object ------

export function cborHead(majorType: number, length: number): Uint8Array {
  const major = majorType << 5;
  if (length < 24) return Uint8Array.from([major | length]);
  if (length < 0x100) return Uint8Array.from([major | 24, length]);
  return Uint8Array.from([major | 25, length >> 8, length & 0xff]);
}

export function cborInt(value: number): Uint8Array {
  return value >= 0 ? cborHead(0, value) : cborHead(1, -1 - value);
}

export function cborBytes(value: Uint8Array): Uint8Array {
  return concat(cborHead(2, value.length), value);
}

export function cborText(value: string): Uint8Array {
  const encoded = new TextEncoder().encode(value);
  return concat(cborHead(3, encoded.length), encoded);
}

export function cborMap(entries: [Uint8Array, Uint8Array][]): Uint8Array {
  return concat(cborHead(5, entries.length), ...entries.flatMap(([k, v]) => [k, v]));
}

/**
 * WebCrypto emits ECDSA signatures raw; authenticators emit them DER-encoded.
 * This applies the wrap real hardware does, so the verifier's unwrap is exercised.
 */
export function rawToDer(raw: Uint8Array): Uint8Array {
  const encodeInteger = (component: Uint8Array): Uint8Array => {
    let value = component;
    while (value.length > 1 && value[0] === 0x00) {
      value = value.subarray(1);
    }
    // A leading high bit would read as a negative integer, so DER pads it.
    const body = value[0] & 0x80 ? concat(Uint8Array.from([0x00]), value) : value;
    return concat(Uint8Array.from([0x02, body.length]), body);
  };
  const body = concat(encodeInteger(raw.subarray(0, 32)), encodeInteger(raw.subarray(32)));
  return concat(Uint8Array.from([0x30, body.length]), body);
}

// --- Authenticator data / client data ----------------------------------------

export interface Flags {
  userPresent?: boolean;
  userVerified?: boolean;
  attested?: boolean;
}

export function flagByte({
  userPresent = true,
  userVerified = true,
  attested = false,
}: Flags): number {
  return (userPresent ? 0x01 : 0) | (userVerified ? 0x04 : 0) | (attested ? 0x40 : 0);
}

export async function buildAuthenticatorData(options: {
  rpId?: string;
  flags?: Flags;
  signCount?: number;
  attestedCredential?: { credentialId: Uint8Array; coseKey: Uint8Array };
}): Promise<Uint8Array> {
  const rpIdHash = await sha256(new TextEncoder().encode(options.rpId ?? RP_ID));
  const counter = new Uint8Array(4);
  new DataView(counter.buffer).setUint32(0, options.signCount ?? 0, false);
  const fixed = concat(
    rpIdHash,
    Uint8Array.from([flagByte({ ...options.flags, attested: !!options.attestedCredential })]),
    counter
  );
  if (!options.attestedCredential) {
    return fixed;
  }
  const { credentialId, coseKey } = options.attestedCredential;
  return concat(
    fixed,
    new Uint8Array(16).fill(0x22), // AAGUID
    Uint8Array.from([credentialId.length >> 8, credentialId.length & 0xff]),
    credentialId,
    coseKey
  );
}

export function buildClientData(options: {
  type?: string;
  challenge?: string;
  origin?: string;
  crossOrigin?: boolean;
}): Uint8Array {
  return new TextEncoder().encode(
    JSON.stringify({
      type: options.type ?? 'webauthn.get',
      challenge: options.challenge ?? '',
      origin: options.origin ?? ORIGIN,
      crossOrigin: options.crossOrigin ?? false,
    })
  );
}

export function attestationObject(authData: Uint8Array): Uint8Array {
  return cborMap([
    [cborText('fmt'), cborText('none')],
    [cborText('attStmt'), cborMap([])],
    [cborText('authData'), cborBytes(authData)],
  ]);
}

// --- The authenticator itself -------------------------------------------------

export interface FakeAuthenticator {
  publicKeyJwk: JsonWebKey;
  coseKey: Uint8Array;
  algorithm: number;
  sign(payload: Uint8Array): Promise<Uint8Array>;
}

export async function createEs256Authenticator(): Promise<FakeAuthenticator> {
  const pair = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, [
    'sign',
    'verify',
  ]);
  const jwk = await crypto.subtle.exportKey('jwk', pair.publicKey);
  const coseKey = cborMap([
    [cborInt(1), cborInt(2)], // kty: EC2
    [cborInt(3), cborInt(COSE_ES256)],
    [cborInt(-1), cborInt(1)], // crv: P-256
    [cborInt(-2), cborBytes(base64UrlToBytes(jwk.x as string))],
    [cborInt(-3), cborBytes(base64UrlToBytes(jwk.y as string))],
  ]);
  return {
    publicKeyJwk: { kty: 'EC', crv: 'P-256', x: jwk.x, y: jwk.y, ext: true },
    coseKey,
    algorithm: COSE_ES256,
    async sign(payload) {
      const raw = new Uint8Array(
        await crypto.subtle.sign(
          { name: 'ECDSA', hash: 'SHA-256' },
          pair.privateKey,
          payload as Uint8Array<ArrayBuffer>
        )
      );
      return rawToDer(raw);
    },
  };
}

/** Windows Hello's algorithm. Its signatures are raw, so no DER wrap here. */
export async function createRs256Authenticator(): Promise<FakeAuthenticator> {
  const pair = await crypto.subtle.generateKey(
    {
      name: 'RSASSA-PKCS1-v1_5',
      modulusLength: 2048,
      publicExponent: Uint8Array.from([0x01, 0x00, 0x01]),
      hash: 'SHA-256',
    },
    true,
    ['sign', 'verify']
  );
  const jwk = await crypto.subtle.exportKey('jwk', pair.publicKey);
  const coseKey = cborMap([
    [cborInt(1), cborInt(3)], // kty: RSA
    [cborInt(3), cborInt(COSE_RS256)],
    [cborInt(-1), cborBytes(base64UrlToBytes(jwk.n as string))],
    [cborInt(-2), cborBytes(base64UrlToBytes(jwk.e as string))],
  ]);
  return {
    publicKeyJwk: { kty: 'RSA', n: jwk.n, e: jwk.e, ext: true },
    coseKey,
    algorithm: COSE_RS256,
    async sign(payload) {
      return new Uint8Array(
        await crypto.subtle.sign(
          'RSASSA-PKCS1-v1_5',
          pair.privateKey,
          payload as Uint8Array<ArrayBuffer>
        )
      );
    },
  };
}

/** Produce a signed assertion the way an authenticator would. */
export async function signAssertion(
  authenticator: FakeAuthenticator,
  authData: Uint8Array,
  clientDataJson: Uint8Array
): Promise<{ authenticatorData: Uint8Array; clientDataJson: Uint8Array; signature: Uint8Array }> {
  const payload = concat(authData, await sha256(clientDataJson));
  return {
    authenticatorData: authData,
    clientDataJson,
    signature: await authenticator.sign(payload),
  };
}
