import { Component, Input } from '@angular/core';

/**
 * Badge Component (Atom)
 * Reusable badge for status indicators, counts, and labels
 */
@Component({
  selector: 'app-badge',
  standalone: true,
  imports: [],
  template: `
    <span [class]="badgeClasses">
      <ng-content></ng-content>
    </span>
  `,
  styles: [
    `
      .badge {
        @apply inline-flex items-center justify-center px-2 py-1 
             text-xs font-medium rounded-full;
      }

      .badge-primary {
        @apply bg-blue-100 text-blue-800;
      }

      .badge-secondary {
        @apply bg-gray-100 text-gray-800;
      }

      .badge-success {
        @apply bg-green-100 text-green-800;
      }

      .badge-warning {
        @apply bg-yellow-100 text-yellow-800;
      }

      .badge-danger {
        @apply bg-red-100 text-red-800;
      }

      .badge-info {
        @apply bg-cyan-100 text-cyan-800;
      }

      .badge-sm {
        @apply px-1.5 py-0.5 text-xs;
      }

      .badge-lg {
        @apply px-3 py-1.5 text-sm;
      }

      .badge-dot {
        @apply w-2 h-2 rounded-full p-0;
      }
    `,
  ],
})
export class BadgeComponent {
  @Input() variant: 'primary' | 'secondary' | 'success' | 'warning' | 'danger' | 'info' = 'primary';
  @Input() size: 'sm' | 'md' | 'lg' = 'md';
  @Input() dot = false;

  get badgeClasses(): string {
    const classes = ['badge', `badge-${this.variant}`];

    if (this.size !== 'md') {
      classes.push(`badge-${this.size}`);
    }

    if (this.dot) {
      classes.push('badge-dot');
    }

    return classes.join(' ');
  }
}

// Made with Bob
