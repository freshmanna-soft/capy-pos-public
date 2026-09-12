import { Routes } from '@angular/router';
import { authGuard } from '@core/presentation/guards/auth.guard';
import { CUSTOMER_AUTH_GATEWAY } from '@core/application/auth/ports/customer-auth-gateway.port';
import { CurrentCustomerService } from '@core/application/auth/current-customer.service';
import { redirectIfAuthenticatedGuard } from '@core/presentation/guards/redirect-if-authenticated.guard';
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
    // The customer's own sign-up form (epic #261 item 16) and the interstitial it
    // lands on (item 17's placeholder). Listed BEFORE `self-checkout` on purpose:
    // that route has no `children`, so relying on prefix-match backtracking to
    // reach these would work only by accident of ordering. Siblings, not children,
    // because the lane's shell owns a full-screen takeover and its own cart, and
    // neither belongs to a form the customer reaches *instead of* scanning.
    //
    // Each carries its own copy of the customer identity providers for the same
    // reason the lane does: a route-level `providers` array is the only scope in
    // which `CUSTOMER_AUTH_GATEWAY` resolves, and `CurrentCustomerService` is
    // route-provided too so the session dies with the flow rather than outliving
    // it in the root injector.
    path: 'self-checkout/sign-up',
    canActivate: [redirectIfAuthenticatedGuard(CurrentCustomerService, '/self-checkout')],
    loadComponent: () =>
      import('./features/self-checkout/self-checkout-signup.component').then(
        (m) => m.SelfCheckoutSignUpComponent
      ),
    providers: [
      { provide: CUSTOMER_AUTH_GATEWAY, useClass: AppIdCustomerAuthAdapter },
      CurrentCustomerService,
    ],
    title: 'Create an Account · Capy-POS',
  },
  {
    // Deliberately NOT behind `redirectIfAuthenticatedGuard`: sign-up publishes the
    // session via `setSession()` before routing here, and a freshly created account
    // is `PENDING` anyway — bouncing the customer off the one screen that explains
    // that is the opposite of what item 17 is for.
    path: 'self-checkout/check-email',
    loadComponent: () =>
      import('./features/self-checkout/self-checkout-check-email.component').then(
        (m) => m.SelfCheckoutCheckEmailComponent
      ),
    providers: [
      { provide: CUSTOMER_AUTH_GATEWAY, useClass: AppIdCustomerAuthAdapter },
      CurrentCustomerService,
    ],
    title: 'Check Your Email · Capy-POS',
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
    // root-provided: a route-level `providers` array gives this route subtree its
    // own environment injector, so `CUSTOMER_AUTH_GATEWAY` is unresolvable from
    // the application's root injector and nothing outside /self-checkout can
    // resolve a customer identity by accident. `customer-auth-gateway.port.ts`'s
    // own header states that requirement; `app.routes.spec.ts` asserts it against
    // an injector built from the real `appConfig.providers`, because a bare
    // TestBed injector would report the token absent either way.
    //
    // `InMemoryCustomerAuthAdapter` is untouched and still what specs provide.
    //
    // What it does NOT buy is a smaller self-checkout download. Measured, not
    // assumed (`npm run build`, then grepping the emitted chunks for each
    // adapter's `sessionStorage` key): both App ID adapters sit in the *initial*
    // bundle — the customer one because of the static import right below. That is
    // inherent to binding a class in the eagerly-evaluated root route table;
    // getting it into the lazy chunk would take `loadChildren`, which the spec
    // above deliberately forbids here. The self-checkout chunk and its whole
    // transitive closure contain neither adapter and no `jose`, which is what
    // item 11's review asked to confirm — but they never did contain them, so
    // extracting `APPID_CONFIG` into `appid-config.ts` moves no bytes today.
    // What it does remove is the customer→staff-adapter import edge, so this
    // route's graph stops depending on the staff adapter before that coupling can
    // start costing anything (a `loadChildren` boundary here, a customer-only
    // build, a customer adapter that outgrows one file).
    // `appid-customer-auth.import-graph.spec.ts` is what keeps the edge gone.
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
