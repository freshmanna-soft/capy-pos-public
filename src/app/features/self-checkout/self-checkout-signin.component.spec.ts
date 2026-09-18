import { TestBed } from '@angular/core/testing';
import { provideRouter, Router } from '@angular/router';
import { CustomerVerificationPendingError } from '@core/application/auth/customer-auth.errors';
import { CurrentCustomerService } from '@core/application/auth/current-customer.service';
import { CustomerSessionDto } from '@core/application/auth/dtos/customer-session.dto';
import {
  CUSTOMER_AUTH_GATEWAY,
  CustomerAuthGateway,
} from '@core/application/auth/ports/customer-auth-gateway.port';
import { Permission } from '@core/domain/auth';
import { InvalidCredentialsError } from '@core/infrastructure/auth/local-credential-auth.adapter';
import { LANE_ROUTE } from './self-checkout-routes';
import { SelfCheckoutSignInComponent } from './self-checkout-signin.component';

describe('SelfCheckoutSignInComponent', () => {
  const session: CustomerSessionDto = {
    customerId: 'customer-1',
    email: 'yuzu@example.com',
    tenantId: 'store-a',
    roles: ['customer'],
    permissions: [Permission.PROCESS_SALE],
    accessToken: 'customer-token',
    expiresAt: new Date(Date.now() + 30 * 60 * 1000).toISOString(),
  };

  function gateway(authenticate = vi.fn().mockResolvedValue(session)): CustomerAuthGateway {
    return {
      signUp: vi.fn(),
      authenticate,
      getActiveSession: vi.fn().mockResolvedValue(null),
      refresh: vi.fn(),
      signOut: vi.fn().mockResolvedValue(undefined),
      getAccessToken: vi.fn().mockReturnValue(null),
    } as unknown as CustomerAuthGateway;
  }

  function render(auth: CustomerAuthGateway = gateway()) {
    TestBed.configureTestingModule({
      imports: [SelfCheckoutSignInComponent],
      providers: [
        provideRouter([]),
        { provide: CUSTOMER_AUTH_GATEWAY, useValue: auth },
        CurrentCustomerService,
      ],
    });
    const fixture = TestBed.createComponent(SelfCheckoutSignInComponent);
    fixture.detectChanges();
    return fixture;
  }

  function fill(fixture: ReturnType<typeof render>): void {
    fixture.componentInstance.form.setValue({
      email: 'Yuzu@Example.com',
      password: 'sup3rsecret',
    });
  }

  async function submit(fixture: ReturnType<typeof render>): Promise<void> {
    await (fixture.componentInstance as unknown as { submit(): Promise<void> }).submit();
    fixture.detectChanges();
  }

  it('publishes the authenticated session and returns to the existing basket', async () => {
    vi.useFakeTimers();
    try {
      const auth = gateway();
      const fixture = render(auth);
      const navigate = vi.spyOn(TestBed.inject(Router), 'navigate').mockResolvedValue(true);
      fill(fixture);

      await submit(fixture);

      expect(auth.authenticate).toHaveBeenCalledWith({
        email: 'Yuzu@Example.com',
        password: 'sup3rsecret',
      });
      expect(TestBed.inject(CurrentCustomerService).session()).toEqual(session);
      expect(navigate).toHaveBeenCalledWith([LANE_ROUTE]);
    } finally {
      vi.useRealTimers();
    }
  });

  it('does not authenticate an invalid form and names both missing fields', async () => {
    const auth = gateway();
    const fixture = render(auth);

    await submit(fixture);

    expect(auth.authenticate).not.toHaveBeenCalled();
    expect(fixture.nativeElement.querySelector('#signin-email-error')?.textContent).toContain(
      'Enter your email'
    );
    expect(fixture.nativeElement.querySelector('#signin-password-error')?.textContent).toContain(
      'Enter your password'
    );
  });

  it('shows neutral copy for invalid credentials and publishes no session', async () => {
    const fixture = render(gateway(vi.fn().mockRejectedValue(new InvalidCredentialsError())));
    fill(fixture);

    await submit(fixture);

    expect(
      fixture.nativeElement.querySelector('[data-testid="signin-error"]')?.textContent
    ).toContain('email or password');
    expect(TestBed.inject(CurrentCustomerService).session()).toBeNull();
  });

  it('tells an unverified customer to open the verification email', async () => {
    const fixture = render(
      gateway(vi.fn().mockRejectedValue(new CustomerVerificationPendingError()))
    );
    fill(fixture);

    await submit(fixture);

    expect(
      fixture.nativeElement.querySelector('[data-testid="signin-error"]')?.textContent
    ).toContain('Verify your email');
    expect(fixture.nativeElement.querySelector('[data-testid="signin-email"]')).toHaveProperty(
      'ariaInvalid',
      'true'
    );
  });

  it('keeps anonymous checkout as an equally available exit', () => {
    const fixture = render();
    const navigate = vi.spyOn(TestBed.inject(Router), 'navigate').mockResolvedValue(true);
    const anonymous = fixture.nativeElement.querySelector(
      '[data-testid="signin-continue-anonymous"]'
    ) as HTMLButtonElement;

    anonymous.click();

    expect(navigate).toHaveBeenCalledWith([LANE_ROUTE]);
  });
});
