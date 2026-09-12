import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  InMemoryCustomerAuthAdapter,
  CustomerAlreadyExistsError,
  NoActiveCustomerSessionError,
} from './in-memory-customer-auth.adapter';
import { InvalidCredentialsError } from './local-credential-auth.adapter';
import { Permission } from '@core/domain/auth';

const creds = { email: 'shopper@example.com', password: 'correct-horse-battery' };

describe('InMemoryCustomerAuthAdapter', () => {
  let adapter: InMemoryCustomerAuthAdapter;

  beforeEach(() => {
    adapter = new InMemoryCustomerAuthAdapter();
  });

  describe('signUp', () => {
    it('registers a new customer and returns the account, with no session', async () => {
      const registration = await adapter.signUp(creds);

      expect(registration).toEqual({
        customerId: 'fake-customer-shopper@example.com',
        email: 'shopper@example.com',
      });
    });

    it('leaves the caller signed OUT, the way a PENDING App ID account does', async () => {
      // The property the real adapter cannot avoid (item 3: a just-created
      // account is `PENDING` and cannot complete a password grant), so the
      // stand-in must not offer a success the real gateway never can.
      await adapter.signUp(creds);

      await expect(adapter.getActiveSession()).resolves.toBeNull();
      expect(adapter.getAccessToken()).toBeNull();
    });

    it('rejects an email that is already registered', async () => {
      await adapter.signUp(creds);

      await expect(adapter.signUp(creds)).rejects.toThrow(CustomerAlreadyExistsError);
    });

    it('treats the email case-insensitively when detecting a duplicate', async () => {
      await adapter.signUp(creds);

      await expect(adapter.signUp({ ...creds, email: 'Shopper@Example.com  ' })).rejects.toThrow(
        CustomerAlreadyExistsError
      );
    });
  });

  describe('authenticate', () => {
    it('accepts the registered password and issues a live session', async () => {
      await adapter.signUp(creds);

      const session = await adapter.authenticate(creds);

      expect(session.email).toBe('shopper@example.com');
      expect(session.roles).toEqual(['customer']);
      expect(session.permissions).toEqual([Permission.PROCESS_SALE]);
      expect(new Date(session.expiresAt).getTime()).toBeGreaterThan(Date.now());
    });

    it('issues a token that is deliberately not a JWT', async () => {
      // Nothing downstream may start trusting the fake token as a signed one,
      // and no forgeable signing secret belongs in the bundle.
      await adapter.signUp(creds);

      const session = await adapter.authenticate(creds);

      expect(session.accessToken.split('.')).toHaveLength(1);
    });

    it('rejects a wrong password', async () => {
      await adapter.signUp(creds);

      await expect(adapter.authenticate({ ...creds, password: 'wrong' })).rejects.toThrow(
        InvalidCredentialsError
      );
    });

    it('rejects an unknown email with the same error as a wrong password', async () => {
      // Anti-enumeration: the two failures must be indistinguishable.
      await expect(adapter.authenticate(creds)).rejects.toThrow(InvalidCredentialsError);
    });
  });

  describe('getActiveSession', () => {
    it('returns null before anyone signs in', async () => {
      await expect(adapter.getActiveSession()).resolves.toBeNull();
    });

    it('returns the session issued by authenticate', async () => {
      await adapter.signUp(creds);
      const issued = await adapter.authenticate(creds);

      await expect(adapter.getActiveSession()).resolves.toEqual(issued);
    });

    it('drops a session whose token has lapsed', async () => {
      vi.useFakeTimers();
      try {
        await adapter.signUp(creds);
        await adapter.authenticate(creds);

        vi.advanceTimersByTime(31 * 60 * 1000);

        await expect(adapter.getActiveSession()).resolves.toBeNull();
        expect(adapter.getAccessToken()).toBeNull();
      } finally {
        vi.useRealTimers();
      }
    });
  });

  describe('refresh', () => {
    it('issues a new token for the same customer', async () => {
      await adapter.signUp(creds);
      const first = await adapter.authenticate(creds);

      const second = await adapter.refresh();

      expect(second.email).toBe(first.email);
      expect(second.accessToken).not.toBe(first.accessToken);
    });

    it('throws when there is no session to refresh', async () => {
      await expect(adapter.refresh()).rejects.toThrow(NoActiveCustomerSessionError);
    });
  });

  describe('signOut', () => {
    it('clears the session and the access token', async () => {
      await adapter.signUp(creds);
      await adapter.authenticate(creds);
      expect(adapter.getAccessToken()).not.toBeNull();

      await adapter.signOut();

      expect(adapter.getAccessToken()).toBeNull();
      await expect(adapter.getActiveSession()).resolves.toBeNull();
    });
  });

  describe('isolation between instances', () => {
    it('does not share registrations with another instance', async () => {
      // Route-scoped provider (#261 item 13): a new self-checkout session gets
      // a clean adapter, so one customer's account never leaks into the next.
      await adapter.signUp(creds);

      const fresh = new InMemoryCustomerAuthAdapter();

      await expect(fresh.authenticate(creds)).rejects.toThrow(InvalidCredentialsError);
    });
  });
});
