import { A11yModule } from '@angular/cdk/a11y';
import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  HostListener,
  inject,
  input,
  output,
} from '@angular/core';
import { ButtonComponent } from '@shared/ui/atoms/button/button.component';
import { generateUUID } from '@core/domain/utils/uuid';

/** Why the modal is being dismissed, so a parent can guard unsaved work. */
export type ModalCloseReason = 'escape' | 'backdrop' | 'button';

/**
 * Modal Component (Molecule)
 *
 * One dialog shell for the whole app. Before this, every overlay was hand-rolled
 * from the same `fixed inset-0 bg-black/50 … z-[1000]` string, and between them
 * they managed: no focus trap anywhere, no scroll lock anywhere, `role="dialog"`
 * on some and not others, and two `(keydown.escape)` handlers bound to
 * unfocusable divs where they could never fire.
 *
 * What this owns, and why each part is not optional:
 *
 * - **Focus trap** via the CDK, which is already a dependency and was unused.
 *   `cdkTrapFocusAutoCapture` also returns focus to whatever was focused before,
 *   so dismissing the dialog puts the caret back on the button that opened it
 *   instead of at the top of the page.
 * - **Escape that actually fires, from anywhere.** Listened for on the document,
 *   not only on the backdrop. A backdrop-only binding works right up until the
 *   focused element is removed from the DOM — re-render a footer and focus falls
 *   back to `document.body`, which is *outside* the backdrop, so the key never
 *   reaches the handler and the dialog stops responding to Escape with no visible
 *   reason. The same binding on the app's other backdrops is dead for a related
 *   reason: nothing ever puts focus inside them at all.
 * - **Scroll lock**, restoring the previous value rather than assuming it was
 *   empty, so a dialog opened over an already-locked page doesn't unlock it.
 * - **Dismissal is a request, not an action.** `close` reports *why*, and the
 *   parent decides — a form with half a product typed into it should get to ask
 *   before a stray Escape throws it away.
 */
@Component({
  selector: 'app-modal',
  standalone: true,
  imports: [A11yModule, ButtonComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div
      class="modal-backdrop"
      [class.modal-backdrop--sheet]="sheet()"
      [attr.data-testid]="testId() || null"
      tabindex="-1"
      (click)="onBackdrop($event)"
      (keydown.escape)="onEscape($event)"
    >
      <div
        class="modal-panel"
        [class.modal-panel--sheet]="sheet()"
        [style.max-width]="maxWidth()"
        role="dialog"
        aria-modal="true"
        [attr.aria-labelledby]="headingId"
        cdkTrapFocus
        [cdkTrapFocusAutoCapture]="true"
      >
        <header class="modal-header">
          <h2 [id]="headingId" class="modal-heading">{{ heading() }}</h2>
          <app-button
            variant="secondary"
            ariaLabel="Close"
            [testId]="closeTestId()"
            (clicked)="dismissed.emit('button')"
          >
            ✕
          </app-button>
        </header>

        <div class="modal-body">
          <ng-content></ng-content>
        </div>

        @if (hasFooter()) {
          <footer class="modal-footer">
            <ng-content select="[modalFooter]"></ng-content>
          </footer>
        }
      </div>
    </div>
  `,
  styles: [
    `
      .modal-backdrop {
        @apply fixed inset-0 z-[1000] flex items-center justify-center bg-black/50 p-0 md:p-4;
      }

      /* Bottom sheet on small screens: a thumb reaches the bottom of a phone, not
         the middle of it. */
      .modal-backdrop--sheet {
        @apply items-end md:items-center;
      }

      .modal-panel {
        @apply flex max-h-[90vh] w-full flex-col overflow-hidden bg-white shadow-2xl md:rounded-xl;
      }

      .modal-panel--sheet {
        @apply rounded-t-2xl md:rounded-xl;
      }

      .modal-header {
        @apply flex flex-shrink-0 items-center justify-between gap-3 border-b border-gray-200 p-4 md:px-6 md:py-5;
      }

      .modal-heading {
        @apply m-0 text-lg font-semibold text-gray-900;
      }

      /* The only scrolling region, so the header and the actions stay put while a
         long form moves. Actions that scroll off the bottom are actions nobody
         finds. */
      .modal-body {
        @apply min-h-0 flex-1 overflow-y-auto p-4 md:p-6;
      }

      .modal-footer {
        @apply flex flex-shrink-0 justify-end gap-3 border-t border-gray-200 p-4 md:px-6;
      }
    `,
  ],
})
export class ModalComponent {
  readonly heading = input.required<string>();
  /** Rendered on the outermost element, where existing tests look for the dialog. */
  readonly testId = input('');
  readonly closeTestId = input('');
  readonly maxWidth = input('640px');
  /** Slide up from the bottom edge on phones instead of sitting centred. */
  readonly sheet = input(true);
  /** Skips the footer rule and padding when the caller projects no actions. */
  readonly hasFooter = input(true);
  /**
   * Whether clicking the backdrop dismisses.
   *
   * Turned off for destructive confirmations: a misplaced click should not be the
   * same gesture as answering "no", and must never be the same as "yes".
   */
  readonly dismissOnBackdrop = input(true);

  /**
   * A dismissal was *requested*. The parent closes — or asks first.
   */
  readonly dismissed = output<ModalCloseReason>();

  /** Stable for the component's lifetime — `aria-labelledby` has to keep resolving. */
  protected readonly headingId = `modal-${generateUUID().slice(0, 8)}-title`;

  constructor() {
    // Locking the page behind the dialog. Restores whatever was there rather than
    // clearing it, so closing a dialog opened over an already-locked page does not
    // hand scrolling back early.
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    inject(DestroyRef).onDestroy(() => {
      document.body.style.overflow = previousOverflow;
    });
  }

  /**
   * Escape, however it reached us.
   *
   * Bound twice on purpose — once on the backdrop, which is the keyboard equivalent
   * of the click that sits there, and once on the document, which is the binding
   * that still works when focus has fallen back to `body` because the element that
   * had it was re-rendered away. Both receive the *same* event object, so comparing
   * against the last one handled makes a doubly-delivered keypress a single
   * dismissal — a consumer's handler should not have to be idempotent to be correct.
   */
  @HostListener('document:keydown.escape', ['$event'])
  protected onEscape(event: Event): void {
    if (this.lastEscape === event) {
      return;
    }
    this.lastEscape = event;
    this.dismissed.emit('escape');
  }

  private lastEscape: Event | null = null;

  /**
   * Dismiss only for a click on the scrim itself.
   *
   * Compared against `currentTarget` rather than stopped from propagating inside
   * the panel: a click whose target is a descendant reaches here too, and so does
   * the mouse-up of a text selection that began on a label and ended past the
   * panel's edge. Treating either as "clicked outside" would throw away a
   * half-filled form because someone highlighted a word.
   */
  protected onBackdrop(event: MouseEvent): void {
    if (event.target !== event.currentTarget) {
      return;
    }
    if (this.dismissOnBackdrop()) {
      this.dismissed.emit('backdrop');
    }
  }
}
