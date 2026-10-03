import { TestBed } from '@angular/core/testing';
import { ActivatedRoute, Router } from '@angular/router';
import { PaymentCallbackComponent } from './payment-callback.component';

/**
 * The MP return tab: what it broadcasts to the waiting checkout tab, and what
 * it tells the buyer, for an approved payment versus every way of leaving MP
 * without paying.
 */
describe('PaymentCallbackComponent', () => {
  const posted: unknown[] = [];
  const navigate = vi.fn().mockResolvedValue(true);

  beforeEach(() => {
    posted.length = 0;
    navigate.mockClear();
    vi.useFakeTimers();
    vi.stubGlobal(
      'BroadcastChannel',
      class {
        postMessage(message: unknown) {
          posted.push(message);
        }
        // eslint-disable-next-line @typescript-eslint/no-empty-function
        close() {}
      }
    );
    vi.spyOn(window, 'close').mockImplementation(() => undefined);
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  function render(queryParams: Record<string, string>) {
    TestBed.configureTestingModule({
      imports: [PaymentCallbackComponent],
      providers: [
        { provide: ActivatedRoute, useValue: { snapshot: { queryParams } } },
        { provide: Router, useValue: { navigate } },
      ],
    });
    const fixture = TestBed.createComponent(PaymentCallbackComponent);
    fixture.detectChanges();
    return fixture;
  }

  it('broadcasts an approved return and navigates back if the tab stays open', () => {
    const fixture = render({
      payment_id: 'pay-1',
      status: 'approved',
      external_reference: 'ext-1',
      preference_id: 'pref-1',
    });

    expect(posted).toEqual([
      {
        outcome: 'approved',
        status: 'approved',
        paymentId: 'pay-1',
        preferenceId: 'pref-1',
        externalReference: 'ext-1',
      },
    ]);
    const el = fixture.nativeElement as HTMLElement;
    expect(el.querySelector('[data-testid="payment-callback-approved"]')).toBeTruthy();

    vi.advanceTimersByTime(300);
    expect(navigate).toHaveBeenCalledWith(['/']);
  });

  it('reports "Return to site" (status=null, no payment) as abandoned and stays put', () => {
    const fixture = render({
      collection_id: 'null',
      collection_status: 'null',
      status: 'null',
      external_reference: 'ext-2',
    });

    expect(posted).toEqual([
      expect.objectContaining({ outcome: 'abandoned', paymentId: '', externalReference: 'ext-2' }),
    ]);
    vi.advanceTimersByTime(300);
    fixture.detectChanges();

    const el = fixture.nativeElement as HTMLElement;
    expect(el.querySelector('[data-testid="payment-callback-cancelled"]')?.textContent).toContain(
      'Payment cancelled'
    );
    expect(el.textContent).toContain('You can close this tab');
    expect(el.querySelector('[data-testid="payment-callback-back"]')).toBeTruthy();
    expect(navigate).not.toHaveBeenCalled();
  });

  it.each(['rejected', 'pending', 'in_process'])('treats status=%s as abandoned', (status) => {
    render({ status, payment_id: 'pay-3', external_reference: 'ext-3' });
    expect(posted).toEqual([expect.objectContaining({ outcome: 'abandoned', status })]);
  });

  it('treats a return with no params at all as abandoned', () => {
    render({});
    expect(posted).toEqual([
      expect.objectContaining({ outcome: 'abandoned', status: 'null', externalReference: '' }),
    ]);
  });

  it('still renders when BroadcastChannel is unavailable', () => {
    vi.stubGlobal(
      'BroadcastChannel',
      class {
        constructor() {
          throw new Error('unsupported');
        }
      }
    );
    const fixture = render({ status: 'null' });
    expect(
      (fixture.nativeElement as HTMLElement).querySelector(
        '[data-testid="payment-callback-cancelled"]'
      )
    ).toBeTruthy();
  });
});
