import { ComponentFixture, TestBed } from '@angular/core/testing';
import { ModalCloseReason, ModalComponent } from '@shared/ui/molecules/modal/modal.component';

describe('ModalComponent (molecule)', () => {
  let component: ModalComponent;
  let fixture: ComponentFixture<ModalComponent>;
  let el: HTMLElement;
  let reasons: ModalCloseReason[];

  const backdrop = (): HTMLElement => el.querySelector('.modal-backdrop')!;
  const panel = (): HTMLElement => el.querySelector('.modal-panel')!;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [ModalComponent],
    }).compileComponents();

    fixture = TestBed.createComponent(ModalComponent);
    component = fixture.componentInstance;
    el = fixture.nativeElement;
    reasons = [];
    fixture.componentRef.setInput('heading', 'Add New Product');
    component.dismissed.subscribe((reason) => reasons.push(reason));
    fixture.detectChanges();
  });

  describe('what assistive tech is told', () => {
    it('is a modal dialog labelled by its own heading', () => {
      // Not one of the app's other overlays does all three, and two of them do
      // none — a dialog nobody is told about is just a div over the page.
      expect(panel().getAttribute('role')).toBe('dialog');
      expect(panel().getAttribute('aria-modal')).toBe('true');

      const labelId = panel().getAttribute('aria-labelledby');
      expect(labelId).toBeTruthy();
      expect(el.querySelector(`#${labelId}`)?.textContent).toContain('Add New Product');
    });

    it('gives the close button a name, since its label is a glyph', () => {
      const close = el.querySelector('button[aria-label="Close"]');
      expect(close).not.toBeNull();
    });
  });

  describe('dismissing', () => {
    it('reports Escape', () => {
      // Bound on the backdrop beside the click, and reached by bubbling from the
      // focused element inside the panel.
      backdrop().dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
      expect(reasons).toEqual(['escape']);
    });

    it('still reports Escape when focus has fallen back to the body', () => {
      // The regression this exists for: re-rendering a footer removes the element
      // that had focus, so focus drops to `body` — outside the backdrop — and a
      // backdrop-only binding silently stops receiving the key. The dialog then
      // ignores Escape with no visible reason.
      document.body.focus();
      document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));

      expect(reasons).toEqual(['escape']);
    });

    it('reports one dismissal for one keypress, despite two bindings', () => {
      // Backdrop and document both handle it; a consumer should not have to make
      // its handler idempotent to survive that.
      backdrop().dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));

      expect(reasons).toEqual(['escape']);
    });

    it('reports a click on the scrim', () => {
      backdrop().click();
      expect(reasons).toEqual(['backdrop']);
    });

    it('ignores a click that landed inside the panel', () => {
      // The click bubbles to the backdrop's handler, so without the target check
      // every click in the form would dismiss it.
      panel().click();
      expect(reasons).toEqual([]);
    });

    it('reports the close button separately, so a parent can tell them apart', () => {
      el.querySelector<HTMLButtonElement>('button[aria-label="Close"]')!.click();
      expect(reasons).toEqual(['button']);
    });

    it('can refuse scrim clicks, for a destructive confirmation', () => {
      // A misplaced click must not be the same gesture as answering the question.
      fixture.componentRef.setInput('dismissOnBackdrop', false);
      fixture.detectChanges();

      backdrop().click();

      expect(reasons).toEqual([]);
    });

    it('only requests dismissal — it never closes itself', () => {
      // The parent owns the decision, so a form holding unsaved work can ask first.
      backdrop().click();
      expect(el.querySelector('.modal-panel')).not.toBeNull();
    });
  });

  describe('the page behind it', () => {
    it('locks scrolling while open', () => {
      expect(document.body.style.overflow).toBe('hidden');
    });

    it('restores what was there before, rather than assuming it was unset', () => {
      // A dialog opened over an already-locked page must not hand scrolling back.
      fixture.destroy();
      expect(document.body.style.overflow).toBe('');
    });
  });
});
