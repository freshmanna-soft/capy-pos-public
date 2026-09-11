import { Routes } from '@angular/router';
import { authGuard } from '@core/presentation/guards/auth.guard';
import { CUSTOMER_AUTH_GATEWAY } from '@core/application/auth/ports/customer-auth-gateway.port';
import { AppIdCustomerAuthAdapter } from '@core/infrastructure/auth/appid-customer-auth.adapter';
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
    // session, and the whole point of this lane is a customer identity.
    path: 'self-checkout',
    loadComponent: () =>
      import('./features/self-checkout/self-checkout.component').then(
        (m) => m.SelfCheckoutComponent
      ),
    // The customer identity seam (epic #261 item 13), bound HERE and nowhere
    // else. Not in `auth.providers.ts` beside the staff `AUTH_GATEWAY`, and not
    // root-provided: a route-level `providers` array creates an environment
    // injector for this route subtree only, so `CUSTOMER_AUTH_GATEWAY` is
    // unresolvable from the root injector and nothing outside /self-checkout can
    // resolve a customer identity by accident. `customer-auth-gateway.port.ts`'s
    // own header states that requirement; `app.routes.spec.ts` asserts both the
    // positive and the negative case.
    //
    // `InMemoryCustomerAuthAdapter` is untouched and still what specs provide.
    //
    // Bundle note (item 11's review finding, verified against the built output,
    // not assumed): the self-checkout lazy chunk contains neither App ID adapter
    // — zero hits for the staff adapter's `capy_pos_access_token` key in it.
    // `APPID_CONFIG` moving to `appid-config.ts` is what makes that hold as the
    // customer adapter grows; while it was imported from `appid-auth.adapter.ts`
    // anything reaching the customer adapter dragged the whole staff adapter
    // along. Both adapters resolve into the initial bundle rather than the chunk,
    // because a route-level `providers` array in this eagerly-loaded root route
    // table is by definition a static import — the staff adapter is already there
    // via `auth.providers.ts`, and pushing the customer one into the chunk would
    // mean `loadChildren`, which `app.routes.spec.ts` deliberately forbids here.
    providers: [{ provide: CUSTOMER_AUTH_GATEWAY, useClass: AppIdCustomerAuthAdapter }],
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
