import { TestBed } from '@angular/core/testing';
import { Router } from '@angular/router';
import { PosFacade } from '@core/application/facades/pos.facade';
import { ProductService } from '@core/application/services/product.service';
import { CartService } from '@core/application/services/cart.service';
import { BarcodeScannerService } from '@core/infrastructure/media/barcode-scanner.service';
import { CameraService } from '@core/infrastructure/media/camera.service';
import { SelfCheckoutComponent } from './self-checkout.component';

/**
 * The shell's contract is small but load-bearing: it has to render as a
 * full-screen takeover (a customer must not be able to reach the staff nav
 * behind it), and it has to offer a way back to the till, because a kiosk build
 * shows no browser chrome to escape through.
 */
describe('SelfCheckoutComponent', () => {
  const navigate = vi.fn();

  beforeEach(() => {
    navigate.mockClear();

    TestBed.configureTestingModule({
      imports: [SelfCheckoutComponent],
      providers: [
        { provide: Router, useValue: { navigate } },
        // The scan panel renders inside the shell, so its collaborators have to be
        // satisfied here too. Stood in for rather than real: the real `PosFacade`
        // drags the whole sale graph into a spec about chrome.
        { provide: PosFacade, useValue: cartOnlyFacade() },
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
