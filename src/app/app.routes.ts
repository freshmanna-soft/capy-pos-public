import { Routes } from '@angular/router';
import { authGuard } from '@core/presentation/guards/auth.guard';
import { SELF_CHECKOUT_TITLE } from '@features/self-checkout/self-checkout-palette';

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
    // Full-screen AI clerk. Shares the cart with /pos through PosFacade, so
    // scanning here and paying there is one transaction.
    //
    // Deliberately WITHOUT `authGuard` (#219): the clerk is the lane where a
    // customer checks themselves out with the capybara's help, so requiring a
    // staff session to reach it was an accident of it having been built for the
    // till first. Nothing behind it needs an operator — ClerkFacade and
    // clerk-agent-tools carry no operatorId, and transactions record no cashier
    // — so the gate was the only thing standing in the way. Customer identity
    // (and the customer-side payment step) layer on top via #218.
    path: 'clerk',
    loadComponent: () => import('./features/clerk/clerk.component').then((m) => m.ClerkComponent),
    title: 'Capy Clerk · Capy-POS',
  },
  {
    // The customer-facing self-checkout lane. Its own top-level route, like
    // /clerk, and deliberately WITHOUT `authGuard`: that guard is the staff
    // session, and the whole point of this lane is a customer identity. Real
    // customer-session gating arrives with the CUSTOMER_AUTH_GATEWAY adapter.
    path: 'self-checkout',
    loadComponent: () =>
      import('./features/self-checkout/self-checkout.component').then(
        (m) => m.SelfCheckoutComponent
      ),
    title: SELF_CHECKOUT_TITLE,
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
    path: 'assistant',
    canActivate: [authGuard],
    loadComponent: () =>
      import('./features/assistant/wx-assistant.component').then((m) => m.WxAssistantComponent),
    title: 'AI Assistant · Capy-POS',
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
