import { ComponentFixture, TestBed } from '@angular/core/testing';
import { ButtonComponent } from '@shared/ui/atoms/button/button.component';

describe('ButtonComponent (atom)', () => {
  let component: ButtonComponent;
  let fixture: ComponentFixture<ButtonComponent>;
  let el: HTMLElement;

  const button = (): HTMLButtonElement => el.querySelector('button')!;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [ButtonComponent],
    }).compileComponents();

    fixture = TestBed.createComponent(ButtonComponent);
    component = fixture.componentInstance;
    el = fixture.nativeElement;
    fixture.detectChanges();
  });

  it('defaults to type="button"', () => {
    // Load-bearing inside a form: a default of "submit" would make Cancel, Scan
    // and every disclosure toggle save the form instead.
    expect(button().getAttribute('type')).toBe('button');
  });

  it('carries a test id and an accessible label for icon-only use', () => {
    fixture.componentRef.setInput('testId', 'btn-close-form');
    fixture.componentRef.setInput('ariaLabel', 'Close');
    fixture.detectChanges();

    expect(button().getAttribute('data-testid')).toBe('btn-close-form');
    expect(button().getAttribute('aria-label')).toBe('Close');
  });

  it('omits both attributes when not given, rather than rendering empty ones', () => {
    expect(button().hasAttribute('data-testid')).toBe(false);
    expect(button().hasAttribute('aria-label')).toBe(false);
  });

  describe('while loading', () => {
    beforeEach(() => {
      fixture.componentRef.setInput('loading', true);
      fixture.detectChanges();
    });

    it('announces the wait and hides the spinner from assistive tech', () => {
      // aria-busy is the announcement; the spinner is decoration, and exposing it
      // would read out a meaningless graphic instead.
      expect(button().getAttribute('aria-busy')).toBe('true');
      expect(el.querySelector('.spinner')?.getAttribute('aria-hidden')).toBe('true');
    });

    it('cannot be clicked', () => {
      let clicks = 0;
      component.clicked.subscribe(() => clicks++);

      button().click();

      expect(button().disabled).toBe(true);
      expect(clicks).toBe(0);
    });
  });

  it('does not announce a wait when idle', () => {
    expect(button().hasAttribute('aria-busy')).toBe(false);
  });

  it('does not emit while disabled', () => {
    fixture.componentRef.setInput('disabled', true);
    fixture.detectChanges();
    let clicks = 0;
    component.clicked.subscribe(() => clicks++);

    button().click();

    expect(clicks).toBe(0);
  });

  it('emits the click when enabled', () => {
    let clicks = 0;
    component.clicked.subscribe(() => clicks++);

    button().click();

    expect(clicks).toBe(1);
  });
});
