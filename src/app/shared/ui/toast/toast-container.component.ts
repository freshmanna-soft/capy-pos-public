import { Component, ChangeDetectionStrategy, inject } from '@angular/core';

import { ToastService, ToastVariant } from './toast.service';

/**
 * ToastContainerComponent
 *
 * Renders the stack of active toasts from ToastService in a fixed overlay.
 * Mounted once at the application root. Each toast is dismissible and the
 * region is announced to assistive tech (errors/warnings assertively,
 * success/info politely).
 */
@Component({
  selector: 'app-toast-container',
  standalone: true,
  imports: [],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <!-- Polite region: success / info -->
    <div
      class="pointer-events-none fixed top-4 right-1/2 translate-x-1/2 sm:right-4 sm:translate-x-0 z-[100] flex flex-col gap-2 w-[calc(100vw-2rem)] sm:w-auto sm:max-w-sm"
      aria-live="polite"
      aria-atomic="false"
      data-testid="toast-region"
    >
      @for (toast of toastService.toasts(); track toast.id) {
        <div
          class="pointer-events-auto flex items-start gap-2.5 px-4 py-3 rounded-lg shadow-lg border text-sm font-medium animate-toast-in"
          [class]="containerClasses(toast.variant)"
          [attr.role]="
            toast.variant === 'error' || toast.variant === 'warning' ? 'alert' : 'status'
          "
          [attr.data-testid]="'toast-' + toast.variant"
        >
          <!-- Variant icon -->
          <span
            class="flex-shrink-0 mt-0.5"
            [innerHTML]="icon(toast.variant)"
            aria-hidden="true"
          ></span>

          <span class="flex-1 leading-snug">{{ toast.message }}</span>

          <!-- Dismiss -->
          <button
            type="button"
            class="flex-shrink-0 -mr-1 -mt-0.5 w-6 h-6 inline-flex items-center justify-center rounded-md opacity-60 hover:opacity-100 transition-opacity"
            (click)="toastService.dismiss(toast.id)"
            aria-label="Dismiss notification"
          >
            <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path
                stroke-linecap="round"
                stroke-linejoin="round"
                stroke-width="2"
                d="M6 18L18 6M6 6l12 12"
              />
            </svg>
          </button>
        </div>
      }
    </div>
  `,
  styles: [
    `
      @keyframes toast-in {
        from {
          opacity: 0;
          transform: translateY(-0.5rem);
        }
        to {
          opacity: 1;
          transform: translateY(0);
        }
      }

      .animate-toast-in {
        animation: toast-in 0.2s ease-out;
      }

      @media (prefers-reduced-motion: reduce) {
        .animate-toast-in {
          animation: none;
        }
      }
    `,
  ],
})
export class ToastContainerComponent {
  protected readonly toastService = inject(ToastService);

  /** Tailwind classes for the toast surface, per variant. */
  protected containerClasses(variant: ToastVariant): string {
    switch (variant) {
      case 'success':
        return 'bg-green-50 border-green-200 text-green-800';
      case 'error':
        return 'bg-red-50 border-red-200 text-red-800';
      case 'warning':
        return 'bg-amber-50 border-amber-200 text-amber-800';
      default:
        return 'bg-indigo-50 border-indigo-200 text-indigo-800';
    }
  }

  /** Inline SVG icon markup, per variant. */
  protected icon(variant: ToastVariant): string {
    switch (variant) {
      case 'success':
        return '<svg class="w-4 h-4" fill="currentColor" viewBox="0 0 20 20"><path fill-rule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clip-rule="evenodd"/></svg>';
      case 'error':
        return '<svg class="w-4 h-4" fill="currentColor" viewBox="0 0 20 20"><path fill-rule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM8.707 7.293a1 1 0 00-1.414 1.414L8.586 10l-1.293 1.293a1 1 0 101.414 1.414L10 11.414l1.293 1.293a1 1 0 001.414-1.414L11.414 10l1.293-1.293a1 1 0 00-1.414-1.414L10 8.586 8.707 7.293z" clip-rule="evenodd"/></svg>';
      case 'warning':
        return '<svg class="w-4 h-4" fill="currentColor" viewBox="0 0 20 20"><path fill-rule="evenodd" d="M8.257 3.099c.765-1.36 2.722-1.36 3.486 0l5.58 9.92c.75 1.334-.213 2.98-1.742 2.98H4.42c-1.53 0-2.493-1.646-1.743-2.98l5.58-9.92zM11 13a1 1 0 11-2 0 1 1 0 012 0zm-1-8a1 1 0 00-1 1v3a1 1 0 002 0V6a1 1 0 00-1-1z" clip-rule="evenodd"/></svg>';
      default:
        return '<svg class="w-4 h-4" fill="currentColor" viewBox="0 0 20 20"><path fill-rule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7-4a1 1 0 11-2 0 1 1 0 012 0zM9 9a1 1 0 000 2v3a1 1 0 001 1h1a1 1 0 100-2v-3a1 1 0 00-1-1H9z" clip-rule="evenodd"/></svg>';
    }
  }
}
