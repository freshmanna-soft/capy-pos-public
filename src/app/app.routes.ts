import { Routes } from '@angular/router';
import { authGuard } from '@core/presentation/guards/auth.guard';
import { permissionGuard } from '@core/presentation/guards/permission.guard';
import { SHOP_CUSTOMER_IDENTITY_PROVIDERS } from '@features/shop/customer-account/shop-customer-identity.providers';
import { Permission } from '@core/domain/auth';

export const routes: Routes = [
  {
    path: '',
    redirectTo: 'shop',
    pathMatch: 'full',
  },
  {
    path: 'kiosk',
    canActivate: [authGuard, permissionGuard(Permission.USE_KIOSK)],
    loadComponent: () =>
      import('./features/kiosk/kiosk-splash.component').then((m) => m.KioskSplashComponent),
    title: 'Welcome · Capy Shop',
  },
  {
    path: 'kiosk/shop',
    canActivate: [authGuard, permissionGuard(Permission.USE_KIOSK)],
    loadComponent: () =>
      import('./features/kiosk/kiosk-shop.component').then((m) => m.KioskShopComponent),
    title: 'Shop · Capy Shop',
  },
  {
    // Customer-phone scan-and-go route — no auth guard, no URL params.
    // Store is resolved at runtime from geofence / settings / fallback.
    //
    // The customer identity (App ID customer application) is bound HERE, on
    // this route's own injector, and never in the root: the account modal signs
    // a shopper in, and nothing outside /shop (or /self-checkout) may resolve
    // that identity — least of all staff authorization. ShopComponent hydrates a
    // persisted session on entry. /kiosk/shop deliberately does not get it — a
    // shared device must not keep a customer signed in for the next shopper.
    path: 'shop',
    providers: SHOP_CUSTOMER_IDENTITY_PROVIDERS,
    loadComponent: () => import('./features/shop/shop.component').then((m) => m.ShopComponent),
    title: 'Shop · Capy Shop',
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
    // MercadoPago back_url redirect targets. The tab that MP opens is sent
    // here after checkout; PaymentCallbackComponent broadcasts the result
    // via BroadcastChannel so the original tab can settle immediately.
    path: 'payment/success',
    loadComponent: () =>
      import('./features/payment-callback/payment-callback.component').then(
        (m) => m.PaymentCallbackComponent
      ),
    title: 'Payment complete',
  },
  {
    path: 'payment/failure',
    loadComponent: () =>
      import('./features/payment-callback/payment-callback.component').then(
        (m) => m.PaymentCallbackComponent
      ),
    title: 'Payment failed',
  },
  {
    path: 'payment/pending',
    loadComponent: () =>
      import('./features/payment-callback/payment-callback.component').then(
        (m) => m.PaymentCallbackComponent
      ),
    title: 'Payment pending',
  },
  {
    // The customer `/self-checkout` lane (and its sign-up, sign-in, check-email
    // and pay screens) was retired: customers shop and pay at /shop. Kept as an
    // explicit redirect rather than left to the wildcard below so the intent
    // survives a future change to the fallback, and so printed QR codes,
    // bookmarks and old emails keep landing customers in the shop.
    //
    // A component-less parent whose only child is `**`, not a bare
    // `redirectTo` on this path: the child wildcard matches the empty remainder
    // too, so `/self-checkout` and every `/self-checkout/<anything>` resolve
    // through the same absolute redirect, with nothing of the old path carried
    // into the shop URL.
    path: 'self-checkout',
    children: [{ path: '**', redirectTo: '/shop' }],
  },
  {
    path: '**',
    redirectTo: 'shop',
  },
];
