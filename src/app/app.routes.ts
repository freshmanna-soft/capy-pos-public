import { Routes } from '@angular/router';
import { authGuard } from '@core/presentation/guards/auth.guard';

export const routes: Routes = [
  {
    path: '',
    redirectTo: 'pos',
    pathMatch: 'full',
  },
  {
    path: 'pos',
    canActivate: [authGuard],
    loadComponent: () =>
      import('./features/pos-terminal/pos-terminal.component').then((m) => m.PosTerminalComponent),
    title: 'POS Terminal · Capy-POS',
  },
  {
    path: 'inventory',
    canActivate: [authGuard],
    loadComponent: () =>
      import('./features/inventory-management/inventory-management.component').then(
        (m) => m.InventoryManagementComponent
      ),
    title: 'Inventory Management',
  },
  {
    path: 'customers',
    canActivate: [authGuard],
    loadComponent: () =>
      import('./features/customers/customers.component').then((m) => m.CustomersComponent),
    title: 'Customers',
  },
  {
    path: 'reports',
    canActivate: [authGuard],
    loadComponent: () =>
      import('./features/reports/reports.component').then((m) => m.ReportsComponent),
    title: 'Reports & Analytics',
  },
  {
    path: 'dashboard',
    canActivate: [authGuard],
    loadComponent: () =>
      import('./features/dashboard/agent-monitor/agent-monitor.component').then(
        (m) => m.AgentMonitorComponent
      ),
    title: 'Agent Dashboard',
  },
  {
    path: 'history',
    canActivate: [authGuard],
    loadComponent: () =>
      import('./features/pos-terminal/components/transaction-history/transaction-history.component').then(
        (m) => m.TransactionHistoryComponent
      ),
    title: 'Transaction History',
  },
  {
    path: 'settings',
    canActivate: [authGuard],
    loadComponent: () =>
      import('./features/settings/settings.component').then((m) => m.SettingsComponent),
    title: 'Settings',
  },
  {
    // Admin area (Users & Roles, and future admin screens) lives in its own
    // lazily-loaded route table — keeps guard/permission wiring out of the
    // root routes. Leaf routes carry their own RBAC guards.
    path: 'admin',
    loadChildren: () => import('./features/admin/admin.routes').then((m) => m.ADMIN_ROUTES),
  },
  {
    path: 'login',
    loadComponent: () => import('./features/login/login.component').then((m) => m.LoginComponent),
    title: 'Sign In',
  },
  {
    path: '**',
    redirectTo: 'pos',
  },
];
