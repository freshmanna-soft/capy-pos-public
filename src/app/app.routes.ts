import { Routes } from '@angular/router';

export const routes: Routes = [
  {
    path: '',
    redirectTo: 'pos',
    pathMatch: 'full',
  },
  {
    path: 'pos',
    loadComponent: () =>
      import('./features/pos-terminal/pos-terminal.component').then((m) => m.PosTerminalComponent),
    title: 'POS Terminal',
  },
  {
    path: 'inventory',
    loadComponent: () =>
      import('./features/inventory-management/inventory-management.component').then(
        (m) => m.InventoryManagementComponent
      ),
    title: 'Inventory Management',
  },
  {
    path: 'customers',
    loadComponent: () =>
      import('./features/customers/customers.component').then((m) => m.CustomersComponent),
    title: 'Customers',
  },
  {
    path: 'reports',
    loadComponent: () =>
      import('./features/reports/reports.component').then((m) => m.ReportsComponent),
    title: 'Reports & Analytics',
  },
  {
    path: 'dashboard',
    loadComponent: () =>
      import('./features/dashboard/agent-monitor/agent-monitor.component').then(
        (m) => m.AgentMonitorComponent
      ),
    title: 'Agent Dashboard',
  },
  {
    path: 'history',
    loadComponent: () =>
      import('./features/pos-terminal/components/transaction-history/transaction-history.component').then(
        (m) => m.TransactionHistoryComponent
      ),
    title: 'Transaction History',
  },
  {
    path: 'settings',
    loadComponent: () =>
      import('./features/settings/settings.component').then((m) => m.SettingsComponent),
    title: 'Settings',
  },
  {
    path: '**',
    redirectTo: 'pos',
  },
];
