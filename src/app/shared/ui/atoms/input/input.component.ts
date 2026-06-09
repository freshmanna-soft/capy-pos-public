import { Component, Input, Output, EventEmitter, forwardRef } from '@angular/core';

import { ControlValueAccessor, NG_VALUE_ACCESSOR } from '@angular/forms';

/**
 * Input Component (Atom)
 * Reusable input field following Atomic Design principles
 * Supports form control integration
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
      @if (label) {
        <label [for]="id" class="input-label">
          {{ label }}
          @if (required) {
            <span class="text-red-500">*</span>
          }
        </label>
      }

      <div class="input-container">
        @if (prefix) {
          <span class="input-prefix">{{ prefix }}</span>
        }

        <input
          [id]="id"
          [type]="type"
          [placeholder]="placeholder"
          [disabled]="disabled"
          [readonly]="readonly"
          [class]="inputClasses"
          [value]="value"
          (input)="onInput($event)"
          (blur)="onTouched()"
          (focus)="focused.emit($event)"
        />

        @if (suffix) {
          <span class="input-suffix">{{ suffix }}</span>
        }
      </div>

      @if (error) {
        <span class="input-error">{{ error }}</span>
      }
      @if (hint && !error) {
        <span class="input-hint">{{ hint }}</span>
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
  @Input() id = `input-${Math.random().toString(36).substr(2, 9)}`;
  @Input() type: 'text' | 'email' | 'password' | 'number' | 'tel' | 'url' | 'search' = 'text';
  @Input() label = '';
  @Input() placeholder = '';
  @Input() hint = '';
  @Input() error = '';
  @Input() prefix = '';
  @Input() suffix = '';
  @Input() size: 'sm' | 'md' | 'lg' = 'md';
  @Input() disabled = false;
  @Input() readonly = false;
  @Input() required = false;

  @Output() focused = new EventEmitter<FocusEvent>();
  @Output() blurred = new EventEmitter<FocusEvent>();
  @Output() valueChange = new EventEmitter<string>();

  value = '';

  // ControlValueAccessor implementation
  // eslint-disable-next-line @typescript-eslint/no-empty-function
  onChange: (value: string) => void = () => {};
  // eslint-disable-next-line @typescript-eslint/no-empty-function
  onTouched: () => void = () => {};

  get inputClasses(): string {
    const classes = ['input'];

    if (this.size !== 'md') {
      classes.push(`input-${this.size}`);
    }

    if (this.error) {
      classes.push('input-error-state');
    }

    if (this.prefix) {
      classes.push('pl-8');
    }

    if (this.suffix) {
      classes.push('pr-8');
    }

    return classes.join(' ');
  }

  onInput(event: Event): void {
    const input = event.target as HTMLInputElement;
    this.value = input.value;
    this.onChange(this.value);
    this.valueChange.emit(this.value);
  }

  writeValue(value: string): void {
    this.value = value || '';
  }

  registerOnChange(fn: (value: string) => void): void {
    this.onChange = fn;
  }

  registerOnTouched(fn: () => void): void {
    this.onTouched = fn;
  }

  setDisabledState(isDisabled: boolean): void {
    this.disabled = isDisabled;
  }
}

// Made with Bob
