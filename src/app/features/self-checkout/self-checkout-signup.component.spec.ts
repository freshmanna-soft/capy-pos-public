import { TestBed } from '@angular/core/testing';
import { provideRouter, Router } from '@angular/router';
import { CurrentCustomerService } from '@core/application/auth/current-customer.service';
import {
  CUSTOMER_AUTH_GATEWAY,
  CustomerAuthGateway,
} from '@core/application/auth/ports/customer-auth-gateway.port';
import { CustomerRegistrationDto } from '@core/application/auth/dtos/customer-registration.dto';
import { CHECK_EMAIL_ROUTE, LANE_ROUTE } from './self-checkout-routes';
import { SelfCheckoutSignUpComponent } from './self-checkout-signup.component';

/**
 * What is actually load-bearing here, and therefore asserted by mutation rather
 * than by coverage:
 *
 * - success routes to the interstitial and invents no session on the way,
 *   because a fresh account is `PENDING` (item 3, 2026-09-11): the gateway
 *   answers with a `CustomerRegistrationDto` and there is no session to publish.
 *   `CurrentCustomerService` is provided here even though the component never
 *   injects it, so "still signed out afterwards" is asserted on the service
 *   rather than inferred from the absence of a call;
 * - the address carried to the interstitial is the one the GATEWAY registered,
 *   not the raw field, so the customer is told the inbox the mail went to;
 * - the guard on this route is asserted in `app.routes.spec.ts` instead, against
 *   the route table's own `canActivate` and the injector the family shares —
 *   calling the factory again here proved only that the factory works;
 * - 409 / 400 / 429 each produce their own copy, from the relay's real bodies;
 * - "continue without an account" is present and works — registration is
 *   optional by product decision, not by omission;
 * - an invalid submit *names* what is wrong, in text and through ARIA. The form
 *   is `novalidate`, so nothing else speaks: before this the only assertion about
 *   an invalid submit was that the gateway went uncalled, which is the silence
 *   itself written down as if it were the requirement.
 */
describe('SelfCheckoutSignUpComponent', () => {
  /**
   * What `signUp` actually resolves with: an account and nothing to sign in
   * with. The email is the gateway's normalized one, deliberately differing in
   * case from what the form below types, so a test that reads the raw field
   * instead of this cannot pass by coincidence.
   */
  const registration: CustomerRegistrationDto = {
    customerId: 'cust-1',
    email: 'yuzu@example.com',
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
      email: 'Yuzu@Example.com',
      password: 'sup3rsecret',
    });
  }

  function errorText(fixture: { nativeElement: HTMLElement }): string {
    return fixture.nativeElement.querySelector('[data-testid="signup-error"]')?.textContent ?? '';
  }

  function field(fixture: { nativeElement: HTMLElement }, name: 'email' | 'password'): HTMLElement {
    return fixture.nativeElement.querySelector(`[data-testid="signup-${name}"]`) as HTMLElement;
  }

  function fieldError(
    fixture: { nativeElement: HTMLElement },
    name: 'email' | 'password'
  ): HTMLElement | null {
    return fixture.nativeElement.querySelector(`[data-testid="signup-${name}-error"]`);
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
    it('routes to the interstitial with the address the gateway registered', async () => {
      const gateway = makeGateway(vi.fn().mockResolvedValue(registration));
      const fixture = await createComponent(gateway);
      const navigate = vi.spyOn(TestBed.inject(Router), 'navigate').mockResolvedValue(true);

      fill(fixture);
      await submit(fixture);

      // Raw field value out: normalizing the address is the adapter's job, and
      // duplicating it here would be a second, drifting implementation of it.
      expect(gateway.signUp).toHaveBeenCalledWith({
        email: 'Yuzu@Example.com',
        password: 'sup3rsecret',
      });
      // ...and the *registered* address back in, lowercased by the gateway. The
      // typed casing differs, so reading `form.value.email` instead fails here.
      expect(navigate).toHaveBeenCalledWith([CHECK_EMAIL_ROUTE], {
        queryParams: { email: 'yuzu@example.com' },
      });
    });

    it('leaves the customer signed OUT — no session is invented', async () => {
      // The rule item 3 established (a just-created account is `PENDING` and
      // cannot complete a password grant), enforced at this layer: there is no
      // session in a `CustomerRegistrationDto`, and assembling one locally would
      // flip `isAuthenticated()` true for an account that cannot authenticate.
      // Re-adding a `setSession(...)` call fails this test.
      const gateway = makeGateway(vi.fn().mockResolvedValue(registration));
      const fixture = await createComponent(gateway);
      vi.spyOn(TestBed.inject(Router), 'navigate').mockResolvedValue(true);
      const customer = TestBed.inject(CurrentCustomerService);

      fill(fixture);
      await submit(fixture);

      expect(customer.session()).toBeNull();
      expect(customer.isAuthenticated()).toBe(false);
      // And no sign-in attempt behind the customer's back either — the grant
      // that would make is the one App ID answers `403 "Pending user
      // verification"` to.
      expect(gateway.authenticate).not.toHaveBeenCalled();
    });

    it('never routes to the lane as if the customer were signed in', async () => {
      const gateway = makeGateway(vi.fn().mockResolvedValue(registration));
      const fixture = await createComponent(gateway);
      const navigate = vi.spyOn(TestBed.inject(Router), 'navigate').mockResolvedValue(true);

      fill(fixture);
      await submit(fixture);

      expect(navigate).toHaveBeenCalledTimes(1);
      expect(navigate.mock.calls[0][0]).toEqual([CHECK_EMAIL_ROUTE]);
    });

    it('does not call the gateway while the form is invalid', async () => {
      const gateway = makeGateway(vi.fn().mockResolvedValue(registration));
      const fixture = await createComponent(gateway);

      await submit(fixture);

      expect(gateway.signUp).not.toHaveBeenCalled();
    });
  });

  /**
   * WCAG 3.3.1. The form carries `novalidate`, so the browser says nothing about a
   * mistyped address and this is the only thing that does.
   *
   * Asserted against the rendered DOM rather than the component's methods, because
   * "the message exists" and "a screen reader is told which field it belongs to"
   * are different claims and the second one is the one that was missing: an
   * invalid submit used to render nothing, and `markAllAsTouched()` could be
   * deleted with all tests still green.
   */
  describe('an invalid submit says what is wrong', () => {
    it('names both problems when nothing has been filled in', async () => {
      const gateway = makeGateway(vi.fn());
      const fixture = await createComponent(gateway);

      await submit(fixture);

      expect(fieldError(fixture, 'email')?.textContent).toContain('Enter your email address');
      expect(fieldError(fixture, 'password')?.textContent).toContain('Choose a password');
      expect(gateway.signUp).not.toHaveBeenCalled();
    });

    it('links each message to its own field for a screen reader', async () => {
      const fixture = await createComponent(makeGateway(vi.fn()));

      await submit(fixture);

      for (const name of ['email', 'password'] as const) {
        expect(field(fixture, name).getAttribute('aria-invalid')).toBe('true');
        // The id in `aria-describedby` has to be an element that is actually
        // there — a dangling reference reads as no message at all.
        const describedBy = field(fixture, name).getAttribute('aria-describedby');
        expect(describedBy).toBe(`signup-${name}-error`);
        expect(fieldError(fixture, name)?.id).toBe(describedBy);
        expect(fieldError(fixture, name)?.getAttribute('role')).toBe('alert');
      }
    });

    it('says the address is malformed, not that it is missing', async () => {
      // Distinct copy per failure: "enter your email" is wrong and unhelpful for
      // an address that was entered and simply has a typo in it.
      const fixture = await createComponent(makeGateway(vi.fn()));
      fixture.componentInstance.form.setValue({ email: 'yuzu@', password: 'sup3rsecret' });

      await submit(fixture);

      expect(fieldError(fixture, 'email')?.textContent).toContain('does not look like an email');
      expect(fieldError(fixture, 'password')).toBeNull();
    });

    it('states our own 8-character minimum for a short password', async () => {
      const fixture = await createComponent(makeGateway(vi.fn()));
      fixture.componentInstance.form.setValue({ email: 'yuzu@example.com', password: 'short' });

      await submit(fixture);

      expect(fieldError(fixture, 'password')?.textContent).toContain('at least 8 characters');
      expect(fieldError(fixture, 'email')).toBeNull();
    });

    it('clears the message once the field is corrected', async () => {
      // Not sticky: a message that outlives the mistake is a shopper retyping a
      // field that is already fine.
      const fixture = await createComponent(makeGateway(vi.fn().mockResolvedValue(registration)));
      await submit(fixture);
      expect(fieldError(fixture, 'email')).not.toBeNull();

      fill(fixture);
      fixture.detectChanges();

      expect(fieldError(fixture, 'email')).toBeNull();
      expect(fieldError(fixture, 'password')).toBeNull();
      expect(field(fixture, 'email').hasAttribute('aria-invalid')).toBe(false);
    });

    it('says nothing before the customer has touched the form', async () => {
      const fixture = await createComponent(makeGateway(vi.fn()));

      expect(fieldError(fixture, 'email')).toBeNull();
      expect(fieldError(fixture, 'password')).toBeNull();
    });

    it('leaves the submit pressable while the form is invalid', async () => {
      // The submit is what reveals the errors, so disabling it on `form.invalid`
      // would take away the only way to find out what is wrong.
      const fixture = await createComponent(makeGateway(vi.fn()));

      const button = fixture.nativeElement.querySelector(
        '[data-testid="signup-submit"]'
      ) as HTMLButtonElement;
      expect(button.disabled).toBe(false);
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

      expect(navigate).toHaveBeenCalledWith([LANE_ROUTE]);
    });
  });
});
