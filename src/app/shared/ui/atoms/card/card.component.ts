import { Component, Input } from '@angular/core';
import { CommonModule } from '@angular/common';

/**
 * Card Component (Atom)
 * Reusable card container for content grouping
 */
@Component({
  selector: 'app-card',
  standalone: true,
  imports: [CommonModule],
  template: `
    <div [class]="cardClasses">
      <ng-content></ng-content>
    </div>
  `,
  styles: [`
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
  `]
})
export class CardComponent {
  @Input() padding: 'none' | 'sm' | 'md' | 'lg' = 'md';
  @Input() hover = false;
  @Input() clickable = false;

  get cardClasses(): string {
    const classes = ['card'];
    
    if (this.padding === 'md') {
      classes.push('card-padded');
    } else if (this.padding !== 'none') {
      classes.push(`card-${this.padding}`);
    }
    
    if (this.hover) {
      classes.push('card-hover');
    }
    
    if (this.clickable) {
      classes.push('card-clickable');
    }
    
    return classes.join(' ');
  }
}

// Made with Bob