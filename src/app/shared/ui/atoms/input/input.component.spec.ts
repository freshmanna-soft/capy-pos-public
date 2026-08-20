import { ComponentFixture, TestBed } from '@angular/core/testing';
import { InputComponent } from '@shared/ui/atoms/input/input.component';

describe('InputComponent (atom)', () => {
  let component: InputComponent;
  let fixture: ComponentFixture<InputComponent>;
  let el: HTMLElement;

  /** The element a form test actually types into. */
  const field = (): HTMLInputElement => el.querySelector('input')!;

  const type = (value: string): void => {
    field().value = value;
    field().dispatchEvent(new Event('input'));
  };

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [InputComponent],
    }).compileComponents();

    fixture = TestBed.createComponent(InputComponent);
    component = fixture.componentInstance;
    el = fixture.nativeElement;
    fixture.componentRef.setInput('id', 'price');
    fixture.detectChanges();
  });

  it('puts the test id on the inner input, not the wrapper', () => {
    // Playwright's getByTestId has to resolve to something fillable. On the
    // wrapper it would be ambiguous and every form test that types into a field
    // would break.
    fixture.componentRef.setInput('testId', 'input-price');
    fixture.detectChanges();

    expect(field().getAttribute('data-testid')).toBe('input-price');
    expect(el.querySelector('.input-wrapper')?.getAttribute('data-testid')).toBeNull();
  });

  it('omits the attribute entirely when no test id is given', () => {
    expect(field().hasAttribute('data-testid')).toBe(false);
  });

  describe('announcing an error', () => {
    it('marks the field invalid and points at the message', () => {
      // A red outline alone is not an error for anyone using a screen reader —
      // without these two attributes the field reads as perfectly fine.
      fixture.componentRef.setInput('error', 'Price cannot be negative');
      fixture.detectChanges();

      expect(field().getAttribute('aria-invalid')).toBe('true');
      expect(field().getAttribute('aria-describedby')).toBe('price-error');
      expect(el.querySelector('#price-error')?.textContent).toContain('Price cannot be negative');
    });

    it('describes the field by its hint when there is no error', () => {
      fixture.componentRef.setInput('hint', 'Leave blank for no barcode');
      fixture.detectChanges();

      expect(field().getAttribute('aria-describedby')).toBe('price-hint');
      expect(field().hasAttribute('aria-invalid')).toBe(false);
    });

    it('prefers the error over the hint, so only one message is announced', () => {
      fixture.componentRef.setInput('hint', 'Leave blank for no barcode');
      fixture.componentRef.setInput('error', 'Required');
      fixture.detectChanges();

      expect(field().getAttribute('aria-describedby')).toBe('price-error');
      expect(el.querySelector('#price-hint')).toBeNull();
    });
  });

  describe('being disabled', () => {
    it('can be disabled by a parent binding', () => {
      // It could not before: `disabled` was a plain signal, so there was no way to
      // set it from a template at all.
      fixture.componentRef.setInput('disabled', true);
      fixture.detectChanges();

      expect(field().disabled).toBe(true);
    });

    it('can be disabled by a form directive', () => {
      component.setDisabledState(true);
      fixture.detectChanges();

      expect(field().disabled).toBe(true);
    });

    it('stays disabled while either source says so', () => {
      // Two independent sources of truth; whichever says disabled has to win, or
      // a reactive form re-enables a field the template meant to lock.
      fixture.componentRef.setInput('disabled', true);
      component.setDisabledState(false);
      fixture.detectChanges();

      expect(field().disabled).toBe(true);
    });
  });

  describe('numeric fields', () => {
    beforeEach(() => {
      fixture.componentRef.setInput('type', 'number');
      fixture.detectChanges();
    });

    it('emits a number rather than a string', () => {
      const seen: unknown[] = [];
      component.valueChange.subscribe((value) => seen.push(value));

      type('12.5');

      expect(seen).toEqual([12.5]);
    });

    it('emits null when cleared, so a blank price does not become zero', () => {
      // What Angular's own number accessor does. Emitting 0 here would silently
      // price a product at nothing the moment someone selected the field and
      // deleted it.
      const seen: unknown[] = [];
      component.valueChange.subscribe((value) => seen.push(value));

      type('');

      expect(seen).toEqual([null]);
    });

    it('passes through the raw string for text fields', () => {
      fixture.componentRef.setInput('type', 'text');
      fixture.detectChanges();
      const seen: unknown[] = [];
      component.valueChange.subscribe((value) => seen.push(value));

      type('0012');

      // A barcode's leading zeros are part of its identity.
      expect(seen).toEqual(['0012']);
    });
  });

  it('emits blurred, which was declared but never fired', () => {
    let blurred = false;
    component.blurred.subscribe(() => (blurred = true));

    field().dispatchEvent(new FocusEvent('blur'));

    expect(blurred).toBe(true);
  });

  it('renders a value written by a form directive', () => {
    component.writeValue(42);
    fixture.detectChanges();

    expect(field().value).toBe('42');
  });

  it('shows an empty field rather than "null" when written a null', () => {
    component.writeValue(null);
    fixture.detectChanges();

    expect(field().value).toBe('');
  });
});
