import { Routes } from '@angular/router';
import { authGuard } from '@core/presentation/guards/auth.guard';
import { CUSTOMER_AUTH_GATEWAY } from '@core/application/auth/ports/customer-auth-gateway.port';
import { CurrentCustomerService } from '@core/application/auth/current-customer.service';
import { redirectIfAuthenticatedGuard } from '@core/presentation/guards/redirect-if-authenticated.guard';
import { AppIdCustomerAuthAdapter } from '@core/infrastructure/auth/appid-customer-auth.adapter';
import { SELF_CHECKOUT_TITLE } from '@features/self-checkout/self-checkout-palette';
import { LANE_ROUTE } from '@features/self-checkout/self-checkout-routes';
import { PendingRegistrationStore } from '@features/self-checkout/pending-registration.store';

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
    // The customer-facing self-checkout family: the lane, plus the two side
    // paths epic #261 items 16/17 add. Its own top-level route like /clerk, and
    // deliberately WITHOUT `authGuard`: that guard is the staff session, and the
    // whole point of this lane is a customer identity.
    //
    // A component-less parent with `children`, not three sibling routes, and
    // that is the load-bearing part rather than tidiness. A route-level
    // `providers` array creates ONE environment injector for the route and
    // everything beneath it, so declaring the customer identity here gives the
    // guard, the form, the interstitial and the lane the same
    // `CurrentCustomerService` — one identity, one holder. As siblings each
    // carried its own copy, which meant three instances: a session published on
    // one was invisible to the next screen, and `redirectIfAuthenticatedGuard`
    // resolved a fourth, permanently-null instance and could never fire. The
    // sibling shape cannot be repaired by ordering; only a shared injector
    // fixes it, which is what this is.
    //
    // `CurrentCustomerService` belongs beside the gateway binding for the reason
    // its own doc comment gives — it is `@Injectable()` and not
    // `providedIn: 'root'` precisely so the customer session dies with the route
    // subtree instead of outliving it in the root injector, and so nothing
    // outside self-checkout can consult a customer identity for authorization.
    path: 'self-checkout',
    // The customer identity seam (epic #261 item 13), bound HERE and nowhere
    // else. Not in `auth.providers.ts` beside the staff `AUTH_GATEWAY`, and not
    // root-provided: `CUSTOMER_AUTH_GATEWAY` is unresolvable from the
    // application's root injector and nothing outside /self-checkout can resolve
    // a customer identity by accident. `customer-auth-gateway.port.ts`'s own
    // header states that requirement; `app.routes.spec.ts` asserts it against an
    // injector built from the real `appConfig.providers`, because a bare TestBed
    // injector would report the token absent either way.
    //
    // `InMemoryCustomerAuthAdapter` is untouched and still what specs provide.
    //
    // What it does NOT buy is a smaller self-checkout download. Measured, not
    // assumed (`npm run build`, then grepping the emitted chunks for each
    // adapter's `sessionStorage` key): both App ID adapters sit in the *initial*
    // bundle — the customer one because of the static import above. That is
    // inherent to binding a class in the eagerly-evaluated root route table;
    // getting it into a lazy chunk would take `loadChildren`, which the spec
    // deliberately forbids here (inline `children` below share this injector;
    // `loadChildren` would not let the guard reach it as directly). The
    // self-checkout chunks and their whole transitive closure contain neither
    // adapter and no `jose`, which is what item 11's review asked to confirm —
    // but they never did contain them, so extracting `APPID_CONFIG` into
    // `appid-config.ts` moves no bytes today. What it does remove is the
    // customer→staff-adapter import edge, so this route's graph stops depending
    // on the staff adapter before that coupling can start costing anything.
    // `appid-customer-auth.import-graph.spec.ts` is what keeps the edge gone.
    //
    // `PendingRegistrationStore` is here for the same reason and not a weaker one:
    // it is how the sign-up form tells the interstitial which inbox to name, and
    // as a per-child provider it would be two instances — the form remembering an
    // address the next screen cannot see, which is the query param this replaced
    // all over again, minus the disclosure.
    providers: [
      { provide: CUSTOMER_AUTH_GATEWAY, useClass: AppIdCustomerAuthAdapter },
      CurrentCustomerService,
      PendingRegistrationStore,
    ],
    children: [
      {
        // The customer's own sign-up form (epic #261 item 16). Guarded so an
        // already signed-in customer is sent back to the lane instead of a form
        // they have no use for — reading the very instance the lane writes,
        // which only holds because the providers above are the parent's.
        path: 'sign-up',
        canActivate: [redirectIfAuthenticatedGuard(CurrentCustomerService, LANE_ROUTE)],
        loadComponent: () =>
          import('./features/self-checkout/self-checkout-signup.component').then(
            (m) => m.SelfCheckoutSignUpComponent
          ),
        title: 'Create an Account · Capy-POS',
      },
      {
        // Item 17's placeholder (#311). Deliberately NOT behind
        // `redirectIfAuthenticatedGuard`: the account that lands here is
        // `PENDING`, and bouncing the customer off the one screen that explains
        // that is the opposite of what item 17 is for.
        path: 'check-email',
        loadComponent: () =>
          import('./features/self-checkout/self-checkout-check-email.component').then(
            (m) => m.SelfCheckoutCheckEmailComponent
          ),
        title: 'Check Your Email · Capy-POS',
      },
      {
        // The lane. `pathMatch: 'full'` rather than relying on the router
        // backtracking out of a prefix match, so /self-checkout/sign-up cannot
        // resolve here by accident of child ordering.
        path: '',
        pathMatch: 'full',
        loadComponent: () =>
          import('./features/self-checkout/self-checkout.component').then(
            (m) => m.SelfCheckoutComponent
          ),
        title: SELF_CHECKOUT_TITLE,
      },
    ],
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
