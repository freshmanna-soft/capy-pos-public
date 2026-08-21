import { Injectable, inject } from '@angular/core';
import {
  DexieDatabase,
  IOperatorCredentialDB,
  IOperatorDB,
} from '@core/infrastructure/database/dexie-database.service';
import { AuthSessionDto } from '@core/application/auth/dtos/auth-session.dto';
import {
  PasskeySummaryDto,
  QuickAuthCapabilitiesDto,
  QuickSignInOperatorDto,
} from '@core/application/auth/dtos/quick-auth.dto';
import {
  InvalidPinError,
  OperatorInactiveError,
  PasskeyCancelledError,
  PasskeyUnavailableError,
  PasskeyVerificationError,
  QuickAuthGateway,
} from '@core/application/auth/ports/quick-auth.port';
import {
  PasskeyAlreadyEnrolledError,
  QuickAuthAdminPort,
  WeakPinError,
} from '@core/application/auth/ports/quick-auth-admin.port';
import { SessionIssuer } from '../session-issuer';
import { compareSecret, hashSecret } from '../secret-hash';
import { validatePin } from './pin-policy';
import {
  CeremonyExpectations,
  createChallenge,
  verifyAssertion,
  verifyRegistration,
} from './ceremony-verifier';
import { COSE_ES256, COSE_RS256, base64UrlToBytes, bytesToBase64Url } from './webauthn-codec';

/**
 * The name the OS shows in its prompt, and in the operator's saved-passkey list.
 */
const RELYING_PARTY_NAME = 'Capy POS';

/** Long enough to find a finger, short enough that a forgotten prompt gives up. */
const CEREMONY_TIMEOUT_MS = 60_000;

/**
 * WebAuthnAuthAdapter
 *
 * Signing in with the sensor the device already has. Implements both quick-auth
 * ports: the gateway the login screen uses, and the admin port settings uses to
 * enroll.
 *
 * The privacy property that makes this worth building, stated plainly: no
 * biometric data reaches this application. The fingerprint or face is matched
 * inside the operating system's secure enclave, which then signs a challenge with
 * a private key that also never leaves. What we store is the public half. A dump
 * of our IndexedDB reveals which operators can sign in at this till and nothing
 * about how any of them look — which is the whole reason this exists instead of
 * the face recognition originally asked for.
 *
 * ─── TODO: verification belongs on a server ───────────────────────────────────
 *
 * Every check in `ceremony-verifier.ts` runs in the browser, against a public key
 * in local IndexedDB, and the session it produces is signed with the hardcoded
 * HMAC secret in `session-issuer.ts`. That combination is honest about what it is:
 * a real improvement at the counter — no password to shoulder-surf, a genuine
 * user-verification gesture, credentials bound to one device — and *not*
 * server-verified authentication. Anyone who can modify the served bundle can
 * bypass all of it.
 *
 * The fix is not more checks here; it is moving the challenge issuing, the
 * assertion verification and the signature-counter store behind Cognito
 * (`cognito-auth.adapter.ts`, #42), which is also where the JWT should be signed
 * with a real secret. Until then this is appropriate for an offline-first kiosk
 * and should not be treated as more than that.
 */
@Injectable()
export class WebAuthnAuthAdapter implements QuickAuthGateway, QuickAuthAdminPort {
  private readonly db = inject(DexieDatabase);
  private readonly sessions = inject(SessionIssuer);

  // ─── Gateway ──────────────────────────────────────────────────────────────

  async capabilities(): Promise<QuickAuthCapabilitiesDto> {
    const [passkeyEnrolledHere, pinAvailable] = await Promise.all([
      this.db.operatorCredentials.count().then((count) => count > 0),
      this.countOperatorsWithPin().then((count) => count > 0),
    ]);
    return {
      passkeySupported: await platformAuthenticatorAvailable(),
      passkeyEnrolledHere,
      pinAvailable,
    };
  }

  /**
   * Sign in with a passkey.
   *
   * `allowCredentials` is deliberately left empty. The credential is discoverable,
   * so the authenticator offers its own account picker and the assertion tells us
   * who it belongs to — whereas listing our stored ids would hand a stranger at the
   * till an enumeration of who works here, for no benefit.
   */
  async signInWithPasskey(): Promise<AuthSessionDto> {
    if (!(await platformAuthenticatorAvailable())) {
      throw new PasskeyUnavailableError();
    }
    if ((await this.db.operatorCredentials.count()) === 0) {
      throw new PasskeyUnavailableError('No passkey is enrolled on this device');
    }

    const expectations = this.expectations(createChallenge());

    let credential: PublicKeyCredential;
    try {
      const result = await navigator.credentials.get({
        publicKey: {
          challenge: toBuffer(base64UrlToBytes(expectations.challenge)),
          rpId: expectations.rpId,
          userVerification: 'required',
          timeout: CEREMONY_TIMEOUT_MS,
          allowCredentials: [],
        },
      });
      if (!result) {
        throw new PasskeyCancelledError();
      }
      credential = result as PublicKeyCredential;
    } catch (error) {
      throw translateCeremonyError(error);
    }

    const response = credential.response as AuthenticatorAssertionResponse;
    const credentialId = bytesToBase64Url(new Uint8Array(credential.rawId));

    const stored = await this.db.operatorCredentials.get(credentialId);
    if (!stored) {
      // The authenticator holds a key we have no record of — someone else's
      // passkey for this origin, or one revoked here. Either way, not a sign-in.
      throw new PasskeyVerificationError('That passkey is not enrolled on this till');
    }

    // The authenticator echoes back the user handle we set at registration. It must
    // agree with the row we just looked up by credential id; a mismatch would mean
    // our own records disagree with the device's.
    if (response.userHandle) {
      const handle = new TextDecoder().decode(new Uint8Array(response.userHandle));
      if (handle !== stored.operatorId) {
        throw new PasskeyVerificationError('That passkey points at a different operator');
      }
    }

    const verdict = await verifyAssertion(
      {
        clientDataJson: new Uint8Array(response.clientDataJSON),
        authenticatorData: new Uint8Array(response.authenticatorData),
        signature: new Uint8Array(response.signature),
      },
      {
        publicKeyJwk: JSON.parse(stored.publicKeyJwk) as JsonWebKey,
        algorithm: stored.algorithm,
        signCount: stored.signCount,
      },
      expectations
    );

    if (!verdict.ok) {
      throw new PasskeyVerificationError(describeRejection(verdict.reason));
    }

    // Written back before the session is issued: the counter is the clone check, and
    // a counter we verified but failed to persist is a counter that never moves.
    await this.db.operatorCredentials.update(credentialId, {
      signCount: verdict.signCount,
      lastUsedAt: new Date(),
    });

    return this.issueFor(stored.operatorId);
  }

  async signInWithPin(operatorId: string, pin: string): Promise<AuthSessionDto> {
    const operator = await this.db.operators.get(operatorId);

    // One outcome for "no such operator", "no PIN set" and "wrong PIN". Telling
    // them apart would turn the keypad into a way to find out who has a PIN, and
    // whoever is typing can do nothing differently with the distinction.
    if (!operator?.isActive || !operator.pinHash) {
      throw new InvalidPinError();
    }
    if (!(await compareSecret(pin, operator.pinHash))) {
      throw new InvalidPinError();
    }

    return this.sessions.issueFor(operator);
  }

  async listPinOperators(): Promise<QuickSignInOperatorDto[]> {
    const operators = await this.activeOperatorsWithPin();
    return operators
      .map((operator) => ({ operatorId: operator.id, displayName: operator.displayName }))
      .sort((a, b) => a.displayName.localeCompare(b.displayName));
  }

  // ─── Admin ────────────────────────────────────────────────────────────────

  async enrollPasskey(operatorId: string, label: string): Promise<PasskeySummaryDto> {
    if (!(await platformAuthenticatorAvailable())) {
      throw new PasskeyUnavailableError();
    }

    const operator = await this.db.operators.get(operatorId);
    if (!operator?.isActive) {
      throw new OperatorInactiveError();
    }

    const expectations = this.expectations(createChallenge());
    const existing = await this.db.operatorCredentials
      .where('operatorId')
      .equals(operatorId)
      .toArray();

    let credential: PublicKeyCredential;
    try {
      const result = await navigator.credentials.create({
        publicKey: {
          rp: { id: expectations.rpId, name: RELYING_PARTY_NAME },
          user: {
            id: toBuffer(new TextEncoder().encode(operator.id)),
            name: operator.email,
            displayName: operator.displayName,
          },
          challenge: toBuffer(base64UrlToBytes(expectations.challenge)),
          // ES256 first: it is what every platform authenticator except Windows
          // Hello prefers, and the order is a preference the authenticator honours.
          pubKeyCredParams: [
            { type: 'public-key', alg: COSE_ES256 },
            { type: 'public-key', alg: COSE_RS256 },
          ],
          authenticatorSelection: {
            // The built-in sensor, not a roaming security key: this is a shift
            // switch at a counter, and a key on a lanyard can walk off with someone.
            authenticatorAttachment: 'platform',
            // Discoverable, so sign-in needs no operator id up front.
            residentKey: 'required',
            userVerification: 'required',
          },
          // Not requested: we do not check attestation statements, and asking for one
          // shows the user an extra consent prompt about device identity for nothing.
          attestation: 'none',
          // Lets the authenticator refuse a second enrollment for a key it already
          // holds — it knows what it has, and we only know what we recorded.
          excludeCredentials: existing.map((row) => ({
            type: 'public-key' as const,
            id: toBuffer(base64UrlToBytes(row.credentialId)),
          })),
          timeout: CEREMONY_TIMEOUT_MS,
        },
      });
      if (!result) {
        throw new PasskeyCancelledError();
      }
      credential = result as PublicKeyCredential;
    } catch (error) {
      throw translateCeremonyError(error);
    }

    const response = credential.response as AuthenticatorAttestationResponse;
    const verdict = await verifyRegistration(
      {
        clientDataJson: new Uint8Array(response.clientDataJSON),
        attestationObject: new Uint8Array(response.attestationObject),
      },
      expectations
    );

    if (!verdict.ok) {
      throw new PasskeyVerificationError(describeRejection(verdict.reason));
    }

    const row: IOperatorCredentialDB = {
      credentialId: verdict.credentialId,
      operatorId: operator.id,
      tenantId: operator.tenantId,
      publicKeyJwk: JSON.stringify(verdict.publicKeyJwk),
      algorithm: verdict.algorithm,
      signCount: verdict.signCount,
      label: label.trim().length > 0 ? label.trim() : 'This device',
      transports: JSON.stringify(readTransports(response)),
      createdAt: new Date(),
    };
    await this.db.operatorCredentials.add(row);

    return toSummary(row);
  }

  async listPasskeys(operatorId: string): Promise<PasskeySummaryDto[]> {
    const rows = await this.db.operatorCredentials.where('operatorId').equals(operatorId).toArray();
    return rows
      .sort(
        (a, b) =>
          // Oldest first. A row whose timestamp is unreadable sorts last rather than
          // to the epoch, so an anomaly cannot displace the entry someone is looking for.
          (readInstant(a.createdAt) ?? Number.MAX_SAFE_INTEGER) -
          (readInstant(b.createdAt) ?? Number.MAX_SAFE_INTEGER)
      )
      .map((row) => toSummary(row));
  }

  async revokePasskey(credentialId: string): Promise<void> {
    await this.db.operatorCredentials.delete(credentialId);
  }

  async setPin(operatorId: string, pin: string): Promise<void> {
    const rejection = validatePin(pin);
    if (rejection) {
      throw new WeakPinError(rejection);
    }

    const operator = await this.db.operators.get(operatorId);
    if (!operator?.isActive) {
      throw new OperatorInactiveError();
    }

    await this.db.operators.update(operatorId, {
      pinHash: await hashSecret(pin),
      pinUpdatedAt: new Date(),
    });
  }

  /**
   * Remove the PIN by writing the record back without those fields.
   *
   * Not `update({ pinHash: undefined })`: Dexie's update treats undefined as "leave
   * this alone", so that call would silently do nothing and leave the operator
   * still able to sign in with a PIN they believe they deleted.
   */
  async clearPin(operatorId: string): Promise<void> {
    const operator = await this.db.operators.get(operatorId);
    if (!operator) {
      return;
    }
    const { pinHash: _pinHash, pinUpdatedAt: _pinUpdatedAt, ...withoutPin } = operator;
    await this.db.operators.put(withoutPin as IOperatorDB);
  }

  // ─── Helpers ──────────────────────────────────────────────────────────────

  /**
   * What the ceremony must be performed against.
   *
   * `rpId` is the bare hostname while `origin` carries the scheme and port, because
   * that is what each is compared to: the authenticator hashes the hostname, the
   * browser reports the full origin. Read from `location` rather than configured, so
   * a till served from a custom domain needs no build-time change.
   */
  private expectations(challenge: string): CeremonyExpectations {
    return { challenge, origin: location.origin, rpId: location.hostname };
  }

  /** Issue a session, refusing one for an operator switched off since enrollment. */
  private async issueFor(operatorId: string): Promise<AuthSessionDto> {
    const operator = await this.db.operators.get(operatorId);
    if (!operator?.isActive) {
      throw new OperatorInactiveError();
    }
    return this.sessions.issueFor(operator);
  }

  /**
   * Operators with a PIN.
   *
   * A scan rather than an index lookup: `pinHash` is deliberately unindexed (it is a
   * secret, and indexing it would put it in a second place), and this runs once when
   * the login screen opens against a table with a handful of rows.
   */
  private async activeOperatorsWithPin(): Promise<IOperatorDB[]> {
    return this.db.operators
      .filter((operator) => operator.isActive && !!operator.pinHash)
      .toArray();
  }

  private async countOperatorsWithPin(): Promise<number> {
    return (await this.activeOperatorsWithPin()).length;
  }
}

// ---------------------------------------------------------------------------
// Module helpers
// ---------------------------------------------------------------------------

/**
 * Whether this device can verify a person itself.
 *
 * Both halves are checked because they fail separately: a browser with no WebAuthn
 * at all, and a browser that has it but no built-in sensor (a desktop with no
 * Hello). Any error is treated as "no" — this only decides whether to offer a
 * button, and offering one that cannot work is worse than not offering it.
 */
async function platformAuthenticatorAvailable(): Promise<boolean> {
  const available = (
    globalThis as {
      PublicKeyCredential?: {
        isUserVerifyingPlatformAuthenticatorAvailable?: () => Promise<boolean>;
      };
    }
  ).PublicKeyCredential?.isUserVerifyingPlatformAuthenticatorAvailable;

  if (typeof available !== 'function' || !globalThis.navigator?.credentials) {
    return false;
  }
  try {
    return await available.call(
      (globalThis as unknown as { PublicKeyCredential: unknown }).PublicKeyCredential
    );
  } catch {
    return false;
  }
}

/**
 * Turn what the browser threw into what the caller should show.
 *
 * The distinction that matters is cancellation. A dismissed prompt arrives as
 * `NotAllowedError` — the same name the spec uses for a genuine refusal — and it
 * must not produce an error banner, because the cashier who touched the sensor by
 * mistake has done nothing wrong. Everything unrecognised is passed through
 * untouched rather than flattened into a generic failure.
 */
function translateCeremonyError(error: unknown): unknown {
  if (
    error instanceof PasskeyCancelledError ||
    error instanceof PasskeyUnavailableError ||
    error instanceof PasskeyVerificationError
  ) {
    return error;
  }

  // Checked by name rather than `instanceof DOMException`: a DOMException raised in
  // another realm fails the instance check while still being the error we mean.
  const name =
    error && typeof error === 'object' && 'name' in error ? String(error.name) : undefined;

  switch (name) {
    case 'NotAllowedError':
    case 'AbortError':
    case 'TimeoutError':
      return new PasskeyCancelledError();
    case 'InvalidStateError':
      return new PasskeyAlreadyEnrolledError();
    case 'NotSupportedError':
      return new PasskeyUnavailableError('This device cannot create that kind of passkey');
    case 'SecurityError':
      // Wrong relying-party id for the page's origin, or an insecure context.
      return new PasskeyUnavailableError('Passkeys need a secure connection to this domain');
    default:
      return error;
  }
}

/** Turn a verifier rejection into something worth putting in front of a person. */
function describeRejection(reason: string): string {
  switch (reason) {
    case 'user-not-verified':
    case 'user-not-present':
      return 'That did not verify who you are. Try again.';
    case 'counter-regressed':
      return 'That passkey looks like a copy. Remove it and enroll again.';
    case 'challenge-mismatch':
      return 'That sign-in attempt expired. Try again.';
    default:
      return 'That passkey could not be verified.';
  }
}

/** `getTransports` is not implemented everywhere; absence is not a failure. */
function readTransports(response: AuthenticatorAttestationResponse): string[] {
  try {
    return typeof response.getTransports === 'function' ? response.getTransports() : [];
  } catch {
    return [];
  }
}

function toSummary(row: IOperatorCredentialDB): PasskeySummaryDto {
  const createdAt = readInstant(row.createdAt);
  const lastUsedAt = readInstant(row.lastUsedAt);
  return {
    credentialId: row.credentialId,
    label: row.label,
    createdAt: createdAt === null ? null : new Date(createdAt).toISOString(),
    lastUsedAt: lastUsedAt === null ? null : new Date(lastUsedAt).toISOString(),
  };
}

/**
 * Read a stored timestamp that may not still be a `Date`.
 *
 * IndexedDB preserves Date objects, so in a live browser these always are one. Two
 * paths break that: a database restored through `importFromJSON` has been through
 * JSON, where a Date becomes an ISO string; and a record written by a different
 * realm can come back as a plain object that no longer answers to `getTime`.
 *
 * Both are handled by returning null rather than throwing, which follows the
 * resilient-mapping rule the repositories use (see `dexie-customer.repository.ts`):
 * one unreadable field must not break the whole screen. A cashier who cannot see
 * when a passkey was added can still see that it exists and still remove it — which
 * is what the list is actually for.
 */
function readInstant(value: unknown): number | null {
  // Deliberately not `instanceof Date`: that is false for a Date created in another
  // realm (an iframe, a worker, or a structured clone that crossed one), while the
  // internal-slot tag below is true for every real Date and nothing else.
  if (Object.prototype.toString.call(value) === '[object Date]') {
    const time = (value as Date).getTime();
    return Number.isNaN(time) ? null : time;
  }
  if (typeof value === 'string' || typeof value === 'number') {
    const parsed = new Date(value).getTime();
    return Number.isNaN(parsed) ? null : parsed;
  }
  return null;
}

/**
 * A standalone ArrayBuffer for the WebAuthn API.
 *
 * `Uint8Array` is accepted as a BufferSource, but a *view* into a larger buffer is
 * not what the caller means, and some implementations read the whole buffer.
 */
function toBuffer(bytes: Uint8Array): ArrayBuffer {
  return bytes.slice().buffer as ArrayBuffer;
}
