import { TestBed } from '@angular/core/testing';
import { Router } from '@angular/router';
import { PendingRegistrationStore } from './pending-registration.store';
import { LANE_ROUTE } from './self-checkout-routes';
import { SelfCheckoutCheckEmailComponent } from './self-checkout-check-email.component';

/**
 * The interstitial shipped with no spec at all, which made the whole tail of the
 * sign-up flow deletable in silence: `route-smoke` asserts only that the landmark
 * paints, so removing the way back to the lane, or the reason the screen exists,
 * left every test green.
 *
 * What is load-bearing here:
 *
 * - the exit works. This screen is the end of a side path on a kiosk build with no
 *   browser chrome, so a shopper who cannot get back to the lane cannot pay;
 * - it names the inbox the mail went to, taken from
 *   {@link PendingRegistrationStore} rather than a query param — an address in the
 *   URL of a shared terminal is an address the next shopper reads;
 * - and it names nothing when there is nothing to name, rather than guessing.
 */
describe('SelfCheckoutCheckEmailComponent', () => {
  const navigate = vi.fn();

  function render(remembered?: string) {
    navigate.mockClear();
    TestBed.configureTestingModule({
      imports: [SelfCheckoutCheckEmailComponent],
      providers: [{ provide: Router, useValue: { navigate } }, PendingRegistrationStore],
    });
    if (remembered) {
      TestBed.inject(PendingRegistrationStore).remember(remembered);
    }
    const fixture = TestBed.createComponent(SelfCheckoutCheckEmailComponent);
    fixture.detectChanges();
    return fixture;
  }

  function text(fixture: { nativeElement: HTMLElement }): string {
    return fixture.nativeElement.textContent ?? '';
  }

  it('renders as a full-screen takeover like the rest of the lane', () => {
    const screen: HTMLElement | null = render().nativeElement.querySelector(
      '[data-testid="self-checkout-check-email"]'
    );

    expect(screen).not.toBeNull();
    expect(screen?.className).toContain('fixed');
    expect(screen?.className).toContain('inset-0');
    // ONSEN tokens, same as the lane and the form.
    expect(screen?.className).toContain('bg-onsen-deep');
    expect(screen?.className).toContain('text-steam');
  });

  it('explains that the account cannot be signed into until the mail is opened', () => {
    // The one fact this screen exists to carry (item 3, 2026-09-11): the account
    // is `PENDING`. Copy that dropped it would leave the customer trying to sign
    // in and being refused with no explanation.
    expect(text(render())).toContain('verification link');
  });

  it('sends the customer back to the lane, which is the only way out here', () => {
    const fixture = render();
    const back: HTMLButtonElement | null = fixture.nativeElement.querySelector(
      '[data-testid="check-email-back-to-lane"]'
    );

    expect(back).not.toBeNull();
    back?.click();

    expect(navigate).toHaveBeenCalledWith([LANE_ROUTE]);
  });

  it('names the inbox the verification mail went to', () => {
    const fixture = render('yuzu@example.com');

    expect(
      fixture.nativeElement.querySelector('[data-testid="check-email-address"]')?.textContent
    ).toContain('yuzu@example.com');
  });

  it('names no inbox when it was reached without a registration', () => {
    // A reload, or this URL opened directly. Guessing an address here would be
    // worse than saying nothing.
    const fixture = render();

    expect(fixture.nativeElement.querySelector('[data-testid="check-email-address"]')).toBeNull();
    expect(text(fixture)).toContain('emailed you');
  });

  it('leaves the address behind for the next shopper who reaches this screen', () => {
    // The screen takes the address once. Rebuilding the component — a reload, or
    // the next customer arriving at the same terminal — must find nothing.
    render('yuzu@example.com');

    const second = TestBed.createComponent(SelfCheckoutCheckEmailComponent);
    second.detectChanges();

    expect(second.nativeElement.querySelector('[data-testid="check-email-address"]')).toBeNull();
    expect(second.nativeElement.textContent).not.toContain('yuzu@example.com');
  });
});
