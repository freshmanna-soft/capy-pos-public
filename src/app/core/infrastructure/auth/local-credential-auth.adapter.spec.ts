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

function makeMockDb(operatorOverride?: Partial<IOperatorDB> | null) {
  const operator = operatorOverride === null ? undefined : { ...seedOperator, ...operatorOverride };

  const operatorsTable = {
    where: vi.fn().mockReturnThis(),
    equals: vi.fn().mockReturnThis(),
    first: vi.fn().mockResolvedValue(operator),
  };

  const rolesTable = {
    get: vi.fn().mockResolvedValue(seedRole),
  };

  return {
    operators: operatorsTable,
    roles: rolesTable,
  } as unknown as DexieDatabase;
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
