import {
  COSE_ES256,
  base64UrlToBytes,
  bytesToBase64Url,
  coseKeyToJwk,
  derToRawEcdsaSignature,
  importParamsFor,
  parseAttestationObject,
  parseAuthenticatorData,
} from './webauthn-codec';

/**
 * The rules a WebAuthn ceremony has to satisfy before it means anything.
 *
 * This is the security-critical half of the passkey path, and it is deliberately
 * a set of pure-ish functions returning verdicts rather than a service that
 * throws. Every rule below can therefore be tested by handing it bytes that break
 * exactly one of them — which is the only way to be confident a check is really
 * doing something, because a verifier with a rule quietly inverted still lets
 * every honest user in and looks perfect in a demo.
 *
 * Both ceremonies are here because they share almost all of their rules.
 * Registration establishes a public key; assertion proves possession of the
 * matching private key. The client-data and authenticator-data checks are the
 * same either way, and keeping them in one place is what stops the two paths
 * drifting into enforcing different things.
 *
 * ─── What this does NOT do ────────────────────────────────────────────────────
 *
 * The attestation *statement* is not verified, so this cannot tell you which make
 * of authenticator enrolled — see the note in `parseAttestationObject`.
 *
 * More importantly: all of this runs in the browser, against a public key held in
 * local IndexedDB. That is a real check — it will catch a replayed assertion, a
 * wrong origin, a credential we never enrolled, a signature that does not verify —
 * but it is verification by the same process that would be lying if the bundle
 * were tampered with. It raises the bar at the counter; it is not a substitute
 * for server-side verification. When the Cognito path lands, that is where these
 * checks belong. See the TODO in `webauthn-auth.adapter.ts`.
 */

/** Why a ceremony was refused. Distinct values because they mean different things. */
export type CeremonyRejection =
  /** clientDataJSON was not JSON, or not the shape the spec describes. */
  | 'malformed-client-data'
  /** A registration response arrived where an assertion was expected, or vice versa. */
  | 'wrong-ceremony-type'
  /** Not the challenge we issued — a replay, or a response to someone else's prompt. */
  | 'challenge-mismatch'
  /** Signed for a different site. */
  | 'origin-mismatch'
  /** The ceremony happened in a cross-origin frame, which this app never initiates. */
  | 'cross-origin'
  /** The authenticator signed for a different relying party than the one we asked about. */
  | 'rp-id-mismatch'
  /** Nobody touched the authenticator. */
  | 'user-not-present'
  /**
   * Somebody touched it but was not identified.
   *
   * The rule that makes this authentication rather than a proximity check: without
   * it, anyone holding an unlocked phone passes.
   */
  | 'user-not-verified'
  /** Authenticator data could not be unpacked. */
  | 'malformed-authenticator-data'
  /** A registration carried no credential to store. */
  | 'no-credential-data'
  /** A key type or algorithm we cannot verify with. */
  | 'unsupported-key'
  /** The signature does not verify against the stored public key. */
  | 'bad-signature'
  /** The signature counter went backwards — the hallmark of a cloned credential. */
  | 'counter-regressed';

/** What the ceremony must have been performed against. */
export interface CeremonyExpectations {
  /** base64url, exactly as issued by {@link createChallenge}. */
  readonly challenge: string;
  readonly origin: string;
  readonly rpId: string;
}

export interface RegistrationInput {
  readonly clientDataJson: Uint8Array;
  readonly attestationObject: Uint8Array;
}

export type RegistrationVerdict =
  | {
      readonly ok: true;
      readonly credentialId: string;
      readonly publicKeyJwk: JsonWebKey;
      readonly algorithm: number;
      readonly signCount: number;
    }
  | { readonly ok: false; readonly reason: CeremonyRejection };

export interface AssertionInput {
  readonly clientDataJson: Uint8Array;
  readonly authenticatorData: Uint8Array;
  readonly signature: Uint8Array;
}

/** The public half we kept at registration, as stored. */
export interface StoredCredential {
  readonly publicKeyJwk: JsonWebKey;
  readonly algorithm: number;
  readonly signCount: number;
}

export type AssertionVerdict =
  | { readonly ok: true; readonly signCount: number }
  | { readonly ok: false; readonly reason: CeremonyRejection };

/**
 * A fresh challenge.
 *
 * 32 random bytes, and single-use by contract: the caller must hold it for exactly
 * one ceremony and discard it afterwards. Reuse is what turns a captured assertion
 * into a working credential, and it is the one part of this that no amount of
 * checking downstream can repair.
 */
export function createChallenge(): string {
  return bytesToBase64Url(crypto.getRandomValues(new Uint8Array(32)));
}

/**
 * Check a registration and pull out the credential worth storing.
 *
 * User verification is required here as well as on sign-in, deliberately: a
 * passkey enrolled without identifying the person is a passkey that might belong
 * to whoever happened to be holding the device.
 */
export async function verifyRegistration(
  input: RegistrationInput,
  expected: CeremonyExpectations
): Promise<RegistrationVerdict> {
  const clientData = checkClientData(input.clientDataJson, 'webauthn.create', expected);
  if (clientData !== null) {
    return { ok: false, reason: clientData };
  }

  let authData;
  try {
    const attestation = parseAttestationObject(input.attestationObject);
    authData = parseAuthenticatorData(attestation.authData);
  } catch {
    return { ok: false, reason: 'malformed-authenticator-data' };
  }

  const authDataProblem = await checkAuthenticatorData(authData, expected.rpId);
  if (authDataProblem !== null) {
    return { ok: false, reason: authDataProblem };
  }

  if (!authData.flags.attestedCredentialData || !authData.credentialId || !authData.coseKey) {
    return { ok: false, reason: 'no-credential-data' };
  }

  let converted;
  try {
    converted = coseKeyToJwk(authData.coseKey);
  } catch {
    return { ok: false, reason: 'unsupported-key' };
  }

  return {
    ok: true,
    credentialId: bytesToBase64Url(authData.credentialId),
    publicKeyJwk: converted.jwk,
    algorithm: converted.algorithm,
    signCount: authData.signCount,
  };
}

/**
 * Check an assertion against the credential we stored for it.
 *
 * @returns the counter to persist on success — the caller must write it back, or
 *   the clone check below is checking against a value that never moves.
 */
export async function verifyAssertion(
  input: AssertionInput,
  credential: StoredCredential,
  expected: CeremonyExpectations
): Promise<AssertionVerdict> {
  const clientData = checkClientData(input.clientDataJson, 'webauthn.get', expected);
  if (clientData !== null) {
    return { ok: false, reason: clientData };
  }

  let authData;
  try {
    authData = parseAuthenticatorData(input.authenticatorData);
  } catch {
    return { ok: false, reason: 'malformed-authenticator-data' };
  }

  const authDataProblem = await checkAuthenticatorData(authData, expected.rpId);
  if (authDataProblem !== null) {
    return { ok: false, reason: authDataProblem };
  }

  const signatureValid = await verifySignature(input, credential);
  if (!signatureValid) {
    return { ok: false, reason: 'bad-signature' };
  }

  if (!isCounterAcceptable(authData.signCount, credential.signCount)) {
    return { ok: false, reason: 'counter-regressed' };
  }

  return { ok: true, signCount: authData.signCount };
}

/**
 * Whether the counter moved in a way consistent with a genuine authenticator.
 *
 * Two legal behaviours, and the awkwardness is that they overlap. An authenticator
 * that counts must strictly increase, and a counter that repeats or goes backwards
 * means two devices are answering for one credential. An authenticator with
 * hardware-bound keys — Apple's, and most platform ones — cannot be cloned and so
 * reports 0 forever.
 *
 * Both are accepted; what is refused is a counter that was moving and then stopped
 * or went back, which is the shape a clone actually has.
 */
export function isCounterAcceptable(incoming: number, stored: number): boolean {
  if (incoming === 0 && stored === 0) {
    return true;
  }
  return incoming > stored;
}

/**
 * The signed payload is authenticatorData followed by the SHA-256 of
 * clientDataJSON — never clientDataJSON itself.
 */
async function verifySignature(
  input: AssertionInput,
  credential: StoredCredential
): Promise<boolean> {
  try {
    const { importAlgorithm, verifyAlgorithm } = importParamsFor(credential.algorithm);
    const key = await crypto.subtle.importKey(
      'jwk',
      credential.publicKeyJwk,
      importAlgorithm,
      false,
      ['verify']
    );

    const clientDataHash = new Uint8Array(
      await crypto.subtle.digest('SHA-256', input.clientDataJson as Uint8Array<ArrayBuffer>)
    );
    const signed = new Uint8Array(input.authenticatorData.length + clientDataHash.length);
    signed.set(input.authenticatorData, 0);
    signed.set(clientDataHash, input.authenticatorData.length);

    // ES256 arrives DER-encoded and has to be unwrapped; RS256 is already raw.
    const signature =
      credential.algorithm === COSE_ES256
        ? derToRawEcdsaSignature(input.signature)
        : input.signature;

    return await crypto.subtle.verify(
      verifyAlgorithm,
      key,
      signature as Uint8Array<ArrayBuffer>,
      signed as Uint8Array<ArrayBuffer>
    );
  } catch {
    // An unimportable key or an unparseable signature is a failed verification, not
    // a crash to propagate — the caller's response is identical either way.
    return false;
  }
}

/** The JSON the browser signs over, as far as we care about it. */
interface ClientData {
  type?: unknown;
  challenge?: unknown;
  origin?: unknown;
  crossOrigin?: unknown;
}

/**
 * @returns the rejection, or null when the client data is acceptable.
 */
function checkClientData(
  clientDataJson: Uint8Array,
  expectedType: 'webauthn.create' | 'webauthn.get',
  expected: CeremonyExpectations
): CeremonyRejection | null {
  let parsed: ClientData;
  try {
    parsed = JSON.parse(new TextDecoder().decode(clientDataJson)) as ClientData;
  } catch {
    return 'malformed-client-data';
  }
  if (parsed === null || typeof parsed !== 'object') {
    return 'malformed-client-data';
  }
  if (typeof parsed.type !== 'string' || typeof parsed.challenge !== 'string') {
    return 'malformed-client-data';
  }

  // Checked before the challenge so a registration response replayed into the
  // sign-in path is reported as what it is.
  if (parsed.type !== expectedType) {
    return 'wrong-ceremony-type';
  }
  if (!sameBytes(parsed.challenge, expected.challenge)) {
    return 'challenge-mismatch';
  }
  if (parsed.origin !== expected.origin) {
    return 'origin-mismatch';
  }
  // Only ever true when the ceremony ran in an iframe on another site. This app
  // never initiates one, so its presence means something else did.
  if (parsed.crossOrigin === true) {
    return 'cross-origin';
  }
  return null;
}

/**
 * @returns the rejection, or null when the authenticator data is acceptable.
 */
async function checkAuthenticatorData(
  authData: { rpIdHash: Uint8Array; flags: { userPresent: boolean; userVerified: boolean } },
  rpId: string
): Promise<CeremonyRejection | null> {
  const expectedHash = new Uint8Array(
    await crypto.subtle.digest('SHA-256', new TextEncoder().encode(rpId))
  );
  if (!equalBytes(authData.rpIdHash, expectedHash)) {
    return 'rp-id-mismatch';
  }
  if (!authData.flags.userPresent) {
    return 'user-not-present';
  }
  if (!authData.flags.userVerified) {
    return 'user-not-verified';
  }
  return null;
}

/**
 * Compare two base64url strings by the bytes they denote.
 *
 * Not by string equality: padding is optional, so the same challenge can be
 * spelled two ways and a textual comparison would reject a perfectly good
 * response from an authenticator that pads.
 */
function sameBytes(a: string, b: string): boolean {
  try {
    return equalBytes(base64UrlToBytes(a), base64UrlToBytes(b));
  } catch {
    return false;
  }
}

function equalBytes(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length || a.length === 0) {
    return false;
  }
  let diff = 0;
  for (let i = 0; i < a.length; i++) {
    diff |= a[i] ^ b[i];
  }
  return diff === 0;
}
