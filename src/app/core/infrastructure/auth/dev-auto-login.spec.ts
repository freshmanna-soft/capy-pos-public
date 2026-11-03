import { describe, it, expect, vi } from 'vitest';
import { DexieDatabase } from '@core/infrastructure/database/dexie-database.service';
import { issueDevSession, shouldDevAutoLogin, DevAutoLoginContext } from './dev-auto-login';
import { SessionIssuer } from './session-issuer';

const base: DevAutoLoginContext = {
  production: false,
  allowSeededAdmin: true,
  hostname: 'localhost',
  automated: false,
};

describe('shouldDevAutoLogin', () => {
  it('is on for a non-production localhost build', () => {
    expect(shouldDevAutoLogin(base)).toBe(true);
    expect(shouldDevAutoLogin({ ...base, hostname: '127.0.0.1' })).toBe(true);
  });

  it('is off for production builds', () => {
    expect(shouldDevAutoLogin({ ...base, production: true })).toBe(false);
  });

  it('is off when the seeded admin is not allowed', () => {
    expect(shouldDevAutoLogin({ ...base, allowSeededAdmin: false })).toBe(false);
  });

  it('is off for any non-loopback host', () => {
    expect(shouldDevAutoLogin({ ...base, hostname: 'pos.example.com' })).toBe(false);
    expect(shouldDevAutoLogin({ ...base, hostname: 'localhost.evil.com' })).toBe(false);
  });

  it('is off under browser automation so e2e sees the login screen', () => {
    expect(shouldDevAutoLogin({ ...base, automated: true })).toBe(false);
  });
});

describe('issueDevSession', () => {
  const session = { operatorId: 'operator-admin-default' };

  function makeDeps(operator: unknown) {
    const db = { operators: { get: vi.fn().mockResolvedValue(operator) } };
    const issuer = { issueFor: vi.fn().mockResolvedValue(session) };
    return {
      db,
      issuer,
      run: () =>
        issueDevSession(db as unknown as DexieDatabase, issuer as unknown as SessionIssuer),
    };
  }

  it('issues a session for the active seeded admin', async () => {
    const operator = { id: 'operator-admin-default', isActive: true };
    const { db, issuer, run } = makeDeps(operator);

    await expect(run()).resolves.toBe(session);
    expect(db.operators.get).toHaveBeenCalledWith('operator-admin-default');
    expect(issuer.issueFor).toHaveBeenCalledWith(operator);
  });

  it('returns null when the seeded admin is missing', async () => {
    const { issuer, run } = makeDeps(undefined);

    await expect(run()).resolves.toBeNull();
    expect(issuer.issueFor).not.toHaveBeenCalled();
  });

  it('returns null when the seeded admin is inactive', async () => {
    const { issuer, run } = makeDeps({ id: 'operator-admin-default', isActive: false });

    await expect(run()).resolves.toBeNull();
    expect(issuer.issueFor).not.toHaveBeenCalled();
  });
});
