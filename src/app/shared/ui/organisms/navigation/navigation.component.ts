import { Component, ChangeDetectionStrategy, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterModule } from '@angular/router';

/**
 * Navigation Component
 * 
 * Sidebar navigation for the Capy-POS application.
 * Provides links to all major sections with icons.
 * Collapsible on smaller screens.
 * 
 * @example
 * ```html
 * <app-navigation />
 * ```
 */
@Component({
  selector: 'app-navigation',
  standalone: true,
  imports: [CommonModule, RouterModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <nav class="nav-sidebar" [class.collapsed]="collapsed()" data-testid="navigation">
      <!-- Logo/Brand -->
      <div class="nav-brand">
        <span class="brand-icon">🦫</span>
        @if (!collapsed()) {
          <span class="brand-text">Capy-POS</span>
        }
        <button 
          class="collapse-btn"
          (click)="toggleCollapse()"
          [attr.aria-label]="collapsed() ? 'Expand navigation' : 'Collapse navigation'">
          <svg fill="none" stroke="currentColor" viewBox="0 0 24 24" class="collapse-icon" [class.rotated]="collapsed()">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M11 19l-7-7 7-7m8 14l-7-7 7-7"/>
          </svg>
        </button>
      </div>

      <!-- Navigation Links -->
      <ul class="nav-links">
        @for (item of navItems; track item.path) {
          <li>
            <a 
              [routerLink]="item.path"
              routerLinkActive="active"
              [routerLinkActiveOptions]="{ exact: item.exact }"
              class="nav-link"
              [attr.aria-label]="item.label"
              [attr.data-testid]="'nav-' + item.id">
              <span class="nav-icon">{{ item.icon }}</span>
              @if (!collapsed()) {
                <span class="nav-label">{{ item.label }}</span>
              }
            </a>
          </li>
        }
      </ul>

      <!-- Footer -->
      @if (!collapsed()) {
        <div class="nav-footer">
          <span class="nav-version">v1.0.0</span>
        </div>
      }
    </nav>
  `,
  styles: [`
    .nav-sidebar {
      display: flex;
      flex-direction: column;
      width: 240px;
      height: 100vh;
      background: #1f2937;
      color: #f9fafb;
      transition: width 0.2s ease;
      overflow: hidden;
    }

    .nav-sidebar.collapsed {
      width: 64px;
    }

    .nav-brand {
      display: flex;
      align-items: center;
      gap: 0.75rem;
      padding: 1.25rem 1rem;
      border-bottom: 1px solid #374151;
    }

    .brand-icon {
      font-size: 1.5rem;
      flex-shrink: 0;
    }

    .brand-text {
      font-size: 1.125rem;
      font-weight: 700;
      white-space: nowrap;
    }

    .collapse-btn {
      margin-left: auto;
      background: none;
      border: none;
      color: #9ca3af;
      cursor: pointer;
      padding: 0.25rem;
      border-radius: 4px;
      display: flex;
      align-items: center;
    }

    .collapse-btn:hover {
      color: #f9fafb;
      background: #374151;
    }

    .collapse-icon {
      width: 1rem;
      height: 1rem;
      transition: transform 0.2s;
    }

    .collapse-icon.rotated {
      transform: rotate(180deg);
    }

    .nav-links {
      list-style: none;
      padding: 0.75rem 0.5rem;
      margin: 0;
      flex: 1;
      display: flex;
      flex-direction: column;
      gap: 0.25rem;
    }

    .nav-link {
      display: flex;
      align-items: center;
      gap: 0.75rem;
      padding: 0.75rem 0.75rem;
      border-radius: 8px;
      color: #d1d5db;
      text-decoration: none;
      font-size: 0.875rem;
      font-weight: 500;
      transition: all 0.15s;
      white-space: nowrap;
    }

    .nav-link:hover {
      background: #374151;
      color: #f9fafb;
    }

    .nav-link.active {
      background: #2563eb;
      color: #ffffff;
    }

    .nav-icon {
      font-size: 1.25rem;
      flex-shrink: 0;
      width: 1.5rem;
      text-align: center;
    }

    .nav-label {
      overflow: hidden;
      text-overflow: ellipsis;
    }

    .nav-footer {
      padding: 1rem;
      border-top: 1px solid #374151;
      text-align: center;
    }

    .nav-version {
      font-size: 0.75rem;
      color: #6b7280;
    }

    /* Collapsed state adjustments */
    .collapsed .nav-brand {
      justify-content: center;
      padding: 1.25rem 0.5rem;
    }

    .collapsed .collapse-btn {
      margin-left: 0;
    }

    .collapsed .nav-link {
      justify-content: center;
      padding: 0.75rem;
    }
  `]
})
export class NavigationComponent {
  readonly collapsed = signal(false);

  readonly navItems = [
    { id: 'pos', path: '/pos', label: 'POS Terminal', icon: '🛒', exact: false },
    { id: 'inventory', path: '/inventory', label: 'Inventory', icon: '📦', exact: false },
    { id: 'customers', path: '/customers', label: 'Customers', icon: '👥', exact: false },
    { id: 'reports', path: '/reports', label: 'Reports', icon: '📊', exact: false },
    { id: 'dashboard', path: '/dashboard', label: 'Agent Monitor', icon: '🤖', exact: false },
    { id: 'settings', path: '/settings', label: 'Settings', icon: '⚙️', exact: false },
  ];

  toggleCollapse(): void {
    this.collapsed.update(v => !v);
  }
}
