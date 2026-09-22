import { TestBed } from '@angular/core/testing';
import { Router } from '@angular/router';
import { PosFacade } from '@core/application/facades/pos.facade';
import { ProductService } from '@core/application/services/product.service';
import { CartService } from '@core/application/services/cart.service';
import { BarcodeScannerService } from '@core/infrastructure/media/barcode-scanner.service';
import { CameraService } from '@core/infrastructure/media/camera.service';
import { PAY_ROUTE, SIGN_IN_ROUTE, SIGN_UP_ROUTE } from './self-checkout-routes';
import { CUSTOMER_AUTH_GATEWAY } from '@core/application/auth/ports/customer-auth-gateway.port';
import { CurrentCustomerService } from '@core/application/auth/current-customer.service';
import { SelfCheckoutComponent } from './self-checkout.component';
import { CurrentCustomerLoyaltyService } from '@core/application/auth/current-customer-loyalty.service';

/**
 * The shell's contract is small but load-bearing: it has to render as a
 * full-screen takeover (a customer must not be able to reach the staff nav
 * behind it), it has to offer a way back to the till, because a kiosk build
 * shows no browser chrome to escape through, and it has to offer the way IN to
 * the sign-up form — the whole feature is reached from this one control, and it
 * used to be deletable with every test still green.
 */
describe('SelfCheckoutComponent', () => {
  const navigate = vi.fn();
  let loyaltyProjection: unknown;

  beforeEach(() => {
    navigate.mockClear();
    loyaltyProjection = null;

    TestBed.configureTestingModule({
      imports: [SelfCheckoutComponent],
      providers: [
        { provide: Router, useValue: { navigate } },
        {
          provide: CUSTOMER_AUTH_GATEWAY,
          useValue: {
            getActiveSession: vi.fn().mockResolvedValue(null),
            signOut: vi.fn().mockResolvedValue(undefined),
          },
        },
        CurrentCustomerService,
        {
          provide: CurrentCustomerLoyaltyService,
          useValue: { projection: () => loyaltyProjection, unavailable: () => false },
        },
        { provide: ProductService, useValue: { getActiveProducts: vi.fn().mockResolvedValue([]) } },
        {
          provide: BarcodeScannerService,
          useValue: {
            prepare: vi.fn().mockResolvedValue(false),
            detect: vi.fn().mockResolvedValue(null),
            supported: vi.fn().mockReturnValue(false),
          },
        },
        {
          provide: CameraService,
          useValue: {
            start: vi.fn().mockResolvedValue(false),
            stop: vi.fn(),
            attach: vi.fn(),
            detectionSource: vi.fn().mockReturnValue(null),
          },
        },
      ],
    });

    // Real routing supplies these from the componentless parent. This focused
    // shell spec supplies the same boundary from TestBed; the route-level lifetime
    // and real facade wiring are asserted in self-checkout-cart-boundary.spec.ts.
    TestBed.overrideProvider(PosFacade, { useValue: cartOnlyFacade() });
  });

  /** Just enough of `PosFacade` for the scan panel to paint an empty basket. */
  function cartOnlyFacade() {
    const cart = new CartService();
    return {
      cartItems: cart.items,
      totalItems: cart.totalItems,
      subtotal: cart.subtotal,
      tax: cart.tax,
      total: cart.total,
      isCartEmpty: cart.isEmpty,
      tryAddToCart: () => ({ added: true }),
      removeFromCart: () => undefined,
    };
  }

  function render() {
    const fixture = TestBed.createComponent(SelfCheckoutComponent);
    fixture.detectChanges();
    return fixture;
  }

  it('renders the lane as a fixed full-screen takeover over the app nav', () => {
    const fixture = render();
    const shell: HTMLElement | null = fixture.nativeElement.querySelector(
      '[data-testid="self-checkout-shell"]'
    );

    expect(shell).not.toBeNull();
    // `fixed inset-0` plus a z-index above the nav is what makes this a mode
    // rather than a panel — the same treatment /clerk uses.
    expect(shell?.className).toContain('fixed');
    expect(shell?.className).toContain('inset-0');
    expect(shell?.className).toContain('z-[60]');
  });

  it('uses the Onsen lane surface and ink tokens', () => {
    const shell: HTMLElement | null = render().nativeElement.querySelector(
      '[data-testid="self-checkout-shell"]'
    );

    expect(shell?.className).toContain('bg-onsen-deep');
    expect(shell?.className).toContain('text-steam');
  });

  it('shows the server loyalty projection for a signed-in customer', () => {
    const currentCustomer = TestBed.inject(CurrentCustomerService);
    currentCustomer.setSession({
      customerId: 'customer-1',
      email: 'shopper@example.com',
      tenantId: 'default-tenant',
      roles: ['customer'],
      permissions: [],
      accessToken: 'customer-token',
      expiresAt: new Date(Date.now() + 60_000).toISOString(),
    });
    loyaltyProjection = { status: 'available', pointsBalance: 1250, tier: 'silver' };

    const loyalty: HTMLElement | null = render().nativeElement.querySelector(
      '[data-testid="self-checkout-customer-loyalty"]'
    );

    expect(loyalty?.textContent).toContain('1250 points');
    expect(loyalty?.textContent).toContain('silver');
  });

  it('offers returning customers the sign-in route', () => {
    const fixture = render();
    const signIn = fixture.nativeElement.querySelector(
      '[data-testid="self-checkout-signin-link"]'
    ) as HTMLButtonElement;

    signIn.click();

    expect(navigate).toHaveBeenCalledWith([SIGN_IN_ROUTE]);
  });

  it('offers the way in to the sign-up form, as a link and not a gate', () => {
    // Registration is optional by product decision (2026-09-11, options 1+3), so
    // this is an offer on the lane rather than something standing in front of it:
    // the control navigates, and the lane itself stays reachable with no account.
    const fixture = render();
    const signUp: HTMLButtonElement | null = fixture.nativeElement.querySelector(
      '[data-testid="self-checkout-signup-link"]'
    );

    expect(signUp).not.toBeNull();
    expect(signUp?.textContent).toContain('Create an account');
    signUp?.click();

    expect(navigate).toHaveBeenCalledWith([SIGN_UP_ROUTE]);
  });

  it('opens the pay route when the scan panel emits checkout', () => {
    const fixture = render();
    fixture.debugElement.children[0].children[1].children[0].triggerEventHandler('checkout');

    expect(navigate).toHaveBeenCalledWith([PAY_ROUTE]);
  });

  it('navigates back to the till when the exit control is used', () => {
    const fixture = render();
    const exit: HTMLButtonElement | null = fixture.nativeElement.querySelector(
      '[data-testid="self-checkout-exit"]'
    );

    expect(exit).not.toBeNull();
    exit?.click();

    expect(navigate).toHaveBeenCalledWith(['/pos']);
  });
});
