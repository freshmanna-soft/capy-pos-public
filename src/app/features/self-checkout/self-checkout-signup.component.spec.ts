import { TestBed } from '@angular/core/testing';
import { provideRouter, Router } from '@angular/router';
import { CurrentCustomerService } from '@core/application/auth/current-customer.service';
import {
  CUSTOMER_AUTH_GATEWAY,
  CustomerAuthGateway,
} from '@core/application/auth/ports/customer-auth-gateway.port';
import { CustomerRegistrationDto } from '@core/application/auth/dtos/customer-registration.dto';
import { PendingRegistrationStore } from './pending-registration.store';
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
 *   not the raw field, so the customer is told the inbox the mail went to — and it
 *   travels in memory, never in the URL: this used to be `queryParams: { email }`,
 *   which published a shopper's address into the address bar and history of a
 *   shared terminal for a screen that did not read it;
 * - the guard on this route is asserted in `app.routes.spec.ts` instead, against
 *   the route table's own `canActivate` and the injector the family shares —
 *   calling the factory again here proved only that the factory works;
 * - 409 / 400 / 429 each produce their own copy, from the relay's real bodies;
 * - "continue without an account" is present and works — registration is
 *   optional by product decision, not by omission;
 * - an invalid submit *names* what is wrong, in text and through ARIA. The form
 *   is `novalidate`, so nothing else speaks: before this the only assertion about
 *   an invalid submit was that the gateway went uncalled, which is the silence
 *   itself written down as if it were the requirement. A refusal that comes back
 *   from the relay marks its field the same way;
 * - the form refuses on shape exactly what the relay refuses on shape, so no
 *   submit can come back a permanent refusal the form never warned about;
 * - the in-flight window is a state the tests stand inside, via a `signUp` that
 *   hangs until they resolve it: the button says what is happening, a second press
 *   creates no second account, and the button comes back after a refusal.
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

  /**
   * A `signUp` that hangs until the test resolves it, so the in-flight window is a
   * state the test can stand inside rather than something inferred afterwards.
   */
  function deferredSignUp() {
    let settle!: (value: CustomerRegistrationDto) => void;
    let fail!: (reason: unknown) => void;
    const signUp = vi.fn(
      () =>
        new Promise<CustomerRegistrationDto>((resolve, reject) => {
          settle = resolve;
          fail = reject;
        })
    );
    return { signUp, settle: (v = registration) => settle(v), fail: (r: unknown) => fail(r) };
  }

  async function createComponent(gateway: CustomerAuthGateway) {
    TestBed.configureTestingModule({
      imports: [SelfCheckoutSignUpComponent],
      providers: [
        provideRouter([]),
        { provide: CUSTOMER_AUTH_GATEWAY, useValue: gateway },
        CurrentCustomerService,
        PendingRegistrationStore,
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

  function submitButton(fixture: { nativeElement: HTMLElement }): HTMLButtonElement {
    return fixture.nativeElement.querySelector(
      '[data-testid="signup-submit"]'
    ) as HTMLButtonElement;
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
    it('routes to the interstitial and hands it the address the gateway registered', async () => {
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
      expect(navigate).toHaveBeenCalledWith([CHECK_EMAIL_ROUTE]);
      // ...and the *registered* address handed on, lowercased by the gateway. The
      // typed casing differs, so remembering `form.value.email` instead fails here.
      expect(TestBed.inject(PendingRegistrationStore).take()).toBe('yuzu@example.com');
    });

    it('puts the address nowhere the next shopper can read it', async () => {
      // The kiosk rule, pinned as a mutation test: re-adding
      // `queryParams: { email }` (or any other navigation extra carrying it) fails
      // here. `/self-checkout` is a shared in-store terminal, so an address in the
      // URL is an address in the address bar and in session history for whoever
      // walks up next — and the interstitial never read the query param anyway.
      const gateway = makeGateway(vi.fn().mockResolvedValue(registration));
      const fixture = await createComponent(gateway);
      const navigate = vi.spyOn(TestBed.inject(Router), 'navigate').mockResolvedValue(true);

      fill(fixture);
      await submit(fixture);

      const [commands, extras] = navigate.mock.calls[0];
      expect(extras).toBeUndefined();
      expect(JSON.stringify(commands)).not.toContain('example.com');
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
    it('409 tells the customer to try signing in, and links nowhere', async () => {
      const gateway = makeGateway(vi.fn().mockRejectedValue(new Error(RELAY_409)));
      const fixture = await createComponent(gateway);

      fill(fixture);
      await submit(fixture);

      expect(errorText(fixture)).toContain('already has an account');
      // The advice #309 asked for, in copy — and deliberately not as a link. There
      // is no customer sign-in screen anywhere yet (Epic #261 item 18 is unbuilt);
      // this used to render `routerLink="/self-checkout"`, which sent the shopper
      // back to the lane, where no sign-in exists either, and lost what they had
      // typed on the way. Re-adding a link fails here until it has somewhere to go.
      expect(errorText(fixture)).toContain('Try signing in');
      const banner = fixture.nativeElement.querySelector('[data-testid="signup-error"]');
      expect(banner.querySelectorAll('a')).toHaveLength(0);
    });

    it('marks the field a refusal blames, not just the banner', async () => {
      // WCAG 3.3.1 for the refusals that come back from the relay rather than from
      // this form's own rules. The banner is `role="alert"`, so it is announced —
      // but the input that caused it stayed `aria-invalid=null`, so a shopper
      // tabbing back through the form got no indication of which field to fix.
      const gateway = makeGateway(vi.fn().mockRejectedValue(new Error(RELAY_409)));
      const fixture = await createComponent(gateway);

      fill(fixture);
      await submit(fixture);

      expect(field(fixture, 'email').getAttribute('aria-invalid')).toBe('true');
      expect(field(fixture, 'email').getAttribute('aria-describedby')).toBe('signup-refusal');
      expect(fixture.nativeElement.querySelector('#signup-refusal')).not.toBeNull();
      // ...and nothing said about the password, which the store never mentioned.
      expect(field(fixture, 'password').hasAttribute('aria-invalid')).toBe(false);
      expect(field(fixture, 'password').hasAttribute('aria-describedby')).toBe(false);
    });

    it('marks the password for a policy refusal, and leaves the address alone', async () => {
      const gateway = makeGateway(vi.fn().mockRejectedValue(new Error(RELAY_400)));
      const fixture = await createComponent(gateway);

      fill(fixture);
      await submit(fixture);

      expect(field(fixture, 'password').getAttribute('aria-describedby')).toBe('signup-refusal');
      expect(field(fixture, 'email').hasAttribute('aria-invalid')).toBe(false);
    });

    it('blames neither field for a rate limit', async () => {
      // Nothing the shopper typed was wrong, so marking a field would be inventing
      // a reason — the same discipline as the copy itself.
      const gateway = makeGateway(vi.fn().mockRejectedValue(new Error(RELAY_429)));
      const fixture = await createComponent(gateway);

      fill(fixture);
      await submit(fixture);

      for (const name of ['email', 'password'] as const) {
        expect(field(fixture, name).hasAttribute('aria-invalid')).toBe(false);
        expect(field(fixture, name).hasAttribute('aria-describedby')).toBe(false);
      }
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

  /**
   * The in-flight window, which was entirely unasserted: `submitting` drove the
   * button's `disabled` and its label and guarded {@link submit}'s own re-entry,
   * and every one of those three lines could be deleted with the suite still
   * green. At a lane the shopper cannot see a request in progress, so a second
   * press is the *expected* behaviour, not an edge case — and a second `signUp`
   * for the same address is a 409 shown for an account that was just created
   * successfully.
   */
  describe('while a submit is in flight', () => {
    it('says so on the button, and refuses to be pressed again', async () => {
      const { signUp, settle } = deferredSignUp();
      const fixture = await createComponent(makeGateway(signUp));
      vi.spyOn(TestBed.inject(Router), 'navigate').mockResolvedValue(true);

      fill(fixture);
      const pending = (
        fixture.componentInstance as unknown as { submit(): Promise<void> }
      ).submit();
      fixture.detectChanges();

      expect(submitButton(fixture).disabled).toBe(true);
      expect(submitButton(fixture).textContent).toContain('Creating');

      settle();
      await pending;
      fixture.detectChanges();
      expect(signUp).toHaveBeenCalledTimes(1);
    });

    it('creates one account however many times the button is pressed', async () => {
      // The guard `submit` opens with. Deleting `|| this.submitting()` fails here.
      const { signUp, settle } = deferredSignUp();
      const fixture = await createComponent(makeGateway(signUp));
      vi.spyOn(TestBed.inject(Router), 'navigate').mockResolvedValue(true);
      const component = fixture.componentInstance as unknown as { submit(): Promise<void> };

      fill(fixture);
      const first = component.submit();
      await component.submit();
      await component.submit();

      expect(signUp).toHaveBeenCalledTimes(1);

      settle();
      await first;
    });

    it('gives the button back after a refusal, so the shopper can retry', async () => {
      // `submitting` is cleared in a `finally`, not on the success path only —
      // otherwise a 429 (the one refusal that *is* worth retrying) leaves the form
      // permanently dead and the shopper has to reload a kiosk to try again.
      const { signUp, fail } = deferredSignUp();
      const fixture = await createComponent(makeGateway(signUp));

      fill(fixture);
      const pending = (
        fixture.componentInstance as unknown as { submit(): Promise<void> }
      ).submit();
      fail(new Error(RELAY_429));
      await pending;
      fixture.detectChanges();

      expect(submitButton(fixture).disabled).toBe(false);
      expect(submitButton(fixture).textContent).toContain('Create account');
      expect(errorText(fixture)).toContain('try again shortly');
    });

    it('clears the previous refusal as the next attempt starts', async () => {
      // Otherwise a stale banner sits over a request in flight and the shopper is
      // reading the last answer while waiting for the next one.
      const { signUp, settle } = deferredSignUp();
      const gateway = makeGateway(signUp);
      const fixture = await createComponent(gateway);
      vi.spyOn(TestBed.inject(Router), 'navigate').mockResolvedValue(true);
      const component = fixture.componentInstance as unknown as { submit(): Promise<void> };

      fill(fixture);
      const first = component.submit();
      settle();
      await first;
      // Second attempt, refused, then a third that succeeds.
      signUp.mockRejectedValueOnce(new Error(RELAY_409));
      await submit(fixture);
      expect(errorText(fixture)).toContain('already has an account');

      signUp.mockResolvedValueOnce(registration);
      await submit(fixture);

      expect(fixture.nativeElement.querySelector('[data-testid="signup-error"]')).toBeNull();
      expect(field(fixture, 'email').hasAttribute('aria-invalid')).toBe(false);
    });
  });

  /**
   * The client's rules against the relay's, at the form's own boundary.
   *
   * `Validators.email` accepted `jane@gmail` and the relay's `EMAIL_PATTERN`
   * refuses it, so the shape check that mattered was the one the form did not do:
   * the submit went out, came back `400 "email must be a valid email address."`,
   * and the customer read "please try again" about an address that will never be
   * accepted. `customer-email.validator.spec.ts` pins the rule itself; these pin
   * that the *form* is the thing using it.
   */
  describe('nothing the relay refuses on shape ever leaves the form', () => {
    it.each([
      ['a domain with no TLD, which Validators.email accepts', 'jane@gmail'],
      ['an address that is only whitespace', '   '],
      ['a passphrase over the relay’s 256-character bound', null],
    ])('does not submit %s', async (_label, email) => {
      const gateway = makeGateway(vi.fn().mockResolvedValue(registration));
      const fixture = await createComponent(gateway);
      fixture.componentInstance.form.setValue({
        email: email ?? 'yuzu@example.com',
        password: email === null ? 'p'.repeat(257) : 'sup3rsecret',
      });

      await submit(fixture);

      expect(gateway.signUp).not.toHaveBeenCalled();
      // ...and it says which field, rather than failing silently.
      const named = email === null ? 'password' : 'email';
      expect(fieldError(fixture, named)).not.toBeNull();
      expect(field(fixture, named).getAttribute('aria-invalid')).toBe('true');
    });

    it('states the relay’s bound for a passphrase that is too long', async () => {
      const fixture = await createComponent(makeGateway(vi.fn()));
      fixture.componentInstance.form.setValue({
        email: 'yuzu@example.com',
        password: 'p'.repeat(257),
      });

      await submit(fixture);

      expect(fieldError(fixture, 'password')?.textContent).toContain('256 characters or fewer');
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
