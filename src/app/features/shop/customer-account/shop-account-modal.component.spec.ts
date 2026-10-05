import { TestBed, type ComponentFixture } from '@angular/core/testing';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CurrentCustomerService } from '@core/application/auth/current-customer.service';
import { CustomerVerificationPendingError } from '@core/application/auth/customer-auth.errors';
import {
  CUSTOMER_AUTH_GATEWAY,
  type CustomerAuthGateway,
} from '@core/application/auth/ports/customer-auth-gateway.port';
import { AppIdAuthError } from '@core/infrastructure/auth/appid-jwks';
import { InMemoryCustomerAuthAdapter } from '@core/infrastructure/auth/in-memory-customer-auth.adapter';
import { CUSTOMER_REPOSITORY } from '@core/infrastructure/factories/repository.factory';
import { ACCOUNT_VIEW, ShopAccountModalComponent } from './shop-account-modal.component';

const EMAIL = 'shopper@example.com';
const PASSWORD = 'correct-horse-battery';

/**
 * The old modal "signed in" by `findByEmail` on the device's own Dexie table
 * and "created accounts" with `create`. Provided as spies so every test can
 * assert (in afterEach) that neither path is reachable any more.
 */
const dexieCustomers = { findByEmail: vi.fn(), create: vi.fn(), findAll: vi.fn() };

interface Harness {
  fixture: ComponentFixture<ShopAccountModalComponent>;
  component: ShopAccountModalComponent;
  gateway: CustomerAuthGateway;
  customer: CurrentCustomerService;
  host: HTMLElement;
}

async function setup(): Promise<Harness> {
  TestBed.configureTestingModule({
    imports: [ShopAccountModalComponent],
    providers: [
      { provide: CUSTOMER_AUTH_GATEWAY, useClass: InMemoryCustomerAuthAdapter },
      CurrentCustomerService,
      { provide: CUSTOMER_REPOSITORY, useValue: dexieCustomers },
    ],
  });
  const fixture = TestBed.createComponent(ShopAccountModalComponent);
  fixture.autoDetectChanges();
  await fixture.whenStable();
  return {
    fixture,
    component: fixture.componentInstance,
    gateway: TestBed.inject(CUSTOMER_AUTH_GATEWAY),
    customer: TestBed.inject(CurrentCustomerService),
    host: fixture.nativeElement as HTMLElement,
  };
}

function q<T extends HTMLElement = HTMLElement>(host: HTMLElement, testId: string): T | null {
  return host.querySelector<T>(`[data-testid="${testId}"]`);
}

function type(host: HTMLElement, testId: string, value: string): void {
  const input = q<HTMLInputElement>(host, testId);
  if (!input) throw new Error(`no ${testId}`);
  input.value = value;
  input.dispatchEvent(new Event('input'));
  input.dispatchEvent(new Event('blur'));
}

/** Submit the way a keyboard user does: Enter inside the form fires ngSubmit. */
async function submit(h: Harness): Promise<void> {
  q<HTMLFormElement>(h.host, 'shop-account-form')?.dispatchEvent(
    new Event('submit', { cancelable: true })
  );
  await h.fixture.whenStable();
}

async function fillAndSubmit(h: Harness, email = EMAIL, password = PASSWORD): Promise<void> {
  type(h.host, 'shop-auth-email', email);
  type(h.host, 'shop-auth-password', password);
  await submit(h);
}

describe('ShopAccountModalComponent', () => {
  let h: Harness;

  beforeEach(async () => {
    h = await setup();
  });

  afterEach(() => {
    // No Dexie customer lookup or write, in any flow.
    expect(dexieCustomers.findByEmail).not.toHaveBeenCalled();
    expect(dexieCustomers.create).not.toHaveBeenCalled();
    vi.restoreAllMocks();
    TestBed.resetTestingModule();
  });

  describe('dialog semantics', () => {
    it('is a labelled modal dialog with labelled fields', () => {
      const dialog = q(h.host, 'shop-account-modal');
      expect(dialog?.getAttribute('role')).toBe('dialog');
      expect(dialog?.getAttribute('aria-modal')).toBe('true');
      const titleId = dialog?.getAttribute('aria-labelledby') ?? '';
      expect(h.host.querySelector(`#${titleId}`)?.textContent).toContain('Sign in');
      for (const id of ['shop-account-email', 'shop-account-password']) {
        expect(h.host.querySelector(`label[for="${id}"]`)).not.toBeNull();
      }
    });

    it('focuses the email field when it opens', () => {
      expect(document.activeElement).toBe(q(h.host, 'shop-auth-email'));
    });

    it('closes on Escape, the ✕ button and the backdrop, but not on a click inside', () => {
      const closed = vi.fn();
      h.component.closed.subscribe(closed);

      q(h.host, 'shop-account-modal')?.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })
      );
      q(h.host, 'shop-account-close')?.click();
      q(h.host, 'shop-account-backdrop')?.click();
      expect(closed).toHaveBeenCalledTimes(3);

      q(h.host, 'shop-account-modal')?.click();
      expect(closed).toHaveBeenCalledTimes(3);
    });

    it('keeps Tab inside the dialog', () => {
      const close = q(h.host, 'shop-account-close') as HTMLElement;
      const last = q(h.host, 'shop-show-sign-up') as HTMLElement;
      last.focus();
      const forward = new KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true });
      last.dispatchEvent(forward);
      expect(forward.defaultPrevented).toBe(true);
      expect(document.activeElement).toBe(close);

      const back = new KeyboardEvent('keydown', {
        key: 'Tab',
        shiftKey: true,
        bubbles: true,
        cancelable: true,
      });
      close.dispatchEvent(back);
      expect(document.activeElement).toBe(last);
    });

    it('has no staff-login escape hatch', () => {
      expect(q(h.host, 'shop-staff-login')).toBeNull();
      expect(h.host.textContent).not.toMatch(/staff/i);
    });
  });

  describe('sign in', () => {
    it('reports both empty fields on submit instead of calling the gateway', async () => {
      const authenticate = vi.spyOn(h.gateway, 'authenticate');
      await submit(h);
      expect(authenticate).not.toHaveBeenCalled();
      expect(h.host.textContent).toContain('Enter your email address.');
      expect(h.host.textContent).toContain('Enter your password.');
      expect(q(h.host, 'shop-auth-email')?.getAttribute('aria-invalid')).toBe('true');
    });

    it('signs a verified customer in and shows the email from the session', async () => {
      await h.gateway.signUp({ email: EMAIL, password: PASSWORD });
      await fillAndSubmit(h, '  Shopper@Example.com ');

      expect(h.customer.isAuthenticated()).toBe(true);
      expect(q(h.host, 'shop-account-email')?.textContent).toContain(EMAIL);
      expect(q(h.host, 'shop-sign-out')).not.toBeNull();
      // The password must not survive in the form once signed in.
      expect(h.component.form.controls.password.value).toBe('');
    });

    it('maps wrong credentials to neutral copy announced through the live region', async () => {
      await fillAndSubmit(h, EMAIL, 'wrong-password');

      expect(h.customer.isAuthenticated()).toBe(false);
      const live = h.host.querySelector('#shop-account-refusal');
      expect(live?.getAttribute('aria-live')).toBe('assertive');
      expect(live?.textContent).toContain('That email or password did not match');
    });

    it('tells an unverified customer to open their verification email', async () => {
      vi.spyOn(h.gateway, 'authenticate').mockRejectedValue(new CustomerVerificationPendingError());
      await fillAndSubmit(h);

      expect(q(h.host, 'shop-auth-error')?.textContent).toContain('Verify your email');
      expect(q(h.host, 'shop-auth-email')?.getAttribute('aria-describedby')).toContain(
        'shop-account-refusal'
      );
    });

    it('maps a rate limit and a network failure to their own copy', async () => {
      const authenticate = vi.spyOn(h.gateway, 'authenticate');
      authenticate.mockRejectedValueOnce(new AppIdAuthError('slow down', 429));
      await fillAndSubmit(h);
      expect(q(h.host, 'shop-auth-error')?.textContent).toContain('Too many sign-in attempts');

      authenticate.mockRejectedValueOnce(
        new AppIdAuthError('App ID customer relay request failed: Failed to fetch')
      );
      await submit(h);
      expect(q(h.host, 'shop-auth-error')?.textContent).toContain('could not reach');
      expect(q(h.host, 'shop-auth-error')?.textContent).not.toContain('Failed to fetch');
    });

    it('disables the submit button while the request is in flight', async () => {
      let release!: () => void;
      vi.spyOn(h.gateway, 'authenticate').mockImplementation(
        () =>
          new Promise((_resolve, reject) => {
            release = () => reject(new Error('later'));
          })
      );
      type(h.host, 'shop-auth-email', EMAIL);
      type(h.host, 'shop-auth-password', PASSWORD);
      q<HTMLFormElement>(h.host, 'shop-account-form')?.dispatchEvent(new Event('submit'));
      await Promise.resolve();
      h.fixture.detectChanges();

      const button = q<HTMLButtonElement>(h.host, 'shop-account-submit');
      expect(button?.disabled).toBe(true);
      expect(button?.textContent).toContain('Signing in…');
      // A second submit while busy is ignored.
      await h.component.submit();
      expect(h.gateway.authenticate).toHaveBeenCalledTimes(1);

      release();
      await vi.waitFor(() => expect(h.component.submitting()).toBe(false));
      await h.fixture.whenStable();
      expect(q<HTMLButtonElement>(h.host, 'shop-account-submit')?.disabled).toBe(false);
    });

    it('says why when the session expired', async () => {
      await h.gateway.signUp({ email: EMAIL, password: PASSWORD });
      h.customer.setSession(await h.gateway.authenticate({ email: EMAIL, password: PASSWORD }));
      await h.customer.logout('expired');
      await h.fixture.whenStable();

      expect(q(h.host, 'shop-account-notice')?.textContent).toContain('session expired');
    });
  });

  describe('create account', () => {
    async function openSignUp(): Promise<void> {
      q(h.host, 'shop-show-sign-up')?.click();
      await h.fixture.whenStable();
    }

    it('switches to the sign-up form with the relay-aligned password rule', async () => {
      await openSignUp();
      expect(h.component.view()).toBe(ACCOUNT_VIEW.SIGN_UP);
      expect(q(h.host, 'shop-auth-password')?.getAttribute('autocomplete')).toBe('new-password');

      const signUp = vi.spyOn(h.gateway, 'signUp');
      await fillAndSubmit(h, EMAIL, 'short');
      expect(signUp).not.toHaveBeenCalled();
      expect(h.host.textContent).toContain('Use at least 8 characters.');
    });

    it('names every sign-up rule the form enforces before any request', async () => {
      await openSignUp();
      const signUp = vi.spyOn(h.gateway, 'signUp');

      await submit(h);
      expect(h.host.textContent).toContain('Choose a password.');

      await fillAndSubmit(h, `${'a'.repeat(250)}@example.com`, 'x'.repeat(257));
      expect(h.host.textContent).toContain('Use an address of 254 characters or fewer.');
      expect(h.host.textContent).toContain('Use 256 characters or fewer.');
      expect(signUp).not.toHaveBeenCalled();
    });

    it('refuses an address the relay would refuse before sending it', async () => {
      await openSignUp();
      const signUp = vi.spyOn(h.gateway, 'signUp');
      await fillAndSubmit(h, 'jane@gmail', PASSWORD);
      expect(signUp).not.toHaveBeenCalled();
      expect(h.host.textContent).toContain('does not look like an email address');
    });

    it('lands on "check your email" — never a signed-in state — then prefills sign-in', async () => {
      await openSignUp();
      await fillAndSubmit(h, ' New@Example.com ', PASSWORD);

      expect(h.customer.isAuthenticated()).toBe(false);
      expect(h.component.view()).toBe(ACCOUNT_VIEW.CHECK_EMAIL);
      expect(q(h.host, 'shop-check-email-address')?.textContent).toContain('new@example.com');
      expect(document.activeElement).toBe(q(h.host, 'shop-check-email-sign-in'));

      q(h.host, 'shop-check-email-sign-in')?.click();
      await h.fixture.whenStable();
      expect(h.component.view()).toBe(ACCOUNT_VIEW.SIGN_IN);
      expect(q<HTMLInputElement>(h.host, 'shop-auth-email')?.value).toBe('new@example.com');
      expect(q<HTMLInputElement>(h.host, 'shop-auth-password')?.value).toBe('');
    });

    it('tells a customer whose email is already registered to sign in instead', async () => {
      await h.gateway.signUp({ email: EMAIL, password: PASSWORD });
      await openSignUp();
      // The relay's real answer is a 409; the in-memory gateway throws its own error.
      vi.spyOn(h.gateway, 'signUp').mockRejectedValueOnce(
        new AppIdAuthError('That email address cannot be used to sign up.', 409)
      );
      await fillAndSubmit(h);

      expect(q(h.host, 'shop-auth-error')?.textContent).toContain('already has an account');
      expect(q(h.host, 'shop-auth-email')?.getAttribute('aria-invalid')).toBe('true');
      expect(h.component.view()).toBe(ACCOUNT_VIEW.SIGN_UP);
    });

    it("shows App ID's password-policy explanation", async () => {
      await openSignUp();
      vi.spyOn(h.gateway, 'signUp').mockRejectedValueOnce(
        new AppIdAuthError(
          'That password does not meet the password policy for this store. Use a digit.',
          400
        )
      );
      await fillAndSubmit(h);

      expect(q(h.host, 'shop-auth-error')?.textContent).toContain('password rules');
      expect(q(h.host, 'shop-auth-error-detail')?.textContent).toContain('Use a digit.');
      expect(q(h.host, 'shop-auth-password')?.getAttribute('aria-invalid')).toBe('true');
    });

    it('does not enforce the sign-up length rule on sign-in', async () => {
      await openSignUp();
      q(h.host, 'shop-show-sign-in')?.click();
      await h.fixture.whenStable();
      const authenticate = vi.spyOn(h.gateway, 'authenticate');
      await fillAndSubmit(h, EMAIL, 'short');
      expect(authenticate).toHaveBeenCalledWith({ email: EMAIL, password: 'short' });
    });
  });

  describe('signed in', () => {
    it('renders the signed-in panel for a hydrated session and signs out', async () => {
      await h.gateway.signUp({ email: EMAIL, password: PASSWORD });
      await h.gateway.authenticate({ email: EMAIL, password: PASSWORD });
      await h.customer.hydrate();
      await h.fixture.whenStable();
      expect(q(h.host, 'shop-account-signed-in')).not.toBeNull();

      q(h.host, 'shop-sign-out')?.click();
      await h.fixture.whenStable();

      expect(h.customer.isAuthenticated()).toBe(false);
      expect(h.gateway.getAccessToken()).toBeNull();
      expect(q(h.host, 'shop-account-notice')?.textContent).toContain('signed out');
      expect(q<HTMLInputElement>(h.host, 'shop-auth-email')?.value).toBe('');
      expect(document.activeElement).toBe(q(h.host, 'shop-auth-email'));
    });
  });
});
