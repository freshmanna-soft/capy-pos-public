import { Component, computed, forwardRef, input, output, signal } from '@angular/core';

import { ControlValueAccessor, NG_VALUE_ACCESSOR } from '@angular/forms';
import { generateUUID } from '@core/domain/utils/uuid';

/**
 * Input Component (Atom)
 * Reusable input field following Atomic Design principles
 * Supports form control integration via ControlValueAccessor
 * Uses Angular Signals API (input/output/computed)
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
            <span class="text-red-500">*</span>
          }
        </label>
      }

      <div class="input-container">
        @if (prefix()) {
          <span class="input-prefix">{{ prefix() }}</span>
        }

        <input
          [id]="id()"
          [type]="type()"
          [placeholder]="placeholder()"
          [disabled]="disabled()"
          [readonly]="readonly()"
          [class]="inputClasses()"
          [value]="value()"
          (input)="onInput($event)"
          (blur)="onTouched()"
          (focus)="focused.emit($event)"
        />

        @if (suffix()) {
          <span class="input-suffix">{{ suffix() }}</span>
        }
      </div>

      @if (error()) {
        <span class="input-error">{{ error() }}</span>
      }
      @if (hint() && !error()) {
        <span class="input-hint">{{ hint() }}</span>
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
        @apply relative flex items-center;
      }

      .input {
        @apply w-full px-3 py-2 border border-gray-300 rounded-lg
             focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent
             disabled:bg-gray-100 disabled:cursor-not-allowed
             transition-all duration-200;
      }

      .input-sm {
        @apply px-2 py-1 text-sm;
      }

      .input-lg {
        @apply px-4 py-3 text-lg;
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
  readonly suffix = input('');
  readonly size = input<'sm' | 'md' | 'lg'>('md');
  readonly disabled = signal(false);
  readonly readonly = input(false);
  readonly required = input(false);

  // Signal-based outputs
  readonly focused = output<FocusEvent>();
  readonly blurred = output<FocusEvent>();
  readonly valueChange = output<string>();

  // Internal state
  readonly value = signal('');

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
  onChange: (value: string) => void = () => {};
  // eslint-disable-next-line @typescript-eslint/no-empty-function
  onTouched: () => void = () => {};

  onInput(event: Event): void {
    const input = event.target as HTMLInputElement;
    this.value.set(input.value);
    this.onChange(input.value);
    this.valueChange.emit(input.value);
  }

  writeValue(value: string): void {
    this.value.set(value || '');
  }

  registerOnChange(fn: (value: string) => void): void {
    this.onChange = fn;
  }

  registerOnTouched(fn: () => void): void {
    this.onTouched = fn;
  }

  setDisabledState(isDisabled: boolean): void {
    this.disabled.set(isDisabled);
  }
}
