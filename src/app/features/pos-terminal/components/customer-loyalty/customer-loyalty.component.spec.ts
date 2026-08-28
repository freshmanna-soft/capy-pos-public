import { TestBed, ComponentFixture } from '@angular/core/testing';
import { vi } from 'vitest';
import { CustomerLoyaltyComponent } from '@features/pos-terminal/components/customer-loyalty/customer-loyalty.component';
import { PosFacade, AttachedCustomer } from '@core/application/facades/pos.facade';
import { ToastService } from '@shared/ui/toast/toast.service';
import { CustomerTier } from '@core/domain/entities/customer.entity';
import { signal } from '@angular/core';

/**
 * Unit tests for CustomerLoyaltyComponent — the till-side control for #177.
 *
 * The facade already knew how to attach a card and award points, but nothing in
 * the UI called it, so the feature was unreachable. These tests pin the clerk's
 * side of that: type or scan a code, see who it belongs to, drop it again.
 */
describe('CustomerLoyaltyComponent', () => {
  let component: CustomerLoyaltyComponent;
  let fixture: ComponentFixture<CustomerLoyaltyComponent>;
  let attached: ReturnType<typeof signal<AttachedCustomer | null>>;
  let mockFacade: {
    attachedCustomer: ReturnType<typeof signal<AttachedCustomer | null>>;
    attachCustomerByLoyaltyCode: ReturnType<typeof vi.fn>;
    detachCustomer: ReturnType<typeof vi.fn>;
  };
  let mockToast: {
    success: ReturnType<typeof vi.fn>;
    warning: ReturnType<typeof vi.fn>;
    info: ReturnType<typeof vi.fn>;
    error: ReturnType<typeof vi.fn>;
  };

  const marco: AttachedCustomer = {
    id: 'customer-1',
    name: 'Marco Rossi',
    loyaltyPoints: 1250,
    tier: CustomerTier.SILVER,
  };

  beforeEach(async () => {
    attached = signal<AttachedCustomer | null>(null);
    mockFacade = {
      attachedCustomer: attached,
      // The real facade sets its own signal; the mock mirrors that so the template
      // reacts the way it does in the app.
      attachCustomerByLoyaltyCode: vi.fn(async (code: string) => {
        const found =
          code.replace(/[^a-z0-9]/gi, '').toUpperCase() === 'CAPYB3KMNPQR' ? marco : null;
        attached.set(found);
        return found;
      }),
      detachCustomer: vi.fn(() => attached.set(null)),
    };
    mockToast = { success: vi.fn(), warning: vi.fn(), info: vi.fn(), error: vi.fn() };

    await TestBed.configureTestingModule({
      imports: [CustomerLoyaltyComponent],
      providers: [
        { provide: PosFacade, useValue: mockFacade },
        { provide: ToastService, useValue: mockToast },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(CustomerLoyaltyComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  function input(): HTMLInputElement {
    return fixture.nativeElement.querySelector('[data-testid="loyalty-code-input"]');
  }

  function type(value: string): void {
    const field = input();
    field.value = value;
    field.dispatchEvent(new Event('input'));
    fixture.detectChanges();
  }

  describe('the anonymous sale', () => {
    it('creates', () => {
      expect(component).toBeTruthy();
    });

    it('offers a code field so a card can be scanned or keyed in', () => {
      expect(input()).toBeTruthy();
    });

    it('names the field for screen readers', () => {
      expect(input().getAttribute('aria-label')).toBeTruthy();
    });

    it('shows no attached customer', () => {
      expect(fixture.nativeElement.querySelector('[data-testid="loyalty-attached"]')).toBeFalsy();
    });
  });

  describe('attaching a card', () => {
    it('attaches the customer the code resolves to', async () => {
      type('CAPY-B3KMNPQR');

      await component.attach();
      fixture.detectChanges();

      expect(mockFacade.attachCustomerByLoyaltyCode).toHaveBeenCalledWith('CAPY-B3KMNPQR');
      expect(fixture.nativeElement.textContent).toContain('Marco Rossi');
    });

    it('shows the balance and tier the points will be priced at', async () => {
      type('CAPY-B3KMNPQR');

      await component.attach();
      fixture.detectChanges();

      const panel = fixture.nativeElement.querySelector('[data-testid="loyalty-attached"]');
      expect(panel.textContent).toContain('1,250');
      expect(panel.textContent).toContain('Silver');
    });

    it('confirms the attach to the cashier', async () => {
      type('CAPY-B3KMNPQR');

      await component.attach();

      expect(mockToast.success).toHaveBeenCalledWith(expect.stringContaining('Marco Rossi'));
    });

    it('empties the field so the next scan starts clean', async () => {
      type('CAPY-B3KMNPQR');

      await component.attach();
      fixture.detectChanges();

      expect(component.code()).toBe('');
    });

    it('accepts the loose spellings a scanner or keypad produces', async () => {
      type('  capy b3kmnpqr  ');

      await component.attach();

      // Normalising is the repository's job; this only trims the field so a stray
      // space does not read as an empty code.
      expect(mockFacade.attachCustomerByLoyaltyCode).toHaveBeenCalledWith('capy b3kmnpqr');
    });

    it('does nothing on an empty field', async () => {
      type('   ');

      await component.attach();

      expect(mockFacade.attachCustomerByLoyaltyCode).not.toHaveBeenCalled();
    });

    it('warns and keeps the code when it matches nobody', async () => {
      type('CAPY-00000000');

      await component.attach();
      fixture.detectChanges();

      expect(mockToast.warning).toHaveBeenCalled();
      // Kept, not cleared: an unrecognised code is usually a typo worth fixing
      // rather than rescanning.
      expect(component.code()).toBe('CAPY-00000000');
      expect(fixture.nativeElement.querySelector('[data-testid="loyalty-attached"]')).toBeFalsy();
    });

    it('does not fire a second lookup while one is in flight', async () => {
      let release = (): void => undefined;
      mockFacade.attachCustomerByLoyaltyCode.mockImplementation(
        () => new Promise((resolve) => (release = () => resolve(marco)))
      );
      type('CAPY-B3KMNPQR');

      const first = component.attach();
      const second = component.attach();
      release();
      await Promise.all([first, second]);

      expect(mockFacade.attachCustomerByLoyaltyCode).toHaveBeenCalledTimes(1);
    });

    it('recovers the field when the lookup blows up', async () => {
      const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
      mockFacade.attachCustomerByLoyaltyCode.mockRejectedValue(new Error('boom'));
      type('CAPY-B3KMNPQR');

      await component.attach();
      fixture.detectChanges();

      expect(mockToast.error).toHaveBeenCalled();
      // Not left stuck in a spinner — the cashier can try again.
      expect(component.looking()).toBe(false);
      expect(errorSpy).toHaveBeenCalled();
      errorSpy.mockRestore();
    });
  });

  describe('detaching a card', () => {
    beforeEach(async () => {
      type('CAPY-B3KMNPQR');
      await component.attach();
      fixture.detectChanges();
    });

    it('drops the customer on request', () => {
      component.detach();
      fixture.detectChanges();

      expect(mockFacade.detachCustomer).toHaveBeenCalled();
      expect(fixture.nativeElement.querySelector('[data-testid="loyalty-attached"]')).toBeFalsy();
    });

    it('offers a remove control while a card is attached', () => {
      expect(
        fixture.nativeElement.querySelector('[data-testid="loyalty-detach-btn"]')
      ).toBeTruthy();
    });

    it('tells the cashier the sale is anonymous again', () => {
      component.detach();

      expect(mockToast.info).toHaveBeenCalled();
    });

    it('reflects a detach made elsewhere, such as a completed sale', () => {
      // `PosFacade.checkout()` and `clearCart()` both detach on their own; this
      // component reads the facade's signal rather than keeping its own copy.
      attached.set(null);
      fixture.detectChanges();

      expect(fixture.nativeElement.querySelector('[data-testid="loyalty-attached"]')).toBeFalsy();
    });
  });
});
