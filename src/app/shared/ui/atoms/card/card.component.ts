import { Component, computed, input } from '@angular/core';

/**
 * Card Component (Atom)
 * Reusable card container for content grouping
 * Uses Angular Signals API (input/computed)
 */
@Component({
  selector: 'app-card',
  standalone: true,
  imports: [],
  template: `
    <div [class]="cardClasses()">
      <ng-content></ng-content>
    </div>
  `,
  styles: [
    `
      .card {
        @apply bg-white rounded-lg shadow-sm border border-gray-200
             transition-all duration-200;
      }

      .card-hover:hover {
        @apply shadow-md;
      }

      .card-clickable {
        @apply cursor-pointer hover:shadow-md;
      }

      .card-padded {
        @apply p-4;
      }

      .card-sm {
        @apply p-2;
      }

      .card-lg {
        @apply p-6;
      }
    `,
  ],
})
export class CardComponent {
  // Signal-based inputs
  readonly padding = input<'none' | 'sm' | 'md' | 'lg'>('md');
  readonly hover = input(false);
  readonly clickable = input(false);

  // Computed classes based on input signals
  readonly cardClasses = computed(() => {
    const classes = ['card'];

    if (this.padding() === 'md') {
      classes.push('card-padded');
    } else if (this.padding() !== 'none') {
      classes.push(`card-${this.padding()}`);
    }

    if (this.hover()) {
      classes.push('card-hover');
    }

    if (this.clickable()) {
      classes.push('card-clickable');
    }

    return classes.join(' ');
  });
}
