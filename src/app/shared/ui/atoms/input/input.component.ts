import { Component, Input, Output, EventEmitter, forwardRef } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ControlValueAccessor, NG_VALUE_ACCESSOR } from '@angular/forms';

/**
 * Input Component (Atom)
 * Reusable input field following Atomic Design principles
 * Supports form control integration
 */
@Component({
  selector: 'app-input',
  standalone: true,
  imports: [CommonModule],
  providers: [
    {
      provide: NG_VALUE_ACCESSOR,
      useExisting: forwardRef(() => InputComponent),
      multi: true
    }
  ],
  template: `
    <div class="input-wrapper">
      <label *ngIf="label" [for]="id" class="input-label">
        {{ label }}
        <span *ngIf="required" class="text-red-500">*</span>
      </label>
      
      <div class="input-container">
        <span *ngIf="prefix" class="input-prefix">{{ prefix }}</span>
        
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
          (focus)="onFocus.emit($event)"
        />
        
        <span *ngIf="suffix" class="input-suffix">{{ suffix }}</span>
      </div>
      
      <span *ngIf="error" class="input-error">{{ error }}</span>
      <span *ngIf="hint && !error" class="input-hint">{{ hint }}</span>
    </div>
  `,
  styles: [`
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
  `]
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
  
  @Output() onFocus = new EventEmitter<FocusEvent>();
  @Output() onBlur = new EventEmitter<FocusEvent>();
  @Output() valueChange = new EventEmitter<string>();

  value = '';
  
  // ControlValueAccessor implementation
  onChange: any = () => {};
  onTouched: any = () => {};

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

  writeValue(value: any): void {
    this.value = value || '';
  }

  registerOnChange(fn: any): void {
    this.onChange = fn;
  }

  registerOnTouched(fn: any): void {
    this.onTouched = fn;
  }

  setDisabledState(isDisabled: boolean): void {
    this.disabled = isDisabled;
  }
}

// Made with Bob