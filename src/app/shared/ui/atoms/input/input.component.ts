import { Component, computed, forwardRef, input, output, signal } from '@angular/core';
import { ControlValueAccessor, NG_VALUE_ACCESSOR } from '@angular/forms';
import { generateUUID } from '@core/domain/utils/uuid';

/**
 * Input Component (Atom)
 *
 * The app's one text field. Wraps a native `<input>` rather than replacing it, so
 * autofill, spellcheck, mobile keyboards and hardware scanner guns all behave the
 * way the platform intends.
 *
 * Three things here exist because a real consumer needed them, and are worth not
 * removing:
 *
 * 1. **`testId` lands on the inner `<input>`, not the wrapper.** Playwright's
 *    `getByTestId` has to resolve to something fillable — a testid on the outer
 *    div would make `fill()` ambiguous and break every form test.
 * 2. **The error is linked, not just rendered.** Without `aria-invalid` and
 *    `aria-describedby` a screen reader reads a red-outlined field as perfectly
 *    fine, which is the accessibility equivalent of showing no error at all.
 * 3. **`inputAction` is a content slot inside the field.** A barcode field needs a
 *    Scan button attached to it; anything positioned from outside would drift the
 *    moment an error message changed the field's height.
 */
@Component({
  selector: 'app-input',
  standalone: true,
  imports: [],
  providers: [
    {
      provide: NG_VALUE_ACCESSOR,
      useExisting: forwardRef(() => InputComponent),
      multi: true,
    },
  ],
  template: `
    <div class="input-wrapper">
      @if (label()) {
        <label [for]="id()" class="input-label">
          {{ label() }}
          @if (required()) {
            <span class="text-red-500" aria-hidden="true">*</span>
          }
        </label>
      }

      <div class="input-container">
        @if (prefix()) {
          <span class="input-prefix" aria-hidden="true">{{ prefix() }}</span>
        }

        <input
          [id]="id()"
          [type]="type()"
          [placeholder]="placeholder()"
          [disabled]="isDisabled()"
          [readonly]="readonly()"
          [class]="inputClasses()"
          [value]="value()"
          [attr.data-testid]="testId() || null"
          [attr.inputmode]="inputMode() || null"
          [attr.autocomplete]="autocomplete() || null"
          [attr.list]="listId() || null"
          [attr.min]="min()"
          [attr.max]="max()"
          [attr.step]="step()"
          [attr.maxlength]="maxLength()"
          [attr.aria-required]="required() ? 'true' : null"
          [attr.aria-invalid]="error() ? 'true' : null"
          [attr.aria-describedby]="describedBy()"
          (input)="onInput($event)"
          (blur)="onBlur($event)"
          (focus)="focused.emit($event)"
        />

        @if (suffix()) {
          <span class="input-suffix" aria-hidden="true">{{ suffix() }}</span>
        }

        <!-- A control that belongs to the field itself, e.g. "Scan". -->
        <ng-content select="[inputAction]"></ng-content>
      </div>

      @if (error()) {
        <span [id]="id() + '-error'" class="input-error">{{ error() }}</span>
      }
      @if (hint() && !error()) {
        <span [id]="id() + '-hint'" class="input-hint">{{ hint() }}</span>
      }
    </div>
  `,
  styles: [
    `
      .input-wrapper {
        @apply w-full;
      }

      .input-label {
        @apply block text-sm font-medium text-gray-700 mb-1;
      }

      .input-container {
        @apply relative flex items-center gap-2;
      }

      /* 44px minimum: this is a touch till, and the forms this replaced set it
         explicitly. Losing it would be a regression dressed up as a refactor. */
      .input {
        @apply w-full min-h-[44px] px-3 py-2 border border-gray-300 rounded-lg
             focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent
             disabled:bg-gray-100 disabled:cursor-not-allowed
             transition-all duration-200;
      }

      .input-sm {
        @apply min-h-[36px] px-2 py-1 text-sm;
      }

      .input-lg {
        @apply min-h-[52px] px-4 py-3 text-lg;
      }

      .input-error-state {
        @apply border-red-500 focus:ring-red-500;
      }

      .input-prefix,
      .input-suffix {
        @apply absolute text-gray-500 text-sm;
      }

      .input-prefix {
        @apply left-3;
      }

      .input-suffix {
        @apply right-3;
      }

      .input-error {
        @apply block text-sm text-red-600 mt-1;
      }

      .input-hint {
        @apply block text-sm text-gray-500 mt-1;
      }
    `,
  ],
})
export class InputComponent implements ControlValueAccessor {
  // Signal-based inputs
  readonly id = input<string>(`input-${generateUUID().slice(0, 9)}`);
  readonly type = input<'text' | 'email' | 'password' | 'number' | 'tel' | 'url' | 'search'>(
    'text'
  );
  readonly label = input('');
  readonly placeholder = input('');
  readonly hint = input('');
  readonly error = input('');
  readonly prefix = input('');
  /**
   * Trailing text inside the field.
   *
   * Mutually exclusive with an `inputAction`: this is absolutely positioned at the
   * right edge, which is exactly where a projected control sits, and the two would
   * overlap.
   */
  readonly suffix = input('');
  readonly size = input<'sm' | 'md' | 'lg'>('md');
  readonly readonly = input(false);
  readonly required = input(false);
  /**
   * Bindable disabled state.
   *
   * An `input()` rather than a signal so a parent can actually set it — and
   * combined with the separate flag `setDisabledState` writes, because a form
   * directive and a template binding are two independent sources of truth and
   * either one saying "disabled" has to win.
   */
  readonly disabled = input(false);
  /** Lands on the inner `<input>`, which is the element tests need to fill. */
  readonly testId = input('');
  /** e.g. `numeric` for a barcode, so phones show a number pad. */
  readonly inputMode = input('');
  readonly autocomplete = input('');
  /** id of a `<datalist>` to suggest from, e.g. existing categories. */
  readonly listId = input('');
  readonly min = input<number | string | null>(null);
  readonly max = input<number | string | null>(null);
  readonly step = input<number | string | null>(null);
  readonly maxLength = input<number | null>(null);

  // Signal-based outputs
  readonly focused = output<FocusEvent>();
  readonly blurred = output<FocusEvent>();
  /**
   * A number for `type="number"`, null when such a field is cleared, otherwise the
   * string. Matching what Angular's own number accessor does, so swapping a raw
   * `<input type="number">` for this atom does not quietly turn a blank price
   * into a zero.
   */
  readonly valueChange = output<string | number | null>();

  // Internal state
  readonly value = signal('');
  private readonly cvaDisabled = signal(false);

  readonly isDisabled = computed(() => this.disabled() || this.cvaDisabled());

  /** Points the field at whichever message is currently on screen, if any. */
  readonly describedBy = computed(() => {
    if (this.error()) {
      return `${this.id()}-error`;
    }
    return this.hint() ? `${this.id()}-hint` : null;
  });

  // Computed classes based on input signals
  readonly inputClasses = computed(() => {
    const classes = ['input'];

    if (this.size() !== 'md') {
      classes.push(`input-${this.size()}`);
    }

    if (this.error()) {
      classes.push('input-error-state');
    }

    if (this.prefix()) {
      classes.push('pl-8');
    }

    if (this.suffix()) {
      classes.push('pr-8');
    }

    return classes.join(' ');
  });

  // ControlValueAccessor implementation
  // eslint-disable-next-line @typescript-eslint/no-empty-function
  onChange: (value: string | number | null) => void = () => {};
  // eslint-disable-next-line @typescript-eslint/no-empty-function
  onTouched: () => void = () => {};

  onInput(event: Event): void {
    const input = event.target as HTMLInputElement;

    // Half-typed numbers must be left alone.
    //
    // A number field reports `value === ''` for any state that isn't yet a valid
    // number — "4." on the way to "4.50", or a lone "-". Storing that empty string
    // would push it straight back out through `[value]` and delete the character
    // just typed, making decimals impossible to enter by hand. `badInput` is how
    // the platform distinguishes "not a number yet" from "genuinely cleared".
    //
    // Nothing in the e2e suite would catch this: `fill()` sets the whole value in
    // one event and never passes through an intermediate state.
    if (input.validity?.badInput) {
      return;
    }

    this.value.set(input.value);
    const emitted = this.coerce(input.value);
    this.onChange(emitted);
    this.valueChange.emit(emitted);
  }

  /**
   * Both jobs on blur.
   *
   * `blurred` was declared here long before anything emitted it, so a parent
   * listening for it was silently never called.
   */
  onBlur(event: FocusEvent): void {
    this.onTouched();
    this.blurred.emit(event);
  }

  writeValue(value: string | number | null): void {
    this.value.set(value === null || value === undefined ? '' : String(value));
  }

  registerOnChange(fn: (value: string | number | null) => void): void {
    this.onChange = fn;
  }

  registerOnTouched(fn: () => void): void {
    this.onTouched = fn;
  }

  setDisabledState(isDisabled: boolean): void {
    this.cvaDisabled.set(isDisabled);
  }

  /** Keep a numeric field's model numeric, and a cleared one empty rather than 0. */
  private coerce(raw: string): string | number | null {
    if (this.type() !== 'number') {
      return raw;
    }
    if (raw.trim().length === 0) {
      return null;
    }
    const parsed = Number(raw);
    return Number.isNaN(parsed) ? null : parsed;
  }
}
