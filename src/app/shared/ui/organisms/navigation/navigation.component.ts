import { Component, ChangeDetectionStrategy, signal, computed, inject } from '@angular/core';
import { RouterModule } from '@angular/router';
import { CurrentUserService } from '@core/application/auth/current-user.service';
import { Permission } from '@core/domain/auth/permission.constants';

/** A single navigation entry. `permission`, when set, gates visibility via RBAC. */
interface NavItem {
  id: string;
  path: string;
  label: string;
  shortLabel: string;
  icon: string;
  exact: boolean;
  /** When present, the item is shown only if the current operator holds it. */
  permission?: Permission;
}

/**
 * Navigation Component (Mobile-First)
 *
 * Mobile: Bottom tab bar (thumb-friendly, always visible)
 * Desktop: Side navigation bar (collapsible)
 *
 * Progressive enhancement approach:
 * - Base styles = mobile bottom nav
 * - md: breakpoint = side navigation
 *
 * @example
 * ```html
 * <app-navigation />
 * ```
 */
@Component({
  selector: 'app-navigation',
  standalone: true,
  imports: [RouterModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <!-- Mobile Bottom Navigation (visible < md) -->
    <nav
      class="fixed bottom-0 inset-x-0 z-50 bg-gray-900 border-t border-gray-700
             flex justify-around items-center px-1 pb-[env(safe-area-inset-bottom)]
             md:hidden"
      style="height: 64px;"
      data-testid="navigation"
      aria-label="Main navigation"
    >
      @for (item of mobileNavItems(); track item.path) {
        <a
          [routerLink]="item.path"
          routerLinkActive="text-blue-400"
          [routerLinkActiveOptions]="{ exact: item.exact }"
          class="flex flex-col items-center justify-center gap-0.5 min-w-[44px] min-h-[44px]
                 text-gray-400 no-underline transition-colors duration-150
                 active:text-blue-300"
          [attr.aria-label]="item.label"
          [attr.data-testid]="'nav-' + item.id"
        >
          <span class="text-xl leading-none">{{ item.icon }}</span>
          <span class="text-[10px] font-medium leading-tight">{{ item.shortLabel }}</span>
        </a>
      }
      <!-- More menu for overflow items -->
      <button
        (click)="toggleMobileMenu()"
        class="flex flex-col items-center justify-center gap-0.5 min-w-[44px] min-h-[44px]
               text-gray-400 bg-transparent border-none cursor-pointer transition-colors duration-150"
        [class.text-blue-400]="mobileMenuOpen()"
        aria-label="More options"
        data-testid="nav-more"
      >
        <span class="text-xl leading-none">⋯</span>
        <span class="text-[10px] font-medium leading-tight">More</span>
      </button>
    </nav>

    <!-- Mobile overflow menu (slide-up panel) -->
    @if (mobileMenuOpen()) {
      <div class="fixed inset-0 z-40 md:hidden" (click)="closeMobileMenu()" aria-hidden="true">
        <div class="absolute inset-0 bg-black/50"></div>
      </div>
      <div
        class="fixed bottom-16 inset-x-0 z-50 bg-gray-900 border-t border-gray-700
               rounded-t-2xl p-4 pb-[env(safe-area-inset-bottom)] md:hidden
               animate-slide-up"
        role="menu"
      >
        <div class="grid grid-cols-4 gap-3">
          @for (item of overflowNavItems(); track item.path) {
            <a
              [routerLink]="item.path"
              routerLinkActive="text-blue-400"
              [routerLinkActiveOptions]="{ exact: item.exact }"
              class="flex flex-col items-center justify-center gap-1 min-h-[56px]
                     text-gray-400 no-underline rounded-lg transition-colors duration-150
                     active:bg-gray-800"
              [attr.aria-label]="item.label"
              [attr.data-testid]="'nav-' + item.id"
              (click)="closeMobileMenu()"
            >
              <span class="text-2xl leading-none">{{ item.icon }}</span>
              <span class="text-xs font-medium">{{ item.shortLabel }}</span>
            </a>
          }
        </div>
      </div>
    }

    <!-- Desktop Side Navigation (visible >= md) -->
    <nav
      class="hidden md:flex md:flex-col md:h-screen md:bg-gray-900 md:text-gray-100
             md:transition-all md:duration-200 md:overflow-hidden md:border-r md:border-gray-700"
      [class.md:w-60]="!collapsed()"
      [class.md:w-16]="collapsed()"
      data-testid="navigation-desktop"
      aria-label="Main navigation"
    >
      <!-- Logo/Brand -->
      <div
        class="flex items-center gap-3 px-4 py-5 border-b border-gray-700"
        [class.justify-center]="collapsed()"
      >
        <span class="text-2xl flex-shrink-0">🦫</span>
        @if (!collapsed()) {
          <span class="text-lg font-bold whitespace-nowrap">Capy-POS</span>
        }
        <button
          class="ml-auto bg-transparent border-none text-gray-400 cursor-pointer p-1 rounded
                 hover:text-gray-100 hover:bg-gray-700 flex items-center"
          [class.ml-0]="collapsed()"
          (click)="toggleCollapse()"
          [attr.aria-label]="collapsed() ? 'Expand navigation' : 'Collapse navigation'"
        >
          <svg
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
            class="w-4 h-4 transition-transform duration-200"
            [class.rotate-180]="collapsed()"
          >
            <path
              stroke-linecap="round"
              stroke-linejoin="round"
              stroke-width="2"
              d="M11 19l-7-7 7-7m8 14l-7-7 7-7"
            />
          </svg>
        </button>
      </div>

      <!-- Navigation Links -->
      <ul class="list-none p-2 m-0 flex-1 flex flex-col gap-1 overflow-y-auto">
        @for (item of navItems(); track item.path) {
          <li>
            <a
              [routerLink]="item.path"
              routerLinkActive="bg-blue-600 text-white"
              [routerLinkActiveOptions]="{ exact: item.exact }"
              class="flex items-center gap-3 px-3 py-3 rounded-lg text-gray-300 no-underline
                     text-sm font-medium whitespace-nowrap transition-all duration-150
                     hover:bg-gray-700 hover:text-gray-100 min-h-[44px]"
              [class.justify-center]="collapsed()"
              [attr.aria-label]="item.label"
              [attr.data-testid]="'nav-' + item.id"
            >
              <span class="text-xl flex-shrink-0 w-6 text-center">{{ item.icon }}</span>
              @if (!collapsed()) {
                <span class="overflow-hidden text-ellipsis">{{ item.label }}</span>
              }
            </a>
          </li>
        }
      </ul>

      <!-- Footer -->
      @if (!collapsed()) {
        <div class="p-4 border-t border-gray-700 text-center">
          <span class="text-xs text-gray-500">v1.0.0</span>
        </div>
      }
    </nav>
  `,
  styles: [
    `
      @keyframes slide-up {
        from {
          transform: translateY(100%);
          opacity: 0;
        }
        to {
          transform: translateY(0);
          opacity: 1;
        }
      }

      .animate-slide-up {
        animation: slide-up 0.2s ease-out;
      }
    `,
  ],
})
export class NavigationComponent {
  private readonly currentUser = inject(CurrentUserService);

  readonly collapsed = signal(false);
  readonly mobileMenuOpen = signal(false);

  /** Full catalogue of navigation items (before RBAC filtering). */
  private readonly allNavItems: NavItem[] = [
    { id: 'pos', path: '/pos', label: 'Norma POS', shortLabel: 'POS', icon: '🌸', exact: false },
    {
      id: 'history',
      path: '/history',
      label: 'Transactions',
      shortLabel: 'History',
      icon: '🧾',
      exact: false,
    },
    {
      id: 'inventory',
      path: '/inventory',
      label: 'Inventory',
      shortLabel: 'Inventory',
      icon: '📦',
      exact: false,
    },
    {
      id: 'customers',
      path: '/customers',
      label: 'Customers',
      shortLabel: 'Customers',
      icon: '👥',
      exact: false,
    },
    {
      id: 'reports',
      path: '/reports',
      label: 'Reports',
      shortLabel: 'Reports',
      icon: '📊',
      exact: false,
    },
    {
      id: 'dashboard',
      path: '/dashboard',
      label: 'Agent Monitor',
      shortLabel: 'Agents',
      icon: '🤖',
      exact: false,
    },
    {
      id: 'admin-users',
      path: '/admin/users',
      label: 'Users',
      shortLabel: 'Users',
      icon: '👥',
      exact: false,
      permission: Permission.MANAGE_OPERATORS,
    },
    {
      id: 'admin-roles',
      path: '/admin/roles',
      label: 'Roles & Permissions',
      shortLabel: 'Roles',
      icon: '🛡️',
      exact: false,
      permission: Permission.MANAGE_ROLES,
    },
    {
      id: 'settings',
      path: '/settings',
      label: 'Settings',
      shortLabel: 'Settings',
      icon: '⚙️',
      exact: false,
    },
  ];

  /**
   * Navigation items visible to the current operator. Items carrying a
   * `permission` are hidden unless it is held; reactive to login/logout and
   * tenant switches because it reads CurrentUserService.permissions().
   */
  readonly navItems = computed<NavItem[]>(() =>
    this.allNavItems.filter(
      (item) => !item.permission || this.currentUser.hasPermission(item.permission)
    )
  );

  /** Primary items shown in mobile bottom bar (max 4) */
  readonly mobileNavItems = computed<NavItem[]>(() => this.navItems().slice(0, 4));

  /** Overflow items shown in "More" menu */
  readonly overflowNavItems = computed<NavItem[]>(() => this.navItems().slice(4));

  toggleCollapse(): void {
    this.collapsed.update((v) => !v);
  }

  toggleMobileMenu(): void {
    this.mobileMenuOpen.update((v) => !v);
  }

  closeMobileMenu(): void {
    this.mobileMenuOpen.set(false);
  }
}
