/**
 * Reading what an authenticator hands back.
 *
 * WebAuthn returns binary: base64url in the JSON-ish parts, CBOR for the
 * attestation object, a packed byte layout for authenticator data, and a COSE key
 * for the public key. Nothing in the browser will parse any of it for us, so this
 * module does — and does *only* that. Every function here is pure and
 * synchronous, which is the entire reason the interesting rules (in
 * `assertion-verifier.ts`) can be tested against hand-built bytes instead of
 * against a fingerprint sensor.
 *
 * The CBOR support is deliberately a subset: the major types WebAuthn actually
 * uses. A general CBOR implementation would be more code, more surface, and no
 * more capable here — and anything outside the subset arriving from an
 * authenticator is a reason to reject the ceremony, not to decode harder.
 *
 * Strict on purpose. Every parse failure throws {@link WebAuthnDataError} rather
 * than returning a partial result, because the caller's only sane response to
 * "this does not parse" is to refuse the sign-in, and a half-parsed credential is
 * how you end up trusting a key you never really read.
 */

/** A structure we could not read. Always a refusal, never a warning. */
export class WebAuthnDataError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'WebAuthnDataError';
  }
}

// ---------------------------------------------------------------------------
// base64url
// ---------------------------------------------------------------------------

/**
 * base64url → bytes.
 *
 * Padding is optional in base64url and authenticators are inconsistent about it,
 * so it is restored here rather than required from the caller.
 */
export function base64UrlToBytes(value: string): Uint8Array {
  const normalised = value.replace(/-/g, '+').replace(/_/g, '/');
  const padded = normalised.padEnd(normalised.length + ((4 - (normalised.length % 4)) % 4), '=');
  let binary: string;
  try {
    binary = atob(padded);
  } catch {
    throw new WebAuthnDataError('Value is not valid base64url');
  }
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

/**
 * bytes → base64url, unpadded.
 *
 * Chunked through `fromCharCode` because spreading a whole array into it blows the
 * call stack on large inputs — RSA moduli are only a few hundred bytes, but the
 * failure mode is a crash rather than a wrong answer, so it is not worth leaving
 * to the size of the key.
 */
export function bytesToBase64Url(bytes: Uint8Array): string {
  let binary = '';
  const CHUNK = 0x8000;
  for (let i = 0; i < bytes.length; i += CHUNK) {
    binary += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  }
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

// ---------------------------------------------------------------------------
// CBOR (the subset WebAuthn uses)
// ---------------------------------------------------------------------------

export type CborValue =
  | number
  | string
  | Uint8Array
  | boolean
  | null
  | CborValue[]
  | Map<number | string, CborValue>;

/**
 * Decode one CBOR item.
 *
 * Returns how many bytes it consumed as well as the value, because two callers
 * need it: attested credential data is a COSE key followed by optional extension
 * bytes, and there is no way to find the end of the key without decoding it.
 *
 * @param bytes buffer to read from
 * @param offset where the item starts
 */
export function decodeCborItem(
  bytes: Uint8Array,
  offset = 0
): { value: CborValue; bytesRead: number } {
  const start = offset;
  const head = readUint8(bytes, offset);
  offset += 1;

  const majorType = head >> 5;
  const additional = head & 0x1f;

  // Major type 7 encodes the simple values in its additional-info field rather
  // than as a following length, so it is handled before the length is read.
  if (majorType === 7) {
    switch (additional) {
      case 20:
        return { value: false, bytesRead: offset - start };
      case 21:
        return { value: true, bytesRead: offset - start };
      case 22:
        return { value: null, bytesRead: offset - start };
      default:
        // Floats and `undefined`. A COSE key has no use for either, and guessing at
        // one would mean inventing a value the authenticator never sent.
        throw new WebAuthnDataError(`Unsupported CBOR simple value ${additional}`);
    }
  }

  const { value: length, bytesRead: lengthBytes } = readLength(bytes, offset, additional);
  offset += lengthBytes;

  switch (majorType) {
    case 0:
      return { value: length, bytesRead: offset - start };
    case 1:
      // Negative integers are stored as -1 - n, which is how COSE algorithm
      // identifiers such as ES256 (-7) are carried.
      return { value: -1 - length, bytesRead: offset - start };
    case 2: {
      const end = offset + length;
      requireLength(bytes, end, 'byte string');
      return { value: bytes.slice(offset, end), bytesRead: end - start };
    }
    case 3: {
      const end = offset + length;
      requireLength(bytes, end, 'text string');
      return {
        value: new TextDecoder().decode(bytes.subarray(offset, end)),
        bytesRead: end - start,
      };
    }
    case 4: {
      const items: CborValue[] = [];
      for (let i = 0; i < length; i++) {
        const item = decodeCborItem(bytes, offset);
        items.push(item.value);
        offset += item.bytesRead;
      }
      return { value: items, bytesRead: offset - start };
    }
    case 5: {
      const map = new Map<number | string, CborValue>();
      for (let i = 0; i < length; i++) {
        const key = decodeCborItem(bytes, offset);
        offset += key.bytesRead;
        if (typeof key.value !== 'number' && typeof key.value !== 'string') {
          throw new WebAuthnDataError('CBOR map keys must be integers or strings');
        }
        const entry = decodeCborItem(bytes, offset);
        offset += entry.bytesRead;
        map.set(key.value, entry.value);
      }
      return { value: map, bytesRead: offset - start };
    }
    default:
      // Major type 6 (tags) only. Nothing in a WebAuthn payload is tagged.
      throw new WebAuthnDataError(`Unsupported CBOR major type ${majorType}`);
  }
}

/**
 * Read the length/value that follows a CBOR head byte.
 *
 * 8-byte lengths are rejected rather than truncated: a value that large cannot be
 * a credential id or a public-key coordinate, and silently narrowing it to a
 * JavaScript number is exactly the kind of quiet lie that turns a parse bug into a
 * security bug.
 */
function readLength(
  bytes: Uint8Array,
  offset: number,
  additional: number
): { value: number; bytesRead: number } {
  if (additional < 24) {
    return { value: additional, bytesRead: 0 };
  }
  switch (additional) {
    case 24:
      return { value: readUint8(bytes, offset), bytesRead: 1 };
    case 25:
      return {
        value: (readUint8(bytes, offset) << 8) | readUint8(bytes, offset + 1),
        bytesRead: 2,
      };
    case 26:
      return {
        value:
          readUint8(bytes, offset) * 0x1000000 +
          ((readUint8(bytes, offset + 1) << 16) |
            (readUint8(bytes, offset + 2) << 8) |
            readUint8(bytes, offset + 3)),
        bytesRead: 4,
      };
    default:
      throw new WebAuthnDataError(`Unsupported CBOR length encoding ${additional}`);
  }
}

function readUint8(bytes: Uint8Array, offset: number): number {
  if (offset >= bytes.length) {
    throw new WebAuthnDataError('CBOR input ended unexpectedly');
  }
  return bytes[offset];
}

function requireLength(bytes: Uint8Array, end: number, what: string): void {
  if (end > bytes.length) {
    throw new WebAuthnDataError(`CBOR ${what} runs past the end of the input`);
  }
}

// ---------------------------------------------------------------------------
// Attestation object
// ---------------------------------------------------------------------------

/**
 * Pull the authenticator data out of a registration's attestation object.
 *
 * The attestation *statement* is deliberately ignored. Verifying it would tell us
 * which make and model of authenticator was used, which matters when a relying
 * party has to enforce a hardware policy and does not matter at all here: this
 * till accepts whatever the operator's own device offers. What we need from
 * registration is the credential id and public key, and those live in authData.
 */
export function parseAttestationObject(bytes: Uint8Array): { fmt: string; authData: Uint8Array } {
  const { value } = decodeCborItem(bytes);
  if (!(value instanceof Map)) {
    throw new WebAuthnDataError('Attestation object is not a CBOR map');
  }
  const fmt = value.get('fmt');
  const authData = value.get('authData');
  if (typeof fmt !== 'string') {
    throw new WebAuthnDataError('Attestation object has no fmt');
  }
  if (!(authData instanceof Uint8Array)) {
    throw new WebAuthnDataError('Attestation object has no authData');
  }
  return { fmt, authData };
}

// ---------------------------------------------------------------------------
// Authenticator data
// ---------------------------------------------------------------------------

export interface AuthenticatorDataFlags {
  /** Someone physically interacted with the authenticator. */
  readonly userPresent: boolean;
  /** They were *identified* — biometric matched, or device PIN entered. */
  readonly userVerified: boolean;
  /** Attested credential data follows (set on registration, not on assertion). */
  readonly attestedCredentialData: boolean;
  /** Extension output follows. */
  readonly extensionData: boolean;
}

export interface ParsedAuthenticatorData {
  readonly rpIdHash: Uint8Array;
  readonly flags: AuthenticatorDataFlags;
  /**
   * The authenticator's use counter for this credential.
   *
   * Meant to increase on every assertion, which is what lets a relying party spot
   * a cloned credential. Many platform authenticators — Apple's included — always
   * report 0 because the key is bound to hardware that cannot be cloned in the
   * first place. Both behaviours are legal, and the verifier has to accept each.
   */
  readonly signCount: number;
  /** Present only on registration. */
  readonly credentialId: Uint8Array | null;
  /** The COSE public key, present only on registration. */
  readonly coseKey: Map<number | string, CborValue> | null;
}

const RP_ID_HASH_LENGTH = 32;
const AAGUID_LENGTH = 16;

/**
 * Unpack the fixed byte layout of authenticator data.
 *
 * Same structure for registration and assertion; registration just has the
 * attested credential data appended, flagged by bit 6.
 */
export function parseAuthenticatorData(bytes: Uint8Array): ParsedAuthenticatorData {
  const MINIMUM = RP_ID_HASH_LENGTH + 1 + 4;
  if (bytes.length < MINIMUM) {
    throw new WebAuthnDataError(
      `Authenticator data is ${bytes.length} bytes, needs at least ${MINIMUM}`
    );
  }

  const rpIdHash = bytes.slice(0, RP_ID_HASH_LENGTH);
  const flagBits = bytes[RP_ID_HASH_LENGTH];
  const flags: AuthenticatorDataFlags = {
    userPresent: (flagBits & 0x01) !== 0,
    userVerified: (flagBits & 0x04) !== 0,
    attestedCredentialData: (flagBits & 0x40) !== 0,
    extensionData: (flagBits & 0x80) !== 0,
  };

  // Big-endian, and read through a DataView rather than shifted by hand: a
  // counter near 2^31 would come out negative from a `<< 24`.
  const signCount = new DataView(
    bytes.buffer,
    bytes.byteOffset + RP_ID_HASH_LENGTH + 1,
    4
  ).getUint32(0, false);

  if (!flags.attestedCredentialData) {
    return { rpIdHash, flags, signCount, credentialId: null, coseKey: null };
  }

  let offset = RP_ID_HASH_LENGTH + 1 + 4 + AAGUID_LENGTH;
  if (offset + 2 > bytes.length) {
    throw new WebAuthnDataError('Attested credential data is truncated before the id length');
  }
  const credentialIdLength = (bytes[offset] << 8) | bytes[offset + 1];
  offset += 2;
  if (offset + credentialIdLength > bytes.length) {
    throw new WebAuthnDataError('Credential id runs past the end of the authenticator data');
  }
  const credentialId = bytes.slice(offset, offset + credentialIdLength);
  offset += credentialIdLength;

  const { value: coseKey } = decodeCborItem(bytes, offset);
  if (!(coseKey instanceof Map)) {
    throw new WebAuthnDataError('Credential public key is not a CBOR map');
  }

  return { rpIdHash, flags, signCount, credentialId, coseKey };
}

// ---------------------------------------------------------------------------
// COSE → JWK
// ---------------------------------------------------------------------------

/** COSE algorithm identifiers we accept, and their WebCrypto equivalents. */
export const COSE_ES256 = -7;
export const COSE_RS256 = -257;

/** COSE key label numbers (RFC 8152 §7.1 and §13). */
const COSE_LABEL_KTY = 1;
const COSE_LABEL_ALG = 3;
const COSE_LABEL_CRV_OR_N = -1;
const COSE_LABEL_X_OR_E = -2;
const COSE_LABEL_Y = -3;

const COSE_KTY_EC2 = 2;
const COSE_KTY_RSA = 3;
const COSE_CRV_P256 = 1;

/**
 * Convert a COSE public key into a JWK `crypto.subtle.importKey` will take.
 *
 * Two algorithms, because between them they cover every platform authenticator a
 * shop will meet: ES256 for Touch ID, Face ID and Android, RS256 for Windows
 * Hello. Anything else is refused by name rather than attempted — an unknown
 * curve or key type cannot be verified, and pretending otherwise would mean
 * importing a key whose semantics we guessed.
 */
export function coseKeyToJwk(coseKey: Map<number | string, CborValue>): {
  jwk: JsonWebKey;
  algorithm: number;
} {
  const kty = coseKey.get(COSE_LABEL_KTY);
  const alg = coseKey.get(COSE_LABEL_ALG);

  if (typeof alg !== 'number') {
    throw new WebAuthnDataError('COSE key has no algorithm');
  }

  if (kty === COSE_KTY_EC2 && alg === COSE_ES256) {
    const crv = coseKey.get(COSE_LABEL_CRV_OR_N);
    const x = coseKey.get(COSE_LABEL_X_OR_E);
    const y = coseKey.get(COSE_LABEL_Y);
    if (crv !== COSE_CRV_P256) {
      throw new WebAuthnDataError(`Unsupported EC curve ${String(crv)}`);
    }
    if (!(x instanceof Uint8Array) || !(y instanceof Uint8Array)) {
      throw new WebAuthnDataError('EC2 COSE key is missing its coordinates');
    }
    return {
      algorithm: COSE_ES256,
      jwk: {
        kty: 'EC',
        crv: 'P-256',
        x: bytesToBase64Url(x),
        y: bytesToBase64Url(y),
        ext: true,
      },
    };
  }

  if (kty === COSE_KTY_RSA && alg === COSE_RS256) {
    const n = coseKey.get(COSE_LABEL_CRV_OR_N);
    const e = coseKey.get(COSE_LABEL_X_OR_E);
    if (!(n instanceof Uint8Array) || !(e instanceof Uint8Array)) {
      throw new WebAuthnDataError('RSA COSE key is missing its modulus or exponent');
    }
    return {
      algorithm: COSE_RS256,
      jwk: {
        kty: 'RSA',
        n: bytesToBase64Url(n),
        e: bytesToBase64Url(e),
        ext: true,
      },
    };
  }

  throw new WebAuthnDataError(
    `Unsupported COSE key: kty ${String(kty)} with algorithm ${String(alg)}`
  );
}

/** The `importKey` parameters for a COSE algorithm we accept. */
export function importParamsFor(algorithm: number): {
  importAlgorithm: EcKeyImportParams | RsaHashedImportParams;
  verifyAlgorithm: EcdsaParams | AlgorithmIdentifier;
} {
  if (algorithm === COSE_ES256) {
    return {
      importAlgorithm: { name: 'ECDSA', namedCurve: 'P-256' },
      verifyAlgorithm: { name: 'ECDSA', hash: 'SHA-256' },
    };
  }
  if (algorithm === COSE_RS256) {
    return {
      importAlgorithm: { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
      verifyAlgorithm: { name: 'RSASSA-PKCS1-v1_5' },
    };
  }
  throw new WebAuthnDataError(`Unsupported algorithm ${algorithm}`);
}

// ---------------------------------------------------------------------------
// ECDSA signature format
// ---------------------------------------------------------------------------

/** Byte length of one P-256 scalar, and so of each half of a raw signature. */
const P256_SCALAR_BYTES = 32;

/**
 * Convert a DER-encoded ECDSA signature into the raw `r || s` WebCrypto expects.
 *
 * The single most common reason a hand-rolled WebAuthn verifier rejects every
 * valid signature. Authenticators emit ES256 signatures as an ASN.1 SEQUENCE of
 * two INTEGERs; `crypto.subtle.verify` for ECDSA wants 64 raw bytes. Neither side
 * documents this next to the other, and the failure looks exactly like a wrong key.
 *
 * The two integers are signed, so each carries a leading 0x00 whenever its top bit
 * would otherwise read as negative, and either can be *shorter* than 32 bytes when
 * it happens to have leading zeroes. Both cases are normalised to a fixed-width,
 * left-padded half here.
 *
 * RS256 signatures need none of this — they are already raw — so this is only
 * applied on the ECDSA path.
 */
export function derToRawEcdsaSignature(der: Uint8Array): Uint8Array {
  let offset = 0;
  if (readUint8(der, offset++) !== 0x30) {
    throw new WebAuthnDataError('ECDSA signature is not a DER sequence');
  }

  // Skip the sequence length, in either short or long form.
  const sequenceLength = readUint8(der, offset++);
  if (sequenceLength > 0x80) {
    offset += sequenceLength - 0x80;
  }

  const r = readDerInteger(der, offset);
  const s = readDerInteger(der, r.nextOffset);

  const raw = new Uint8Array(P256_SCALAR_BYTES * 2);
  raw.set(r.value, P256_SCALAR_BYTES - r.value.length);
  raw.set(s.value, P256_SCALAR_BYTES * 2 - s.value.length);
  return raw;
}

function readDerInteger(
  der: Uint8Array,
  offset: number
): { value: Uint8Array; nextOffset: number } {
  if (readUint8(der, offset++) !== 0x02) {
    throw new WebAuthnDataError('ECDSA signature component is not a DER integer');
  }
  const length = readUint8(der, offset++);
  const end = offset + length;
  requireLength(der, end, 'ECDSA signature component');

  // Strip the sign byte, and any other leading zeroes, so the value can be
  // left-padded to a fixed width below.
  let value = der.subarray(offset, end);
  while (value.length > P256_SCALAR_BYTES && value[0] === 0x00) {
    value = value.subarray(1);
  }
  if (value.length > P256_SCALAR_BYTES) {
    throw new WebAuthnDataError('ECDSA signature component is too large for P-256');
  }
  return { value, nextOffset: end };
}
