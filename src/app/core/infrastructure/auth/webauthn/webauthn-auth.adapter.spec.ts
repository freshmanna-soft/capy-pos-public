import { TestBed } from '@angular/core/testing';
import { describe, it, expect, beforeEach, afterEach, beforeAll } from 'vitest';
import { DexieDatabase, IOperatorDB } from '@core/infrastructure/database/dexie-database.service';
import {
  InvalidPinError,
  OperatorInactiveError,
  PasskeyCancelledError,
  PasskeyUnavailableError,
  PasskeyVerificationError,
} from '@core/application/auth/ports/quick-auth.port';
import {
  PasskeyAlreadyEnrolledError,
  WeakPinError,
} from '@core/application/auth/ports/quick-auth-admin.port';
import { WebAuthnAuthAdapter } from './webauthn-auth.adapter';
import { bytesToBase64Url } from './webauthn-codec';
import {
  FakeAuthenticator,
  attestationObject,
  buildAuthenticatorData,
  buildClientData,
  createEs256Authenticator,
  createRs256Authenticator,
  signAssertion,
} from './fake-authenticator.fixture';

// ---------------------------------------------------------------------------
// A fake `navigator.credentials`, backed by the real signing fixture.
//
// The point of driving the adapter through this rather than stubbing out the
// verifier is that the bytes are real: the responses below are signed by an actual
// WebCrypto key and verified by the actual rules, so a mistake in how the adapter
// wires the two together shows up here rather than on a real fingerprint sensor.
//
// The relying party is read from jsdom's own `location`, because that is what the
// adapter compares against.
// ---------------------------------------------------------------------------

const CREDENTIAL_ID = Uint8Array.from([9, 9, 7, 7, 5, 5]);

interface CeremonyLog {
  create?: PublicKeyCredentialCreationOptions;
  get?: PublicKeyCredentialRequestOptions;
}

class FakeDevice {
  /** Set to make the next ceremony throw, mimicking a browser rejection. */
  failWith: { name: string } | null = null;
  /** The counter the device reports. Bump it to simulate use; freeze it to replay. */
  signCount = 0;
  /** Cleared to simulate a device that failed to identify the person. */
  userVerified = true;
  userPresent = true;
  /** Overridden to simulate a response signed for somewhere else. */
  originOverride: string | null = null;
  rpIdOverride: string | null = null;
  /** The credential id returned by an assertion; differs to simulate a stranger. */
  assertedCredentialId: Uint8Array = CREDENTIAL_ID;
  /** What the device echoes as the user handle. */
  userHandle: Uint8Array | null = null;
  readonly log: CeremonyLog = {};

  constructor(private readonly authenticator: FakeAuthenticator) {}

  private get origin(): string {
    return this.originOverride ?? location.origin;
  }

  private get rpId(): string {
    return this.rpIdOverride ?? location.hostname;
  }

  async create(options: CredentialCreationOptions): Promise<Credential> {
    const publicKey = options.publicKey!;
    this.log.create = publicKey;
    if (this.failWith) {
      throw this.failWith;
    }
    // An authenticator refuses to make a second key for one it already holds.
    const excluded = publicKey.excludeCredentials ?? [];
    if (excluded.some((entry) => equal(new Uint8Array(entry.id as ArrayBuffer), CREDENTIAL_ID))) {
      throw { name: 'InvalidStateError' };
    }

    this.userHandle = new Uint8Array(publicKey.user.id as ArrayBuffer);
    const clientDataJson = buildClientData({
      type: 'webauthn.create',
      challenge: bytesToBase64Url(new Uint8Array(publicKey.challenge as ArrayBuffer)),
      origin: this.origin,
    });
    const authData = await buildAuthenticatorData({
      rpId: this.rpId,
      flags: { userPresent: this.userPresent, userVerified: this.userVerified },
      signCount: this.signCount,
      attestedCredential: {
        credentialId: CREDENTIAL_ID,
        coseKey: this.authenticator.coseKey,
      },
    });

    return {
      id: bytesToBase64Url(CREDENTIAL_ID),
      type: 'public-key',
      rawId: buffer(CREDENTIAL_ID),
      response: {
        clientDataJSON: buffer(clientDataJson),
        attestationObject: buffer(attestationObject(authData)),
        getTransports: () => ['internal'],
      },
    } as unknown as Credential;
  }

  async get(options: CredentialRequestOptions): Promise<Credential> {
    const publicKey = options.publicKey!;
    this.log.get = publicKey;
    if (this.failWith) {
      throw this.failWith;
    }

    const clientDataJson = buildClientData({
      type: 'webauthn.get',
      challenge: bytesToBase64Url(new Uint8Array(publicKey.challenge as ArrayBuffer)),
      origin: this.origin,
    });
    const authData = await buildAuthenticatorData({
      rpId: this.rpId,
      flags: { userPresent: this.userPresent, userVerified: this.userVerified },
      signCount: this.signCount,
    });
    const signed = await signAssertion(this.authenticator, authData, clientDataJson);

    return {
      id: bytesToBase64Url(this.assertedCredentialId),
      type: 'public-key',
      rawId: buffer(this.assertedCredentialId),
      response: {
        clientDataJSON: buffer(signed.clientDataJson),
        authenticatorData: buffer(signed.authenticatorData),
        signature: buffer(signed.signature),
        userHandle: this.userHandle ? buffer(this.userHandle) : null,
      },
    } as unknown as Credential;
  }
}

function buffer(bytes: Uint8Array): ArrayBuffer {
  return bytes.slice().buffer as ArrayBuffer;
}

function equal(a: Uint8Array, b: Uint8Array): boolean {
  return a.length === b.length && a.every((byte, index) => byte === b[index]);
}

/** Install the fake browser API. `platformAvailable: false` mimics no sensor. */
function installWebAuthn(device: FakeDevice | null, platformAvailable = true): void {
  Object.defineProperty(globalThis, 'PublicKeyCredential', {
    value: { isUserVerifyingPlatformAuthenticatorAvailable: async () => platformAvailable },
    configurable: true,
    writable: true,
  });
  Object.defineProperty(globalThis.navigator, 'credentials', {
    value: device
      ? { create: (o: never) => device.create(o), get: (o: never) => device.get(o) }
      : undefined,
    configurable: true,
    writable: true,
  });
}

function uninstallWebAuthn(): void {
  Reflect.deleteProperty(globalThis, 'PublicKeyCredential');
  Object.defineProperty(globalThis.navigator, 'credentials', {
    value: undefined,
    configurable: true,
    writable: true,
  });
}

// --- Database isolation (same override trick as dexie-database.service.spec) ---

let dbCounter = 0;

class TestDexieDatabase extends DexieDatabase {
  constructor(name: string) {
    super();
    (this as unknown as { name: string }).name = name;
  }
}

const OPERATOR_ID = 'op-cashier';

function operatorRow(overrides: Partial<IOperatorDB> = {}): IOperatorDB {
  return {
    id: OPERATOR_ID,
    email: 'marco@capy-pos.local',
    displayName: 'Marco',
    roleId: 'role-operator',
    tenantId: 'default-tenant',
    passwordHash: 'pbkdf2:1:00:00',
    isActive: true,
    createdAt: new Date('2026-01-01T00:00:00Z'),
    updatedAt: new Date('2026-01-01T00:00:00Z'),
    ...overrides,
  };
}

// ---------------------------------------------------------------------------

describe('WebAuthnAuthAdapter', () => {
  let db: DexieDatabase;
  let adapter: WebAuthnAuthAdapter;
  let device: FakeDevice;
  let es256: FakeAuthenticator;

  beforeAll(async () => {
    es256 = await createEs256Authenticator();
  });

  beforeEach(async () => {
    db = new TestDexieDatabase(`CapyPOSDB-webauthn-${Date.now()}-${++dbCounter}`);
    await db.open();
    await db.seedRbacDefaults();
    await db.operators.put(operatorRow());

    device = new FakeDevice(es256);
    installWebAuthn(device);

    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      providers: [WebAuthnAuthAdapter, { provide: DexieDatabase, useValue: db }],
    });
    adapter = TestBed.inject(WebAuthnAuthAdapter);
    sessionStorage.clear();
  });

  afterEach(async () => {
    uninstallWebAuthn();
    try {
      await db.delete();
    } catch {
      // ignore teardown failures
    }
  });

  /** Enroll through the real ceremony — the precondition for the sign-in tests. */
  async function enroll(label = 'Counter till'): Promise<void> {
    await adapter.enrollPasskey(OPERATOR_ID, label);
  }

  // ─── capabilities ───────────────────────────────────────────────────────────

  describe('capabilities', () => {
    it('reports no passkey support when the browser has no WebAuthn at all', async () => {
      uninstallWebAuthn();
      const capabilities = await adapter.capabilities();
      expect(capabilities.passkeySupported).toBe(false);
    });

    it('reports no support when there is no platform authenticator', async () => {
      installWebAuthn(device, false);
      const capabilities = await adapter.capabilities();
      expect(capabilities.passkeySupported).toBe(false);
    });

    it('reports no support when the availability probe throws', async () => {
      Object.defineProperty(globalThis, 'PublicKeyCredential', {
        value: {
          isUserVerifyingPlatformAuthenticatorAvailable: async () => {
            throw new Error('probe exploded');
          },
        },
        configurable: true,
        writable: true,
      });
      expect((await adapter.capabilities()).passkeySupported).toBe(false);
    });

    it('distinguishes support from anything actually being enrolled here', async () => {
      const before = await adapter.capabilities();
      expect(before.passkeySupported).toBe(true);
      expect(before.passkeyEnrolledHere).toBe(false);

      await enroll();

      expect((await adapter.capabilities()).passkeyEnrolledHere).toBe(true);
    });

    it('reports the PIN path only once an operator has set one', async () => {
      expect((await adapter.capabilities()).pinAvailable).toBe(false);
      await adapter.setPin(OPERATOR_ID, '4917');
      expect((await adapter.capabilities()).pinAvailable).toBe(true);
    });
  });

  // ─── enrollPasskey ──────────────────────────────────────────────────────────

  describe('enrollPasskey', () => {
    it('stores the credential and returns a summary', async () => {
      const summary = await adapter.enrollPasskey(OPERATOR_ID, 'Counter till');

      expect(summary.label).toBe('Counter till');
      expect(summary.credentialId).toBe(bytesToBase64Url(CREDENTIAL_ID));
      expect(summary.lastUsedAt).toBeNull();

      const stored = await db.operatorCredentials.get(summary.credentialId);
      expect(stored?.operatorId).toBe(OPERATOR_ID);
      expect(stored?.tenantId).toBe('default-tenant');
      expect(stored?.algorithm).toBe(-7);
      expect(JSON.parse(stored!.transports)).toEqual(['internal']);
    });

    it('stores a public key and nothing that could identify a person', async () => {
      const summary = await adapter.enrollPasskey(OPERATOR_ID, 'Counter till');
      const stored = await db.operatorCredentials.get(summary.credentialId);
      const jwk = JSON.parse(stored!.publicKeyJwk) as Record<string, unknown>;

      expect(jwk['kty']).toBe('EC');
      // `d` is the private scalar. Its absence is the whole privacy argument.
      expect(jwk['d']).toBeUndefined();
      expect(JSON.stringify(stored)).not.toContain('biometric');
    });

    it('demands user verification and a built-in sensor, and asks for a discoverable key', async () => {
      await enroll();
      const selection = device.log.create?.authenticatorSelection;

      expect(selection?.userVerification).toBe('required');
      expect(selection?.authenticatorAttachment).toBe('platform');
      // Discoverable, or sign-in would need the operator named up front.
      expect(selection?.residentKey).toBe('required');
    });

    it('offers ES256 first and RS256 for Windows Hello', async () => {
      await enroll();
      expect(device.log.create?.pubKeyCredParams?.map((p) => p.alg)).toEqual([-7, -257]);
    });

    it('identifies the operator to the authenticator by id, not by anything secret', async () => {
      await enroll();
      const user = device.log.create?.user;
      expect(new TextDecoder().decode(new Uint8Array(user!.id as ArrayBuffer))).toBe(OPERATOR_ID);
      expect(user?.displayName).toBe('Marco');
    });

    it('falls back to a usable label when given a blank one', async () => {
      const summary = await adapter.enrollPasskey(OPERATOR_ID, '   ');
      expect(summary.label).toBe('This device');
    });

    it('excludes already-enrolled credentials so one finger cannot enroll twice', async () => {
      await enroll();

      // The device now recognises its own id in excludeCredentials and refuses.
      await expect(adapter.enrollPasskey(OPERATOR_ID, 'Again')).rejects.toBeInstanceOf(
        PasskeyAlreadyEnrolledError
      );
      expect(device.log.create?.excludeCredentials).toHaveLength(1);
      expect(await db.operatorCredentials.count()).toBe(1);
    });

    it('refuses to enroll when the device has no platform authenticator', async () => {
      installWebAuthn(device, false);
      await expect(adapter.enrollPasskey(OPERATOR_ID, 'x')).rejects.toBeInstanceOf(
        PasskeyUnavailableError
      );
    });

    it('refuses to enroll an operator who is not active', async () => {
      await db.operators.put(operatorRow({ isActive: false }));
      await expect(adapter.enrollPasskey(OPERATOR_ID, 'x')).rejects.toBeInstanceOf(
        OperatorInactiveError
      );
    });

    it('refuses to enroll an operator who does not exist', async () => {
      await expect(adapter.enrollPasskey('nobody', 'x')).rejects.toBeInstanceOf(
        OperatorInactiveError
      );
    });

    it('treats a dismissed prompt as a cancellation, not a failure', async () => {
      device.failWith = { name: 'NotAllowedError' };
      await expect(adapter.enrollPasskey(OPERATOR_ID, 'x')).rejects.toBeInstanceOf(
        PasskeyCancelledError
      );
      expect(await db.operatorCredentials.count()).toBe(0);
    });

    it('reports an insecure context as unavailable rather than as a refusal', async () => {
      device.failWith = { name: 'SecurityError' };
      await expect(adapter.enrollPasskey(OPERATOR_ID, 'x')).rejects.toBeInstanceOf(
        PasskeyUnavailableError
      );
    });

    it('passes an unrecognised browser error through untouched', async () => {
      device.failWith = { name: 'WhoKnowsError' };
      await expect(adapter.enrollPasskey(OPERATOR_ID, 'x')).rejects.toEqual({
        name: 'WhoKnowsError',
      });
    });

    it('stores nothing when the registration does not verify', async () => {
      // A response signed for another site must not become an enrolled credential.
      device.originOverride = 'https://evil.example';
      await expect(adapter.enrollPasskey(OPERATOR_ID, 'x')).rejects.toBeInstanceOf(
        PasskeyVerificationError
      );
      expect(await db.operatorCredentials.count()).toBe(0);
    });

    it('refuses an enrollment that identified nobody', async () => {
      device.userVerified = false;
      await expect(adapter.enrollPasskey(OPERATOR_ID, 'x')).rejects.toBeInstanceOf(
        PasskeyVerificationError
      );
    });

    it('enrolls an RS256 authenticator, for Windows Hello', async () => {
      const rs256 = await createRs256Authenticator();
      device = new FakeDevice(rs256);
      installWebAuthn(device);

      const summary = await adapter.enrollPasskey(OPERATOR_ID, 'Hello laptop');
      const stored = await db.operatorCredentials.get(summary.credentialId);
      expect(stored?.algorithm).toBe(-257);
      expect((JSON.parse(stored!.publicKeyJwk) as JsonWebKey).kty).toBe('RSA');
    });
  });

  // ─── signInWithPasskey ──────────────────────────────────────────────────────

  describe('signInWithPasskey', () => {
    it('issues a session for the operator the credential belongs to', async () => {
      await enroll();
      device.signCount = 1;

      const session = await adapter.signInWithPasskey();

      expect(session.operatorId).toBe(OPERATOR_ID);
      expect(session.tenantId).toBe('default-tenant');
      expect(session.accessToken.split('.')).toHaveLength(3);
    });

    it('never sends our stored credential ids to the authenticator', async () => {
      await enroll();
      device.signCount = 1;
      await adapter.signInWithPasskey();

      // A populated allowCredentials would tell anyone at the till who works here.
      expect(device.log.get?.allowCredentials).toEqual([]);
      expect(device.log.get?.userVerification).toBe('required');
    });

    it('persists the advanced counter so the same assertion cannot be replayed', async () => {
      await enroll();
      device.signCount = 5;
      await adapter.signInWithPasskey();

      const stored = await db.operatorCredentials.get(bytesToBase64Url(CREDENTIAL_ID));
      expect(stored?.signCount).toBe(5);
      expect(stored?.lastUsedAt).toBeDefined();

      // The device replays the same counter: the clone check must now refuse it.
      await expect(adapter.signInWithPasskey()).rejects.toBeInstanceOf(PasskeyVerificationError);
    });

    it('accepts an authenticator that always reports a zero counter', async () => {
      await enroll();
      device.signCount = 0;

      await expect(adapter.signInWithPasskey()).resolves.toBeDefined();
      // ...and again, because zero-forever is legal and must not read as a replay.
      await expect(adapter.signInWithPasskey()).resolves.toBeDefined();
    });

    it('refuses when nothing is enrolled on this device', async () => {
      await expect(adapter.signInWithPasskey()).rejects.toBeInstanceOf(PasskeyUnavailableError);
    });

    it('refuses when the browser cannot do passkeys', async () => {
      await enroll();
      installWebAuthn(device, false);
      await expect(adapter.signInWithPasskey()).rejects.toBeInstanceOf(PasskeyUnavailableError);
    });

    it('refuses a credential this till has no record of', async () => {
      await enroll();
      device.signCount = 1;
      device.assertedCredentialId = Uint8Array.from([1, 1, 1, 1]);

      await expect(adapter.signInWithPasskey()).rejects.toThrow(/not enrolled on this till/);
    });

    it('refuses a credential whose user handle disagrees with our record', async () => {
      await enroll();
      device.signCount = 1;
      device.userHandle = new TextEncoder().encode('op-someone-else');

      await expect(adapter.signInWithPasskey()).rejects.toThrow(/different operator/);
    });

    it('refuses a revoked passkey', async () => {
      const summary = await adapter.enrollPasskey(OPERATOR_ID, 'Counter till');
      await adapter.revokePasskey(summary.credentialId);
      device.signCount = 1;

      await expect(adapter.signInWithPasskey()).rejects.toBeInstanceOf(PasskeyUnavailableError);
    });

    it('refuses a touch that identified nobody', async () => {
      await enroll();
      device.signCount = 1;
      device.userVerified = false;

      await expect(adapter.signInWithPasskey()).rejects.toThrow(/did not verify who you are/);
    });

    it('refuses an assertion signed for another origin', async () => {
      await enroll();
      device.signCount = 1;
      device.originOverride = 'https://evil.example';

      await expect(adapter.signInWithPasskey()).rejects.toBeInstanceOf(PasskeyVerificationError);
    });

    it('refuses to sign in an operator deactivated since they enrolled', async () => {
      await enroll();
      device.signCount = 1;
      await db.operators.put(operatorRow({ isActive: false }));

      await expect(adapter.signInWithPasskey()).rejects.toBeInstanceOf(OperatorInactiveError);
    });

    it('treats a dismissed prompt as a cancellation', async () => {
      await enroll();
      device.failWith = { name: 'NotAllowedError' };
      await expect(adapter.signInWithPasskey()).rejects.toBeInstanceOf(PasskeyCancelledError);
    });

    it('treats a timed-out prompt as a cancellation', async () => {
      await enroll();
      device.failWith = { name: 'TimeoutError' };
      await expect(adapter.signInWithPasskey()).rejects.toBeInstanceOf(PasskeyCancelledError);
    });
  });

  // ─── PIN ────────────────────────────────────────────────────────────────────

  describe('signInWithPin', () => {
    it('issues a session for the right PIN', async () => {
      await adapter.setPin(OPERATOR_ID, '4917');
      const session = await adapter.signInWithPin(OPERATOR_ID, '4917');
      expect(session.operatorId).toBe(OPERATOR_ID);
    });

    it('refuses the wrong PIN', async () => {
      await adapter.setPin(OPERATOR_ID, '4917');
      await expect(adapter.signInWithPin(OPERATOR_ID, '4918')).rejects.toBeInstanceOf(
        InvalidPinError
      );
    });

    it('gives the same answer for an operator with no PIN as for a wrong one', async () => {
      // Telling these apart would make the keypad a way to discover who has a PIN.
      const noPin = adapter.signInWithPin(OPERATOR_ID, '4917');
      await expect(noPin).rejects.toBeInstanceOf(InvalidPinError);

      await adapter.setPin(OPERATOR_ID, '4917');
      const wrongPin = adapter.signInWithPin(OPERATOR_ID, '0000');
      await expect(wrongPin).rejects.toBeInstanceOf(InvalidPinError);
    });

    it('gives the same answer for an operator who does not exist', async () => {
      await expect(adapter.signInWithPin('nobody', '4917')).rejects.toBeInstanceOf(InvalidPinError);
    });

    it('refuses a deactivated operator even with the right PIN', async () => {
      await adapter.setPin(OPERATOR_ID, '4917');
      await db.operators.update(OPERATOR_ID, { isActive: false });
      await expect(adapter.signInWithPin(OPERATOR_ID, '4917')).rejects.toBeInstanceOf(
        InvalidPinError
      );
    });
  });

  describe('setPin', () => {
    it('stores a hash, never the PIN itself', async () => {
      await adapter.setPin(OPERATOR_ID, '4917');
      const operator = await db.operators.get(OPERATOR_ID);

      // The format assertion alone already proves this: a `pbkdf2:<iterations>:
      // <hex-salt>:<hex-derived-key>` triple cannot structurally *be* the raw PIN.
      // A `.not.toContain('4917')` on top of it would be flaky, not additional
      // proof — a random-salted hex digest has a real (~1.5% per run) chance of
      // containing any fixed 4-digit substring by pure chance, which is exactly
      // what failed an unrelated PR's pre-push run on 2026-09-02.
      expect(operator?.pinHash).toMatch(/^pbkdf2:\d+:[0-9a-f]+:[0-9a-f]+$/);
      expect(operator?.pinUpdatedAt).toBeDefined();
    });

    it('salts the hash, so two operators with the same PIN do not match', async () => {
      await db.operators.put(operatorRow({ id: 'op-two', email: 'b@x', displayName: 'Bea' }));
      await adapter.setPin(OPERATOR_ID, '4917');
      await adapter.setPin('op-two', '4917');

      const [first, second] = await Promise.all([
        db.operators.get(OPERATOR_ID),
        db.operators.get('op-two'),
      ]);
      expect(first?.pinHash).not.toBe(second?.pinHash);
    });

    it('replaces an existing PIN', async () => {
      await adapter.setPin(OPERATOR_ID, '4917');
      await adapter.setPin(OPERATOR_ID, '8305');

      await expect(adapter.signInWithPin(OPERATOR_ID, '4917')).rejects.toBeInstanceOf(
        InvalidPinError
      );
      await expect(adapter.signInWithPin(OPERATOR_ID, '8305')).resolves.toBeDefined();
    });

    it.each([
      ['123', 'too-short'],
      ['123456789', 'too-long'],
      ['12ab', 'not-numeric'],
      ['1234', 'too-guessable'],
    ] as const)('refuses %s and says why', async (pin, reason) => {
      await expect(adapter.setPin(OPERATOR_ID, pin)).rejects.toMatchObject({
        name: 'WeakPinError',
        reason,
      });
      expect((await db.operators.get(OPERATOR_ID))?.pinHash).toBeUndefined();
    });

    it('rejects a weak PIN before touching the database at all', async () => {
      await expect(adapter.setPin('nobody', '1111')).rejects.toBeInstanceOf(WeakPinError);
    });

    it('refuses to set a PIN for an inactive operator', async () => {
      await db.operators.put(operatorRow({ isActive: false }));
      await expect(adapter.setPin(OPERATOR_ID, '4917')).rejects.toBeInstanceOf(
        OperatorInactiveError
      );
    });
  });

  describe('clearPin', () => {
    it('really removes the PIN rather than leaving it in place', async () => {
      await adapter.setPin(OPERATOR_ID, '4917');
      await adapter.clearPin(OPERATOR_ID);

      const operator = await db.operators.get(OPERATOR_ID);
      expect(operator?.pinHash).toBeUndefined();
      expect(operator?.pinUpdatedAt).toBeUndefined();
      await expect(adapter.signInWithPin(OPERATOR_ID, '4917')).rejects.toBeInstanceOf(
        InvalidPinError
      );
    });

    it('leaves the rest of the operator intact', async () => {
      await adapter.setPin(OPERATOR_ID, '4917');
      await adapter.clearPin(OPERATOR_ID);

      const operator = await db.operators.get(OPERATOR_ID);
      expect(operator?.displayName).toBe('Marco');
      expect(operator?.isActive).toBe(true);
      expect(operator?.roleId).toBe('role-operator');
    });

    it('is a no-op for an operator that does not exist', async () => {
      await expect(adapter.clearPin('nobody')).resolves.toBeUndefined();
    });
  });

  describe('listPinOperators', () => {
    it('lists only operators who opted into a PIN, by name', async () => {
      await db.operators.put(operatorRow({ id: 'op-zoe', email: 'z@x', displayName: 'Zoe' }));
      await db.operators.put(operatorRow({ id: 'op-ana', email: 'a@x', displayName: 'Ana' }));
      await adapter.setPin('op-zoe', '4917');
      await adapter.setPin('op-ana', '8305');

      const listed = await adapter.listPinOperators();

      expect(listed.map((entry) => entry.displayName)).toEqual(['Ana', 'Zoe']);
      expect(listed.map((entry) => entry.operatorId)).not.toContain(OPERATOR_ID);
    });

    it('omits deactivated operators', async () => {
      await adapter.setPin(OPERATOR_ID, '4917');
      await db.operators.update(OPERATOR_ID, { isActive: false });
      expect(await adapter.listPinOperators()).toEqual([]);
    });

    it('exposes nothing but an id and a display name', async () => {
      await adapter.setPin(OPERATOR_ID, '4917');
      const [entry] = await adapter.listPinOperators();
      expect(Object.keys(entry).sort()).toEqual(['displayName', 'operatorId']);
    });
  });

  describe('listPasskeys / revokePasskey', () => {
    it('lists what is enrolled here, oldest first', async () => {
      await enroll('Counter till');
      // A second credential, as if enrolled from another authenticator.
      await db.operatorCredentials.add({
        credentialId: 'later-credential',
        operatorId: OPERATOR_ID,
        tenantId: 'default-tenant',
        publicKeyJwk: '{}',
        algorithm: -7,
        signCount: 0,
        label: 'Back office',
        transports: '[]',
        createdAt: new Date('2030-01-01T00:00:00Z'),
      });

      const listed = await adapter.listPasskeys(OPERATOR_ID);
      expect(listed.map((entry) => entry.label)).toEqual(['Counter till', 'Back office']);
    });

    it('does not list another operator’s passkeys', async () => {
      await enroll();
      expect(await adapter.listPasskeys('op-two')).toEqual([]);
    });

    it('reports when a passkey was last used', async () => {
      await enroll();
      device.signCount = 3;
      await adapter.signInWithPasskey();

      const [entry] = await adapter.listPasskeys(OPERATOR_ID);
      expect(entry.lastUsedAt).not.toBeNull();
    });

    it('revokes a passkey, and is quiet about one that is already gone', async () => {
      const summary = await adapter.enrollPasskey(OPERATOR_ID, 'Counter till');
      await adapter.revokePasskey(summary.credentialId);
      expect(await adapter.listPasskeys(OPERATOR_ID)).toEqual([]);

      await expect(adapter.revokePasskey(summary.credentialId)).resolves.toBeUndefined();
    });
  });
});
