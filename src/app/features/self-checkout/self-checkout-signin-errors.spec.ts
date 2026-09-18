import { describe, expect, it } from 'vitest';
import { CustomerVerificationPendingError } from '@core/application/auth/customer-auth.errors';
import { AppIdAuthError } from '@core/infrastructure/auth/appid-jwks';
import { InvalidCredentialsError } from '@core/infrastructure/auth/local-credential-auth.adapter';
import { describeSignInRefusal } from './self-checkout-signin-errors';

describe('describeSignInRefusal', () => {
  it('distinguishes pending email verification from a wrong password', () => {
    const refusal = describeSignInRefusal(new CustomerVerificationPendingError());

    expect(refusal.message).toContain('Verify your email');
    expect(refusal.field).toBe('email');
    expect(refusal.pendingVerification).toBe(true);
  });

  it('keeps invalid credentials neutral between email and password', () => {
    const refusal = describeSignInRefusal(new InvalidCredentialsError());

    expect(refusal.message).toContain('email or password');
    expect(refusal.field).toBeNull();
    expect(refusal.pendingVerification).toBe(false);
  });

  it('gives rate limiting retry copy without exposing a status code', () => {
    const refusal = describeSignInRefusal(new AppIdAuthError('provider detail', 429));

    expect(refusal.message).toContain('wait a moment');
    expect(refusal.message).not.toContain('429');
  });

  it.each([new Error('network detail'), null, undefined, 'provider detail'])(
    'never exposes an unclassified failure (%s)',
    (error) => {
      const refusal = describeSignInRefusal(error);

      expect(refusal.message).toContain('keep shopping without an account');
      expect(refusal.message).not.toContain('provider detail');
      expect(refusal.field).toBeNull();
    }
  );
});
