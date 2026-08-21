import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import {
  CeremonyExpectations,
  createChallenge,
  isCounterAcceptable,
  verifyAssertion,
  verifyRegistration,
} from './ceremony-verifier';
import { COSE_ES256, base64UrlToBytes, bytesToBase64Url } from './webauthn-codec';
import {
  FakeAuthenticator,
  Flags,
  ORIGIN,
  RP_ID,
  attestationObject,
  buildAuthenticatorData,
  buildClientData,
  cborBytes,
  cborInt,
  cborMap,
  createEs256Authenticator,
  createRs256Authenticator,
  signAssertion,
} from './fake-authenticator.fixture';

// Fixtures live in `fake-authenticator.fixture.ts`, shared with the adapter spec.

// ---------------------------------------------------------------------------

let es256: FakeAuthenticator;
let challenge: string;
let expected: CeremonyExpectations;

beforeAll(async () => {
  es256 = await createEs256Authenticator();
});

beforeEach(() => {
  challenge = createChallenge();
  expected = { challenge, origin: ORIGIN, rpId: RP_ID };
});

describe('createChallenge', () => {
  it('produces 32 bytes of base64url', () => {
    expect(base64UrlToBytes(createChallenge()).length).toBe(32);
  });

  it('never produces the same challenge twice', () => {
    const seen = new Set(Array.from({ length: 50 }, () => createChallenge()));
    expect(seen.size).toBe(50);
  });
});

describe('isCounterAcceptable', () => {
  it('accepts a counter that advanced', () => {
    expect(isCounterAcceptable(9, 8)).toBe(true);
  });

  it('accepts an authenticator that never counts at all', () => {
    // Apple's platform authenticator reports 0 forever; hardware-bound keys cannot
    // be cloned, so there is nothing for a counter to detect.
    expect(isCounterAcceptable(0, 0)).toBe(true);
  });

  it('refuses a counter that repeats — two devices answering for one credential', () => {
    expect(isCounterAcceptable(8, 8)).toBe(false);
  });

  it('refuses a counter that went backwards', () => {
    expect(isCounterAcceptable(3, 8)).toBe(false);
  });

  it('refuses a counter that dropped to zero after having counted', () => {
    expect(isCounterAcceptable(0, 5)).toBe(false);
  });
});

describe('verifyRegistration', () => {
  async function register(
    overrides: {
      clientData?: Parameters<typeof buildClientData>[0];
      flags?: Flags;
      rpId?: string;
      signCount?: number;
      coseKey?: Uint8Array;
      attested?: boolean;
    } = {}
  ) {
    const authData = await buildAuthenticatorData({
      rpId: overrides.rpId,
      flags: overrides.flags,
      signCount: overrides.signCount,
      attestedCredential:
        overrides.attested === false
          ? undefined
          : {
              credentialId: Uint8Array.from([1, 2, 3, 4]),
              coseKey: overrides.coseKey ?? es256.coseKey,
            },
    });
    return verifyRegistration(
      {
        clientDataJson: buildClientData({
          type: 'webauthn.create',
          challenge,
          ...overrides.clientData,
        }),
        attestationObject: attestationObject(authData),
      },
      expected
    );
  }

  it('accepts a well-formed registration and returns the credential to store', async () => {
    const verdict = await register({ signCount: 7 });
    expect(verdict.ok).toBe(true);
    if (!verdict.ok) return;
    expect(verdict.credentialId).toBe(bytesToBase64Url(Uint8Array.from([1, 2, 3, 4])));
    expect(verdict.algorithm).toBe(COSE_ES256);
    expect(verdict.publicKeyJwk.kty).toBe('EC');
    expect(verdict.signCount).toBe(7);
  });

  it('accepts a challenge echoed back with base64 padding', async () => {
    const padded = challenge + '='.repeat((4 - (challenge.length % 4)) % 4);
    const verdict = await register({ clientData: { challenge: padded } });
    expect(verdict.ok).toBe(true);
  });

  it('refuses an assertion response replayed into the registration path', async () => {
    const verdict = await register({ clientData: { type: 'webauthn.get' } });
    expect(verdict).toEqual({ ok: false, reason: 'wrong-ceremony-type' });
  });

  it('refuses a challenge we did not issue', async () => {
    const verdict = await register({ clientData: { challenge: createChallenge() } });
    expect(verdict).toEqual({ ok: false, reason: 'challenge-mismatch' });
  });

  it('refuses a different origin', async () => {
    const verdict = await register({ clientData: { origin: 'https://evil.example' } });
    expect(verdict).toEqual({ ok: false, reason: 'origin-mismatch' });
  });

  it('refuses a ceremony run in a cross-origin frame', async () => {
    const verdict = await register({ clientData: { crossOrigin: true } });
    expect(verdict).toEqual({ ok: false, reason: 'cross-origin' });
  });

  it('refuses a relying party other than ours', async () => {
    const verdict = await register({ rpId: 'other.example' });
    expect(verdict).toEqual({ ok: false, reason: 'rp-id-mismatch' });
  });

  it('refuses an enrollment nobody touched', async () => {
    const verdict = await register({ flags: { userPresent: false } });
    expect(verdict).toEqual({ ok: false, reason: 'user-not-present' });
  });

  it('refuses an enrollment where the person was not identified', async () => {
    const verdict = await register({ flags: { userVerified: false } });
    expect(verdict).toEqual({ ok: false, reason: 'user-not-verified' });
  });

  it('refuses a registration carrying no credential', async () => {
    const verdict = await register({ attested: false });
    expect(verdict).toEqual({ ok: false, reason: 'no-credential-data' });
  });

  it('refuses a key algorithm it cannot verify with', async () => {
    const eddsa = cborMap([
      [cborInt(1), cborInt(1)], // kty: OKP
      [cborInt(3), cborInt(-8)], // alg: EdDSA
      [cborInt(-1), cborInt(6)],
      [cborInt(-2), cborBytes(new Uint8Array(32).fill(9))],
    ]);
    const verdict = await register({ coseKey: eddsa });
    expect(verdict).toEqual({ ok: false, reason: 'unsupported-key' });
  });

  it('refuses an attestation object that does not parse', async () => {
    const verdict = await verifyRegistration(
      {
        clientDataJson: buildClientData({ type: 'webauthn.create', challenge }),
        attestationObject: Uint8Array.from([0xff, 0xff, 0xff]),
      },
      expected
    );
    expect(verdict).toEqual({ ok: false, reason: 'malformed-authenticator-data' });
  });

  it('refuses client data that is not JSON', async () => {
    const verdict = await verifyRegistration(
      {
        clientDataJson: new TextEncoder().encode('not json at all'),
        attestationObject: attestationObject(await buildAuthenticatorData({})),
      },
      expected
    );
    expect(verdict).toEqual({ ok: false, reason: 'malformed-client-data' });
  });

  it('refuses client data missing the fields it must have', async () => {
    const verdict = await verifyRegistration(
      {
        clientDataJson: new TextEncoder().encode(JSON.stringify({ origin: ORIGIN })),
        attestationObject: attestationObject(await buildAuthenticatorData({})),
      },
      expected
    );
    expect(verdict).toEqual({ ok: false, reason: 'malformed-client-data' });
  });

  it('refuses client data that is valid JSON but not an object', async () => {
    const verdict = await verifyRegistration(
      {
        clientDataJson: new TextEncoder().encode('"a string"'),
        attestationObject: attestationObject(await buildAuthenticatorData({})),
      },
      expected
    );
    expect(verdict).toEqual({ ok: false, reason: 'malformed-client-data' });
  });
});

describe('verifyAssertion', () => {
  async function assertWith(
    authenticator: FakeAuthenticator,
    overrides: {
      clientData?: Parameters<typeof buildClientData>[0];
      flags?: Flags;
      rpId?: string;
      signCount?: number;
      storedSignCount?: number;
      storedJwk?: JsonWebKey;
    } = {}
  ) {
    const authData = await buildAuthenticatorData({
      rpId: overrides.rpId,
      flags: overrides.flags,
      signCount: overrides.signCount ?? 0,
    });
    const input = await signAssertion(
      authenticator,
      authData,
      buildClientData({ type: 'webauthn.get', challenge, ...overrides.clientData })
    );
    return verifyAssertion(
      input,
      {
        publicKeyJwk: overrides.storedJwk ?? authenticator.publicKeyJwk,
        algorithm: authenticator.algorithm,
        signCount: overrides.storedSignCount ?? 0,
      },
      expected
    );
  }

  it('accepts a real ES256 assertion and returns the counter to persist', async () => {
    const verdict = await assertWith(es256, { signCount: 12, storedSignCount: 11 });
    expect(verdict).toEqual({ ok: true, signCount: 12 });
  });

  it('accepts a real RS256 assertion, for Windows Hello', async () => {
    const rs256 = await createRs256Authenticator();
    const verdict = await assertWith(rs256, { signCount: 3, storedSignCount: 2 });
    expect(verdict).toEqual({ ok: true, signCount: 3 });
  });

  it('refuses a signature made by a different key', async () => {
    const impostor = await createEs256Authenticator();
    const verdict = await assertWith(es256, { storedJwk: impostor.publicKeyJwk });
    expect(verdict).toEqual({ ok: false, reason: 'bad-signature' });
  });

  it('refuses an assertion whose authenticator data was altered after signing', async () => {
    const authData = await buildAuthenticatorData({ signCount: 5 });
    const clientDataJson = buildClientData({ type: 'webauthn.get', challenge });
    const input = await signAssertion(es256, authData, clientDataJson);
    const tampered = Uint8Array.from(input.authenticatorData);
    tampered[tampered.length - 1] ^= 0xff; // bump the counter, keep the signature
    const verdict = await verifyAssertion(
      { ...input, authenticatorData: tampered },
      { publicKeyJwk: es256.publicKeyJwk, algorithm: es256.algorithm, signCount: 0 },
      expected
    );
    expect(verdict).toEqual({ ok: false, reason: 'bad-signature' });
  });

  it('refuses a corrupted signature', async () => {
    const authData = await buildAuthenticatorData({});
    const clientDataJson = buildClientData({ type: 'webauthn.get', challenge });
    const input = await signAssertion(es256, authData, clientDataJson);
    const signature = Uint8Array.from(input.signature);
    signature[signature.length - 1] ^= 0xff;
    const verdict = await verifyAssertion(
      { ...input, signature },
      { publicKeyJwk: es256.publicKeyJwk, algorithm: es256.algorithm, signCount: 0 },
      expected
    );
    expect(verdict).toEqual({ ok: false, reason: 'bad-signature' });
  });

  it('refuses a signature that is not even DER', async () => {
    const authData = await buildAuthenticatorData({});
    const clientDataJson = buildClientData({ type: 'webauthn.get', challenge });
    const verdict = await verifyAssertion(
      { authenticatorData: authData, clientDataJson, signature: Uint8Array.from([0, 1, 2]) },
      { publicKeyJwk: es256.publicKeyJwk, algorithm: es256.algorithm, signCount: 0 },
      expected
    );
    expect(verdict).toEqual({ ok: false, reason: 'bad-signature' });
  });

  it('refuses a stored key that cannot be imported', async () => {
    const verdict = await assertWith(es256, { storedJwk: { kty: 'EC', crv: 'P-256' } });
    expect(verdict).toEqual({ ok: false, reason: 'bad-signature' });
  });

  it('refuses a replayed assertion whose counter did not advance', async () => {
    const verdict = await assertWith(es256, { signCount: 4, storedSignCount: 4 });
    expect(verdict).toEqual({ ok: false, reason: 'counter-regressed' });
  });

  it('accepts an authenticator that always reports zero', async () => {
    const verdict = await assertWith(es256, { signCount: 0, storedSignCount: 0 });
    expect(verdict).toEqual({ ok: true, signCount: 0 });
  });

  it('refuses a registration response replayed into the sign-in path', async () => {
    const verdict = await assertWith(es256, { clientData: { type: 'webauthn.create' } });
    expect(verdict).toEqual({ ok: false, reason: 'wrong-ceremony-type' });
  });

  it('refuses a challenge we did not issue', async () => {
    const verdict = await assertWith(es256, { clientData: { challenge: createChallenge() } });
    expect(verdict).toEqual({ ok: false, reason: 'challenge-mismatch' });
  });

  it('refuses a challenge that is not base64url at all', async () => {
    const verdict = await assertWith(es256, { clientData: { challenge: '!!!!' } });
    expect(verdict).toEqual({ ok: false, reason: 'challenge-mismatch' });
  });

  it('refuses another origin', async () => {
    const verdict = await assertWith(es256, { clientData: { origin: 'https://evil.example' } });
    expect(verdict).toEqual({ ok: false, reason: 'origin-mismatch' });
  });

  it('refuses another relying party', async () => {
    const verdict = await assertWith(es256, { rpId: 'other.example' });
    expect(verdict).toEqual({ ok: false, reason: 'rp-id-mismatch' });
  });

  it('refuses an assertion where nobody was present', async () => {
    const verdict = await assertWith(es256, { flags: { userPresent: false } });
    expect(verdict).toEqual({ ok: false, reason: 'user-not-present' });
  });

  it('refuses a touch that identified nobody — the rule that makes this authentication', async () => {
    const verdict = await assertWith(es256, { flags: { userVerified: false } });
    expect(verdict).toEqual({ ok: false, reason: 'user-not-verified' });
  });

  it('refuses authenticator data too short to be real', async () => {
    const verdict = await verifyAssertion(
      {
        authenticatorData: new Uint8Array(10),
        clientDataJson: buildClientData({ type: 'webauthn.get', challenge }),
        signature: new Uint8Array(64),
      },
      { publicKeyJwk: es256.publicKeyJwk, algorithm: es256.algorithm, signCount: 0 },
      expected
    );
    expect(verdict).toEqual({ ok: false, reason: 'malformed-authenticator-data' });
  });

  it('checks the signature before the counter, so a forgery is never reported as a clone', async () => {
    // A forged assertion with a regressed counter breaks two rules at once. The
    // signature is the one that matters: reporting "counter-regressed" would send
    // whoever reads the log looking for a cloned device instead of an attacker.
    const impostor = await createEs256Authenticator();
    const verdict = await assertWith(es256, {
      signCount: 1,
      storedSignCount: 9,
      storedJwk: impostor.publicKeyJwk,
    });
    expect(verdict).toEqual({ ok: false, reason: 'bad-signature' });
  });
});
