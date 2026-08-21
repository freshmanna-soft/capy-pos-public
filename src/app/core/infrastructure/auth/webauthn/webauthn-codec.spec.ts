import { describe, it, expect } from 'vitest';
import {
  COSE_ES256,
  COSE_RS256,
  WebAuthnDataError,
  base64UrlToBytes,
  bytesToBase64Url,
  coseKeyToJwk,
  decodeCborItem,
  derToRawEcdsaSignature,
  importParamsFor,
  parseAttestationObject,
  parseAuthenticatorData,
} from './webauthn-codec';

// ---------------------------------------------------------------------------
// Fixtures
//
// A tiny CBOR *encoder* lives here rather than in the module under test, because
// nothing in the app ever needs to write CBOR — only authenticators do. Using it
// alone would only prove the decoder is the inverse of this encoder, so the
// integer/string/array/map cases below are additionally pinned to the worked
// examples in RFC 8949 Appendix A. Those are the bytes a real authenticator emits.
// ---------------------------------------------------------------------------

type Encodable =
  | number
  | string
  | Uint8Array
  | boolean
  | null
  | Encodable[]
  | Map<number, Encodable>;

function cbor(value: Encodable): Uint8Array {
  if (value === null) return Uint8Array.from([0xf6]);
  if (value === true) return Uint8Array.from([0xf5]);
  if (value === false) return Uint8Array.from([0xf4]);
  if (typeof value === 'number') {
    return value >= 0 ? head(0, value) : head(1, -1 - value);
  }
  if (typeof value === 'string') {
    const bytes = new TextEncoder().encode(value);
    return concat(head(3, bytes.length), bytes);
  }
  if (value instanceof Uint8Array) {
    return concat(head(2, value.length), value);
  }
  if (Array.isArray(value)) {
    return concat(head(4, value.length), ...value.map(cbor));
  }
  const entries = [...value.entries()];
  return concat(head(5, entries.length), ...entries.flatMap(([k, v]) => [cbor(k), cbor(v)]));
}

/** Major type + length, using the shortest legal encoding. */
function head(majorType: number, length: number): Uint8Array {
  const major = majorType << 5;
  if (length < 24) return Uint8Array.from([major | length]);
  if (length < 0x100) return Uint8Array.from([major | 24, length]);
  if (length < 0x10000) return Uint8Array.from([major | 25, length >> 8, length & 0xff]);
  return Uint8Array.from([
    major | 26,
    (length >>> 24) & 0xff,
    (length >>> 16) & 0xff,
    (length >>> 8) & 0xff,
    length & 0xff,
  ]);
}

function concat(...parts: Uint8Array[]): Uint8Array {
  const total = parts.reduce((sum, part) => sum + part.length, 0);
  const out = new Uint8Array(total);
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.length;
  }
  return out;
}

function bytes(...values: number[]): Uint8Array {
  return Uint8Array.from(values);
}

function filled(length: number, value: number): Uint8Array {
  return new Uint8Array(length).fill(value);
}

/** An ES256 COSE key with recognisable coordinates. */
function es256CoseKey(x = filled(32, 0xaa), y = filled(32, 0xbb)): Map<number, Encodable> {
  return new Map<number, Encodable>([
    [1, 2], // kty: EC2
    [3, COSE_ES256],
    [-1, 1], // crv: P-256
    [-2, x],
    [-3, y],
  ]);
}

/**
 * Authenticator data, assembled to the packed layout in the spec.
 *
 * @param options.attested append attested credential data (registration shape)
 */
function authenticatorData(options: {
  rpIdHash?: Uint8Array;
  flags: number;
  signCount: number;
  attested?: { credentialId: Uint8Array; coseKey: Map<number, Encodable> };
  trailing?: Uint8Array;
}): Uint8Array {
  const signCount = new Uint8Array(4);
  new DataView(signCount.buffer).setUint32(0, options.signCount, false);

  const fixed = concat(options.rpIdHash ?? filled(32, 0x11), bytes(options.flags), signCount);

  if (!options.attested) {
    return options.trailing ? concat(fixed, options.trailing) : fixed;
  }

  const { credentialId, coseKey } = options.attested;
  return concat(
    fixed,
    filled(16, 0x22), // AAGUID
    bytes(credentialId.length >> 8, credentialId.length & 0xff),
    credentialId,
    cbor(coseKey),
    options.trailing ?? new Uint8Array(0)
  );
}

// ---------------------------------------------------------------------------

describe('base64url', () => {
  it('round-trips arbitrary bytes', () => {
    const original = bytes(0x00, 0x01, 0xfe, 0xff, 0x7f, 0x80);
    expect(base64UrlToBytes(bytesToBase64Url(original))).toEqual(original);
  });

  it('emits no padding and no URL-unsafe characters', () => {
    // 0xfb 0xff encodes to "+/" in standard base64 and needs padding.
    const encoded = bytesToBase64Url(bytes(0xfb, 0xff, 0xfe));
    expect(encoded).not.toContain('=');
    expect(encoded).not.toContain('+');
    expect(encoded).not.toContain('/');
  });

  it('accepts input whose padding has been stripped', () => {
    // "AQID" is 3 bytes and needs no padding; "AQI" is 2 bytes and normally would.
    expect(base64UrlToBytes('AQI')).toEqual(bytes(0x01, 0x02));
  });

  it('round-trips a payload larger than one fromCharCode chunk', () => {
    const large = new Uint8Array(0x8000 + 250).map((_, index) => index % 256);
    expect(base64UrlToBytes(bytesToBase64Url(large))).toEqual(large);
  });

  it('rejects a value that is not base64 at all', () => {
    expect(() => base64UrlToBytes('!!!not base64!!!')).toThrow(WebAuthnDataError);
  });
});

describe('decodeCborItem — RFC 8949 Appendix A vectors', () => {
  const cases: [string, Uint8Array, unknown][] = [
    ['0', bytes(0x00), 0],
    ['23 (inline)', bytes(0x17), 23],
    ['24 (one-byte)', bytes(0x18, 0x18), 24],
    ['100', bytes(0x18, 0x64), 100],
    ['1000 (two-byte)', bytes(0x19, 0x03, 0xe8), 1000],
    ['1000000 (four-byte)', bytes(0x1a, 0x00, 0x0f, 0x42, 0x40), 1000000],
    ['-1', bytes(0x20), -1],
    ['-100', bytes(0x38, 0x63), -100],
    ['-1000', bytes(0x39, 0x03, 0xe7), -1000],
    ['empty text', bytes(0x60), ''],
    ['"IETF"', bytes(0x64, 0x49, 0x45, 0x54, 0x46), 'IETF'],
    ['empty bytes', bytes(0x40), new Uint8Array(0)],
    ['h(01020304)', bytes(0x44, 0x01, 0x02, 0x03, 0x04), bytes(1, 2, 3, 4)],
    ['[]', bytes(0x80), []],
    ['[1,2,3]', bytes(0x83, 0x01, 0x02, 0x03), [1, 2, 3]],
    ['false', bytes(0xf4), false],
    ['true', bytes(0xf5), true],
    ['null', bytes(0xf6), null],
  ];

  it.each(cases)('decodes %s', (_label, input, expected) => {
    const { value, bytesRead } = decodeCborItem(input);
    expect(value).toEqual(expected);
    expect(bytesRead).toBe(input.length);
  });

  it('decodes the {1:2, 3:4} map vector into a Map', () => {
    const { value } = decodeCborItem(bytes(0xa2, 0x01, 0x02, 0x03, 0x04));
    expect(value).toEqual(
      new Map<number, number>([
        [1, 2],
        [3, 4],
      ])
    );
  });

  it('decodes the COSE algorithm identifiers as negative integers', () => {
    expect(decodeCborItem(bytes(0x26)).value).toBe(COSE_ES256);
    expect(decodeCborItem(bytes(0x39, 0x01, 0x00)).value).toBe(COSE_RS256);
  });

  it('reports bytesRead so a caller can find what follows the item', () => {
    // A COSE key with three bytes of extension data appended after it.
    const key = cbor(es256CoseKey());
    const stream = concat(key, bytes(0xde, 0xad, 0xbe));
    expect(decodeCborItem(stream).bytesRead).toBe(key.length);
  });

  it('decodes an item that does not start at offset zero', () => {
    const stream = concat(bytes(0xff, 0xff), bytes(0x18, 0x64));
    expect(decodeCborItem(stream, 2).value).toBe(100);
  });
});

describe('decodeCborItem — refusals', () => {
  it('rejects input that ends mid-item', () => {
    expect(() => decodeCborItem(bytes(0x19, 0x03))).toThrow(/ended unexpectedly/);
  });

  it('rejects a byte string longer than the buffer', () => {
    expect(() => decodeCborItem(bytes(0x44, 0x01))).toThrow(/runs past the end/);
  });

  it('rejects a text string longer than the buffer', () => {
    expect(() => decodeCborItem(bytes(0x64, 0x49))).toThrow(/runs past the end/);
  });

  it('rejects an empty buffer', () => {
    expect(() => decodeCborItem(new Uint8Array(0))).toThrow(WebAuthnDataError);
  });

  it('rejects floats rather than rounding them', () => {
    // 1.5 as a half-precision float.
    expect(() => decodeCborItem(bytes(0xf9, 0x3e, 0x00))).toThrow(/simple value 25/);
  });

  it('rejects undefined', () => {
    expect(() => decodeCborItem(bytes(0xf7))).toThrow(/simple value 23/);
  });

  it('rejects tags, which nothing in WebAuthn uses', () => {
    expect(() => decodeCborItem(bytes(0xc0, 0x00))).toThrow(/major type 6/);
  });

  it('rejects an 8-byte length instead of truncating it to a JS number', () => {
    expect(() => decodeCborItem(bytes(0x1b, 0, 0, 0, 0, 0, 0, 0, 1))).toThrow(/length encoding 27/);
  });

  it('rejects a map keyed by something other than an integer or string', () => {
    // { []: 1 } — a legal CBOR map, not a legal COSE one.
    expect(() => decodeCborItem(bytes(0xa1, 0x80, 0x01))).toThrow(/map keys/);
  });
});

describe('parseAttestationObject', () => {
  it('extracts fmt and authData', () => {
    const authData = authenticatorData({ flags: 0x45, signCount: 1 });
    // Built directly so the map keys are the strings a real authenticator sends.
    const object = concat(
      head(5, 3),
      cbor('fmt'),
      cbor('none'),
      cbor('attStmt'),
      cbor(new Map<number, Encodable>()),
      cbor('authData'),
      cbor(authData)
    );
    const parsed = parseAttestationObject(object);
    expect(parsed.fmt).toBe('none');
    expect(parsed.authData).toEqual(authData);
  });

  it('rejects an attestation object that is not a map', () => {
    expect(() => parseAttestationObject(cbor([1, 2]))).toThrow(/not a CBOR map/);
  });

  it('rejects a missing fmt', () => {
    const object = concat(head(5, 1), cbor('authData'), cbor(new Uint8Array(37)));
    expect(() => parseAttestationObject(object)).toThrow(/no fmt/);
  });

  it('rejects a missing authData', () => {
    const object = concat(head(5, 1), cbor('fmt'), cbor('none'));
    expect(() => parseAttestationObject(object)).toThrow(/no authData/);
  });
});

describe('parseAuthenticatorData', () => {
  it('unpacks the rpIdHash, flags and counter of an assertion', () => {
    const parsed = parseAuthenticatorData(
      authenticatorData({ rpIdHash: filled(32, 0x7c), flags: 0x05, signCount: 42 })
    );
    expect(parsed.rpIdHash).toEqual(filled(32, 0x7c));
    expect(parsed.flags.userPresent).toBe(true);
    expect(parsed.flags.userVerified).toBe(true);
    expect(parsed.flags.attestedCredentialData).toBe(false);
    expect(parsed.signCount).toBe(42);
    expect(parsed.credentialId).toBeNull();
    expect(parsed.coseKey).toBeNull();
  });

  it('distinguishes user presence from user verification', () => {
    const presentOnly = parseAuthenticatorData(authenticatorData({ flags: 0x01, signCount: 0 }));
    expect(presentOnly.flags.userPresent).toBe(true);
    expect(presentOnly.flags.userVerified).toBe(false);
  });

  it('reads the extension-data flag', () => {
    const parsed = parseAuthenticatorData(authenticatorData({ flags: 0x81, signCount: 0 }));
    expect(parsed.flags.extensionData).toBe(true);
  });

  it('reads a counter above 2^31 without going negative', () => {
    const parsed = parseAuthenticatorData(
      authenticatorData({ flags: 0x01, signCount: 0xfffffff0 })
    );
    expect(parsed.signCount).toBe(0xfffffff0);
  });

  it('extracts the credential id and public key from a registration', () => {
    const credentialId = bytes(9, 8, 7, 6, 5);
    const parsed = parseAuthenticatorData(
      authenticatorData({
        flags: 0x45, // UP | UV | AT
        signCount: 0,
        attested: { credentialId, coseKey: es256CoseKey() },
      })
    );
    expect(parsed.flags.attestedCredentialData).toBe(true);
    expect(parsed.credentialId).toEqual(credentialId);
    expect(parsed.coseKey?.get(3)).toBe(COSE_ES256);
  });

  it('ignores extension bytes that follow the public key', () => {
    const parsed = parseAuthenticatorData(
      authenticatorData({
        flags: 0xc5, // ...with ED set as well
        signCount: 0,
        attested: { credentialId: bytes(1, 2), coseKey: es256CoseKey() },
        trailing: cbor(new Map<number, Encodable>([[1, 'ignored']])),
      })
    );
    expect(parsed.credentialId).toEqual(bytes(1, 2));
  });

  it('rejects data too short to hold even the fixed part', () => {
    expect(() => parseAuthenticatorData(filled(36, 0))).toThrow(/needs at least 37/);
  });

  it('rejects attested data truncated before the id length', () => {
    const truncated = concat(filled(32, 0x11), bytes(0x45), filled(4, 0), filled(16, 0x22));
    expect(() => parseAuthenticatorData(truncated)).toThrow(/truncated before the id length/);
  });

  it('rejects a credential id longer than the buffer', () => {
    const lying = concat(
      filled(32, 0x11),
      bytes(0x45),
      filled(4, 0),
      filled(16, 0x22),
      bytes(0x01, 0x00), // claims 256 bytes
      bytes(1, 2, 3)
    );
    expect(() => parseAuthenticatorData(lying)).toThrow(/runs past the end/);
  });

  it('rejects a public key that is not a CBOR map', () => {
    const notAMap = concat(
      filled(32, 0x11),
      bytes(0x45),
      filled(4, 0),
      filled(16, 0x22),
      bytes(0x00, 0x02),
      bytes(0xab, 0xcd),
      cbor([1, 2])
    );
    expect(() => parseAuthenticatorData(notAMap)).toThrow(/not a CBOR map/);
  });
});

describe('coseKeyToJwk', () => {
  it('converts an ES256 key', () => {
    const { jwk, algorithm } = coseKeyToJwk(es256CoseKey(filled(32, 0x01), filled(32, 0x02)));
    expect(algorithm).toBe(COSE_ES256);
    expect(jwk.kty).toBe('EC');
    expect(jwk.crv).toBe('P-256');
    expect(jwk.x).toBe(bytesToBase64Url(filled(32, 0x01)));
    expect(jwk.y).toBe(bytesToBase64Url(filled(32, 0x02)));
  });

  it('converts an RS256 key, for Windows Hello', () => {
    const key = new Map<number, Encodable>([
      [1, 3], // kty: RSA
      [3, COSE_RS256],
      [-1, filled(256, 0xcd)], // n
      [-2, bytes(0x01, 0x00, 0x01)], // e = 65537
    ]);
    const { jwk, algorithm } = coseKeyToJwk(key);
    expect(algorithm).toBe(COSE_RS256);
    expect(jwk.kty).toBe('RSA');
    expect(jwk.n).toBe(bytesToBase64Url(filled(256, 0xcd)));
    expect(jwk.e).toBe(bytesToBase64Url(bytes(0x01, 0x00, 0x01)));
  });

  it('rejects a key with no algorithm', () => {
    expect(() => coseKeyToJwk(new Map<number, Encodable>([[1, 2]]))).toThrow(/no algorithm/);
  });

  it('rejects a curve other than P-256', () => {
    const key = es256CoseKey();
    key.set(-1, 2); // P-384
    expect(() => coseKeyToJwk(key)).toThrow(/Unsupported EC curve 2/);
  });

  it('rejects an EC2 key missing a coordinate', () => {
    const key = es256CoseKey();
    key.delete(-3);
    expect(() => coseKeyToJwk(key)).toThrow(/missing its coordinates/);
  });

  it('rejects an RSA key missing its modulus', () => {
    const key = new Map<number, Encodable>([
      [1, 3],
      [3, COSE_RS256],
      [-2, bytes(0x01, 0x00, 0x01)],
    ]);
    expect(() => coseKeyToJwk(key)).toThrow(/missing its modulus/);
  });

  it('rejects an algorithm it cannot verify rather than guessing', () => {
    const key = es256CoseKey();
    key.set(3, -8); // EdDSA
    expect(() => coseKeyToJwk(key)).toThrow(/Unsupported COSE key/);
  });

  it('rejects a key type it does not know', () => {
    const key = es256CoseKey();
    key.set(1, 4); // symmetric
    expect(() => coseKeyToJwk(key)).toThrow(/Unsupported COSE key/);
  });
});

describe('importParamsFor', () => {
  it('maps ES256 onto ECDSA P-256 with SHA-256', () => {
    const params = importParamsFor(COSE_ES256);
    expect(params.importAlgorithm).toEqual({ name: 'ECDSA', namedCurve: 'P-256' });
    expect(params.verifyAlgorithm).toEqual({ name: 'ECDSA', hash: 'SHA-256' });
  });

  it('maps RS256 onto RSASSA-PKCS1-v1_5', () => {
    const params = importParamsFor(COSE_RS256);
    expect(params.importAlgorithm).toEqual({ name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' });
  });

  it('refuses an algorithm it has no parameters for', () => {
    expect(() => importParamsFor(-8)).toThrow(/Unsupported algorithm -8/);
  });
});

describe('derToRawEcdsaSignature', () => {
  /** DER-wrap two raw components exactly as an authenticator would. */
  function der(r: Uint8Array, s: Uint8Array): Uint8Array {
    const body = concat(bytes(0x02, r.length), r, bytes(0x02, s.length), s);
    return concat(bytes(0x30, body.length), body);
  }

  it('produces 64 bytes from two full-width components', () => {
    const raw = derToRawEcdsaSignature(der(filled(32, 0x11), filled(32, 0x22)));
    expect(raw.length).toBe(64);
    expect(raw.subarray(0, 32)).toEqual(filled(32, 0x11));
    expect(raw.subarray(32)).toEqual(filled(32, 0x22));
  });

  it('strips the sign byte DER adds to a component with a high top bit', () => {
    // 0x00 prefix keeps the integer positive; it is not part of the scalar.
    const r = concat(bytes(0x00), filled(32, 0xff));
    const raw = derToRawEcdsaSignature(der(r, filled(32, 0x01)));
    expect(raw.length).toBe(64);
    expect(raw.subarray(0, 32)).toEqual(filled(32, 0xff));
  });

  it('left-pads a component that is shorter than 32 bytes', () => {
    // A scalar with leading zeroes is encoded short, and must not shift s along.
    const raw = derToRawEcdsaSignature(der(bytes(0x07, 0x08), filled(32, 0x33)));
    expect(raw.subarray(0, 32)).toEqual(concat(filled(30, 0x00), bytes(0x07, 0x08)));
    expect(raw.subarray(32)).toEqual(filled(32, 0x33));
  });

  it('rejects a signature that is not a DER sequence', () => {
    expect(() => derToRawEcdsaSignature(bytes(0x31, 0x02, 0x02, 0x00))).toThrow(
      /not a DER sequence/
    );
  });

  it('rejects a sequence whose components are not integers', () => {
    const body = concat(bytes(0x04, 0x02), bytes(0x00, 0x00));
    expect(() => derToRawEcdsaSignature(concat(bytes(0x30, body.length), body))).toThrow(
      /not a DER integer/
    );
  });

  it('rejects a component that runs past the end', () => {
    expect(() => derToRawEcdsaSignature(bytes(0x30, 0x04, 0x02, 0x20, 0x01))).toThrow(
      /runs past the end/
    );
  });

  it('rejects a component too large to be a P-256 scalar', () => {
    expect(() => derToRawEcdsaSignature(der(filled(33, 0x44), filled(32, 0x01)))).toThrow(
      /too large for P-256/
    );
  });
});
