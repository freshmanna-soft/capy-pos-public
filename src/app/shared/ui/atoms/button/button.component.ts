import { Component, computed, input, output } from '@angular/core';

/**
 * Button Component (Atom)
 *
 * Reusable button following Atomic Design principles. Uses the Angular Signals
 * API (input/output/computed).
 *
 * `type` defaults to `button` on purpose: the moment one of these sits inside a
 * `<form>`, a default of `submit` would make every secondary action — Cancel,
 * Scan, a disclosure toggle — save the form instead.
 */
@Component({
  selector: 'app-button',
  standalone: true,
  imports: [],
  template: `
    <button
      [type]="type()"
      [disabled]="disabled() || loading()"
      [class]="buttonClasses()"
      [attr.data-testid]="testId() || null"
      [attr.aria-label]="ariaLabel() || null"
      [attr.aria-busy]="loading() ? 'true' : null"
      (click)="handleClick($event)"
    >
      @if (loading()) {
        <!-- Decorative: the aria-busy attribute above is what announces the wait.
             A readable spinner would be announced as a meaningless graphic. -->
        <span class="spinner" aria-hidden="true"></span>
      }
      <ng-content></ng-content>
    </button>
  `,
  styles: [
    `
      /* 44px minimum — touch target on a till, not a decoration. */
      .btn {
        @apply min-h-[44px] px-4 py-2 rounded-lg font-medium transition-all duration-200 
             focus:outline-none focus:ring-2 focus:ring-offset-2
             disabled:opacity-50 disabled:cursor-not-allowed
             flex items-center justify-center gap-2;
      }

      .btn-primary {
        @apply bg-blue-600 text-white hover:bg-blue-700 
             focus:ring-blue-500;
      }

      .btn-secondary {
        @apply bg-gray-200 text-gray-800 hover:bg-gray-300 
             focus:ring-gray-500;
      }

      .btn-danger {
        @apply bg-red-600 text-white hover:bg-red-700 
             focus:ring-red-500;
      }

      .btn-success {
        @apply bg-green-600 text-white hover:bg-green-700 
             focus:ring-green-500;
      }

      .btn-sm {
        @apply min-h-[36px] px-3 py-1.5 text-sm;
      }

      .btn-lg {
        @apply min-h-[52px] px-6 py-3 text-lg;
      }

      .spinner {
        @apply inline-block w-4 h-4 border-2 border-white border-t-transparent 
             rounded-full animate-spin;
      }
    `,
  ],
})
export class ButtonComponent {
  // Signal-based inputs
  readonly type = input<'button' | 'submit' | 'reset'>('button');
  readonly variant = input<'primary' | 'secondary' | 'danger' | 'success'>('primary');
  readonly size = input<'sm' | 'md' | 'lg'>('md');
  readonly disabled = input(false);
  readonly loading = input(false);
  readonly fullWidth = input(false);
  /** Required for icon-only buttons, where the glyph is the whole label. */
  readonly ariaLabel = input('');
  readonly testId = input('');

  // Signal-based output
  readonly clicked = output<MouseEvent>();

  // Computed classes based on input signals
  readonly buttonClasses = computed(() => {
    const classes = ['btn', `btn-${this.variant()}`];

    if (this.size() !== 'md') {
      classes.push(`btn-${this.size()}`);
    }

    if (this.fullWidth()) {
      classes.push('w-full');
    }

    return classes.join(' ');
  });

  handleClick(event: MouseEvent): void {
    if (!this.disabled() && !this.loading()) {
      this.clicked.emit(event);
    }
  }
}
