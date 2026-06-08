import { Component, ChangeDetectionStrategy } from '@angular/core';
import { CommonModule } from '@angular/common';

@Component({
  selector: 'app-customers',
  standalone: true,
  imports: [CommonModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="page-container" data-testid="customers-page">
      <div class="page-header">
        <h1>👥 Customers</h1>
        <p class="page-subtitle">Customer profiles, loyalty points, and purchase history</p>
      </div>
      <div class="coming-soon">
        <span class="coming-icon">🚧</span>
        <h2>Coming in Sprint 2</h2>
        <p>Customer list, profiles, loyalty program, and purchase history tracking.</p>
      </div>
    </div>
  `,
  styles: [`
    .page-container { padding: 2rem; max-width: 1200px; margin: 0 auto; }
    .page-header h1 { font-size: 1.75rem; font-weight: 700; color: #111827; margin: 0; }
    .page-subtitle { color: #6b7280; margin: 0.25rem 0 0; }
    .coming-soon { 
      display: flex; flex-direction: column; align-items: center; justify-content: center;
      padding: 4rem 2rem; margin-top: 2rem; background: white; border-radius: 12px;
      border: 2px dashed #d1d5db; text-align: center;
    }
    .coming-icon { font-size: 3rem; margin-bottom: 1rem; }
    .coming-soon h2 { color: #374151; margin: 0 0 0.5rem; }
    .coming-soon p { color: #6b7280; margin: 0; max-width: 400px; }
  `]
})
export class CustomersComponent {}
