import { Injectable } from '@angular/core';
import { CustomerAuthGateway } from '@core/application/auth/ports/customer-auth-gateway.port';
import { CredentialsDto } from '@core/application/auth/dtos/credentials.dto';
import { CustomerSessionDto } from '@core/application/auth/dtos/customer-session.dto';
import { InvalidCredentialsError } from './local-credential-auth.adapter';
import { Permission } from '@core/domain/auth';

/** Thrown by {@link InMemoryCustomerAuthAdapter.signUp} for an email already registered. */
export class CustomerAlreadyExistsError extends Error {
  constructor() {
    super('An account already exists for that email');
    this.name = 'CustomerAlreadyExistsError';
  }
}

/** Thrown when a refresh is attempted with no live session. */
export class NoActiveCustomerSessionError extends Error {
  constructor() {
    super('No active customer session');
    this.name = 'NoActiveCustomerSessionError';
  }
}

/** How long a fake customer session lasts — long enough to shop, short enough to lapse on a kiosk. */
const SESSION_TTL_MS = 30 * 60 * 1000;

/**
 * InMemoryCustomerAuthAdapter
 *
 * The stand-in {@link CustomerAuthGateway} that lets everything above the port
 * (Epic #261 items 15-18, 20-21) be built and tested before
 * `AppIdCustomerAuthAdapter` exists (item 11). It accepts any well-formed
 * credentials, keeps registrations in memory only, and issues an opaque
 * non-JWT token string — deliberately NOT a signed token, so nothing
 * downstream can start trusting it as one and no forgeable secret lands in the
 * bundle.
 *
 * Not registered in `AUTH_PROVIDERS`: the customer gateway binding is
 * route-scoped by item 13, which is also where this gets swapped for the real
 * adapter. Nothing outside self-checkout should be able to resolve it.
 */
@Injectable()
export class InMemoryCustomerAuthAdapter implements CustomerAuthGateway {
  /** email → password, for the lifetime of this adapter instance only. */
  private readonly accounts = new Map<string, string>();
  private session: CustomerSessionDto | null = null;
  private tokenCounter = 0;

  async signUp(creds: CredentialsDto): Promise<CustomerSessionDto> {
    const email = normalizeEmail(creds.email);
    if (this.accounts.has(email)) {
      throw new CustomerAlreadyExistsError();
    }
    this.accounts.set(email, creds.password);
    return this.issue(email);
  }

  async authenticate(creds: CredentialsDto): Promise<CustomerSessionDto> {
    const email = normalizeEmail(creds.email);
    const known = this.accounts.get(email);
    // Unknown email and wrong password fail identically — the same
    // anti-enumeration property the real adapter has to preserve.
    if (known === undefined || known !== creds.password) {
      throw new InvalidCredentialsError();
    }
    return this.issue(email);
  }

  async getActiveSession(): Promise<CustomerSessionDto | null> {
    // An expired session is no session — matches what a real token check does,
    // so `CurrentCustomerService.hydrate()` behaves the same either way.
    if (this.session && new Date(this.session.expiresAt).getTime() <= Date.now()) {
      this.session = null;
    }
    return this.session;
  }

  async refresh(): Promise<CustomerSessionDto> {
    if (!this.session) {
      throw new NoActiveCustomerSessionError();
    }
    return this.issue(this.session.email);
  }

  async signOut(): Promise<void> {
    this.session = null;
  }

  getAccessToken(): string | null {
    return this.session?.accessToken ?? null;
  }

  private issue(email: string): CustomerSessionDto {
    this.session = {
      customerId: `fake-customer-${email}`,
      email,
      tenantId: 'store-a',
      roles: ['customer'],
      permissions: [Permission.PROCESS_SALE],
      accessToken: `fake-customer-token-${++this.tokenCounter}`,
      expiresAt: new Date(Date.now() + SESSION_TTL_MS).toISOString(),
    };
    return this.session;
  }
}

function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}
