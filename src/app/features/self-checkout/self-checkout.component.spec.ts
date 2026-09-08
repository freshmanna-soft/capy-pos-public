import { TestBed } from '@angular/core/testing';
import { Router } from '@angular/router';
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
      providers: [{ provide: Router, useValue: { navigate } }],
    });
  });

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
