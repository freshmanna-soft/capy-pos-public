import { Component, Input, Output, EventEmitter } from '@angular/core';
import { CommonModule } from '@angular/common';

/**
 * Button Component (Atom)
 * Reusable button following Atomic Design principles
 * Can be used across all microservices agents
 */
@Component({
  selector: 'app-button',
  standalone: true,
  imports: [CommonModule],
  template: `
    <button
      [type]="type"
      [disabled]="disabled || loading"
      [class]="buttonClasses"
      (click)="handleClick($event)"
    >
      <span *ngIf="loading" class="spinner"></span>
      <ng-content></ng-content>
    </button>
  `,
  styles: [`
    .btn {
      @apply px-4 py-2 rounded-lg font-medium transition-all duration-200 
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
      @apply px-3 py-1.5 text-sm;
    }
    
    .btn-lg {
      @apply px-6 py-3 text-lg;
    }
    
    .spinner {
      @apply inline-block w-4 h-4 border-2 border-white border-t-transparent 
             rounded-full animate-spin;
    }
  `]
})
export class ButtonComponent {
  @Input() type: 'button' | 'submit' | 'reset' = 'button';
  @Input() variant: 'primary' | 'secondary' | 'danger' | 'success' = 'primary';
  @Input() size: 'sm' | 'md' | 'lg' = 'md';
  @Input() disabled = false;
  @Input() loading = false;
  @Input() fullWidth = false;
  
  @Output() clicked = new EventEmitter<MouseEvent>();

  get buttonClasses(): string {
    const classes = ['btn', `btn-${this.variant}`];
    
    if (this.size !== 'md') {
      classes.push(`btn-${this.size}`);
    }
    
    if (this.fullWidth) {
      classes.push('w-full');
    }
    
    return classes.join(' ');
  }

  handleClick(event: MouseEvent): void {
    if (!this.disabled && !this.loading) {
      this.clicked.emit(event);
    }
  }
}

// Made with Bob
