import { TestBed } from '@angular/core/testing';
import { provideRouter, Router } from '@angular/router';
import { CurrentCustomerService } from '@core/application/auth/current-customer.service';
import {
  CUSTOMER_AUTH_GATEWAY,
  CustomerAuthGateway,
} from '@core/application/auth/ports/customer-auth-gateway.port';
import { CustomerSessionDto } from '@core/application/auth/dtos/customer-session.dto';
import { redirectIfAuthenticatedGuard } from '@core/presentation/guards/redirect-if-authenticated.guard';
import { SelfCheckoutSignUpComponent } from './self-checkout-signup.component';

/**
 * What is actually load-bearing here, and therefore asserted by mutation rather
 * than by coverage:
 *
 * - the form calls the GATEWAY and then tells the SERVICE — dropping
 *   `setSession()` leaves the service's signals stale and nothing downstream
 *   sees the sign-in, so a session assertion on the *service* is the check, not
 *   a spy on the gateway alone;
 * - success routes to the interstitial and never to a signed-in lane state,
 *   because a fresh account is `PENDING` (item 3, 2026-09-11);
 * - 409 / 400 / 429 each produce their own copy, from the relay's real bodies;
 * - "continue without an account" is present and works — registration is
 *   optional by product decision, not by omission.
 */
describe('SelfCheckoutSignUpComponent', () => {
  const session: CustomerSessionDto = {
    customerId: 'cust-1',
    email: 'yuzu@example.com',
    tenantId: 'store-1',
    roles: ['customer'],
    permissions: ['sale:process'],
    accessToken: 'token',
    expiresAt: new Date(Date.now() + 3_600_000).toISOString(),
  };

  /** The relay's real 409 body (`DUPLICATE_EMAIL_MESSAGE`), verbatim. */
  const RELAY_409 =
    'That email address cannot be used to sign up. If the account is yours, try signing in instead, ' +
    'or reset your password if you have forgotten it.';

  /** The relay's real 400 body, with App ID's own explanation appended. */
  const RELAY_400 =
    'That password does not meet the password policy for this store. ' +
    'Must be at least 8 characters and contain a digit.';

  /** The adapter's fallback when the body carries nothing — the 429 case. */
  const RELAY_429 = 'Customer sign-up returned 429';

  function makeGateway(signUp: CustomerAuthGateway['signUp']): CustomerAuthGateway {
    return {
      signUp,
      authenticate: vi.fn(),
      getActiveSession: vi.fn().mockResolvedValue(null),
      refresh: vi.fn(),
      signOut: vi.fn().mockResolvedValue(undefined),
      getAccessToken: vi.fn().mockReturnValue(null),
    } as unknown as CustomerAuthGateway;
  }

  async function createComponent(gateway: CustomerAuthGateway) {
    TestBed.configureTestingModule({
      imports: [SelfCheckoutSignUpComponent],
      providers: [
        provideRouter([]),
        { provide: CUSTOMER_AUTH_GATEWAY, useValue: gateway },
        CurrentCustomerService,
      ],
    });
    const fixture = TestBed.createComponent(SelfCheckoutSignUpComponent);
    fixture.detectChanges();
    return fixture;
  }

  function fill(fixture: { componentInstance: SelfCheckoutSignUpComponent }): void {
    fixture.componentInstance.form.setValue({
      email: 'yuzu@example.com',
      password: 'sup3rsecret',
    });
  }

  function errorText(fixture: { nativeElement: HTMLElement }): string {
    return fixture.nativeElement.querySelector('[data-testid="signup-error"]')?.textContent ?? '';
  }

  async function submit(fixture: {
    componentInstance: SelfCheckoutSignUpComponent;
    detectChanges(): void;
  }): Promise<void> {
    // `submit` is protected — reached the way the template reaches it.
    await (fixture.componentInstance as unknown as { submit(): Promise<void> }).submit();
    fixture.detectChanges();
  }

  describe('success', () => {
    it('publishes the session on CurrentCustomerService and routes to the interstitial', async () => {
      const gateway = makeGateway(vi.fn().mockResolvedValue(session));
      const fixture = await createComponent(gateway);
      const router = TestBed.inject(Router);
      const navigate = vi.spyOn(router, 'navigate').mockResolvedValue(true);
      const customer = TestBed.inject(CurrentCustomerService);

      fill(fixture);
      await submit(fixture);

      expect(gateway.signUp).toHaveBeenCalledWith({
        email: 'yuzu@example.com',
        password: 'sup3rsecret',
      });
      // The SERVICE, not just the gateway — a missing setSession() is the bug.
      expect(customer.session()).toEqual(session);
      expect(navigate).toHaveBeenCalledWith(['/self-checkout/check-email'], {
        queryParams: { email: 'yuzu@example.com' },
      });
    });

    it('never routes to the lane as if the customer were signed in', async () => {
      const gateway = makeGateway(vi.fn().mockResolvedValue(session));
      const fixture = await createComponent(gateway);
      const navigate = vi.spyOn(TestBed.inject(Router), 'navigate').mockResolvedValue(true);

      fill(fixture);
      await submit(fixture);

      expect(navigate).toHaveBeenCalledTimes(1);
      expect(navigate.mock.calls[0][0]).toEqual(['/self-checkout/check-email']);
    });

    it('does not call the gateway while the form is invalid', async () => {
      const gateway = makeGateway(vi.fn().mockResolvedValue(session));
      const fixture = await createComponent(gateway);

      await submit(fixture);

      expect(gateway.signUp).not.toHaveBeenCalled();
    });
  });

  describe('refusals get their own copy', () => {
    it('409 tells the customer to try signing in, and offers the link', async () => {
      const gateway = makeGateway(vi.fn().mockRejectedValue(new Error(RELAY_409)));
      const fixture = await createComponent(gateway);

      fill(fixture);
      await submit(fixture);

      expect(errorText(fixture)).toContain('already has an account');
      expect(errorText(fixture)).toContain('Try signing in');
      expect(
        fixture.nativeElement.querySelector('[data-testid="signup-try-sign-in"]')
      ).not.toBeNull();
    });

    it('400 surfaces the tenant password-policy explanation', async () => {
      const gateway = makeGateway(vi.fn().mockRejectedValue(new Error(RELAY_400)));
      const fixture = await createComponent(gateway);

      fill(fixture);
      await submit(fixture);

      expect(errorText(fixture)).toContain('password rules');
      expect(
        fixture.nativeElement.querySelector('[data-testid="signup-error-detail"]')?.textContent
      ).toContain('at least 8 characters and contain a digit');
    });

    it('429 says something neutral and invents no reason', async () => {
      const gateway = makeGateway(vi.fn().mockRejectedValue(new Error(RELAY_429)));
      const fixture = await createComponent(gateway);

      fill(fixture);
      await submit(fixture);

      const text = errorText(fixture);
      expect(text).toContain('try again shortly');
      expect(text).not.toContain('429');
      expect(text).not.toContain('password');
      expect(fixture.nativeElement.querySelector('[data-testid="signup-try-sign-in"]')).toBeNull();
    });

    it('leaves the session untouched when sign-up fails', async () => {
      const gateway = makeGateway(vi.fn().mockRejectedValue(new Error(RELAY_409)));
      const fixture = await createComponent(gateway);
      const customer = TestBed.inject(CurrentCustomerService);

      fill(fixture);
      await submit(fixture);

      expect(customer.session()).toBeNull();
      expect(customer.isAuthenticated()).toBe(false);
    });
  });

  describe('registration stays optional', () => {
    it('offers continuing without an account alongside the submit', async () => {
      const fixture = await createComponent(makeGateway(vi.fn()));

      const anonymous = fixture.nativeElement.querySelector(
        '[data-testid="signup-continue-anonymous"]'
      ) as HTMLButtonElement | null;
      expect(anonymous).not.toBeNull();
      expect(anonymous?.textContent).toContain('Continue without an account');
    });

    it('continuing without an account returns to the lane', async () => {
      const fixture = await createComponent(makeGateway(vi.fn()));
      const navigate = vi.spyOn(TestBed.inject(Router), 'navigate').mockResolvedValue(true);

      (
        fixture.nativeElement.querySelector(
          '[data-testid="signup-continue-anonymous"]'
        ) as HTMLButtonElement
      ).click();

      expect(navigate).toHaveBeenCalledWith(['/self-checkout']);
    });
  });

  describe('the guard on this route', () => {
    it('redirects a customer who already has a session', () => {
      TestBed.configureTestingModule({
        providers: [
          provideRouter([]),
          { provide: CUSTOMER_AUTH_GATEWAY, useValue: makeGateway(vi.fn()) },
          CurrentCustomerService,
        ],
      });
      TestBed.inject(CurrentCustomerService).setSession(session);

      const guard = redirectIfAuthenticatedGuard(CurrentCustomerService, '/self-checkout');
      const result = TestBed.runInInjectionContext(() => guard(null as never, null as never));

      expect(String(result)).toBe('/self-checkout');
    });

    it('lets a customer with no session through', () => {
      TestBed.configureTestingModule({
        providers: [
          provideRouter([]),
          { provide: CUSTOMER_AUTH_GATEWAY, useValue: makeGateway(vi.fn()) },
          CurrentCustomerService,
        ],
      });

      const guard = redirectIfAuthenticatedGuard(CurrentCustomerService, '/self-checkout');
      const result = TestBed.runInInjectionContext(() => guard(null as never, null as never));

      expect(result).toBe(true);
    });
  });
});
