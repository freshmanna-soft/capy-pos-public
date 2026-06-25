// Polyfill WebCrypto for jsdom test environment — Node 26 exposes it via globalThis
// but jsdom doesn't wire it up automatically.
import { webcrypto } from 'node:crypto';
if (typeof globalThis.crypto === 'undefined' || typeof globalThis.crypto.subtle === 'undefined') {
  Object.defineProperty(globalThis, 'crypto', {
    value: webcrypto,
    writable: false,
    configurable: true,
  });
}

import { TestBed } from '@angular/core/testing';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  LocalCredentialAuthAdapter,
  InvalidCredentialsError,
  hashPassword,
} from './local-credential-auth.adapter';
import {
  DexieDatabase,
  IOperatorDB,
  IRoleDB,
} from '@core/infrastructure/database/dexie-database.service';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const ADMIN_HASH = '$2b$10$EixZaYVK1fsbw1ZfbX3OXePaWxn96p36WQoeG6Lruj3vjPGga31lW';

const seedOperator: IOperatorDB = {
  id: 'op-001',
  email: 'admin@capy-pos.local',
  displayName: 'Admin',
  roleId: 'role-admin',
  tenantId: 'default-tenant',
  passwordHash: ADMIN_HASH,
  isActive: true,
  createdAt: new Date(),
  updatedAt: new Date(),
};

const seedRole: IRoleDB = {
  id: 'role-admin',
  name: 'admin',
  permissions: JSON.stringify(['sale:process', 'admin:settings']),
  createdAt: new Date(),
  updatedAt: new Date(),
};

function makeMockDb(
  operatorOverride?: Partial<IOperatorDB> | null,
  roleOverride?: Partial<IRoleDB> | null
) {
  const operator = operatorOverride === null ? undefined : { ...seedOperator, ...operatorOverride };
  const role = roleOverride === null ? undefined : { ...seedRole, ...roleOverride };

  const operatorsTable = {
    where: vi.fn().mockReturnThis(),
    equals: vi.fn().mockReturnThis(),
    first: vi.fn().mockResolvedValue(operator),
  };

  const rolesTable = {
    get: vi.fn().mockResolvedValue(role),
  };

  return {
    operators: operatorsTable,
    roles: rolesTable,
  } as unknown as DexieDatabase;
}

/** Rebuild the adapter against a fresh mock db (for per-test db overrides). */
function buildAdapter(db: DexieDatabase): LocalCredentialAuthAdapter {
  TestBed.resetTestingModule();
  TestBed.configureTestingModule({
    providers: [LocalCredentialAuthAdapter, { provide: DexieDatabase, useValue: db }],
  });
  return TestBed.inject(LocalCredentialAuthAdapter);
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('LocalCredentialAuthAdapter', () => {
  let adapter: LocalCredentialAuthAdapter;
  let mockDb: DexieDatabase;

  beforeEach(() => {
    // Clear sessionStorage between tests
    sessionStorage.clear();

    mockDb = makeMockDb();

    TestBed.configureTestingModule({
      providers: [LocalCredentialAuthAdapter, { provide: DexieDatabase, useValue: mockDb }],
    });

    adapter = TestBed.inject(LocalCredentialAuthAdapter);
  });

  // -------------------------------------------------------------------------
  // authenticate — success
  // -------------------------------------------------------------------------

  describe('authenticate — valid credentials', () => {
    it('returns an AuthSessionDto with operatorId, tenantId, roles and permissions', async () => {
      const session = await adapter.authenticate({
        email: 'admin@capy-pos.local',
        password: 'admin1234',
      });

      expect(session.operatorId).toBe('op-001');
      expect(session.tenantId).toBe('default-tenant');
      expect(session.roles).toContain('admin');
      expect(session.permissions).toContain('sale:process');
      expect(session.permissions).toContain('admin:settings');
    });

    it('returns a non-empty JWT accessToken', async () => {
      const session = await adapter.authenticate({
        email: 'admin@capy-pos.local',
        password: 'admin1234',
      });

      expect(typeof session.accessToken).toBe('string');
      expect(session.accessToken.split('.').length).toBe(3); // header.payload.sig
    });

    it('stores the token so getAccessToken() returns it synchronously', async () => {
      await adapter.authenticate({
        email: 'admin@capy-pos.local',
        password: 'admin1234',
      });

      expect(adapter.getAccessToken()).not.toBeNull();
    });

    it('normalises email to lowercase', async () => {
      await adapter.authenticate({
        email: 'ADMIN@CAPY-POS.LOCAL',
        password: 'admin1234',
      });

      // The mock operator's email is lower-case; the adapter must normalise
      const equalsFn = (mockDb.operators as unknown as { equals: (...args: unknown[]) => unknown })
        .equals;
      expect(equalsFn).toHaveBeenCalledWith('admin@capy-pos.local');
    });
  });

  // -------------------------------------------------------------------------
  // authenticate — failure
  // -------------------------------------------------------------------------

  describe('authenticate — invalid credentials', () => {
    it('throws InvalidCredentialsError for wrong password', async () => {
      await expect(
        adapter.authenticate({ email: 'admin@capy-pos.local', password: 'wrongpassword' })
      ).rejects.toThrow(InvalidCredentialsError);
    });

    it('throws InvalidCredentialsError when operator is not found', async () => {
      mockDb = makeMockDb(null);
      TestBed.resetTestingModule();
      TestBed.configureTestingModule({
        providers: [LocalCredentialAuthAdapter, { provide: DexieDatabase, useValue: mockDb }],
      });
      adapter = TestBed.inject(LocalCredentialAuthAdapter);

      await expect(
        adapter.authenticate({ email: 'unknown@capy-pos.local', password: 'admin1234' })
      ).rejects.toThrow(InvalidCredentialsError);
    });

    it('throws InvalidCredentialsError when operator is inactive', async () => {
      mockDb = makeMockDb({ isActive: false });
      TestBed.resetTestingModule();
      TestBed.configureTestingModule({
        providers: [LocalCredentialAuthAdapter, { provide: DexieDatabase, useValue: mockDb }],
      });
      adapter = TestBed.inject(LocalCredentialAuthAdapter);

      await expect(
        adapter.authenticate({ email: 'admin@capy-pos.local', password: 'admin1234' })
      ).rejects.toThrow(InvalidCredentialsError);
    });

    it('does not store a token on failure', async () => {
      await adapter
        .authenticate({ email: 'admin@capy-pos.local', password: 'wrong' })
        .catch((_err: unknown) => {
          /* expected */
        });
      expect(adapter.getAccessToken()).toBeNull();
    });
  });

  // -------------------------------------------------------------------------
  // getActiveSession
  // -------------------------------------------------------------------------

  describe('getActiveSession', () => {
    it('returns null when no token is stored', async () => {
      expect(await adapter.getActiveSession()).toBeNull();
    });

    it('returns a session after successful login', async () => {
      await adapter.authenticate({ email: 'admin@capy-pos.local', password: 'admin1234' });
      const session = await adapter.getActiveSession();
      expect(session).not.toBeNull();
      expect(session?.operatorId).toBe('op-001');
    });
  });

  // -------------------------------------------------------------------------
  // signOut
  // -------------------------------------------------------------------------

  describe('signOut', () => {
    it('clears the token', async () => {
      await adapter.authenticate({ email: 'admin@capy-pos.local', password: 'admin1234' });
      await adapter.signOut();
      expect(adapter.getAccessToken()).toBeNull();
    });

    it('makes getActiveSession return null after sign-out', async () => {
      await adapter.authenticate({ email: 'admin@capy-pos.local', password: 'admin1234' });
      await adapter.signOut();
      expect(await adapter.getActiveSession()).toBeNull();
    });
  });

  // -------------------------------------------------------------------------
  // refresh
  // -------------------------------------------------------------------------

  describe('refresh', () => {
    it('issues a new token with the same claims', async () => {
      const original = await adapter.authenticate({
        email: 'admin@capy-pos.local',
        password: 'admin1234',
      });
      const refreshed = await adapter.refresh();
      expect(refreshed.operatorId).toBe(original.operatorId);
      expect(refreshed.roles).toEqual(original.roles);
    });

    it('throws when there is no active session', async () => {
      await expect(adapter.refresh()).rejects.toThrow('No active session to refresh');
    });
  });

  // -------------------------------------------------------------------------
  // getAccessToken (synchronous)
  // -------------------------------------------------------------------------

  describe('getAccessToken', () => {
    it('returns null before login', () => {
      expect(adapter.getAccessToken()).toBeNull();
    });

    it('returns the JWT string after login', async () => {
      await adapter.authenticate({ email: 'admin@capy-pos.local', password: 'admin1234' });
      const token = adapter.getAccessToken();
      expect(token).not.toBeNull();
      expect(token?.split('.').length).toBe(3);
    });
  });
});

// ---------------------------------------------------------------------------
// Password comparison branches (PBKDF2 + bcrypt reject + malformed)
// ---------------------------------------------------------------------------

describe('LocalCredentialAuthAdapter — password formats', () => {
  beforeEach(() => {
    sessionStorage.clear();
  });

  it('authenticates a PBKDF2-hashed operator with the correct password', async () => {
    const passwordHash = await hashPassword('pbkdf2-secret');
    const adapter = buildAdapter(makeMockDb({ passwordHash }));

    const session = await adapter.authenticate({
      email: 'admin@capy-pos.local',
      password: 'pbkdf2-secret',
    });

    expect(session.operatorId).toBe('op-001');
    expect(session.accessToken.split('.').length).toBe(3);
  });

  it('rejects a PBKDF2-hashed operator when the password is wrong', async () => {
    const passwordHash = await hashPassword('pbkdf2-secret');
    const adapter = buildAdapter(makeMockDb({ passwordHash }));

    await expect(
      adapter.authenticate({ email: 'admin@capy-pos.local', password: 'not-the-password' })
    ).rejects.toThrow(InvalidCredentialsError);
  });

  it('rejects an unknown (non-seed) bcrypt hash that cannot be verified', async () => {
    const adapter = buildAdapter(
      makeMockDb({ passwordHash: '$2b$10$abcdefghijklmnopqrstuvwxyz0123456789ABCDEFGHIJKLMNOP' })
    );

    await expect(
      adapter.authenticate({ email: 'admin@capy-pos.local', password: 'anything' })
    ).rejects.toThrow(InvalidCredentialsError);
  });

  it('rejects a malformed PBKDF2 hash (wrong number of parts)', async () => {
    const adapter = buildAdapter(makeMockDb({ passwordHash: 'pbkdf2:100000:onlythreeparts' }));

    await expect(
      adapter.authenticate({ email: 'admin@capy-pos.local', password: 'anything' })
    ).rejects.toThrow(InvalidCredentialsError);
  });

  it('rejects an unrecognised hash format', async () => {
    const adapter = buildAdapter(makeMockDb({ passwordHash: 'plaintext-no-prefix' }));

    await expect(
      adapter.authenticate({ email: 'admin@capy-pos.local', password: 'plaintext-no-prefix' })
    ).rejects.toThrow(InvalidCredentialsError);
  });
});

// ---------------------------------------------------------------------------
// Permission resolution branches (custom roles unknown to the domain)
// ---------------------------------------------------------------------------

describe('LocalCredentialAuthAdapter — permission resolution', () => {
  beforeEach(() => {
    sessionStorage.clear();
  });

  it('derives permissions from a known domain role (admin) ignoring stored JSON', async () => {
    // seedRole.name === 'admin' is known to the domain; permissions come from
    // permission.constants, not the stored JSON.
    const adapter = buildAdapter(makeMockDb());
    const session = await adapter.authenticate({
      email: 'admin@capy-pos.local',
      password: 'admin1234',
    });
    expect(session.permissions).toContain('admin:settings');
  });

  it('falls back to stored JSON permissions for a custom role unknown to the domain', async () => {
    const adapter = buildAdapter(
      makeMockDb(
        { roleId: 'role-custom' },
        { name: 'kiosk-attendant', permissions: JSON.stringify(['sale:process']) }
      )
    );
    const session = await adapter.authenticate({
      email: 'admin@capy-pos.local',
      password: 'admin1234',
    });
    expect(session.roles).toEqual(['kiosk-attendant']);
    expect(session.permissions).toEqual(['sale:process']);
  });

  it('yields empty permissions for a custom role with invalid stored JSON', async () => {
    const adapter = buildAdapter(
      makeMockDb({ roleId: 'role-custom' }, { name: 'kiosk-attendant', permissions: 'not-json{' })
    );
    const session = await adapter.authenticate({
      email: 'admin@capy-pos.local',
      password: 'admin1234',
    });
    expect(session.permissions).toEqual([]);
  });

  it('uses the operator roleId as role name and empty permissions when no role record exists', async () => {
    // roles.get resolves undefined -> roleName falls back to operator.roleId
    // ('role-admin', unknown to the domain) and there is no stored JSON to parse.
    const adapter = buildAdapter(makeMockDb(undefined, null));
    const session = await adapter.authenticate({
      email: 'admin@capy-pos.local',
      password: 'admin1234',
    });
    expect(session.roles).toEqual(['role-admin']);
    expect(session.permissions).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// getActiveSession — tampered / invalid token
// ---------------------------------------------------------------------------

describe('LocalCredentialAuthAdapter — tampered token', () => {
  beforeEach(() => {
    sessionStorage.clear();
  });

  it('returns null and clears the stored token when it fails verification', async () => {
    const adapter = buildAdapter(makeMockDb());
    // Plant a structurally-plausible but unverifiable token.
    sessionStorage.setItem('capy_pos_access_token', 'aaa.bbb.ccc');

    expect(await adapter.getActiveSession()).toBeNull();
    // The invalid token must have been cleared.
    expect(adapter.getAccessToken()).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// hashPassword utility
// ---------------------------------------------------------------------------

describe('hashPassword utility', () => {
  it('produces a pbkdf2-prefixed hash', async () => {
    const hash = await hashPassword('mysecret');
    expect(hash.startsWith('pbkdf2:')).toBe(true);
  });

  it('two hashes of the same password differ (unique salts)', async () => {
    const h1 = await hashPassword('same');
    const h2 = await hashPassword('same');
    expect(h1).not.toBe(h2);
  });
});
