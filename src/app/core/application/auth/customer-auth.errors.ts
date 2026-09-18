/**
 * The credentials identify an App ID account that still needs email
 * verification. Kept distinct from invalid credentials so the customer is sent
 * back to their inbox rather than told to keep changing a correct password.
 */
export class CustomerVerificationPendingError extends Error {
  readonly status = 403;

  constructor() {
    super('Customer email verification is pending');
    this.name = 'CustomerVerificationPendingError';
  }
}
